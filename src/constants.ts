import type { Connection, ImageTask } from "./types";

export const fixedBaseUrl = "https://1kgpt.hootoo.dpdns.org";
export const clientDownloadUrl = "https://pan.quark.cn/s/3da05efbef6e";
export const defaultConnection: Connection = { baseUrl: fixedBaseUrl, apiKey: "" };
export const defaultImageModel = "gpt-image-2";
export const aspectOptions = [
  { label: "1:1", size: "1024x1024" },
  { label: "2:3", size: "1024x1536" },
  { label: "3:2", size: "1536x1024" },
  { label: "3:4", size: "1024x1365" },
  { label: "4:3", size: "1365x1024" },
  { label: "9:16", size: "1088x1920" },
  { label: "16:9", size: "1920x1088" },
  { label: "auto", size: "" },
];
export const qualityOptions = ["auto", "low", "medium", "high"];
export const activeStatuses = new Set<ImageTask["status"]>(["queued", "running"]);
export const terminalStatuses = new Set<ImageTask["status"]>(["success", "error"]);
export const promptQueueReleaseProgresses = new Set([
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
export const maxReferenceImageEdge = 1536;
export const referenceImageSizeThreshold = 2 * 1024 * 1024;
export const referenceImageJpegQuality = 0.9;
export const maxClientBatchConcurrency = 5;
export const maxClientEditConcurrency = 1;
export const maxPreviewHydrateAttempts = 5;
export const localResultPageSizeOptions = [10, 20, 50];
export const themeStorageKey = "phantom-image-theme";
export const taskStatusLabels: Record<ImageTask["status"], string> = {
  queued: "排队中",
  running: "生成中",
  success: "已完成",
  error: "失败",
};
export const progressTextLabels: Record<string, string> = {
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
