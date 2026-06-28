import { convertFileSrc } from "@tauri-apps/api/core";
import { activeStatuses, appearanceStorageKey, aspectOptions, maxReferenceImageEdge, maxRunningTaskSeconds, progressTextLabels, promptQueueReleaseProgresses, referenceImageJpegQuality, referenceImageSizeThreshold, taskStatusLabels, terminalStatuses, themeStorageKey } from "./constants";
import type { AppearanceMode, ImageTask, LocalResultRecord, NativeLocalImage, TaskRecord, ThemeMode } from "./types";

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

export function localDataUrlFromImageItem(item: { b64_json?: string; url?: string; mime_type?: string }) {
  return item.b64_json ? `data:${item.mime_type || "image/png"};base64,${item.b64_json}` : "";
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
  const base = Math.max(0, task.runningElapsedBase ?? task.elapsed_secs ?? 0);
  if (task.status !== "running") return Math.floor(task.elapsed_secs ?? base);
  if (!task.runningStartedAt) return Math.floor(base);
  return Math.max(0, Math.floor(base + (now - task.runningStartedAt) / 1000));
}

export function isRunningTaskTimedOut(task: TaskRecord, now = Date.now()) {
  return task.status === "running" && taskElapsedSeconds(task, now) >= maxRunningTaskSeconds;
}

export function withTaskTimeout(task: TaskRecord, now = Date.now()) {
  if (!isRunningTaskTimedOut(task, now)) return task;
  const elapsed = taskElapsedSeconds(task, now);
  return {
    ...task,
    status: "error",
    error: `超过 ${Math.floor(maxRunningTaskSeconds / 60)} 分钟仍未完成，已自动判定任务中断，可重新提交。`,
    progress: "failed",
    elapsed_secs: elapsed,
    updated_at: new Date(now).toISOString(),
    runningStartedAt: undefined,
    runningElapsedBase: undefined,
  } satisfies TaskRecord;
}

export function withRunningTimer(task: TaskRecord, now = Date.now()) {
  const recoveredTask = recoverStableImageDownloadTask(recoverStableHttpZeroTask(task));
  const normalized = normalizeImageTask(recoveredTask) as TaskRecord;
  const timed = withTaskTimeout(normalized, now);
  if (timed.status !== "running") {
    return {
      ...timed,
      runningStartedAt: undefined,
      runningElapsedBase: undefined,
    };
  }
  if (timed.runningStartedAt) return timed;
  return {
    ...timed,
    runningStartedAt: now,
    runningElapsedBase: Math.max(0, timed.elapsed_secs || 0),
  };
}

export function recoverStableImageDownloadTask<T extends TaskRecord>(task: T): T {
  if (
    task.channel !== "stable"
    || task.status !== "success"
    || task.localSaveError?.trim() !== "下载图片失败 (400 Bad Request)"
  ) {
    return task;
  }
  return {
    ...task,
    localSaveError: "",
  };
}

export function recoverStableHttpZeroTask<T extends TaskRecord>(task: T): T {
  if (
    task.channel !== "stable"
    || task.status !== "error"
    || task.error?.trim() !== "稳定版任务失败（HTTP 0）"
  ) {
    return task;
  }
  return {
    ...task,
    status: "running",
    error: undefined,
    progress: "running",
  };
}

export function mergeTaskUpdate(current: TaskRecord, next: ImageTask, now = Date.now()) {
  const normalizedNext = normalizeImageTask(next);
  const merged = {
    ...current,
    ...normalizedNext,
    mode: current.mode || normalizedNext.mode,
    created_at: current.created_at || normalizedNext.created_at,
  };
  if (normalizedNext.status !== "running") {
    return {
      ...merged,
      elapsed_secs: normalizedNext.elapsed_secs ?? taskElapsedSeconds(current, now),
      runningStartedAt: undefined,
      runningElapsedBase: undefined,
    };
  }
  if (current.status === "running" && current.runningStartedAt) {
    return withTaskTimeout({
      ...merged,
      runningStartedAt: current.runningStartedAt,
      runningElapsedBase: current.runningElapsedBase ?? current.elapsed_secs ?? 0,
    }, now);
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

export function shouldFallbackToSyncImage(error: unknown) {
  const message = getErrorMessage(error).trim().toLowerCase();
  return message === "internal server error"
    || message.includes("内部服务错误")
    || message.includes("not found")
    || message.includes("404")
    || message.includes("method not allowed")
    || message.includes("cannot post")
    || message.includes("unsupported")
    || message.includes("不支持");
}

export function nativeLocalImageToRecord(item: NativeLocalImage): LocalResultRecord {
  const originalUrl = convertFileSrc(item.path);
  const thumbnailDataUrl = item.thumbnail_data_url || item.thumbnailDataUrl || item.data_url || item.dataUrl || "";
  const thumbnailPath = item.thumbnail_path || item.thumbnailPath || "";
  const thumbnailUrl = thumbnailDataUrl || (thumbnailPath ? convertFileSrc(thumbnailPath) : originalUrl);
  return {
    id: item.id,
    rel: item.rel,
    name: item.name,
    path: item.path,
    url: thumbnailUrl,
    originalUrl,
    prompt: item.prompt || "",
    taskType: item.taskType || item.task_type,
    created_at: item.created_at || item.createdAt || "",
    localCreatedAt: item.local_created_at || item.localCreatedAt || "",
    size: item.size,
    width: item.width,
    height: item.height,
    source: "local",
  };
}

export function isActiveTask(task: Pick<ImageTask, "status">) {
  return activeStatuses.has(task.status) && !hasFailedTaskSignal(task);
}

export function isPollableTask(task: TaskRecord) {
  return task.taskType !== "reverse" && isActiveTask(task) && !task.isLocalPending;
}

export function shouldApplyTaskUpdate(current: TaskRecord, next: ImageTask) {
  if (terminalStatuses.has(current.status) && isActiveTask(next)) return false;
  if (current.updated_at && next.updated_at && next.updated_at < current.updated_at) return false;
  return true;
}

export function shouldReleasePromptQueueSlot(task: ImageTask) {
  return terminalStatuses.has(normalizeImageTask(task).status) || Boolean(task.progress && promptQueueReleaseProgresses.has(task.progress));
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

export function hasFailedTaskSignal(task: Pick<ImageTask, "status"> & Partial<Pick<ImageTask, "error" | "progress">>) {
  if (terminalStatuses.has(task.status)) return task.status === "error";
  if (String(task.status).toLowerCase() === "failed") return true;
  if (task.error?.trim()) return true;
  const progress = task.progress?.trim().toLowerCase();
  return Boolean(progress && (
    progressTextLabels[progress] === "失败"
    || progress.includes("fail")
    || progress.includes("error")
    || progress.includes("失败")
  ));
}

export function normalizeImageTask<T extends ImageTask>(task: T): T {
  if (!hasFailedTaskSignal(task)) return task;
  const failureMessage = task.error?.trim() || progressText(task.progress) || "处理失败";
  return {
    ...task,
    status: "error",
    error: failureMessage,
    progress: task.progress || "failed",
  };
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
