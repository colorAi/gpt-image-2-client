import { convertFileSrc } from "@tauri-apps/api/core";
import { activeStatuses, appearanceStorageKey, aspectOptions, maxReferenceImageEdge, progressTextLabels, promptQueueReleaseProgresses, referenceImageJpegQuality, referenceImageSizeThreshold, taskStatusLabels, terminalStatuses, themeStorageKey } from "./constants";
import type { AppearanceMode, ImageTask, LocalResultRecord, NativeLocalImage, TaskRecord, ThemeMode } from "./types";

export function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(file.name);
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

export function fileFromDataUrl(dataUrl: string, name: string) {
  const [meta, encoded = ""] = dataUrl.split(",", 2);
  const mime = meta.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name || "image", { type: mime });
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number) {
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

export function loadImageElement(file: File) {
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

export function jpegFileName(name: string) {
  const cleanName = name.trim() || "reference";
  return /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(cleanName)
    ? cleanName.replace(/\.[^.]+$/, ".jpg")
    : `${cleanName}.jpg`;
}

export async function compressReferenceImage(file: File) {
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

export function localDataUrlFromImageItem(item: { b64_json?: string; url?: string }) {
  return item.b64_json ? `data:image/png;base64,${item.b64_json}` : "";
}

export function hasRemoteOnlyImageData(task: Pick<TaskRecord, "data" | "status">) {
  return task.status === "success" && Boolean(task.data?.some((item) => item.url && !item.b64_json));
}

export function hasPendingPreviewHydration(task: Pick<TaskRecord, "data" | "status" | "previewLoadError">) {
  return !task.previewLoadError && hasRemoteOnlyImageData(task);
}

export function formatSize(size: number) {
  if (!Number.isFinite(size)) return "-";
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}

export function formatResolution(width?: number, height?: number) {
  return width && height ? `${width} x ${height}` : "--";
}

export function formatElapsedTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function taskElapsedSeconds(task: TaskRecord, now = Date.now()) {
  if (task.status !== "running" && !task.runningStartedAt) return 0;
  const base = Math.max(0, task.runningElapsedBase ?? task.elapsed_secs ?? 0);
  if (!task.runningStartedAt) return Math.floor(base);
  return Math.max(0, Math.floor(base + (now - task.runningStartedAt) / 1000));
}

export function withRunningTimer(task: TaskRecord, now = Date.now()) {
  if (task.status !== "running" || task.runningStartedAt) return task;
  return {
    ...task,
    runningStartedAt: now,
    runningElapsedBase: Math.max(0, task.elapsed_secs || 0),
  };
}

export function mergeTaskUpdate(current: TaskRecord, next: ImageTask, now = Date.now()) {
  const merged = { ...current, ...next };
  if (next.status !== "running") return merged;
  if (current.status === "running" && current.runningStartedAt) {
    return {
      ...merged,
      runningStartedAt: current.runningStartedAt,
      runningElapsedBase: current.runningElapsedBase ?? current.elapsed_secs ?? 0,
    };
  }
  return withRunningTimer(merged, now);
}

export function aspectLabelFromSize(size?: string) {
  if (!size) return "";
  return aspectOptions.find((item) => item.size === size)?.label || "";
}

export function compactLocalResultTitle(item: Pick<LocalResultRecord, "name" | "localCreatedAt">) {
  const cleanName = item.name.replace(/\.[^.]+$/, "");
  const match = cleanName.match(/^(\d{4}[-_]\d{1,2}[-_]\d{1,2})(?:[ T_-](\d{1,2})[-_:](\d{1,2})(?:[-_:](\d{1,2}))?)?/);
  if (match) {
    const [, date, hour, minute, second] = match;
    const time = hour && minute ? ` ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}${second ? `:${second.padStart(2, "0")}` : ""}` : "";
    return `${date.replace(/_/g, "-")}${time}`;
  }
  return item.localCreatedAt || cleanName;
}

export function getErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "请求失败";
}

export function shouldFallbackToSyncEdit(error: unknown) {
  const message = getErrorMessage(error).trim().toLowerCase();
  return message === "internal server error" || message.includes("内部服务错误");
}

export function isDirectoryAccessError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("permission")
    || message.includes("denied")
    || message.includes("operation not permitted")
    || message.includes("访问")
    || message.includes("权限");
}

export function nativeLocalImageToRecord(item: NativeLocalImage): LocalResultRecord {
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

export function isActiveTask(task: Pick<ImageTask, "status">) {
  return activeStatuses.has(task.status);
}

export function isPollableTask(task: TaskRecord) {
  return isActiveTask(task) && !task.isLocalPending;
}

export function shouldApplyTaskUpdate(current: TaskRecord, next: ImageTask) {
  if (terminalStatuses.has(current.status) && isActiveTask(next)) return false;
  if (current.updated_at && next.updated_at && next.updated_at < current.updated_at) return false;
  return true;
}

export function shouldReleasePromptQueueSlot(task: ImageTask) {
  return terminalStatuses.has(task.status) || Boolean(task.progress && promptQueueReleaseProgresses.has(task.progress));
}

export function compactTaskForStorage(task: TaskRecord) {
  const data = task.data
    ?.map((item) => item.url ? { url: item.url } : null)
    .filter((item): item is { url: string } => Boolean(item));
  return {
    ...task,
    ...(data?.length ? { data } : { data: undefined }),
  };
}

export function localSortKey(batchId: number, index: number) {
  return `${batchId}-${String(index).padStart(4, "0")}`;
}

export function taskStatusLabel(status: ImageTask["status"]) {
  return taskStatusLabels[status] || status;
}

export function progressText(value?: string) {
  const text = value?.trim();
  if (!text) return "";
  const key = text.toLowerCase();
  if (progressTextLabels[key]) return progressTextLabels[key];
  return key.includes("_") ? "处理中" : text;
}

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const savedTheme = window.localStorage.getItem(themeStorageKey);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getInitialAppearance(): AppearanceMode {
  if (typeof window === "undefined") return "dragon-boat";
  const savedAppearance = window.localStorage.getItem(appearanceStorageKey);
  return savedAppearance === "default" ? "default" : "dragon-boat";
}

export function splitPromptGroups(value: string) {
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

export function promptAssistantContent(text: string, imageDataUrls: string[]) {
  if (!imageDataUrls.length) return text;
  return [
    { type: "text", text },
    ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
}
