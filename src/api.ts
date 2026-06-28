import { invoke } from "@tauri-apps/api/core";
import type { ChatCompletionResponse, Connection, ImageEditResponse, ImageTask, PromptAssistantMessage } from "./types";
import { fileToDataUrl, getErrorMessage, promptAssistantContent, shouldFallbackToSyncImage } from "./utils";

export function createApiClient(connection: Connection) {
  async function request<T>(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    return invoke<T>("api_request", {
      payload: {
        connection,
        path,
        method: options.method || "GET",
        body: options.body ?? null,
        headers: options.headers ?? null,
      },
    });
  }

  async function multipart<T>(path: string, fields: Array<[string, string]>, files: File[], headers?: Record<string, string>) {
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
        headers: headers ?? null,
      },
    });
  }

  return { request, multipart, connection };
}

export async function createGenerationTask(api: ReturnType<typeof createApiClient>, payload: { clientTaskId: string; prompt: string; model: string; size: string; quality: string }): Promise<ImageTask> {
  if (api.connection.channel === "stable") {
    const body: Record<string, unknown> = {
      model: payload.model,
      prompt: payload.prompt,
      n: 1,
      response_format: "url",
      size: payload.size || "auto",
    };
    if (payload.quality !== "auto") body.quality = payload.quality;
    try {
      const result = await api.request<StableImageTaskResponse>("/v1/images/async/generations", {
        method: "POST",
        headers: { "X-Image-Task-ID": payload.clientTaskId },
        body,
      });
      return normalizeStableImageTask(result, {
        fallbackId: payload.clientTaskId,
        mode: "generate",
        model: payload.model,
        size: payload.size,
        quality: payload.quality,
      });
    } catch (error) {
      if (!shouldFallbackToSyncImage(error)) throw error;
      return createSyncGenerationTaskFallback(api, payload, error);
    }
  }

  const result = await api.request<ImageTask>("/api/image-tasks/generations", {
    method: "POST",
    body: {
      client_task_id: payload.clientTaskId,
      prompt: payload.prompt,
      model: payload.model,
      ...(payload.size ? { size: payload.size } : {}),
      quality: payload.quality,
    },
  });
  return { ...result, channel: "dream" };
}

export async function createEditTask(api: ReturnType<typeof createApiClient>, payload: { clientTaskId: string; files: File[]; prompt: string; model: string; size: string; quality: string }): Promise<ImageTask> {
  if (api.connection.channel === "stable") {
    const fields: Array<[string, string]> = [
      ["model", payload.model],
      ["prompt", payload.prompt],
      ["n", "1"],
      ["response_format", "url"],
      ["size", payload.size || "auto"],
    ];
    if (payload.quality !== "auto") fields.push(["quality", payload.quality]);
    try {
      const result = await api.multipart<StableImageTaskResponse>(
        "/v1/images/async/edits",
        fields,
        payload.files,
        { "X-Image-Task-ID": payload.clientTaskId },
      );
      return normalizeStableImageTask(result, {
        fallbackId: payload.clientTaskId,
        mode: "edit",
        model: payload.model,
        size: payload.size,
        quality: payload.quality,
      });
    } catch (error) {
      if (!shouldFallbackToSyncImage(error)) throw error;
      return createSyncEditTaskFallback(api, payload, error, "异步图生图接口");
    }
  }

  const fields: Array<[string, string]> = [
    ["client_task_id", payload.clientTaskId],
    ["prompt", payload.prompt],
    ["model", payload.model],
    ["quality", payload.quality],
  ];
  if (payload.size) fields.push(["size", payload.size]);
  try {
    const result = await api.multipart<ImageTask>("/api/image-tasks/edits", fields, payload.files);
    return { ...result, channel: "dream" };
  } catch (error) {
    if (!shouldFallbackToSyncImage(error)) throw error;
    return createSyncEditTaskFallback(api, payload, error, "图生图任务接口");
  }
}

