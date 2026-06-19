import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Eye, EyeOff, FilePenLine, FolderOpen, Image as ImageIcon, ImagePlus, LoaderCircle, Paintbrush, RotateCcw, Trash2, X } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { localResultPageSizeOptions } from "../constants";
import type { LocalResultRecord, PreviewItem, PromptQueueStats, TaskRecord, Toast } from "../types";
import { compactLocalResultTitle, formatElapsedTime, formatResolution, formatSize, getErrorMessage, hasPendingPreviewHydration, isActiveTask, localDataUrlFromImageItem, localDateString, progressText, taskElapsedSeconds, taskStatusLabel } from "../utils";

export default function TaskResultGrid({
  tasks,
  localResults,
  localResultDate,
  localResultDates,
  localResultPage,
  localResultPageSize,
  localResultTotal,
  localResultOverallTotal,
  isLocalResultsLoading,
  activeCount,
  queueStats,
  onLocalResultDateChange,
  onLocalResultPageChange,
  onLocalResultPageSizeChange,
  onUsePrompt,
  onEditTask,
  onRetryTask,
  onAddReference,
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
  localResultOverallTotal: number;
  isLocalResultsLoading: boolean;
  activeCount: number;
  queueStats: PromptQueueStats;
  onLocalResultDateChange: (date: string) => void;
  onLocalResultPageChange: (page: number) => void;
  onLocalResultPageSizeChange: (pageSize: number) => void;
  onUsePrompt: (prompt: string) => void;
  onEditTask: (task: TaskRecord) => void;
  onRetryTask: (task: TaskRecord) => void | Promise<void>;
  onAddReference: (src: string, name: string) => void | Promise<void>;
  notify: (message: string, tone?: Toast["tone"]) => void;
  onDelete: (taskIds: string[]) => Promise<boolean>;
  onDeleteLocal: (resultIds: string[]) => Promise<boolean>;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [columns, setColumns] = useState(5);
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  const [privateItemIds, setPrivateItemIds] = useState<string[]>([]);
  const [clockNow, setClockNow] = useState(Date.now());
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
  const privateItemSet = new Set(privateItemIds);
  const hasTickingCards = visibleTasks.some((task) => (
    !task.data?.some((item) => item.b64_json)
    && (task.status === "running" || hasPendingPreviewHydration(task))
  ));

  useEffect(() => {
    setSelected((current) => current.filter((id) => visibleTasks.some((task) => task.id === id) || visibleLocalResults.some((item) => item.id === id)));
    setPrivateItemIds((current) => current.filter((id) => visibleTasks.some((task) => task.id === id) || visibleLocalResults.some((item) => item.id === id)));
  }, [visibleTasks, visibleLocalResults]);

  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex >= previewItems.length) {
      setLightboxIndex(previewItems.length ? previewItems.length - 1 : null);
    }
  }, [lightboxIndex, previewItems.length]);

  useEffect(() => {
    if (isPrivacyMode) setLightboxIndex(null);
  }, [isPrivacyMode]);

  useEffect(() => {
    if (!hasTickingCards) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [hasTickingCards]);

  const toggleItemPrivacy = (itemId: string) => {
    setPrivateItemIds((current) => current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId]);
    if (lightboxItem?.id === itemId) setLightboxIndex(null);
  };

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

  const revealLocalImage = async (path: string) => {
    if (!path) {
      notify("图片文件位置不可用", "error");
      return;
    }
    try {
      await revealItemInDir(path);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  };

  return (
    <div className="results-panel">
      <div className="section-bar">
        <div>
          <h3>任务和结果</h3>
          <p>
            本地总数 {localResultOverallTotal} 张，当前日期 {localResultTotal} 张，{activeCount} 个服务运行中，
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
            <button
              className={isPrivacyMode ? "active privacy-active" : ""}
              onClick={() => setIsPrivacyMode((current) => !current)}
              title={isPrivacyMode ? "显示缩略图" : "隐藏缩略图"}
              aria-pressed={isPrivacyMode}
            >
              {isPrivacyMode ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
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
              const taskError = task.error || (task.localSaveError ? `本地保存失败：${task.localSaveError}` : "");
              const isItemPrivate = privateItemSet.has(task.id);
              const isMasked = isPrivacyMode || isItemPrivate;
              return (
                <article className="image-card" key={task.id}>
                  <div className="image-card-header">
                    <label className="task-select">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(task.id)}
                        onChange={(event) => setSelected((current) => event.target.checked ? [...current, task.id] : current.filter((taskId) => taskId !== task.id))}
                      />
                      选择
                    </label>
                    <PrivacyToggle isPrivate={isMasked} isGlobal={isPrivacyMode} onToggle={() => toggleItemPrivacy(task.id)} />
                  </div>
                  <div className="image-frame">
                    <button className={`image-preview ${firstImage ? "" : "placeholder"} ${isMasked && firstImage ? "privacy-masked" : ""}`} onClick={() => firstImage && !isMasked && setLightboxIndex(previewIndexById.get(task.id) ?? null)} disabled={!firstImage}>
                      {firstImage && !isMasked ? <img src={firstImage} alt={task.prompt} /> : null}
                      {firstImage && isMasked ? <PrivacyMask /> : null}
                      {!firstImage && isActive ? (
                        <GenerationProgress
                          elapsed={task.status === "running" ? formatElapsedTime(taskElapsedSeconds(task, clockNow)) : undefined}
                          label={task.isLocalPending ? "等待提交" : progressText(task.progress) || "生成中"}
                        />
                      ) : null}
                      {!firstImage && !isActive && isHydrating ? (
                        <GenerationProgress elapsed={formatElapsedTime(taskElapsedSeconds(task, clockNow))} label="加载结果" />
                      ) : null}
                      {taskError ? <TaskErrorOverlay message={taskError} compact={Boolean(firstImage)} /> : null}
                      {!firstImage && !isActive && !isHydrating && !taskError ? <ImageIcon size={30} /> : null}
                    </button>
                    {task.savedFiles?.[0] ? (
                      <button className="saved-badge" type="button" title="定位文件" aria-label="定位文件" onClick={() => void revealLocalImage(task.savedFiles![0])}>
                        <FolderOpen size={15} />
                      </button>
                    ) : null}
                    <button className="image-card-action edit" type="button" title="编辑这条任务" onClick={() => onEditTask(task)}>
                      <FilePenLine size={15} />
                    </button>
                    {task.status === "error" ? (
                      <button className="image-card-action retry" type="button" title="重新提交" onClick={() => void onRetryTask(task)}>
                        <RotateCcw size={15} />
                      </button>
                    ) : null}
                    {task.status === "success" && firstImage ? (
                      <button className="image-card-action use-reference" type="button" title="一键加入参考图" onClick={() => void onAddReference(firstImage, `task-${task.id}`)}>
                        <ImagePlus size={15} />
                      </button>
                    ) : null}
                    <button className="image-delete" type="button" title="删除" onClick={() => void deleteTasks([task.id])}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="image-meta">
                    <span className={`status-badge ${task.status}`}>{taskStatusLabel(task.status)}</span>
                  </div>
                </article>
              );
            })}
            {visibleLocalResults.map((item) => {
              const isItemPrivate = privateItemSet.has(item.id);
              const isMasked = isPrivacyMode || isItemPrivate;
              return (
                <article className="image-card local-result-card" key={item.id}>
                  <div className="image-card-header">
                    <label className="task-select">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(item.id)}
                        onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}
                      />
                      选择
                    </label>
                    <PrivacyToggle isPrivate={isMasked} isGlobal={isPrivacyMode} onToggle={() => toggleItemPrivacy(item.id)} />
                  </div>
                  <div className="image-frame">
                    <button className={`image-preview ${isMasked ? "privacy-masked" : ""}`} onClick={() => !isMasked && setLightboxIndex(previewIndexById.get(item.id) ?? null)}>
                      {isMasked ? <PrivacyMask /> : <img src={item.url} alt={item.name} />}
                    </button>
                    <button className="saved-badge" type="button" title="定位文件" aria-label="定位文件" onClick={() => void revealLocalImage(item.path)}>
                      <FolderOpen size={15} />
                    </button>
                    <button className="image-delete" type="button" title="删除" onClick={() => void deleteItems([item.id])}>
                      <Trash2 size={15} />
                    </button>
                    <button className="image-card-action use-reference" type="button" title="一键加入参考图" onClick={() => void onAddReference(item.originalUrl, item.name.replace(/\.[^.]+$/, ""))}>
                      <ImagePlus size={15} />
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
              );
            })}
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

