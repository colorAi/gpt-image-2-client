import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Image as ImageIcon, Languages, LoaderCircle, Sparkles, Upload, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askPromptAssistant, createApiClient, createEditTask, createGenerationTask, fetchImageTasks, translatePromptText } from "../api";
import type { ApiClient } from "../api";
import { aspectOptions, connectionForChannel, defaultImageModel, maxClientBatchConcurrency, maxClientEditConcurrency, maxPreviewHydrateAttempts, normalizeApiChannel, qualityOptions, resolutionOptions, resolveImageSize, stableSelectionFromSize } from "../constants";
import type { ApiChannel, ConfirmRequest, ImageResolution, ImageTask, LocalResultRecord, NativeDroppedFile, NativeLocalImagePage, PendingPromptJob, PromptAssistantMessage, PromptQueueStats, SubmitPromptOptions, TaskRecord, Toast } from "../types";
import { aspectLabelFromSize, compactTaskForStorage, compressReferenceImage, fileFromDataUrl, fileToDataUrl, getErrorMessage, hasPendingPreviewHydration, isImageFile, isPollableTask, localDateString, localSortKey, mergeTaskUpdate, nativeLocalImageToRecord, shouldApplyTaskUpdate, shouldReleasePromptQueueSlot, splitPromptGroups, withRunningTimer, withTaskTimeout } from "../utils";
import ConfirmDialog from "./ConfirmDialog";
import { FestivalButtonDragonHead, FestivalButtonDragonTail } from "./FestivalRail";
import TaskResultGrid from "./TaskResultGrid";