export async function createSyncGenerationTaskFallback(
  api: ReturnType<typeof createApiClient>,
  payload: { clientTaskId: string; prompt: string; model: string; size: string; quality: string },
  primaryError: unknown,
): Promise<ImageTask> {
  const body: Record<string, unknown> = {
    prompt: payload.prompt,
    model: payload.model,
    n: 1,
    response_format: "url",
  };
  if (payload.size) body.size = payload.size;
  if (payload.quality !== "auto") body.quality = payload.quality;
  try {
    const result = await api.request<ImageEditResponse>("/v1/images/generations", {
      method: "POST",
      body,
    });
    const now = new Date().toISOString();
    return {
      id: payload.clientTaskId,
      status: "success",
      mode: "generate",
      channel: api.connection.channel,
      model: payload.model,
      size: payload.size,
      quality: payload.quality,
      created_at: now,
      updated_at: now,
      data: result.data || [],
      progress: "success",
    } satisfies ImageTask;
  } catch (fallbackError) {
    throw new Error(`异步文生图接口失败：${getErrorMessage(primaryError)}；兼容接口也失败：${getErrorMessage(fallbackError)}`);
  }
}

export async function createSyncEditTaskFallback(
  api: ReturnType<typeof createApiClient>,
  payload: { clientTaskId: string; files: File[]; prompt: string; model: string; size: string; quality: string },
  primaryError: unknown,
  primaryLabel = "图生图任务接口",
): Promise<ImageTask> {
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
      channel: api.connection.channel,
      model: payload.model,
      size: payload.size,
      quality: payload.quality,
      created_at: now,
      updated_at: now,
      data: result.data || [],
      progress: "success",
    } satisfies ImageTask;
  } catch (fallbackError) {
    throw new Error(`${primaryLabel}失败：${getErrorMessage(primaryError)}；兼容接口也失败：${getErrorMessage(fallbackError)}`);
  }
}

export async function fetchImageTasks(api: ReturnType<typeof createApiClient>, ids: string[]) {
  if (api.connection.channel === "stable") {
    const items = await Promise.all(ids.map(async (id) => {
      const result = await api.request<StableImageTaskResponse>(`/v1/images/tasks/${encodeURIComponent(id)}`);
      return normalizeStableImageTask(result, { fallbackId: id });
    }));
    return { items, missing_ids: [] };
  }

  const params = new URLSearchParams();
  if (ids.length) params.set("ids", ids.join(","));
  params.set("_t", String(Date.now()));
  return api.request<{ items: ImageTask[]; missing_ids: string[] }>(`/api/image-tasks?${params.toString()}`);
}

type StableImageTaskResponse = {
  task_id?: string;
  taskId?: string;
  status?: string;
  status_code?: number;
  statusCode?: number;
  response?: unknown;
  response_text?: string;
  error?: unknown;
  progress?: string;
  created_at?: string;
  updated_at?: string;
};

function normalizeStableImageTask(
  task: StableImageTaskResponse,
  context: {
    fallbackId: string;
    mode?: "generate" | "edit";
    model?: string;
    size?: string;
    quality?: string;
  },
): ImageTask {
  const responsePayload = task.response ?? parseJsonText(task.response_text);
  const statusCode = task.status_code ?? task.statusCode ?? 200;
  const normalizedStatus = normalizeStableStatus(task.status, statusCode);
  const data = extractStableImageData(responsePayload);
  const error = normalizedStatus === "error" ? stableTaskError(task, responsePayload, statusCode) : undefined;
  const now = new Date().toISOString();
  return {
    id: task.task_id || task.taskId || context.fallbackId,
    status: normalizedStatus,
    mode: context.mode || "generate",
    channel: "stable",
    ...(context.model ? { model: context.model } : {}),
    ...(context.size ? { size: context.size } : {}),
    ...(context.quality ? { quality: context.quality } : {}),
    created_at: task.created_at || now,
    updated_at: task.updated_at || now,
    ...(data ? { data } : {}),
    ...(error ? { error } : {}),
    progress: task.progress || task.status || normalizedStatus,
  };
}

function normalizeStableStatus(status: string | undefined, statusCode: number): ImageTask["status"] {
  const normalizedStatus = status?.trim().toLowerCase();
  if (normalizedStatus === "failed" || normalizedStatus === "error") return "error";
  if (normalizedStatus === "succeeded" || normalizedStatus === "success" || normalizedStatus === "completed") {
    return statusCode < 200 || statusCode >= 300 ? "error" : "success";
  }
  if (normalizedStatus === "queued" || normalizedStatus === "pending") return "queued";
  if (normalizedStatus === "running" || normalizedStatus === "processing") return "running";
  if (statusCode > 0 && (statusCode < 200 || statusCode >= 300)) return "error";
  return "running";
}

