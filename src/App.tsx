import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  FilePenLine,
  FolderOpen,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  Paintbrush,
  RotateCcw,
  Save,
  Send,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Connection = {
  baseUrl: string;
  apiKey: string;
};

type ImageTask = {
  id: string;
  status: "queued" | "running" | "success" | "error";
  mode: "generate" | "edit";
  model?: string;
  size?: string;
  quality?: string;
  created_at: string;
  updated_at: string;
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  error?: string;
  progress?: string;
  elapsed_secs?: number;
  duration_ms?: number;
};

type TaskRecord = ImageTask & {
  prompt: string;
  localCreatedAt: string;
  clientTaskId?: string;
  isLocalPending?: boolean;
  localBatchId?: number;
  localBatchIndex?: number;
  localSortKey?: string;
  savedFiles?: string[];
  localSaveError?: string;
  previewLoadError?: string;
};

type LocalResultRecord = {
  id: string;
  rel: string;
  name: string;
  path: string;
  url: string;
  originalUrl: string;
  prompt?: string;
  created_at: string;
  localCreatedAt: string;
  size: number;
  width?: number;
  height?: number;
  source: "local";
};

type NativeLocalImage = {
  id: string;
  rel: string;
  name: string;
  path: string;
  dataUrl?: string;
  data_url?: string;
  thumbnailDataUrl?: string;
  thumbnail_data_url?: string;
  thumbnailPath?: string;
  thumbnail_path?: string;
  prompt?: string;
  createdAt?: string;
  created_at?: string;
  localCreatedAt?: string;
  local_created_at?: string;
  size: number;
  width?: number;
  height?: number;
};

type NativeLocalImagePage = {
  items: NativeLocalImage[];
  total: number;
  page: number;
  pageSize?: number;
  page_size?: number;
  dates: string[];
};

type NativeDroppedFile = {
  name: string;
  dataUrl?: string;
  data_url?: string;
};

type Model = {
  id: string;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

type PromptAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  referenceImageCount?: number;
};

type Toast = {
  id: string;
  message: string;
  tone: "success" | "error" | "info";
};

type PreviewItem = {
  id: string;
  src: string;
  title: string;
  prompt: string;
};

type PendingPromptJob = {
  id: string;
  prompt: string;
  files: File[];
  model: string;
  size: string;
  quality: string;
  localCreatedAt: string;
  localBatchId: number;
  localBatchIndex: number;
  localSortKey: string;
};

type SubmitPromptOptions = {
  files?: File[];
  model?: string;
  size?: string;
  quality?: string;
};

type PromptQueueStats = {
  waiting: number;
  running: number;
};

