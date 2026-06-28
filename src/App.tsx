import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FolderOpen, Globe2, KeyRound, Leaf, LoaderCircle, Moon, Paintbrush, Palette, RotateCcw, Save, Settings, Sun, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient, fetchImageTasks } from "./api";
import { FestivalBackdrop, FestivalRailSeal } from "./components/FestivalRail";
import GenerateView from "./components/GenerateView";
import { apiChannelOptions, appearanceStorageKey, connectionForChannel, connectionWithApiKey, connectionWithBaseUrl, defaultApiBaseUrls, defaultConnection, normalizeApiBaseUrls, normalizeApiKeys, themeStorageKey } from "./constants";
import type { ApiChannel, AppearanceMode, Connection, Model, ThemeMode, Toast } from "./types";
import { getErrorMessage, getInitialAppearance, getInitialTheme } from "./utils";

function getChannelLabel(channel: ApiChannel) {
  return channel === "stable" ? "稳定版" : "畅享版";
}

function getChannelShortLabel(channel: ApiChannel) {
  return channel === "stable" ? "稳定" : "畅享";
}

function getChannelSupportText(channel: ApiChannel) {
  return channel === "stable" ? "支持 sub2api，兼容非异步接口" : "支持 chatgpt2api 任务接口";
}

export default function App() {
  const [connection, setConnection] = useState<Connection>(defaultConnection);
  const [draftConnection, setDraftConnection] = useState<Connection>(connection);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [appearance, setAppearance] = useState<AppearanceMode>(getInitialAppearance);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [connectionState, setConnectionState] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [resultDir, setResultDir] = useState("");
  const [activeResultDir, setActiveResultDir] = useState("");
  const [directoryMessage, setDirectoryMessage] = useState("");

  const api = useMemo(() => createApiClient(draftConnection), [draftConnection]);

  const notify = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3200);
  }, []);

  const saveConnection = () => {
    const next = connectionForChannel(draftConnection.channel, draftConnection.apiKeys, draftConnection.apiBaseUrls);
    setConnection(next);
    setDraftConnection(next);
    void invoke("save_connection", { value: next }).catch((error) => notify(getErrorMessage(error), "error"));
    notify("API 渠道与 Key 已保存", "success");
  };

  const selectChannel = (channel: ApiChannel) => {
    setDraftConnection(connectionForChannel(channel, draftConnection.apiKeys, draftConnection.apiBaseUrls));
    setConnectionState("idle");
    setConnectionMessage("");
  };

  const quickSwitchChannel = () => {
    const nextChannel: ApiChannel = draftConnection.channel === "stable" ? "dream" : "stable";
    const next = connectionForChannel(nextChannel, draftConnection.apiKeys, draftConnection.apiBaseUrls);
    setConnection(next);
    setDraftConnection(next);
    setConnectionState("idle");
    setConnectionMessage("");
    void invoke("save_connection", { value: next }).catch((error) => notify(getErrorMessage(error), "error"));
    notify(`已切换到${getChannelLabel(nextChannel)}`, "success");
  };

  const chooseDirectory = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, recursive: true, title: "选择本地结果目录" });
      if (!selected || Array.isArray(selected)) return;
      await invoke("save_settings", { value: { resultDir: selected } });
      if (isTauri()) {
        await invoke("remember_result_dir_scope", { resultDir: selected });
      }
      setResultDir(selected);
      setActiveResultDir(selected);
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
      setActiveResultDir("");
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
      if (api.connection.channel === "dream") {
        await api.request("/auth/login", { method: "POST", body: {} });
      }
      await refreshModels();
      if (api.connection.channel === "dream") {
        await fetchImageTasks(api, []);
      }
      setConnectionState("ok");
      setConnectionMessage(`${getChannelLabel(api.connection.channel)}连接成功`);
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
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    window.localStorage.setItem(appearanceStorageKey, appearance);
  }, [appearance]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<Connection>("load_connection"),
      invoke<{ resultDir?: string | null }>("load_settings"),
    ]).then(([savedConnection, settings]) => {
      if (cancelled) return;
      const savedChannel: ApiChannel = savedConnection?.channel === "stable" ? "stable" : "dream";
      const apiKeys = normalizeApiKeys(savedConnection?.apiKeys, savedChannel, savedConnection?.apiKey || "");
      const apiBaseUrls = normalizeApiBaseUrls(savedConnection?.apiBaseUrls, savedChannel, savedConnection?.baseUrl || "");
      const nextConnection = connectionForChannel(savedChannel, apiKeys, apiBaseUrls);
      setConnection(nextConnection);
      setDraftConnection(nextConnection);
      const savedDir = settings.resultDir || "";
      setResultDir(savedDir);
      setActiveResultDir(savedDir);
      setDirectoryMessage(savedDir ? `已记住：${savedDir}` : "");
    }).catch(() => {
      if (!cancelled) {
        setConnection(defaultConnection);
        setDraftConnection(defaultConnection);
        setActiveResultDir("");
        setDirectoryMessage("");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const nextQuickChannel: ApiChannel = draftConnection.channel === "stable" ? "dream" : "stable";
  const currentChannelLabel = getChannelLabel(draftConnection.channel);
  const nextChannelLabel = getChannelLabel(nextQuickChannel);
  return (
    <div className="app-shell">
      {appearance === "dragon-boat" ? <FestivalBackdrop /> : null}
      <aside className="sidebar">
        <div className="brand rail-brand">
          {appearance === "dragon-boat" ? (
            <div className="brand-mark festival-brand-mark"><Leaf size={22} /></div>
          ) : <div className="brand-mark"><Paintbrush size={22} /></div>}
          <h1>幻影G2生图</h1>
          {appearance === "dragon-boat" ? <FestivalRailSeal /> : null}
        </div>

        <div className="rail-actions">
          <button
            className={`icon-btn rail-channel ${draftConnection.channel}`}
            onClick={quickSwitchChannel}
            title={`当前${currentChannelLabel}，点击切换到${nextChannelLabel}`}
            aria-label={`当前${currentChannelLabel}，点击切换到${nextChannelLabel}`}
          >
            <span className="rail-channel-main">{getChannelShortLabel(draftConnection.channel)}</span>
            <span className="rail-channel-sub">渠道</span>
          </button>
          <button
            className="icon-btn rail-theme"
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
            aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
            aria-pressed={theme === "dark"}
          >
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button className="icon-btn rail-settings" onClick={() => setSettingsOpen(true)} title="配置">
            <Settings size={19} />
          </button>
        </div>
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
              <div className="connection-panel appearance-panel">
                <div className="panel-title"><Palette size={16} />界面主题</div>
                <div className="appearance-options" role="radiogroup" aria-label="界面主题">
                  <button
                    className={`appearance-option ${appearance === "default" ? "active" : ""}`}
                    type="button"
                    role="radio"
                    aria-checked={appearance === "default"}
                    onClick={() => setAppearance("default")}
                  >
                    <span className="appearance-preview default-preview"><Paintbrush size={18} /></span>
                    <span><strong>默认</strong><small>经典简洁界面</small></span>
                  </button>
                  <button
                    className={`appearance-option ${appearance === "dragon-boat" ? "active" : ""}`}
                    type="button"
                    role="radio"
                    aria-checked={appearance === "dragon-boat"}
                    onClick={() => setAppearance("dragon-boat")}
                  >
                    <span className="appearance-preview festival-preview"><Leaf size={18} /></span>
                    <span><strong>端午</strong><small>龙舟与粽叶主题</small></span>
                  </button>
                </div>
              </div>

              <div className="connection-panel">
                <div className="connection-panel-header">
                  <div className="panel-title"><Settings size={16} />连接</div>
                  <div className="channel-switch" role="radiogroup" aria-label="API 渠道">
                    {apiChannelOptions.map((channel) => (
                      <button
                        className={draftConnection.channel === channel.value ? "active" : ""}
                        type="button"
                        role="radio"
                        aria-checked={draftConnection.channel === channel.value}
                        onClick={() => selectChannel(channel.value)}
                        title={channel.description}
                        key={channel.value}
                      >
                        {channel.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="channel-support-text">{getChannelSupportText(draftConnection.channel)}</div>
                <label>
                  <span><Globe2 size={14} />服务地址</span>
                  <div className="url-input-row">
                    <input
                      value={draftConnection.baseUrl}
                      onChange={(event) => setDraftConnection((current) => connectionWithBaseUrl(current, event.target.value))}
                      placeholder={draftConnection.channel === "stable" ? "https://your-sub2api.example.com" : "https://your-chatgpt2api.example.com"}
                      inputMode="url"
                    />
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={() => setDraftConnection((current) => connectionWithBaseUrl(current, defaultApiBaseUrls[current.channel]))}
                      title={`恢复${currentChannelLabel}默认地址`}
                      aria-label={`恢复${currentChannelLabel}默认地址`}
                    >
                      <RotateCcw size={16} />
                    </button>
                  </div>
                </label>
                <label>
                  <span><KeyRound size={14} />API Key</span>
                  <input value={draftConnection.apiKey} onChange={(event) => setDraftConnection((current) => connectionWithApiKey(current, event.target.value))} placeholder={`${currentChannelLabel} Bearer key`} type="password" />
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
        <GenerateView api={api} resultDir={activeResultDir} notify={notify} />
      </main>

      <div className="toast-stack">
        {toasts.map((toast) => <div className={`toast ${toast.tone}`} key={toast.id}>{toast.message}</div>)}
      </div>
    </div>
  );
}
