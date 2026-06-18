export type Connection = {
  baseUrl: string;
  apiKey: string;
};

export type ThemeMode = "light" | "dark";

export type ImageTask = {
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

export type ImageEditResponse = {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
};

export type TaskRecord = ImageTask & {
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

export type LocalResultRecord = {
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
  model?: string;
  size?: string;
  quality?: string;
  replaceTaskId?: string;
};

export type PromptQueueStats = {
  waiting: number;
  running: number;
};
