import type { ApiChannel, ApiKeys, Connection, ImageResolution, ImageTask } from "./types";

export const fixedBaseUrl = "https://1kgpt.hootoo.dpdns.org";
export const stableBaseUrl = "https://api.hootoo.dpdns.org";
export const apiChannelBaseUrls: Record<ApiChannel, string> = {
  dream: fixedBaseUrl,
  stable: stableBaseUrl,
};
export const apiChannelOptions: Array<{ value: ApiChannel; label: string; description: string }> = [
  { value: "dream", label: "畅享版", description: "原有任务接口" },
  { value: "stable", label: "稳定版", description: "稳定接口与高清分辨率" },
];
export const clientDownloadUrl = "https://pan.quark.cn/s/3da05efbef6e";
export const defaultApiKeys: ApiKeys = { dream: "", stable: "" };
export const defaultConnection: Connection = {
  baseUrl: fixedBaseUrl,
  apiKey: "",
  channel: "dream",
  apiKeys: defaultApiKeys,
};
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
export const resolutionOptions: ImageResolution[] = ["1K", "2K", "4K"];
export const stableSizeByResolutionAndAspect: Record<ImageResolution, Record<string, string>> = {
  "1K": {
    "1:1": "1024x1024",
    "9:16": "720x1280",
    "16:9": "1280x720",
    "4:3": "1152x864",
    "3:2": "1248x832",
    "3:4": "864x1152",
    "2:3": "832x1248",
  },
  "2K": {
    "1:1": "2048x2048",
    "9:16": "1440x2560",
    "16:9": "2560x1440",
    "4:3": "2304x1728",
    "3:2": "2496x1664",
    "3:4": "1728x2304",
    "2:3": "1664x2496",
  },
  "4K": {
    "1:1": "2880x2880",
    "9:16": "2160x3840",
    "16:9": "3840x2160",
    "4:3": "3264x2448",
    "3:2": "3504x2336",
    "3:4": "2448x3264",
    "2:3": "2336x3504",
  },
};

export function normalizeApiChannel(value: unknown): ApiChannel {
  return value === "stable" ? "stable" : "dream";
}

export function normalizeApiKeys(
  value: Partial<ApiKeys> | undefined,
  legacyChannel: ApiChannel = "dream",
  legacyApiKey = "",
): ApiKeys {
  const keys = {
    dream: value?.dream?.trim() || "",
    stable: value?.stable?.trim() || "",
  };
  if (!keys[legacyChannel] && legacyApiKey.trim()) {
    keys[legacyChannel] = legacyApiKey.trim();
  }
  return keys;
}

export function connectionForChannel(channel: ApiChannel, apiKeys: Partial<ApiKeys> = defaultApiKeys): Connection {
  const normalizedKeys = normalizeApiKeys(apiKeys);
  return {
    channel,
    baseUrl: apiChannelBaseUrls[channel],
    apiKey: normalizedKeys[channel],
    apiKeys: normalizedKeys,
  };
}

export function connectionWithApiKey(connection: Connection, apiKey: string): Connection {
  const apiKeys = {
    ...connection.apiKeys,
    [connection.channel]: apiKey,
  };
  return {
    ...connection,
    apiKey,
    apiKeys,
  };
}

export function resolveImageSize(channel: ApiChannel, aspect: string, resolution: ImageResolution) {
  if (channel === "stable") {
    if (aspect === "auto") return "auto";
    return stableSizeByResolutionAndAspect[resolution][aspect] || stableSizeByResolutionAndAspect["1K"]["1:1"];
  }
  return aspectOptions.find((item) => item.label === aspect)?.size || "";
}

export function stableSelectionFromSize(size?: string) {
  if (!size || size === "auto") return null;
  for (const resolution of resolutionOptions) {
    const match = Object.entries(stableSizeByResolutionAndAspect[resolution]).find(([, value]) => value === size);
    if (match) return { resolution, aspect: match[0] };
  }
  return null;
}
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
export const maxRunningTaskSeconds = 5 * 60;
export const maxPreviewHydrateAttempts = 5;
export const localResultPageSizeOptions = [10, 20, 50];
export const themeStorageKey = "phantom-image-theme";
export const appearanceStorageKey = "phantom-image-appearance";
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