function parseJsonText(text?: string) {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function extractStableImageData(payload: unknown): ImageTask["data"] {
  if (!payload || typeof payload !== "object") return undefined;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;
  return data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { b64_json?: unknown; url?: unknown; revised_prompt?: unknown };
    const image = {
      ...(typeof row.b64_json === "string" ? { b64_json: row.b64_json } : {}),
      ...(typeof row.url === "string" ? { url: row.url } : {}),
      ...(typeof row.revised_prompt === "string" ? { revised_prompt: row.revised_prompt } : {}),
    };
    return image.b64_json || image.url ? [image] : [];
  });
}

function stableTaskError(task: StableImageTaskResponse, payload: unknown, statusCode: number) {
  const candidates = [
    task.error,
    payload && typeof payload === "object" ? (payload as { error?: unknown }).error : undefined,
    payload && typeof payload === "object" ? (payload as { message?: unknown }).message : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const message = (candidate as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  }
  return `稳定版任务失败（HTTP ${statusCode}）`;
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

export async function reversePromptFromImages(api: ReturnType<typeof createApiClient>, referenceImages: File[]) {
  const imageDataUrls = await Promise.all(referenceImages.map(fileToDataUrl));
  const systemPrompt = [
    "你是一名图片反推提示词专家。请根据输入图片输出一段可直接用于图像生成的自然语言提示词。",
    "核心目标是还原主体，而不是写分析报告。优先描述最影响复现的可见信息：主体是谁/是什么、服装或产品样式、颜色、材质、身材或外形轮廓、姿势动作、朝向角度、与周围物体的关系、场景、构图、光线和画面质感。不要编造看不到的元素。输出长度控制在500字左右。",
    "如果主体是人物，必须优先写清人物性别/年龄感/发型发色、身材比例和体态轮廓、肤色、可见服饰的具体类别、颜色、剪裁、覆盖范围、材质和细节。例如看到黑色比基尼、吊带、抹胸、泳装、外套、短裤、长裙等，必须直接写出，不要用“深色服装”“夏季服饰”等模糊词替代；贴身、露肩、露腰、高腰、低腰、绑带、分体式等可见结构也要写清。",
    "人物动作要按真实画面还原：身体朝向、肩线和躯干方向、头部转向、脸部朝向、视线方向、手臂和腿部位置、坐姿/站姿/倚靠/半坐/跨坐关系。不要把仅头部转向误写成侧身；不要把正面或半正面写成背面；所有左右方向统一用观看者视角的“画面左侧/画面右侧”。",
    "景别只需作为简短约束补充，不要喧宾夺主。写明是特写、半身、中景、全身或远景，以及大致裁切到胸部、腰部、大腿、膝盖、脚部或完整主体即可，目的是避免把半身生成成全景。",
    "如果主体不是人物，不要套用人体术语，改为优先描述该对象的类别、形状结构、颜色材质、表面细节、摆放角度、空间关系和使用场景。",
    "输出应像一条最终提示词，把关键复现点压缩成一段连贯描述。主体服饰、外形和动作角度必须比环境氛围更靠前、更具体。",
    "不要说“这张图片”“图片展示了”“I can see”。不要输出解释、标题、编号或 Markdown。",
    "忽略水印、品牌、界面文字和无关文字，除非文字本身是画面主体。",
    "不要追加任何平台专属参数、命令或开关。",
  ].join("\n");
  const data = await api.request<ChatCompletionResponse>("/v1/chat/completions", {
    method: "POST",
    body: {
      model: "auto",
      stream: false,
      modalities: ["text"],
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: promptAssistantContent("请根据所附参考图反推最终图像生成提示词。", imageDataUrls),
        },
      ],
    },
  });
  return data.choices?.[0]?.message?.content?.trim() || "";
}

export type ApiClient = ReturnType<typeof createApiClient>;
