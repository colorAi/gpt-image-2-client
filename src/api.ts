import { invoke } from "@tauri-apps/api/core";
import type { ChatCompletionResponse, Connection, ImageEditResponse, ImageTask, PromptAssistantMessage } from "./types";
import { fileToDataUrl, getErrorMessage, promptAssistantContent, shouldFallbackToSyncEdit } from "./utils";

export function createApiClient(connection: Connection) {
  async function request<T>(path: string, options: { method?: string; body?: unknown } = {}) {
    return invoke<T>("api_request", {
      payload: {
        connection,
        path,
        method: options.method || "GET",
        body: options.body ?? null,
      },
    });
  }

  async function multipart<T>(path: string, fields: Array<[string, string]>, files: File[]) {
    const encodedFiles = await Promise.all(files.map(async (file) => ({
      name: file.name,
      dataUrl: await fileToDataUrl(file),
    })));
    return invoke<T>("api_multipart_request", {
      payload: {
        connection,
        path,
        fields,
        files: encodedFiles,
      },
    });
  }

  return { request, multipart, connection };
}

export async function createGenerationTask(api: ReturnType<typeof createApiClient>, payload: { clientTaskId: string; prompt: string; model: string; size: string; quality: string }) {
  return api.request<ImageTask>("/api/image-tasks/generations", {
    method: "POST",
    body: {
      client_task_id: payload.clientTaskId,
      prompt: payload.prompt,
      model: payload.model,
      ...(payload.size ? { size: payload.size } : {}),
      quality: payload.quality,
    },
  });
}

export async function createEditTask(api: ReturnType<typeof createApiClient>, payload: { clientTaskId: string; files: File[]; prompt: string; model: string; size: string; quality: string }) {
  const fields: Array<[string, string]> = [
    ["client_task_id", payload.clientTaskId],
    ["prompt", payload.prompt],
    ["model", payload.model],
    ["quality", payload.quality],
  ];
  if (payload.size) fields.push(["size", payload.size]);
  try {
    return await api.multipart<ImageTask>("/api/image-tasks/edits", fields, payload.files);
  } catch (error) {
    if (!shouldFallbackToSyncEdit(error)) throw error;
    return createSyncEditTaskFallback(api, payload, error);
  }
}

export async function createSyncEditTaskFallback(
  api: ReturnType<typeof createApiClient>,
  payload: { clientTaskId: string; files: File[]; prompt: string; model: string; size: string; quality: string },
  primaryError: unknown,
) {
  const fields: Array<[string, string]> = [
    ["prompt", payload.prompt],
    ["model", payload.model],
    ["quality", payload.quality],
    ["n", "1"],
    ["response_format", "url"],
  ];
  if (payload.size) fields.push(["size", payload.size]);
  try {
    const result = await api.multipart<ImageEditResponse>("/v1/images/edits", fields, payload.files);
    const now = new Date().toISOString();
    return {
      id: payload.clientTaskId,
      status: "success",
      mode: "edit",
      model: payload.model,
      size: payload.size,
      quality: payload.quality,
      created_at: now,
      updated_at: now,
      data: result.data || [],
      progress: "success",
    } satisfies ImageTask;
  } catch (fallbackError) {
    throw new Error(`图生图任务接口失败：${getErrorMessage(primaryError)}；兼容接口也失败：${getErrorMessage(fallbackError)}`);
  }
}

export async function fetchImageTasks(api: ReturnType<typeof createApiClient>, ids: string[]) {
  const params = new URLSearchParams();
  if (ids.length) params.set("ids", ids.join(","));
  params.set("_t", String(Date.now()));
  return api.request<{ items: ImageTask[]; missing_ids: string[] }>(`/api/image-tasks?${params.toString()}`);
}

export async function askPromptAssistant(
  api: ReturnType<typeof createApiClient>,
  payload: { messages: PromptAssistantMessage[]; currentPrompt: string; mode: "generate" | "edit"; referenceImages: File[] },
) {
  const recentMessages = payload.messages.slice(-8);
  const latestMessage = recentMessages[recentMessages.length - 1];
  const priorMessages = recentMessages.slice(0, -1);
  const imageDataUrls = await Promise.all(payload.referenceImages.map(fileToDataUrl));
  const latestUserText = [
    payload.mode === "edit" ? "当前是图生图/编辑模式，参考图已附在本条消息中。" : "当前是文生图模式。",
    payload.currentPrompt ? `当前提示词：${payload.currentPrompt}` : "",
    "请根据下面用户本轮需求，结合前面对话，给出可直接用于生图的提示词。",
    latestMessage?.content ? `用户本轮需求：${latestMessage.content}` : "",
  ].filter(Boolean).join("\n");
  const data = await api.request<ChatCompletionResponse>("/v1/chat/completions", {
    method: "POST",
    body: {
      model: "auto",
      stream: false,
      modalities: ["text"],
      messages: [
        {
          role: "system",
          content: "你是图片生成提示词助手。根据用户想法输出一段可直接用于生图的中文提示词，画面主体、构图、风格、光线、色彩、细节要具体。只输出提示词正文，不要解释。",
        },
        ...priorMessages.map((message) => ({ role: message.role, content: message.content })),
        { role: "user", content: promptAssistantContent(latestUserText, imageDataUrls) },
      ],
    },
  });
  return data.choices?.[0]?.message?.content?.trim() || "";
}

export async function translatePromptText(api: ReturnType<typeof createApiClient>, prompt: string) {
  const data = await api.request<ChatCompletionResponse>("/v1/chat/completions", {
    method: "POST",
    body: {
      model: "auto",
      stream: false,
      modalities: ["text"],
      messages: [
        {
          role: "system",
          content: "你是提示词翻译器。判断用户输入主要是中文还是英文：中文翻译成自然、准确的英文；英文翻译成自然、准确的中文。保留段落、列表、参数和专有名词含义。只输出翻译后的提示词正文，不要解释。",
        },
        { role: "user", content: prompt },
      ],
    },
  });
  return data.choices?.[0]?.message?.content?.trim() || "";
}

export type ApiClient = ReturnType<typeof createApiClient>;