function GenerationProgress({ elapsed, label }: { elapsed?: string; label: string }) {
  return (
    <span className="generation-progress" role="status" aria-label={`${label}${elapsed ? `，已运行 ${elapsed}` : ""}`}>
      <LoaderCircle size={32} className="spin" aria-hidden="true" />
      <strong>{elapsed || "···"}</strong>
      <small>{label}</small>
    </span>
  );
}

function TaskErrorOverlay({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <span className={`task-error-overlay ${compact ? "compact" : ""}`} role="alert" title={message}>
      <strong>处理失败</strong>
      <span>{message}</span>
    </span>
  );
}

function PrivacyMask() {
  return (
    <span className="privacy-mask">
      <EyeOff size={26} />
      <span>隐私模式</span>
    </span>
  );
}

function PrivacyToggle({
  isPrivate,
  isGlobal,
  onToggle,
}: {
  isPrivate: boolean;
  isGlobal: boolean;
  onToggle: () => void;
}) {
  const title = isGlobal ? "已开启一键隐私模式" : isPrivate ? "显示这张图片" : "隐藏这张图片";
  return (
    <button
      className={`card-privacy-toggle ${isPrivate ? "active" : ""}`}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={isPrivate}
      disabled={isGlobal}
      onClick={onToggle}
    >
      {isPrivate ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
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
