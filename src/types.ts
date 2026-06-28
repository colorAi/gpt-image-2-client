export type ApiChannel = "dream" | "stable";
export type ImageResolution = "1K" | "2K" | "4K";
export type ApiKeys = Record<ApiChannel, string>;
export type ApiBaseUrls = Record<ApiChannel, string>;

export type Connection = {
  baseUrl: string;
  apiKey: string;
  channel: ApiChannel;
  apiKeys: ApiKeys;
  apiBaseUrls: ApiBaseUrls;
};

export type ThemeMode = "light" | "dark";
export type AppearanceMode = "default" | "dragon-boat";

export type ImageTask = {
  id: string;
  status: "queued" | "running" | "success" | "error";
  mode: "generate" | "edit";
  channel?: ApiChannel;
  model?: string;
  size?: string;
  quality?: string;
  created_at: string;
  updated_at: string;
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string; mime_type?: string }>;
  error?: string;
  progress?: string;
  elapsed_secs?: number;
  duration_ms?: number;
};

export type ImageEditResponse = {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string; mime_type?: string }>;
};

export type TaskRecord = ImageTask & {
  prompt: string;
  taskType?: "generate" | "edit" | "reverse";
  localCreatedAt: string;
  runningStartedAt?: number;
  runningElapsedBase?: number;
  clientTaskId?: string;
  isLocalPending?: boolean;
  localBatchId?: number;
  localBatchIndex?: number;
  localSortKey?: string;
  savedFiles?: string[];
  localSaveError?: string;
  previewLoadError?: string;
  reverseSourceImage?: {
    dataUrl: string;
    name: string;
    type: string;
  };
};

export type LocalResultRecord = {
  id: string;
  rel: string;
  name: string;
  path: string;
  url: string;
  originalUrl: string;
  prompt?: string;
  taskType?: "generate" | "edit" | "reverse";
  created_at: string;
  localCreatedAt: string;
  size: number;
  width?: number;
  height?: number;
  source: "local";
};

export type NativeLocalImage = {
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
  taskType?: "generate" | "edit" | "reverse";
  task_type?: "generate" | "edit" | "reverse";
  createdAt?: string;
  created_at?: string;
  localCreatedAt?: string;
  local_created_at?: string;
  size: number;
  width?: number;
  height?: number;
};

export type NativeLocalImagePage = {
  items: NativeLocalImage[];
  total: number;
  overallTotal?: number;
  overall_total?: number;
  page: number;
  pageSize?: number;
  page_size?: number;
  dates: string[];
};

export type NativeDroppedFile = {
  name: string;
  dataUrl?: string;
  data_url?: string;
};

export type Model = {
  id: string;
};

export type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export type PromptAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  referenceImageCount?: number;
};

export type Toast = {
  id: string;
  message: string;
  tone: "success" | "error" | "info";
};

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  resolve: (confirmed: boolean) => void;
};

export type PreviewItem = {
  id: string;
  src: string;
  title: string;
  prompt: string;
};

export type PendingPromptJob = {
  id: string;
  prompt: string;
  files: File[];
  channel: ApiChannel;
  model: string;
  size: string;
  quality: string;
  localCreatedAt: string;
  localBatchId: number;
  localBatchIndex: number;
  localSortKey: string;
};

export type SubmitPromptOptions = {
  files?: File[];
  channel?: ApiChannel;
  model?: string;
  size?: string;
  quality?: string;
  replaceTaskId?: string;
};

export type PromptQueueStats = {
  waiting: number;
  running: number;
};