const fixedBaseUrl = "https://1kgpt.hootoo.dpdns.org";
const defaultConnection: Connection = { baseUrl: fixedBaseUrl, apiKey: "" };
const defaultImageModel = "gpt-image-2";
const aspectOptions = [
  { label: "1:1", size: "1024x1024" },
  { label: "2:3", size: "1024x1536" },
  { label: "3:2", size: "1536x1024" },
  { label: "3:4", size: "1024x1365" },
  { label: "4:3", size: "1365x1024" },
  { label: "9:16", size: "1088x1920" },
  { label: "16:9", size: "1920x1088" },
  { label: "auto", size: "" },
];
const qualityOptions = ["auto", "low", "medium", "high"];
const activeStatuses = new Set<ImageTask["status"]>(["queued", "running"]);
const terminalStatuses = new Set<ImageTask["status"]>(["success", "error"]);
const promptQueueReleaseProgresses = new Set([
  "receiving_image",
  "image_receiving",
  "image_received",
  "downloading_image",
  "saving_image",
  "saved_image",
  "finalizing",
  "success",
  "completed",
  "complete",
]);
const maxReferenceImageEdge = 2048;
const referenceImageSizeThreshold = 5 * 1024 * 1024;
const referenceImageJpegQuality = 0.9;
const maxClientBatchConcurrency = 5;
const maxPreviewHydrateAttempts = 5;
const localResultPageSizeOptions = [10, 20, 50];
const taskStatusLabels: Record<ImageTask["status"], string> = {
  queued: "排队中",
  running: "生成中",
  success: "已完成",
  error: "失败",
};
const progressTextLabels: Record<string, string> = {
  queued: "排队中",
  pending: "排队中",
  running: "生成中",
  processing: "生成中",
  generating: "生成中",
  image_stream_resolve_start: "解析图片流",
  image_stream_resolving: "解析图片流",
  image_stream_resolve_done: "图片流解析完成",
  receiving_image: "接收图片中",
  image_receiving: "接收图片中",
  image_received: "图片接收完成",
  uploading_image: "上传图片中",
  resolving_image: "解析图片中",
  downloading_image: "下载图片中",
  saving_image: "保存图片中",
  saved_image: "图片已保存",
  finalizing: "收尾处理中",
  success: "已完成",
  completed: "已完成",
  complete: "已完成",
  error: "失败",
  failed: "失败",
  starting: "准备中",
  submitted: "已提交",
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(file.name);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function fileFromDataUrl(dataUrl: string, name: string) {
  const [meta, encoded = ""] = dataUrl.split(",", 2);
  const mime = meta.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name || "image", { type: mime });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("压缩图片失败"));
      }
    }, "image/jpeg", quality);
  });
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法读取图片：${file.name}`));
    };
    image.src = url;
  });
}

function jpegFileName(name: string) {
  const cleanName = name.trim() || "reference";
  return /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(cleanName)
    ? cleanName.replace(/\.[^.]+$/, ".jpg")
    : `${cleanName}.jpg`;
}

async function compressReferenceImage(file: File) {
  const image = await loadImageElement(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error(`图片尺寸无效：${file.name}`);
  if (file.size <= referenceImageSizeThreshold && Math.max(sourceWidth, sourceHeight) <= maxReferenceImageEdge) {
    return file;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前环境不支持图片压缩");

  const scale = Math.min(1, maxReferenceImageEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToJpegBlob(canvas, referenceImageJpegQuality);
  return new File([blob], jpegFileName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
}

function localDataUrlFromImageItem(item: { b64_json?: string; url?: string }) {
  return item.b64_json ? `data:image/png;base64,${item.b64_json}` : "";
}

function hasRemoteOnlyImageData(task: Pick<TaskRecord, "data" | "status">) {
  return task.status === "success" && Boolean(task.data?.some((item) => item.url && !item.b64_json));
}

function hasPendingPreviewHydration(task: Pick<TaskRecord, "data" | "status" | "previewLoadError">) {
  return !task.previewLoadError && hasRemoteOnlyImageData(task);
}

function formatSize(size: number) {
  if (!Number.isFinite(size)) return "-";
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}

function formatResolution(width?: number, height?: number) {
  return width && height ? `${width} x ${height}` : "--";
}

function aspectLabelFromSize(size?: string) {
  if (!size) return "";
  return aspectOptions.find((item) => item.size === size)?.label || "";
}

function compactLocalResultTitle(item: Pick<LocalResultRecord, "name" | "localCreatedAt">) {
  const cleanName = item.name.replace(/\.[^.]+$/, "");
  const match = cleanName.match(/^(\d{4}[-_]\d{1,2}[-_]\d{1,2})(?:[ T_-](\d{1,2})[-_:](\d{1,2})(?:[-_:](\d{1,2}))?)?/);
  if (match) {
    const [, date, hour, minute, second] = match;
    const time = hour && minute ? ` ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}${second ? `:${second.padStart(2, "0")}` : ""}` : "";
    return `${date.replace(/_/g, "-")}${time}`;
  }
  return item.localCreatedAt || cleanName;
}

function getErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "请求失败";
}

function isDirectoryAccessError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("permission")
    || message.includes("denied")
    || message.includes("operation not permitted")
    || message.includes("访问")
    || message.includes("权限");
}

function nativeLocalImageToRecord(item: NativeLocalImage): LocalResultRecord {
  const originalUrl = convertFileSrc(item.path);
  const thumbnailPath = item.thumbnail_path || item.thumbnailPath || "";
  const thumbnailUrl = thumbnailPath
    ? convertFileSrc(thumbnailPath)
    : item.thumbnail_data_url || item.thumbnailDataUrl || item.data_url || item.dataUrl || originalUrl;
  return {
    id: item.id,
    rel: item.rel,
    name: item.name,
    path: item.path,
    url: thumbnailUrl,
    originalUrl,
    prompt: item.prompt || "",
    created_at: item.created_at || item.createdAt || "",
    localCreatedAt: item.local_created_at || item.localCreatedAt || "",
    size: item.size,
    width: item.width,
    height: item.height,
    source: "local",
  };
}

function isActiveTask(task: Pick<ImageTask, "status">) {
  return activeStatuses.has(task.status);
}

function isPollableTask(task: TaskRecord) {
  return isActiveTask(task) && !task.isLocalPending;
}

function shouldApplyTaskUpdate(current: TaskRecord, next: ImageTask) {
  if (terminalStatuses.has(current.status) && isActiveTask(next)) return false;
  if (current.updated_at && next.updated_at && next.updated_at < current.updated_at) return false;
  return true;
}

function shouldReleasePromptQueueSlot(task: ImageTask) {
  return terminalStatuses.has(task.status) || Boolean(task.progress && promptQueueReleaseProgresses.has(task.progress));
}

function compactTaskForStorage(task: TaskRecord) {
  const data = task.data
    ?.map((item) => item.url ? { url: item.url } : null)
    .filter((item): item is { url: string } => Boolean(item));
  return {
    ...task,
    ...(data?.length ? { data } : { data: undefined }),
  };
}

function localSortKey(batchId: number, index: number) {
  return `${batchId}-${String(index).padStart(4, "0")}`;
}

function taskStatusLabel(status: ImageTask["status"]) {
  return taskStatusLabels[status] || status;
}

function progressText(value?: string) {
  const text = value?.trim();
  if (!text) return "";
  const key = text.toLowerCase();
  if (progressTextLabels[key]) return progressTextLabels[key];
  return key.includes("_") ? "处理中" : text;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function splitPromptGroups(value: string) {
  const blocks = value
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (blocks.length > 1) return blocks;
  const numberedItems = value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^(?:[-*•]|\d+[.)、]|[（(]\d+[）)])\s*/, "").trim())
    .filter(Boolean);
  return numberedItems.length > 1 ? numberedItems : blocks;
}

function promptAssistantContent(text: string, imageDataUrls: string[]) {
  if (!imageDataUrls.length) return text;
  return [
    { type: "text", text },
    ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
}

export default function App() {
  const [connection, setConnection] = useState<Connection>(defaultConnection);
  const [draftConnection, setDraftConnection] = useState<Connection>(connection);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [connectionState, setConnectionState] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [resultDir, setResultDir] = useState("");
  const [directoryMessage, setDirectoryMessage] = useState("");
  const startupDirectoryPrompted = useRef(false);

  const api = useMemo(() => createApiClient(draftConnection), [draftConnection]);

  const notify = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3200);
  }, []);

  const saveConnection = () => {
    const next = { baseUrl: fixedBaseUrl, apiKey: draftConnection.apiKey.trim() };
    setConnection(next);
    setDraftConnection(next);
    void invoke("save_connection", { value: next }).catch((error) => notify(getErrorMessage(error), "error"));
    notify("API Key 已保存", "success");
  };

  const chooseDirectory = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "选择本地结果目录" });
      if (!selected || Array.isArray(selected)) return;
      await invoke("save_settings", { value: { resultDir: selected } });
      setResultDir(selected);
      setDirectoryMessage(`已选择：${selected}`);
      notify("本地结果目录已保存", "success");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  };

  const clearDirectory = async () => {
    try {
      await invoke("save_settings", { value: { resultDir: null } });
      setResultDir("");
      setDirectoryMessage("");
      notify("已取消本地结果目录", "info");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  };

  const refreshModels = useCallback(async () => {
    try {
      await api.request<{ data: Model[] }>("/v1/models");
      return true;
    } catch {
      return false;
    }
  }, [api]);

  const checkConnection = async () => {
    setConnectionState("checking");
    setConnectionMessage("");
    try {
      await api.request("/auth/login", { method: "POST", body: {} });
      await refreshModels();
      await fetchImageTasks(api, []);
      setConnectionState("ok");
      setConnectionMessage("连接成功，任务与结果接口可用");
      notify("连接成功", "success");
    } catch (error) {
      setConnectionState("error");
      setConnectionMessage(getErrorMessage(error));
      notify(getErrorMessage(error), "error");
    }
  };

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<Connection>("load_connection"),
      invoke<{ resultDir?: string | null }>("load_settings"),
      isTauri() ? invoke<string>("host_platform") : Promise.resolve("browser"),
    ]).then(([savedConnection, settings, platform]) => {
      if (cancelled) return;
      const nextConnection = { baseUrl: fixedBaseUrl, apiKey: (savedConnection?.apiKey || "").trim() };
      setConnection(nextConnection);
      setDraftConnection(nextConnection);
      const savedDir = settings.resultDir || "";
      setResultDir(savedDir);
      setDirectoryMessage(savedDir ? `已记住：${savedDir}` : "");
      if (platform !== "macos" || startupDirectoryPrompted.current) return;
      if (!savedDir) {
        startupDirectoryPrompted.current = true;
        setSettingsOpen(true);
        window.setTimeout(() => void chooseDirectory(), 400);
        return;
      }
      void invoke("check_result_dir_access", { resultDir: savedDir }).catch((error) => {
        if (!isDirectoryAccessError(error) || startupDirectoryPrompted.current) return;
        startupDirectoryPrompted.current = true;
        setSettingsOpen(true);
        setDirectoryMessage("macOS 需要重新选择本地结果目录以授予读写权限");
        window.setTimeout(() => void chooseDirectory(), 400);
      });
    }).catch(() => {
      if (!cancelled) {
        setConnection(defaultConnection);
        setDraftConnection(defaultConnection);
        setDirectoryMessage("");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand rail-brand">
          <div className="brand-mark"><Paintbrush size={22} /></div>
          <h1>幻影畅享版</h1>
        </div>

        <button className="icon-btn rail-settings" onClick={() => setSettingsOpen(true)} title="配置">
          <Settings size={19} />
        </button>
      </aside>

      {settingsOpen ? (
        <div className="settings-popover" role="dialog" aria-modal="true" aria-label="配置中心">
          <div className="settings-popover-header">
            <div>
              <h2>配置中心</h2>
              <p>连接服务并选择本地结果目录</p>
            </div>
            <button className="icon-btn" onClick={() => setSettingsOpen(false)} title="关闭配置"><X size={18} /></button>
          </div>

          <div className="settings-content">
            <div className="settings-main">
              <div className="connection-panel">
                <div className="panel-title"><Settings size={16} />连接</div>
                <label>
                  <span><KeyRound size={14} />API Key</span>
                  <input value={draftConnection.apiKey} onChange={(event) => setDraftConnection((current) => ({ ...current, apiKey: event.target.value }))} placeholder="Bearer key" type="password" />
                </label>
                <div className="button-row">
                  <button className="btn primary" onClick={saveConnection}><Save size={16} />保存</button>
                  <button className="btn" onClick={checkConnection} disabled={connectionState === "checking"}>
                    {connectionState === "checking" ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}
                    测试
                  </button>
                </div>
                {connectionMessage ? <div className={`connection-status ${connectionState}`}>{connectionMessage}</div> : null}
              </div>

              <div className="connection-panel local-panel">
                <div className="panel-title"><FolderOpen size={16} />本地结果</div>
                <div className="button-row">
                  <button className="btn" onClick={chooseDirectory}><FolderOpen size={16} />选择目录</button>
                  <button className="icon-btn danger" onClick={clearDirectory} disabled={!resultDir} title="取消本地目录"><X size={16} /></button>
                </div>
                <div className={`local-status ${resultDir ? "ok" : ""}`}>
                  {resultDir ? directoryMessage || `已选择：${resultDir}` : "未选择目录时不能提交任务；选择后结果会直接落盘并生成缩略图"}
                </div>
              </div>
            </div>

            <div className="qr-panel">
              <div className="qr-card">
                <img src="/kafei.jpg" alt="请我喝咖啡二维码" />
                <span>微信扫码，请我喝咖啡</span>
              </div>
              <div className="qr-card">
                <img src="/qq%E7%BE%A4.png" alt="进群交流二维码" />
                <span>进群交流</span>
                <small>群号：543917943</small>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <main className="main">
        <GenerateView api={api} resultDir={resultDir} notify={notify} />
      </main>

      <div className="toast-stack">
        {toasts.map((toast) => <div className={`toast ${toast.tone}`} key={toast.id}>{toast.message}</div>)}
      </div>
    </div>
  );
}

function createApiClient(connection: Connection) {
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

function GenerateView({
  api,
  resultDir,
  notify,
}: {
  api: ReturnType<typeof createApiClient>;
  resultDir: string;
  notify: (message: string, tone?: Toast["tone"]) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const model = defaultImageModel;
  const [aspect, setAspect] = useState("1:1");
  const [quality, setQuality] = useState("auto");
  const [count, setCount] = useState(1);
  const [splitSubmit, setSplitSubmit] = useState(false);
  const [commonPrompt, setCommonPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReferenceDragging, setIsReferenceDragging] = useState(false);
  const [isProcessingReferences, setIsProcessingReferences] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<PromptAssistantMessage[]>([]);
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [localResults, setLocalResults] = useState<LocalResultRecord[]>([]);
  const [localResultDates, setLocalResultDates] = useState<string[]>([]);
  const [localResultDate, setLocalResultDate] = useState(localDateString());
  const [localResultPage, setLocalResultPage] = useState(1);
  const [localResultPageSize, setLocalResultPageSize] = useState(20);
  const [localResultTotal, setLocalResultTotal] = useState(0);
  const [isLocalResultsLoading, setIsLocalResultsLoading] = useState(false);
  const [queueStats, setQueueStats] = useState<PromptQueueStats>({ waiting: 0, running: 0 });
  const fileInput = useRef<HTMLInputElement | null>(null);
  const savingTaskIds = useRef(new Set<string>());
  const hydratingTaskIds = useRef(new Set<string>());
  const failedHydrateTaskIds = useRef(new Set<string>());
  const localLoadSeq = useRef(0);
  const saveTasksTimer = useRef<number | null>(null);
  const pendingPromptJobs = useRef<PendingPromptJob[]>([]);
  const runningPromptJobIds = useRef(new Set<string>());
  const promptQueueReleaseWaiters = useRef(new Map<string, () => void>());
  const previewHydrateAttempts = useRef(new Map<string, number>());
  const previewHydrateRetryAfter = useRef(new Map<string, number>());
  const previewHydrateRetryTimers = useRef(new Map<string, number>());
  const isPromptQueuePumping = useRef(false);
  const selectedSize = aspectOptions.find((item) => item.label === aspect)?.size || "";
  const activeTaskIds = useMemo(() => tasks.filter(isPollableTask).map((item) => item.id).join(","), [tasks]);
  const activeCount = activeTaskIds ? activeTaskIds.split(",").length : 0;
  const syncQueueStats = useCallback(() => {
    setQueueStats({
      waiting: pendingPromptJobs.current.length,
      running: runningPromptJobIds.current.size,
    });
  }, []);

  const releasePromptQueueWaiter = useCallback((task: ImageTask) => {
    if (!shouldReleasePromptQueueSlot(task)) return;
    const release = promptQueueReleaseWaiters.current.get(task.id);
    if (!release) return;
    promptQueueReleaseWaiters.current.delete(task.id);
    release();
  }, []);

  const schedulePreviewHydrateRetry = useCallback((taskId: string, attempt: number) => {
    if (previewHydrateRetryTimers.current.has(taskId)) return;
    const delay = Math.min(8000, attempt * 1500);
    previewHydrateRetryAfter.current.set(taskId, Date.now() + delay);
    const timer = window.setTimeout(() => {
      previewHydrateRetryTimers.current.delete(taskId);
      previewHydrateRetryAfter.current.delete(taskId);
      setTasks((current) => [...current]);
    }, delay);
    previewHydrateRetryTimers.current.set(taskId, timer);
  }, []);

  useEffect(() => () => {
    previewHydrateRetryTimers.current.forEach((timer) => window.clearTimeout(timer));
    previewHydrateRetryTimers.current.clear();
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<TaskRecord[]>("load_tasks").then((items) => {
      if (cancelled) return;
      setTasks(Array.isArray(items) ? items : []);
      setTasksLoaded(true);
    }).catch((error) => {
      if (!cancelled) {
        notify(getErrorMessage(error), "error");
        setTasksLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  useEffect(() => {
    if (!tasksLoaded) return;
    if (saveTasksTimer.current !== null) {
      window.clearTimeout(saveTasksTimer.current);
    }
    saveTasksTimer.current = window.setTimeout(() => {
      saveTasksTimer.current = null;
      void invoke("save_tasks", { tasks: tasks.slice(0, 100).map(compactTaskForStorage) }).catch((error) => notify(getErrorMessage(error), "error"));
    }, 800);
    return () => {
      if (saveTasksTimer.current !== null) {
        window.clearTimeout(saveTasksTimer.current);
        saveTasksTimer.current = null;
      }
    };
  }, [notify, tasks, tasksLoaded]);

  useEffect(() => {
    setLocalResultPage(1);
  }, [localResultDate, localResultPageSize]);

  const loadLocalResults = useCallback(async (dir: string, date: string, page: number, pageSize: number) => {
    const loadId = localLoadSeq.current + 1;
    localLoadSeq.current = loadId;
    setIsLocalResultsLoading(true);
    try {
      const result = await invoke<NativeLocalImagePage>("scan_local_images", {
        resultDir: dir,
        date,
        page,
        pageSize,
      });
      if (localLoadSeq.current !== loadId) {
        return;
      }
      setLocalResults(result.items.map(nativeLocalImageToRecord));
      setLocalResultDates(result.dates || []);
      setLocalResultTotal(result.total || 0);
      if (!result.total && date === localDateString() && result.dates?.length && !result.dates.includes(date)) {
        setLocalResultDate(result.dates[0]);
      }
      const nextPageSize = result.pageSize || result.page_size || pageSize;
      if (nextPageSize !== pageSize) setLocalResultPageSize(nextPageSize);
      if (result.page && result.page !== page) setLocalResultPage(result.page);
    } catch (error) {
      if (localLoadSeq.current !== loadId) return;
      setLocalResults([]);
      setLocalResultTotal(0);
      notify(getErrorMessage(error), "error");
    } finally {
      if (localLoadSeq.current === loadId) setIsLocalResultsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!resultDir) {
      localLoadSeq.current += 1;
      setLocalResults([]);
      setLocalResultDates([]);
      setLocalResultTotal(0);
      setIsLocalResultsLoading(false);
      return;
    }
    void loadLocalResults(resultDir, localResultDate, localResultPage, localResultPageSize);
    return () => {
      localLoadSeq.current += 1;
      setIsLocalResultsLoading(false);
    };
  }, [resultDir, localResultDate, localResultPage, localResultPageSize, loadLocalResults]);

  useEffect(() => {
    if (!resultDir) return;
    const pendingSaveTasks = tasks.filter((task) =>
      task.status === "success"
      && task.data?.length
      && !task.savedFiles?.length
      && !task.localSaveError
      && !savingTaskIds.current.has(task.id)
    );
    pendingSaveTasks.forEach((task) => {
      savingTaskIds.current.add(task.id);
      invoke<string[]>("save_task_images", {
        payload: {
          connection: api.connection,
          resultDir,
          taskId: task.id,
          prompt: task.prompt,
          localCreatedAt: task.localCreatedAt,
          localSortKey: task.localSortKey || task.created_at || task.localCreatedAt,
          data: task.data || [],
        },
      }).then((savedFiles) => {
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, savedFiles, localSaveError: "" } : item));
        if (savedFiles.length) notify(`已保存 ${savedFiles.length} 张到本地结果`, "success");
        return loadLocalResults(resultDir, localResultDate, localResultPage, localResultPageSize);
      }).catch((error) => {
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, localSaveError: getErrorMessage(error) } : item));
        notify(getErrorMessage(error), "error");
      }).finally(() => {
        savingTaskIds.current.delete(task.id);
      });
    });
  }, [api, loadLocalResults, localResultDate, localResultPage, localResultPageSize, notify, resultDir, tasks]);

  useEffect(() => {
    if (resultDir) return;
    const now = Date.now();
    const hydrateTargets = tasks.filter((task) =>
      hasPendingPreviewHydration(task)
      && !hydratingTaskIds.current.has(task.id)
      && !failedHydrateTaskIds.current.has(task.id)
      && (previewHydrateRetryAfter.current.get(task.id) || 0) <= now
    );
    hydrateTargets.forEach((task) => {
      hydratingTaskIds.current.add(task.id);
      invoke<ImageTask["data"]>("hydrate_task_images", {
        payload: {
          connection: api.connection,
          data: task.data || [],
        },
      }).then((data) => {
        previewHydrateAttempts.current.delete(task.id);
        previewHydrateRetryAfter.current.delete(task.id);
        const retryTimer = previewHydrateRetryTimers.current.get(task.id);
        if (retryTimer) {
          window.clearTimeout(retryTimer);
          previewHydrateRetryTimers.current.delete(task.id);
        }
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, data, previewLoadError: "" } : item));
      }).catch((error) => {
        const message = getErrorMessage(error);
        const nextAttempt = (previewHydrateAttempts.current.get(task.id) || 0) + 1;
        previewHydrateAttempts.current.set(task.id, nextAttempt);
        if (nextAttempt < maxPreviewHydrateAttempts) {
          schedulePreviewHydrateRetry(task.id, nextAttempt);
          return;
        }
        previewHydrateAttempts.current.delete(task.id);
        previewHydrateRetryAfter.current.delete(task.id);
        failedHydrateTaskIds.current.add(task.id);
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, previewLoadError: message } : item));
      }).finally(() => {
        hydratingTaskIds.current.delete(task.id);
      });
    });
  }, [api, resultDir, schedulePreviewHydrateRetry, tasks]);

  useEffect(() => {
    const activeIds = activeTaskIds ? activeTaskIds.split(",") : [];
    if (!activeIds.length) return;
    let cancelled = false;
    let inFlight = false;
    const syncTasks = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await fetchImageTasks(api, activeIds);
        if (cancelled) return;
        const taskMap = new Map(data.items.map((item) => [item.id, item]));
        data.items.forEach(releasePromptQueueWaiter);
        setTasks((current) => current.map((item) => {
          const next = taskMap.get(item.id);
          return next && shouldApplyTaskUpdate(item, next) ? { ...item, ...next } : item;
        }));
      } catch {
        // The next poll can recover.
      } finally {
        inFlight = false;
      }
    };
    void syncTasks();
    const timer = window.setInterval(syncTasks, 2200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, activeTaskIds, releasePromptQueueWaiter]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(files.map(fileToDataUrl)).then((items) => {
      if (!cancelled) setPreviews(items);
    }).catch(() => setPreviews([]));
    return () => {
      cancelled = true;
    };
  }, [files]);

  const addFiles = useCallback(async (nextFiles: FileList | File[]) => {
    const images = Array.from(nextFiles).filter(isImageFile);
    if (!images.length) return;
    const remainingSlots = Math.max(0, 8 - files.length);
    if (!remainingSlots) {
      notify("最多添加 8 张参考图", "error");
      return;
    }
    setIsProcessingReferences(true);
    try {
      const candidates = images.slice(0, remainingSlots);
      const results = await Promise.allSettled(candidates.map(compressReferenceImage));
      const compressed = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failed = results.flatMap((result) => result.status === "rejected" ? [getErrorMessage(result.reason)] : []);
      if (!compressed.length) throw new Error(failed[0] || "参考图处理失败");
      setFiles((current) => [...current, ...compressed].slice(0, 8));
      if (images.length > candidates.length) notify("最多添加 8 张参考图，超出的图片已跳过", "info");
      if (failed.length) notify(`已跳过 ${failed.length} 张无法处理的图片`, "info");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setIsProcessingReferences(false);
    }
  }, [files.length, notify]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsReferenceDragging(true);
        return;
      }
      if (event.payload.type === "leave") {
        setIsReferenceDragging(false);
        return;
      }
      if (event.payload.type !== "drop") return;
      setIsReferenceDragging(false);
      const paths = event.payload.paths;
      if (!paths.length) return;
      void invoke<NativeDroppedFile[]>("read_dropped_images", { paths }).then((items) => {
        if (cancelled) return;
        const droppedFiles = items
          .map((item) => {
            const dataUrl = item.dataUrl || item.data_url || "";
            return dataUrl ? fileFromDataUrl(dataUrl, item.name) : null;
          })
          .filter((file): file is File => Boolean(file));
        if (droppedFiles.length) {
          void addFiles(droppedFiles);
        } else {
          notify("拖入的文件不是图片", "error");
        }
      }).catch((error) => {
        if (!cancelled) notify(getErrorMessage(error), "error");
      });
    }).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    }).catch((error) => notify(getErrorMessage(error), "error"));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [addFiles, notify]);

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const waitForPromptQueueRelease = useCallback((task: ImageTask) => {
    if (shouldReleasePromptQueueSlot(task)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      promptQueueReleaseWaiters.current.set(task.id, resolve);
    });
  }, []);

  const runPromptJob = useCallback(async (job: PendingPromptJob) => {
    try {
      const task = job.files.length
        ? await createEditTask(api, { clientTaskId: job.id, files: job.files, prompt: job.prompt, model: job.model, size: job.size, quality: job.quality })
        : await createGenerationTask(api, { clientTaskId: job.id, prompt: job.prompt, model: job.model, size: job.size, quality: job.quality });
      const record: TaskRecord = {
        ...task,
        prompt: job.prompt,
        localCreatedAt: job.localCreatedAt,
        clientTaskId: job.id,
        isLocalPending: false,
        localBatchId: job.localBatchId,
        localBatchIndex: job.localBatchIndex,
        localSortKey: job.localSortKey,
      };
      setTasks((current) => {
        const replaced = current.map((item) => item.id === job.id || item.clientTaskId === job.id ? record : item);
        return replaced.some((item) => item.id === record.id) ? replaced : [record, ...replaced].slice(0, 100);
      });
      await waitForPromptQueueRelease(task);
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === job.id ? {
        ...item,
        status: "error",
        error: getErrorMessage(error),
        isLocalPending: false,
        updated_at: new Date().toISOString(),
      } : item));
      throw error;
    }
  }, [api, waitForPromptQueueRelease]);

  const pumpPromptQueue = useCallback(() => {
    if (!isPromptQueuePumping.current) {
      isPromptQueuePumping.current = true;
    }

    const launchNext = () => {
      while (runningPromptJobIds.current.size < maxClientBatchConcurrency && pendingPromptJobs.current.length) {
        const job = pendingPromptJobs.current.shift();
        if (!job) continue;
        runningPromptJobIds.current.add(job.id);
        syncQueueStats();
        void runPromptJob(job).catch((error) => {
          notify(getErrorMessage(error), "error");
        }).finally(() => {
          runningPromptJobIds.current.delete(job.id);
          syncQueueStats();
          launchNext();
        });
      }
      if (!pendingPromptJobs.current.length && runningPromptJobIds.current.size === 0) {
        isPromptQueuePumping.current = false;
        syncQueueStats();
        notify("批量队列已完成", "success");
      }
    };

    launchNext();
  }, [notify, runPromptJob, syncQueueStats]);

  const submitPromptList = async (prompts: string[], successSuffix: string, options: SubmitPromptOptions = {}) => {
    if (!resultDir) {
      notify("请先在配置中心选择本地结果目录", "error");
      return;
    }
    const cleanedPrompts = prompts.map((item) => item.trim()).filter(Boolean);
    if (!cleanedPrompts.length) {
      notify("请输入提示词", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const startedAt = Date.now();
      const submittedAt = new Date(startedAt);
      const submitFiles = options.files ?? files;
      const submitModel = options.model || model;
      const submitSize = options.size ?? selectedSize;
      const submitQuality = options.quality || quality;
      const jobs = cleanedPrompts.map((text, index): PendingPromptJob => ({
        id: `${startedAt}-${index}-${Math.random().toString(16).slice(2)}`,
        prompt: text,
        files: submitFiles.slice(),
        model: submitModel,
        size: submitSize,
        quality: submitQuality,
        localCreatedAt: submittedAt.toLocaleString(),
        localBatchId: startedAt,
        localBatchIndex: index,
        localSortKey: localSortKey(startedAt, index),
      }));
      const placeholders: TaskRecord[] = jobs.map((job) => ({
        id: job.id,
        status: "queued",
        mode: job.files.length ? "edit" : "generate",
        model: job.model,
        size: job.size,
        quality: job.quality,
        created_at: submittedAt.toISOString(),
        updated_at: submittedAt.toISOString(),
        prompt: job.prompt,
        localCreatedAt: job.localCreatedAt,
        clientTaskId: job.id,
        isLocalPending: true,
        localBatchId: job.localBatchId,
        localBatchIndex: job.localBatchIndex,
        localSortKey: job.localSortKey,
        progress: "等待本机提交",
      }));
      setTasks((current) => [...placeholders.slice().reverse(), ...current].slice(0, 100));
      pendingPromptJobs.current.push(...jobs);
      syncQueueStats();
      pumpPromptQueue();
      const waitingCount = pendingPromptJobs.current.length;
      const runningCount = runningPromptJobIds.current.size;
      notify(
        waitingCount || runningCount > jobs.length
          ? `已加入 ${jobs.length} 个任务，本地队列最多同时运行 ${maxClientBatchConcurrency} 个`
          : `已加入 ${jobs.length} 个任务，${successSuffix}`,
        "success",
      );
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = async () => {
    const text = prompt.trim();
    if (splitSubmit) {
      const groups = splitPromptGroups(text);
      if (groups.length <= 1) {
        notify("需要至少 2 段提示词才能拆分提交", "error");
        return;
      }
      const shared = commonPrompt.trim();
      const prompts = shared ? groups.map((group) => `${group}\n\n${shared}`) : groups;
      await submitPromptList(prompts, "每段已作为单独任务");
      return;
    }
    await submitPromptList(Array.from({ length: count }, () => text), "可继续提交");
  };

  const fillTaskForEdit = useCallback((task: TaskRecord) => {
    setPrompt(task.prompt || "");
    setSplitSubmit(false);
    setCommonPrompt("");
    setCount(1);
    const nextAspect = aspectLabelFromSize(task.size);
    if (nextAspect) setAspect(nextAspect);
    if (task.quality && qualityOptions.includes(task.quality)) setQuality(task.quality);
    if (task.mode === "generate") {
      setFiles([]);
    } else if (!files.length) {
      notify("这条编辑任务的参考图需要重新添加", "info");
    }
    notify("任务参数已填回左侧", "success");
  }, [files.length, notify]);

  const retryTask = useCallback(async (task: TaskRecord) => {
    if (task.status !== "error") return;
    const retryPrompt = (task.prompt || "").trim();
    if (!retryPrompt) {
      notify("这条任务没有可重新提交的提示词", "error");
      return;
    }
    if (task.mode === "edit" && !files.length) {
      notify("这条编辑任务需要先重新添加参考图", "error");
      return;
    }
    await submitPromptList([retryPrompt], "已重新提交", {
      files: task.mode === "edit" ? files.slice() : [],
      model: task.model || model,
      size: task.size ?? selectedSize,
      quality: task.quality || quality,
    });
  }, [files, model, notify, quality, selectedSize]);

  const deleteTasksAndFiles = useCallback(async (taskIds: string[]) => {
    const targets = tasks.filter((task) => taskIds.includes(task.id));
    if (!targets.length) return false;
    const savedPaths = targets.flatMap((task) => task.savedFiles || []);
    const confirmText = savedPaths.length
      ? `确定删除 ${targets.length} 个任务吗？删除会连同 ${savedPaths.length} 个本地文件一起删除，此操作不可撤销。`
      : `确定删除 ${targets.length} 个任务记录吗？此操作不可撤销。`;
    if (!window.confirm(confirmText)) return false;
    try {
      let removed = 0;
      if (savedPaths.length) {
        if (!resultDir) throw new Error("请先选择本地结果目录");
        removed = await invoke<number>("delete_local_images", { resultDir, paths: savedPaths });
        void loadLocalResults(resultDir, localResultDate, localResultPage, localResultPageSize);
      }
      setTasks((current) => current.filter((task) => !taskIds.includes(task.id)));
      notify(savedPaths.length ? `已删除 ${targets.length} 个任务和 ${removed} 张本地图片` : `已删除 ${targets.length} 个任务`, "success");
      return true;
    } catch (error) {
      notify(getErrorMessage(error), "error");
      return false;
    }
  }, [loadLocalResults, localResultDate, localResultPage, localResultPageSize, notify, resultDir, tasks]);

  const askAssistant = async () => {
    if (isAssistantLoading) return;
    const text = assistantInput.trim() || prompt.trim();
    if (!text) {
      notify("请输入想法或现有提示词", "error");
      return;
    }
    const referenceImageCount = files.length;
    const userMessage: PromptAssistantMessage = { id: `${Date.now()}-user`, role: "user", content: text, referenceImageCount: referenceImageCount || undefined };
    const nextMessages = [...assistantMessages, userMessage];
    setAssistantMessages(nextMessages);
    setAssistantInput("");
    setIsAssistantLoading(true);
    try {
      const reply = await askPromptAssistant(api, { messages: nextMessages, currentPrompt: prompt.trim(), mode: files.length ? "edit" : "generate", referenceImages: files });
      if (!reply) throw new Error("AI 没有返回提示词");
      setAssistantMessages((current) => [...current, { id: `${Date.now()}-assistant`, role: "assistant", content: reply }]);
    } catch (error) {
      setAssistantMessages((current) => current.filter((message) => message.id !== userMessage.id));
      notify(getErrorMessage(error), "error");
    } finally {
      setIsAssistantLoading(false);
    }
  };

  return (
    <section className="view generate-view">
      <div className="generate-layout">
        <div className="composer">
          <div className="prompt-assistant">
            <div className="assistant-chat">
              {assistantMessages.length ? assistantMessages.map((message) => (
                <div className={`assistant-message ${message.role}`} key={message.id}>
                  <p>{message.content}</p>
                  {message.referenceImageCount ? (
                    <div className="assistant-attachments"><ImageIcon size={13} />{message.referenceImageCount} 张参考图</div>
                  ) : null}
                  {message.role === "assistant" ? <button className="btn small" onClick={() => setPrompt(message.content)}>采用</button> : null}
                </div>
              )) : (
                <div className="assistant-empty">提示词助手</div>
              )}
              {isAssistantLoading ? (
                <div className="assistant-message assistant pending">
                  <p>生成中...</p>
                </div>
              ) : null}
            </div>
            <div className="assistant-input-row">
              <textarea
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void askAssistant();
                  }
                }}
                placeholder="让 AI 帮你整理提示词"
              />
              <div className="assistant-actions">
                <button className="btn" onClick={askAssistant} disabled={isAssistantLoading || isProcessingReferences}>
                  {isAssistantLoading ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
                  发送
                </button>
                <button className="btn" onClick={() => setAssistantMessages([])} disabled={!assistantMessages.length || isAssistantLoading}>清空</button>
              </div>
            </div>
          </div>
          <div className="prompt-tools">
            <label className="split-toggle">
              <input type="checkbox" checked={splitSubmit} onChange={(event) => setSplitSubmit(event.target.checked)} />
              <span>拆分提交</span>
            </label>
            {splitSubmit ? (
              <input
                value={commonPrompt}
                onChange={(event) => setCommonPrompt(event.target.value)}
                placeholder="公共提示词：统一风格、光线、镜头、色彩等"
              />
            ) : null}
          </div>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={splitSubmit ? "每段一组提示词，空行分隔；提交时每段会单独生成" : files.length ? "描述你希望如何修改参考图" : "输入你想生成的画面"} />
          <div
            className={`reference-panel ${isReferenceDragging ? "dragging" : ""} ${previews.length ? "has-previews" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsReferenceDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsReferenceDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsReferenceDragging(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsReferenceDragging(false);
              void addFiles(event.dataTransfer.files);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                void addFiles(event.target.files || []);
                event.currentTarget.value = "";
              }}
            />
            <button className="reference-upload-tile" type="button" onClick={() => fileInput.current?.click()} disabled={isProcessingReferences}>
              {isProcessingReferences ? <LoaderCircle size={22} className="spin" /> : <Upload size={22} />}
              <span>{isProcessingReferences ? "处理中" : "上传"}</span>
            </button>
            <div className="reference-preview-area">
              {previews.length ? previews.map((src, index) => (
                <div className="reference-thumb" key={`${src}-${index}`}>
                  <img src={src} alt="" />
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    title="移除参考图"
                  >
                    <X size={14} />
                  </button>
                </div>
              )) : (
                <div className="reference-placeholder">
                  <strong>添加参考图</strong>
                  <span>点击左侧上传，或把图片拖到这里</span>
                </div>
              )}
            </div>
          </div>

          <div className="controls-grid">
            <label><span>比例</span><select value={aspect} onChange={(event) => setAspect(event.target.value)}>{aspectOptions.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}</select></label>
            <label><span>质量</span><select value={quality} onChange={(event) => setQuality(event.target.value)}>{qualityOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>数量</span><input type="number" min={1} max={4} value={count} disabled={splitSubmit} onChange={(event) => setCount(Math.min(4, Math.max(1, Number(event.target.value) || 1)))} /></label>
            <button className="btn clear-prompt-button" type="button" onClick={() => setPrompt("")} disabled={!prompt.trim()}>
              <X size={15} />
              清空提示词
            </button>
          </div>

          <button className="btn primary run-button" onClick={submit} disabled={isSubmitting || isProcessingReferences}>
            {isSubmitting ? <LoaderCircle size={18} className="spin" /> : <Paintbrush size={18} />}
            {splitSubmit ? "拆分提交任务" : files.length ? "提交编辑任务" : "提交生成任务"}
          </button>
        </div>

        <TaskResultGrid
          tasks={tasks}
          localResults={localResults}
          localResultDate={localResultDate}
          localResultDates={localResultDates}
          localResultPage={localResultPage}
          localResultPageSize={localResultPageSize}
          localResultTotal={localResultTotal}
          isLocalResultsLoading={isLocalResultsLoading}
          activeCount={activeCount}
          queueStats={queueStats}
          onLocalResultDateChange={setLocalResultDate}
          onLocalResultPageChange={setLocalResultPage}
          onLocalResultPageSizeChange={setLocalResultPageSize}
          onUsePrompt={setPrompt}
          onEditTask={fillTaskForEdit}
          onRetryTask={retryTask}
          notify={notify}
          onDelete={deleteTasksAndFiles}
          onDeleteLocal={async (resultIds) => {
            const targets = localResults.filter((item) => resultIds.includes(item.id));
            if (!targets.length) return false;
            if (!window.confirm(`确定删除 ${targets.length} 张本地图片吗？文件、提示词记录和缩略图都会一起删除，此操作不可撤销。`)) return false;
            try {
              const removed = await invoke<number>("delete_local_images", { resultDir, paths: targets.map((item) => item.path) });
              setLocalResults((current) => current.filter((item) => !resultIds.includes(item.id)));
              setLocalResultTotal((current) => Math.max(0, current - removed));
              void loadLocalResults(resultDir, localResultDate, localResultPage, localResultPageSize);
              notify(`已删除 ${removed} 张本地图片`, "success");
              return true;
            } catch (error) {
              notify(getErrorMessage(error), "error");
              return false;
            }
          }}
        />
      </div>
    </section>
  );
}