export default function GenerateView({
  api,
  resultDir,
  notify,
}: {
  api: ApiClient;
  resultDir: string;
  notify: (message: string, tone?: Toast["tone"]) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const model = defaultImageModel;
  const [aspect, setAspect] = useState("1:1");
  const [quality, setQuality] = useState("auto");
  const [count, setCount] = useState(1);
  const [resolution, setResolution] = useState<ImageResolution>("1K");
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
  const [isTranslatingPrompt, setIsTranslatingPrompt] = useState(false);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [localResults, setLocalResults] = useState<LocalResultRecord[]>([]);
  const [localResultDates, setLocalResultDates] = useState<string[]>([]);
  const [localResultDate, setLocalResultDate] = useState(localDateString());
  const [localResultPage, setLocalResultPage] = useState(1);
  const [localResultPageSize, setLocalResultPageSize] = useState(20);
  const [localResultTotal, setLocalResultTotal] = useState(0);
  const [localResultOverallTotal, setLocalResultOverallTotal] = useState(0);
  const [isLocalResultsLoading, setIsLocalResultsLoading] = useState(false);
  const [queueStats, setQueueStats] = useState<PromptQueueStats>({ waiting: 0, running: 0 });
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const savingTaskIds = useRef(new Set<string>());
  const hydratingTaskIds = useRef(new Set<string>());
  const failedHydrateTaskIds = useRef(new Set<string>());
  const localLoadSeq = useRef(0);
  const saveTasksTimer = useRef<number | null>(null);
  const pendingPromptJobs = useRef<PendingPromptJob[]>([]);
  const runningPromptJobIds = useRef(new Set<string>());
  const runningEditPromptJobIds = useRef(new Set<string>());
  const promptQueueReleaseWaiters = useRef(new Map<string, () => void>());
  const previewHydrateAttempts = useRef(new Map<string, number>());
  const previewHydrateRetryAfter = useRef(new Map<string, number>());
  const previewHydrateRetryTimers = useRef(new Map<string, number>());
  const isPromptQueuePumping = useRef(false);
  const selectedSize = resolveImageSize(api.connection.channel, aspect, resolution);
  const activePollTargets = useMemo(() => tasks.filter(isPollableTask).map((item) => ({
    id: item.id,
    channel: normalizeApiChannel(item.channel),
  })), [tasks]);
  const activeTaskIds = activePollTargets.map((item) => item.id).join(",");
  const activeTaskChannels = activePollTargets.map((item) => `${item.channel}:${item.id}`).join(",");
  const activeCount = activeTaskIds ? activeTaskIds.split(",").length : 0;
  const syncQueueStats = useCallback(() => {
    setQueueStats({
      waiting: pendingPromptJobs.current.length,
      running: runningPromptJobIds.current.size,
    });
  }, []);

  const requestConfirmation = useCallback((options: Omit<ConfirmRequest, "resolve">) => (
    new Promise<boolean>((resolve) => setConfirmRequest({ ...options, resolve }))
  ), []);

  const resolveConfirmation = useCallback((confirmed: boolean) => {
    setConfirmRequest((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const releasePromptQueueWaiter = useCallback((task: ImageTask) => {
    if (!shouldReleasePromptQueueSlot(task)) return;
    const release = promptQueueReleaseWaiters.current.get(task.id);
    if (!release) return;
    promptQueueReleaseWaiters.current.delete(task.id);
    release();
  }, []);

  useEffect(() => {
    const closeTimedOutTasks = () => {
      const now = Date.now();
      const timedOutTasks = tasks
        .map((task) => withTaskTimeout(task, now))
        .filter((task, index) => task !== tasks[index]);
      if (!timedOutTasks.length) return;

      timedOutTasks.forEach(releasePromptQueueWaiter);
      setTasks((current) => {
        let changed = false;
        const next = current.map((task) => {
          const updated = withTaskTimeout(task, now);
          if (updated === task) return task;
          changed = true;
          return updated;
        });
        return changed ? next : current;
      });
    };

    closeTimedOutTasks();
    if (!tasks.some((task) => task.status === "running")) return;
    const timer = window.setInterval(closeTimedOutTasks, 5000);
    return () => window.clearInterval(timer);
  }, [releasePromptQueueWaiter, tasks]);

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
      setTasks(Array.isArray(items) ? items.map((item) => withRunningTimer(item)) : []);
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
      setLocalResultOverallTotal(result.overallTotal ?? result.overall_total ?? result.total ?? 0);
      const nextPageSize = result.pageSize || result.page_size || pageSize;
      if (nextPageSize !== pageSize) setLocalResultPageSize(nextPageSize);
      if (result.page && result.page !== page) setLocalResultPage(result.page);
    } catch (error) {
      if (localLoadSeq.current !== loadId) return;
      setLocalResults([]);
      setLocalResultTotal(0);
      setLocalResultOverallTotal(0);
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
      setLocalResultOverallTotal(0);
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
    if (!activePollTargets.length) return;
    const targetsByChannel = new Map<ApiChannel, string[]>();
    activePollTargets.forEach((target) => {
      const ids = targetsByChannel.get(target.channel) || [];
      ids.push(target.id);
      targetsByChannel.set(target.channel, ids);
    });
    let cancelled = false;
    let inFlight = false;
    const syncTasks = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const responses = await Promise.all(Array.from(targetsByChannel.entries()).map(async ([channel, ids]) => {
          const channelApi = channel === api.connection.channel
            ? api
            : createApiClient(connectionForChannel(channel, api.connection.apiKeys));
          return fetchImageTasks(channelApi, ids);
        }));
        if (cancelled) return;
        const items = responses.flatMap((response) => response.items);
        const taskMap = new Map(items.map((item) => [item.id, item]));
        items.forEach(releasePromptQueueWaiter);
        const receivedAt = Date.now();
        setTasks((current) => current.map((item) => {
          const next = taskMap.get(item.id);
          return next && shouldApplyTaskUpdate(item, next) ? mergeTaskUpdate(item, next, receivedAt) : item;
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
  }, [api, activeTaskChannels, activeTaskIds, releasePromptQueueWaiter]);

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
    if (!images.length) return false;
    const remainingSlots = Math.max(0, 8 - files.length);
    if (!remainingSlots) {
      notify("最多添加 8 张参考图", "error");
      return false;
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
      return true;
    } catch (error) {
      notify(getErrorMessage(error), "error");
      return false;
    } finally {
      setIsProcessingReferences(false);
    }
  }, [files.length, notify]);

  const addResultAsReference = useCallback(async (src: string, name: string) => {
    if (!src) {
      notify("当前图片还未加载完成", "error");
      return;
    }
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`读取图片失败（${response.status}）`);
      const blob = await response.blob();
      const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const file = new File([blob], `${name || "result"}.${extension}`, { type: blob.type || "image/png" });
      if (await addFiles([file])) {
        notify("已加入参考图，可以直接提交编辑任务", "success");
      }
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }, [addFiles, notify]);

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
      const jobApi = job.channel === api.connection.channel
        ? api
        : createApiClient(connectionForChannel(job.channel, api.connection.apiKeys));
      const task = job.files.length
        ? await createEditTask(jobApi, { clientTaskId: job.id, files: job.files, prompt: job.prompt, model: job.model, size: job.size, quality: job.quality })
        : await createGenerationTask(jobApi, { clientTaskId: job.id, prompt: job.prompt, model: job.model, size: job.size, quality: job.quality });
      const record = withRunningTimer({
        ...task,
        channel: job.channel,
        prompt: job.prompt,
        localCreatedAt: job.localCreatedAt,
        clientTaskId: job.id,
        isLocalPending: false,
        localBatchId: job.localBatchId,
        localBatchIndex: job.localBatchIndex,
        localSortKey: job.localSortKey,
      });
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
        const nextJobIndex = pendingPromptJobs.current.findIndex((job) => (
          !job.files.length || runningEditPromptJobIds.current.size < maxClientEditConcurrency
        ));
        if (nextJobIndex < 0) break;
        const [job] = pendingPromptJobs.current.splice(nextJobIndex, 1);
        if (!job) continue;
        runningPromptJobIds.current.add(job.id);
        if (job.files.length) runningEditPromptJobIds.current.add(job.id);
        syncQueueStats();
        void runPromptJob(job).catch((error) => {
          notify(getErrorMessage(error), "error");
        }).finally(() => {
          runningPromptJobIds.current.delete(job.id);
          runningEditPromptJobIds.current.delete(job.id);
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
      const submitChannel = options.channel || api.connection.channel;
      const submitModel = options.model || model;
      const submitSize = options.size ?? selectedSize;
      const submitQuality = options.quality || quality;
      const jobs = cleanedPrompts.map((text, index): PendingPromptJob => ({
        id: `${startedAt}-${index}-${Math.random().toString(16).slice(2)}`,
        prompt: text,
        files: submitFiles.slice(),
        channel: submitChannel,
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
        channel: job.channel,
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
      setTasks((current) => {
        if (!options.replaceTaskId) {
          return [...placeholders.slice().reverse(), ...current].slice(0, 100);
        }
        const replacement = placeholders[0];
        const replaced = current.map((item) => item.id === options.replaceTaskId ? replacement : item);
        return replaced.some((item) => item.id === replacement.id)
          ? replaced
          : [replacement, ...current].slice(0, 100);
      });
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
    const submitCount = api.connection.channel === "stable" ? 1 : count;
    await submitPromptList(Array.from({ length: submitCount }, () => text), "可继续提交");
  };

  const fillTaskForEdit = useCallback((task: TaskRecord) => {
    setPrompt(task.prompt || "");
    setSplitSubmit(false);
    setCommonPrompt("");
    setCount(1);
    const taskChannel = normalizeApiChannel(task.channel);
    const stableSelection = taskChannel === "stable" ? stableSelectionFromSize(task.size) : null;
    if (stableSelection) {
      setAspect(stableSelection.aspect);
      setResolution(stableSelection.resolution);
    } else {
      const nextAspect = aspectLabelFromSize(task.size);
      if (nextAspect) setAspect(nextAspect);
    }
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
      channel: normalizeApiChannel(task.channel),
      model: task.model || model,
      size: task.size ?? selectedSize,
      quality: task.quality || quality,
      replaceTaskId: task.id,
    });
  }, [files, model, notify, quality, selectedSize]);

  const deleteTasksAndFiles = useCallback(async (taskIds: string[]) => {
    const targets = tasks.filter((task) => taskIds.includes(task.id));
    if (!targets.length) return false;
    const savedPaths = targets.flatMap((task) => task.savedFiles || []);
    const confirmText = savedPaths.length
      ? `确定删除 ${targets.length} 个任务吗？删除会连同 ${savedPaths.length} 个本地文件一起删除，此操作不可撤销。`
      : `确定删除 ${targets.length} 个任务记录吗？此操作不可撤销。`;
    const confirmed = await requestConfirmation({
      title: "确认删除",
      message: confirmText,
      confirmLabel: savedPaths.length ? "删除任务和本地文件" : "删除任务记录",
      cancelLabel: "取消",
    });
    if (!confirmed) return false;
    try {
      let removed = 0;
      if (savedPaths.length) {
        if (!resultDir) throw new Error("请先选择本地结果目录");
        removed = await invoke<number>("delete_local_images", { resultDir, paths: savedPaths });
        setLocalResultOverallTotal((current) => Math.max(0, current - removed));
        void loadLocalResults(resultDir, localResultDate, localResultPage, localResultPageSize);
      }
      setTasks((current) => current.filter((task) => !taskIds.includes(task.id)));
      notify(savedPaths.length ? `已删除 ${targets.length} 个任务和 ${removed} 张本地图片` : `已删除 ${targets.length} 个任务`, "success");
      return true;
    } catch (error) {
      notify(getErrorMessage(error), "error");
      return false;
    }
  }, [loadLocalResults, localResultDate, localResultPage, localResultPageSize, notify, requestConfirmation, resultDir, tasks]);

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

  const translateCurrentPrompt = async () => {
    if (isTranslatingPrompt) return;
    const text = prompt.trim();
    if (!text) {
      notify("请输入要翻译的提示词", "error");
      return;
    }
    setIsTranslatingPrompt(true);
    try {
      const translated = await translatePromptText(api, text);
      if (!translated) throw new Error("AI 没有返回翻译结果");
      setPrompt(translated);
      notify("提示词已互译", "success");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setIsTranslatingPrompt(false);
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
                <button className="btn assistant-send-button" onClick={askAssistant} disabled={isAssistantLoading || isProcessingReferences}>
                  <span className="button-icon button-icon-soft">
                    {isAssistantLoading ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                  </span>
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
            {api.connection.channel === "stable" ? (
              <label><span>分辨率</span><select value={resolution} onChange={(event) => setResolution(event.target.value as ImageResolution)}>{resolutionOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            ) : (
              <label><span>数量</span><input type="number" min={1} max={4} value={count} disabled={splitSubmit} onChange={(event) => setCount(Math.min(4, Math.max(1, Number(event.target.value) || 1)))} /></label>
            )}
            <button className="btn translate-prompt-button" type="button" onClick={() => void translateCurrentPrompt()} disabled={!prompt.trim() || isTranslatingPrompt}>
              {isTranslatingPrompt ? <LoaderCircle size={15} className="spin" /> : <Languages size={15} />}
              翻译
            </button>
            <button className="btn clear-prompt-button" type="button" onClick={() => setPrompt("")} disabled={!prompt.trim()}>
              <X size={15} />
              清空提示词
            </button>
          </div>

          <button className="btn primary run-button" onClick={submit} disabled={isSubmitting || isProcessingReferences}>
            <FestivalButtonDragonHead />
            <span className="button-icon primary-action-icon">
              {isSubmitting ? <LoaderCircle size={17} className="spin" /> : <WandSparkles size={17} />}
            </span>
            {splitSubmit ? "拆分提交任务" : files.length ? "提交编辑任务" : "提交生成任务"}
            <FestivalButtonDragonTail />
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
          localResultOverallTotal={localResultOverallTotal}
          isLocalResultsLoading={isLocalResultsLoading}
          activeCount={activeCount}
          queueStats={queueStats}
          onLocalResultDateChange={setLocalResultDate}
          onLocalResultPageChange={setLocalResultPage}
          onLocalResultPageSizeChange={setLocalResultPageSize}
          onUsePrompt={setPrompt}
          onEditTask={fillTaskForEdit}
          onRetryTask={retryTask}
          onAddReference={addResultAsReference}
          notify={notify}
          onDelete={deleteTasksAndFiles}
          onDeleteLocal={async (resultIds) => {
            const targets = localResults.filter((item) => resultIds.includes(item.id));
            if (!targets.length) return false;
            const confirmed = await requestConfirmation({
              title: "确认删除本地图片",
              message: `确定删除 ${targets.length} 张本地图片吗？文件、提示词记录和缩略图都会一起删除，此操作不可撤销。`,
              confirmLabel: "删除本地图片",
              cancelLabel: "取消",
            });
            if (!confirmed) return false;
            try {
              const removed = await invoke<number>("delete_local_images", { resultDir, paths: targets.map((item) => item.path) });
              setLocalResults((current) => current.filter((item) => !resultIds.includes(item.id)));
              setLocalResultTotal((current) => Math.max(0, current - removed));
              setLocalResultOverallTotal((current) => Math.max(0, current - removed));
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
      <ConfirmDialog
        request={confirmRequest}
        onCancel={() => resolveConfirmation(false)}
        onConfirm={() => resolveConfirmation(true)}
      />
    </section>
  );
}