async function createGenerationTask(api: ReturnType<typeof createApiClient>, payload: { clientTaskId: string; prompt: string; model: string; size: string; quality: string }) {
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

async function createEditTask(api: ReturnType<typeof createApiClient>, payload: { clientTaskId: string; files: File[]; prompt: string; model: string; size: string; quality: string }) {
  const fields: Array<[string, string]> = [
    ["client_task_id", payload.clientTaskId],
    ["prompt", payload.prompt],
    ["model", payload.model],
    ["quality", payload.quality],
  ];
  if (payload.size) fields.push(["size", payload.size]);
  return api.multipart<ImageTask>("/api/image-tasks/edits", fields, payload.files);
}

async function fetchImageTasks(api: ReturnType<typeof createApiClient>, ids: string[]) {
  const params = new URLSearchParams();
  if (ids.length) params.set("ids", ids.join(","));
  params.set("_t", String(Date.now()));
  return api.request<{ items: ImageTask[]; missing_ids: string[] }>(`/api/image-tasks?${params.toString()}`);
}

async function askPromptAssistant(
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

function TaskResultGrid({
  tasks,
  localResults,
  localResultDate,
  localResultDates,
  localResultPage,
  localResultPageSize,
  localResultTotal,
  isLocalResultsLoading,
  activeCount,
  queueStats,
  onLocalResultDateChange,
  onLocalResultPageChange,
  onLocalResultPageSizeChange,
  onUsePrompt,
  onEditTask,
  onRetryTask,
  notify,
  onDelete,
  onDeleteLocal,
}: {
  tasks: TaskRecord[];
  localResults: LocalResultRecord[];
  localResultDate: string;
  localResultDates: string[];
  localResultPage: number;
  localResultPageSize: number;
  localResultTotal: number;
  isLocalResultsLoading: boolean;
  activeCount: number;
  queueStats: PromptQueueStats;
  onLocalResultDateChange: (date: string) => void;
  onLocalResultPageChange: (page: number) => void;
  onLocalResultPageSizeChange: (pageSize: number) => void;
  onUsePrompt: (prompt: string) => void;
  onEditTask: (task: TaskRecord) => void;
  onRetryTask: (task: TaskRecord) => void | Promise<void>;
  notify: (message: string, tone?: Toast["tone"]) => void;
  onDelete: (taskIds: string[]) => Promise<boolean>;
  onDeleteLocal: (resultIds: string[]) => Promise<boolean>;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [columns, setColumns] = useState(5);
  const visibleTasks = useMemo(() => tasks.filter((task) => (
    isActiveTask(task)
    || task.status === "error"
    || !task.savedFiles?.length
  )), [tasks]);
  const visibleLocalResults = localResults;
  const previewItems = useMemo<PreviewItem[]>(() => [
    ...visibleTasks.flatMap((task) => {
      const firstImage = task.data?.map(localDataUrlFromImageItem).find(Boolean) || "";
      return firstImage ? [{
        id: task.id,
        src: firstImage,
        title: "生成结果",
        prompt: task.prompt,
      }] : [];
    }),
    ...visibleLocalResults.map((item) => ({
      id: item.id,
      src: item.originalUrl,
      title: compactLocalResultTitle(item),
      prompt: item.prompt || "",
    })),
  ], [visibleTasks, visibleLocalResults]);
  const previewIndexById = useMemo(() => new Map(previewItems.map((item, index) => [item.id, index])), [previewItems]);
  const lightboxItem = lightboxIndex === null ? null : previewItems[lightboxIndex] || null;
  const totalCount = visibleTasks.length + visibleLocalResults.length;
  const totalLocalPages = Math.max(1, Math.ceil(localResultTotal / localResultPageSize));
  const selectedSet = new Set(selected);

  useEffect(() => {
    setSelected((current) => current.filter((id) => visibleTasks.some((task) => task.id === id) || visibleLocalResults.some((item) => item.id === id)));
  }, [visibleTasks, visibleLocalResults]);

  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex >= previewItems.length) {
      setLightboxIndex(previewItems.length ? previewItems.length - 1 : null);
    }
  }, [lightboxIndex, previewItems.length]);

  const deleteItems = async (itemIds: string[]) => {
    const taskIds = itemIds.filter((id) => visibleTasks.some((task) => task.id === id));
    const localIds = itemIds.filter((id) => visibleLocalResults.some((item) => item.id === id));
    if (taskIds.length) {
      const deleted = await onDelete(taskIds);
      if (!deleted) return;
    }
    if (localIds.length) {
      const deleted = await onDeleteLocal(localIds);
      if (!deleted) return;
    }
    setSelected((current) => current.filter((id) => !itemIds.includes(id)));
  };

  const deleteTasks = async (taskIds: string[]) => {
    const deleted = await onDelete(taskIds);
    if (deleted) setSelected((current) => current.filter((taskId) => !taskIds.includes(taskId)));
  };

  return (
    <div className="results-panel">
      <div className="section-bar">
        <div>
          <h3>任务和结果</h3>
          <p>
            {tasks.length} 个任务，{localResultTotal} 张本地图片，{activeCount} 个服务运行中，
            本机运行 {queueStats.running} 个，排队 {queueStats.waiting} 个，已选 {selected.length} 个
          </p>
        </div>
        <div className="result-tools">
          <label className="result-date-control">
            <span>日期</span>
            <input
              type="date"
              value={localResultDate}
              list="local-result-dates"
              onChange={(event) => onLocalResultDateChange(event.target.value || localDateString())}
            />
            <datalist id="local-result-dates">
              {localResultDates.map((date) => <option key={date} value={date} />)}
            </datalist>
          </label>
          <label className="result-page-size">
            <span>每页</span>
            <select value={localResultPageSize} onChange={(event) => onLocalResultPageSizeChange(Number(event.target.value) || 20)}>
              {localResultPageSizeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <div className="pager-control" aria-label="本地结果分页">
            <button className="icon-btn" onClick={() => onLocalResultPageChange(Math.max(1, localResultPage - 1))} disabled={localResultPage <= 1 || isLocalResultsLoading} title="上一页">
              <ChevronLeft size={16} />
            </button>
            <span>{localResultPage}/{totalLocalPages}</span>
            <button className="icon-btn" onClick={() => onLocalResultPageChange(Math.min(totalLocalPages, localResultPage + 1))} disabled={localResultPage >= totalLocalPages || isLocalResultsLoading} title="下一页">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="column-control" aria-label="每排显示数量">
            {[2, 3, 4, 5].map((value) => (
              <button className={columns === value ? "active" : ""} key={value} onClick={() => setColumns(value)}>
                {value}
              </button>
            ))}
          </div>
          <button className="icon-btn danger" onClick={() => void deleteItems(selected)} disabled={!selected.length} title="删除选中的项目"><Trash2 size={16} /></button>
        </div>
      </div>
      <div className="task-scroll">
        {totalCount ? (
          <div className="image-grid task-grid" style={{ "--task-columns": columns } as React.CSSProperties}>
            {visibleTasks.map((task) => {
              const firstImage = task.data?.map(localDataUrlFromImageItem).find(Boolean) || "";
              const isActive = task.status === "queued" || task.status === "running";
              const isHydrating = hasPendingPreviewHydration(task);
              const previewStatus = task.previewLoadError && !firstImage && !isActive ? "预览不可用" : progressText(task.progress) || task.localCreatedAt;
              return (
                <article className="image-card" key={task.id}>
                  <label className="task-select">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(task.id)}
                      onChange={(event) => setSelected((current) => event.target.checked ? [...current, task.id] : current.filter((taskId) => taskId !== task.id))}
                    />
                    选择
                  </label>
                  <div className="image-frame">
                    <button className={`image-preview ${firstImage ? "" : "placeholder"}`} onClick={() => firstImage && setLightboxIndex(previewIndexById.get(task.id) ?? null)} disabled={!firstImage}>
                      {firstImage ? <img src={firstImage} alt={task.prompt} /> : isActive || isHydrating ? <LoaderCircle size={28} className="spin" /> : <ImageIcon size={30} />}
                      {task.savedFiles?.length ? <span className="saved-badge">已保存</span> : null}
                    </button>
                    <button className="image-card-action edit" type="button" title="编辑这条任务" onClick={() => onEditTask(task)}>
                      <FilePenLine size={15} />
                    </button>
                    {task.status === "error" ? (
                      <button className="image-card-action retry" type="button" title="重新提交" onClick={() => void onRetryTask(task)}>
                        <RotateCcw size={15} />
                      </button>
                    ) : null}
                    <button className="image-delete" type="button" title="删除" onClick={() => void deleteTasks([task.id])}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="image-meta">
                    <span className={`status-badge ${task.status}`}>{taskStatusLabel(task.status)}</span>
                  </div>
                  {task.error ? <p className="task-error">{task.error}</p> : null}
                  {task.localSaveError ? <p className="task-error">本地保存失败：{task.localSaveError}</p> : null}
                  <div className="card-actions">
                    <span className="task-time">{previewStatus}</span>
                  </div>
                </article>
              );
            })}
            {visibleLocalResults.map((item) => (
              <article className="image-card local-result-card" key={item.id}>
                <label className="task-select">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(item.id)}
                    onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}
                  />
                  选择
                </label>
                <div className="image-frame">
                  <button className="image-preview" onClick={() => setLightboxIndex(previewIndexById.get(item.id) ?? null)}>
                    <img src={item.url} alt={item.name} />
                    <span className="saved-badge">本地</span>
                  </button>
                  <button className="image-delete" type="button" title="删除" onClick={() => void deleteItems([item.id])}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="image-meta">
                  <strong title={item.name}>{compactLocalResultTitle(item)}</strong>
                </div>
                <div className="card-actions">
                  <span className="task-time">{formatSize(item.size)}</span>
                  <span className="task-time">{formatResolution(item.width, item.height)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon={isLocalResultsLoading ? <LoaderCircle size={30} className="spin" /> : <ImageIcon size={30} />} title={isLocalResultsLoading ? "正在读取本地结果" : "提交任务或选择本地结果目录后会出现在这里"} />
        )}
      </div>
      <Lightbox
        item={lightboxItem}
        hasPrevious={lightboxIndex !== null && lightboxIndex > 0}
        hasNext={lightboxIndex !== null && lightboxIndex < previewItems.length - 1}
        onPrevious={() => setLightboxIndex((current) => current === null ? current : Math.max(0, current - 1))}
        onNext={() => setLightboxIndex((current) => current === null ? current : Math.min(previewItems.length - 1, current + 1))}
        onClose={() => setLightboxIndex(null)}
        onCopy={(prompt) => {
          void navigator.clipboard.writeText(prompt).then(() => notify("提示词已复制", "success")).catch((error) => notify(getErrorMessage(error), "error"));
        }}
        onUsePrompt={(prompt) => {
          onUsePrompt(prompt);
          notify("提示词已填入", "success");
        }}
      />
    </div>
  );
}

function Lightbox({
  item,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onClose,
  onCopy,
  onUsePrompt,
}: {
  item: PreviewItem | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onCopy: (prompt: string) => void;
  onUsePrompt: (prompt: string) => void;
}) {
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);

  useEffect(() => {
    if (!item) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && hasPrevious) {
        event.preventDefault();
        onPrevious();
      }
      if (event.key === "ArrowRight" && hasNext) {
        event.preventDefault();
        onNext();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasNext, hasPrevious, item, onClose, onNext, onPrevious]);

  useEffect(() => {
    setIsPromptExpanded(false);
  }, [item?.id]);

  if (!item) return null;
  const prompt = item.prompt.trim();
  return (
    <div className="modal-backdrop lightbox" onClick={onClose}>
      <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose} title="关闭"><X size={18} /></button>
        <button className="icon-btn lightbox-nav previous" onClick={onPrevious} disabled={!hasPrevious} title="上一张"><ChevronLeft size={22} /></button>
        <img src={item.src} alt={prompt || item.title} />
        <button className="icon-btn lightbox-nav next" onClick={onNext} disabled={!hasNext} title="下一张"><ChevronRight size={22} /></button>
        <div className={`lightbox-prompt ${isPromptExpanded ? "expanded" : "collapsed"}`}>
          <div className="lightbox-prompt-header">
            <strong>{item.title}</strong>
            <div className="lightbox-actions">
              <button className="btn small" onClick={() => setIsPromptExpanded((current) => !current)}>
                {isPromptExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                {isPromptExpanded ? "收起" : "展开"}
              </button>
              <button className="btn small" onClick={() => prompt && onCopy(prompt)} disabled={!prompt}><Copy size={14} />复制</button>
              <button className="btn small primary" onClick={() => prompt && onUsePrompt(prompt)} disabled={!prompt}><Paintbrush size={14} />填入</button>
            </div>
          </div>
          <p>{prompt || "没有保存提示词"}</p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="empty-state">
      {icon}
      <span>{title}</span>
    </div>
  );
}
