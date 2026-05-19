import { useEffect, useState, useCallback, useRef } from "react";
import { useAutoScroll } from "../lib/useAutoScroll";
import { useParams, Link } from "react-router-dom";
import {
  Play,
  Square,
  RotateCcw,
  Edit3,
  Save,
  X,
  CheckCircle,
  Terminal as TerminalIcon,
  Radio,
} from "lucide-react";
import type {
  AgentInfo,
  LogEntry,
} from "../lib/types";
import {
  agentAction,
  fetchAgents,
  fetchAgentConfig,
  type AgentConfig,
  streamLogs,
  updateAgentConfig,
  updateDisplayName,
  validateAgentConfig,
} from "../lib/api";
import ConfigEditor from "./ConfigEditor";
import Terminal from "./Terminal";
import { ChatPanel } from "./ChatPanel";
import TomlSettingsPanel from "./TomlSettingsPanel";
import { extractChannelToggles, setChannelEnabled } from "../lib/configChannels";
import { formatBytes } from "../lib/format";
import { useData } from "../lib/DataContext";

interface AgentDetailProps {
  agent: AgentInfo;
  onRefresh?: () => Promise<void> | void;
}

const validTabs = ["chat", "config"] as const;
type Tab = (typeof validTabs)[number];

export default function AgentDetail({ agent, onRefresh }: AgentDetailProps) {
  const { tab: tabParam } = useParams<{ tab?: string }>();

  const tab: Tab = validTabs.includes(tabParam as Tab)
    ? (tabParam as Tab)
    : "chat";

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | false>(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const { backendDown, backendStarting, setPendingAction } = useData();
  const backendUnavailable = backendDown || backendStarting;

  const actionControllerRef = useRef<AbortController | null>(null);

  // cleanup on unmount
  useEffect(() => {
    return () => { actionControllerRef.current?.abort(); };
  }, []);

  const handleAction = useCallback(
    async (action: "start" | "stop" | "restart") => {
      if (backendUnavailable) return;
      setActionPending(action);
      setPendingAction(agent.name, action);
      const controller = new AbortController();
      actionControllerRef.current = controller;
      try {
        await agentAction(agent.name, action);
        if (onRefresh) {
          if (action === "start" || action === "restart") {
            for (let i = 0; i < 10; i++) {
              if (controller.signal.aborted) break;
              await new Promise((r) => setTimeout(r, 1000));
              if (controller.signal.aborted) break;
              await onRefresh();
              try {
                const agents = await fetchAgents();
                const a = agents.find((x: any) => x.name === agent.name);
                if (a?.alive) break;
              } catch { /* ignore */ }
            }
          } else {
            await onRefresh();
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setActionPending(false);
        setPendingAction(agent.name, null);
      }
    },
    [agent.name, backendUnavailable, onRefresh, setPendingAction],
  );

  useEffect(() => {
    if (tab === "config") {
      if (backendUnavailable) {
        setLogs([]);
        return;
      }
      setLogs([]);
      const close = streamLogs(agent.name, (entry) => {
        setLogs((prev) => [...prev.slice(-200), entry]);
      });
      return close;
    }
  }, [tab, agent.name, agent.alive, backendUnavailable]);

  useEffect(() => {
    if (backendUnavailable) {
      setConfig(null);
      setConfigError(null);
      return;
    }
    setConfig(null);
    setConfigError(null);
    fetchAgentConfig(agent.name)
      .then(setConfig)
      .catch((err) => setConfigError(err.message ?? "Failed to load config"));
  }, [agent.name, agent.alive, backendUnavailable]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/agents/overview"
          className="text-xs text-text-muted transition-colors hover:text-text"
        >
          &lt; back
        </Link>

        <div className="flex gap-2">
          {!agent.alive ? (
            <ActionButton
              icon={<Play className="h-3.5 w-3.5" />}
              label={actionPending === "start" ? "starting..." : "start"}
              onClick={() => handleAction("start")}
              disabled={backendUnavailable || !!actionPending}
            />
          ) : (
            <>
              <ActionButton
                icon={<TerminalIcon className="h-3.5 w-3.5" />}
                label="terminal"
                onClick={() => { if (!backendUnavailable) setShowTerminal(true); }}
                disabled={backendUnavailable}
              />
              <ActionButton
                icon={actionPending === "restart" ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-yellow-400/30 border-t-yellow-400" /> : <RotateCcw className="h-3.5 w-3.5" />}
                label={actionPending === "restart" ? "restarting..." : "restart"}
                onClick={() => handleAction("restart")}
                disabled={backendUnavailable || !!actionPending}
              />
              <ActionButton
                icon={<Square className="h-3.5 w-3.5" />}
                label={actionPending === "stop" ? "stopping..." : "stop"}
                onClick={() => handleAction("stop")}
                disabled={backendUnavailable || !!actionPending}
                variant={actionPending === "stop" ? undefined : "danger"}
              />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 shrink-0">
          <div className="flex items-center gap-3">
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${actionPending ? "bg-yellow-400 animate-pulse" : !agent.alive ? "bg-red" : agent.status?.provider_status === "error" ? "bg-yellow" : "bg-green"}`}
            />
            {editingName ? (
              <form
                className="flex items-center gap-1.5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const cleaned = nameInput.replace(/[^a-zA-Z0-9 \-_]/g, "").trim();
                  if (!cleaned) { setEditingName(false); return; }
                  setNameSaving(true);
                  try {
                    await updateDisplayName(agent.name, cleaned);
                    if (onRefresh) await onRefresh();
                  } catch (err) {
                    setNameError(err instanceof Error ? err.message : "failed to save name");
                  }
                  setNameSaving(false);
                  setEditingName(false);
                }}
              >
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setEditingName(false); }}
                  className="text-xl font-bold bg-transparent border-b border-accent text-text outline-none w-48"
                  disabled={nameSaving}
                />
                <button type="submit" disabled={nameSaving} className="p-1 text-accent hover:text-accent-hover">
                  <Save className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setEditingName(false)} className="p-1 text-text-muted hover:text-text">
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => { setNameInput(agent.display_name || agent.name); setEditingName(true); setNameError(null); }}
                className="group relative min-w-0"
              >
                <h2 className="truncate text-xl font-bold">{agent.display_name || agent.name}</h2>
                <Edit3 className="absolute -top-1 -right-3 h-3 w-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
            <span className="rounded border border-border-strong bg-surface-hover px-2 py-0.5 text-[11px] text-text-secondary">
              {agent.framework}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            // gateway: {agent.host}:{agent.port}
          </p>
          {nameError && (
            <p className="mt-1 text-xs text-red">{nameError}</p>
          )}
        </div>
        <AgentHeaderSummary agent={agent} />
      </div>

      <div className="flex border-b border-border">
        {validTabs.map((t) => (
          <TabLink
            key={t}
            to={`/agents/${agent.name}/${t}`}
            active={tab === t}
          >
            {t}
          </TabLink>
        ))}
      </div>

      {tab === "config" && <OverviewTab agent={agent} config={config} configError={configError} logs={logs} onConfigSaved={() => {
        fetchAgentConfig(agent.name)
          .then(setConfig)
          .catch((err) => setConfigError(err.message ?? "Failed to load config"));
      }} />}
      {tab === "chat" && (
        <ChatPanel key={agent.name} alive={agent.alive} framework={agent.framework} agentName={agent.name} />
      )}

      {/* Terminal Modal */}
      {showTerminal && (
        <Terminal agentName={agent.name} onClose={() => setShowTerminal(false)} />
      )}
    </div>
  );
}

function AgentHeaderSummary({ agent }: { agent: AgentInfo }) {
  const providerHealth = providerHealthSummary(agent);
  const items = [
    {
      label: "status",
      value: agent.alive ? "running" : "stopped",
      tone: agent.alive ? "success" : "danger",
    },
    {
      label: "provider",
      value: agent.status?.provider || "-",
    },
    {
      label: "provider health",
      value: providerHealth.value,
      tone: providerHealth.tone,
    },
    {
      label: "model",
      value: agent.status?.model || "-",
      wide: true,
    },
    {
      label: "pid",
      value: agent.health?.pid?.toString() || "-",
    },
    {
      label: "uptime",
      value: formatUptime(agent.health?.uptime),
    },
    {
      label: "memory",
      value: agent.health?.ram_bytes ? formatBytes(agent.health.ram_bytes) : "-",
    },
    {
      label: "cpu",
      value:
        agent.health?.cpu_percent != null
          ? `${agent.health.cpu_percent.toFixed(1)}%`
          : "-",
    },
  ];

  return (
    <div className="flex min-w-[18rem] flex-1 flex-wrap items-center justify-start gap-1.5 text-[10px]">
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex min-w-0 items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 ${item.wide ? "max-w-72" : ""}`}
        >
          <span className="shrink-0 uppercase tracking-wider text-text-muted">
            {item.label}
          </span>
          <span
            className={`min-w-0 truncate text-xs font-semibold ${summaryToneClass(item.tone)}`}
            title={item.value}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function providerHealthSummary(agent: AgentInfo): {
  value: string;
  tone?: "success" | "warn" | "danger" | "muted";
} {
  if (!agent.alive) return { value: "-", tone: "muted" };
  if (agent.status?.provider_status === "ok") {
    return { value: "reachable", tone: "success" };
  }
  if (agent.status?.provider_status === "error") {
    return { value: "unreachable", tone: "warn" };
  }
  return { value: "unknown", tone: "muted" };
}

function summaryToneClass(tone?: string): string {
  switch (tone) {
    case "success":
      return "text-green";
    case "warn":
      return "text-yellow";
    case "danger":
      return "text-red";
    case "muted":
      return "text-text-muted";
    default:
      return "text-text";
  }
}

function formatUptime(nanoseconds?: number): string {
  if (!nanoseconds) return "-";
  const seconds = nanoseconds / 1e9;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes}m`;
}

function OverviewTab({
  agent,
  config,
  configError,
  logs,
  onConfigSaved,
}: {
  agent: AgentInfo;
  config: AgentConfig | null;
  configError: string | null;
  logs: LogEntry[];
  onConfigSaved: () => void;
}) {
  const { ref: logScrollRef } = useAutoScroll([logs.length]);
  const health = agent.health;
  const [configEditing, setConfigEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const [configSaveSuccess, setConfigSaveSuccess] = useState(false);

  useEffect(() => {
    if (config) setEditedContent(config.content);
  }, [config]);

  return (
    <div className="space-y-4">
      {config && (
        <ChannelTogglePanel
          agentName={agent.name}
          config={config}
          onSaved={onConfigSaved}
        />
      )}

      {config && (
        <TomlSettingsPanel
          agentName={agent.name}
          config={config}
          onSaved={onConfigSaved}
        />
      )}

      {health?.components && Object.keys(health.components).length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-text-muted">
            Components
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(health.components).map(([name, comp]) => (
              <div
                key={name}
                className="rounded border border-border bg-surface p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{name}</span>
                  <span
                    className={`text-[10px] ${comp.status === "ok" ? "text-green" : "text-red"}`}
                  >
                    {comp.status}
                  </span>
                </div>
                {comp.restart_count > 0 && (
                  <p className="mt-1 text-[10px] text-yellow">
                    restarts: {comp.restart_count}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logs section */}
      <details className="group rounded border border-border bg-surface" open>
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none text-[10px] font-medium uppercase tracking-wider text-text-muted hover:text-text transition-colors">
          <span>logs {logs.length > 0 ? `(${logs.length})` : ""}</span>
          <span className="text-text-muted group-open:rotate-90 transition-transform">▶</span>
        </summary>
        <div className="px-4 pb-4">
          <div ref={logScrollRef} className="max-h-48 overflow-y-auto rounded border border-border bg-bg p-3 text-xs">
            {logs.length === 0 ? (
              <p className="text-text-muted">
                {agent.alive ? "waiting for log entries..." : "no log history available."}
              </p>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className="py-0.5">
                  <span className="text-text-muted">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>{" "}
                  <span className={`font-medium ${
                    entry.level === "error" ? "text-red"
                    : entry.level === "warn" ? "text-yellow"
                    : "text-green"
                  }`}>
                    [{entry.level}]
                  </span>{" "}
                  <span className="text-text">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </details>

      {/* Config section */}
      <details className="group rounded border border-border bg-surface">
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none text-[10px] font-medium uppercase tracking-wider text-text-muted hover:text-text transition-colors">
          <span>configuration {config?.format ? `(${config.format})` : ""}</span>
          <span className="text-text-muted group-open:rotate-90 transition-transform">▶</span>
        </summary>

        {configError ? (
          <p className="px-4 pb-3 text-xs text-red">failed to load config: {configError}</p>
        ) : !config ? (
          <p className="px-4 pb-3 text-xs text-text-muted">loading...</p>
        ) : configEditing ? (
          <div className="px-4 pb-4 space-y-3">
            {configSaveError && (
              <div className="p-2 bg-red/10 border border-red/20 rounded text-xs text-red">
                {configSaveError}
              </div>
            )}
            <ConfigEditor
              value={editedContent}
              format={config.format}
              onChange={setEditedContent}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    setConfigSaving(true);
                    setConfigSaveError(null);
                    const validation = await validateAgentConfig(agent.name, editedContent);
                    if (!validation.valid) {
                      setConfigSaveError(validation.error || "configuration is invalid");
                      return;
                    }
                    await updateAgentConfig(agent.name, editedContent);
                    setConfigEditing(false);
                    setConfigSaveSuccess(true);
                    setTimeout(() => setConfigSaveSuccess(false), 3000);
                    onConfigSaved();
                  } catch (err) {
                    setConfigSaveError(err instanceof Error ? err.message : "failed to save");
                  } finally {
                    setConfigSaving(false);
                  }
                }}
                disabled={configSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Save className="h-3 w-3" />
                {configSaving ? "saving..." : "save"}
              </button>
              <button
                onClick={() => { setConfigEditing(false); setEditedContent(config.content); setConfigSaveError(null); }}
                disabled={configSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-text-secondary rounded text-xs font-medium transition-colors hover:text-text disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4 space-y-2">
            {configSaveSuccess && (
              <div className="p-2 bg-green/10 border border-green/20 rounded text-xs text-green flex items-center gap-1.5">
                <CheckCircle className="h-3 w-3" />
                saved — restart agent to apply
              </div>
            )}
            <div className="flex justify-end">
              {agent.alive && (
                <button
                  onClick={() => setConfigEditing(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-text-muted hover:text-accent transition-colors"
                >
                  <Edit3 className="h-3 w-3" />
                  edit
                </button>
              )}
            </div>
            <pre className="max-h-64 overflow-auto rounded border border-border bg-bg p-3 text-xs leading-relaxed">
              {config.format === "json"
                ? highlightJson((() => { try { return JSON.stringify(JSON.parse(config.content), null, 2); } catch { return config.content; } })())
                : highlightToml(config.content)}
            </pre>
          </div>
        )}
      </details>
    </div>
  );
}

function ChannelTogglePanel({
  agentName,
  config,
  onSaved,
}: {
  agentName: string;
  config: AgentConfig;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(config.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(config.content);
    setError(null);
  }, [config.content]);

  const channels = extractChannelToggles(draft, config.format);
  if (channels.length === 0) return null;

  const dirty = draft !== config.content;

  return (
    <section className="rounded border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-accent" />
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
            channels
          </h3>
        </div>
        <button
          onClick={async () => {
            try {
              setSaving(true);
              setError(null);
              const validation = await validateAgentConfig(agentName, draft);
              if (!validation.valid) {
                setError(validation.error || "configuration is invalid");
                return;
              }
              await updateAgentConfig(agentName, draft);
              setSaved(true);
              setTimeout(() => setSaved(false), 3000);
              onSaved();
            } catch (err) {
              setError(err instanceof Error ? err.message : "failed to save");
            } finally {
              setSaving(false);
            }
          }}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3 w-3" />
          {saving ? "saving..." : "save channels"}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {channels.map((channel) => (
          <label
            key={channel.name}
            className="flex items-center justify-between gap-3 rounded border border-border bg-bg px-3 py-2"
          >
            <span className="text-sm font-medium text-text">
              {channel.name}
            </span>
            <input
              type="checkbox"
              checked={channel.enabled}
              onChange={(event) => {
                setDraft((prev) =>
                  setChannelEnabled(prev, channel.name, event.target.checked),
                );
                setSaved(false);
                setError(null);
              }}
              className="h-4 w-4 rounded border-border bg-bg-subtle text-accent focus:ring-2 focus:ring-accent/50"
            />
          </label>
        ))}
      </div>

      {dirty && (
        <p className="mt-2 text-[10px] text-yellow">
          unsaved channel changes
        </p>
      )}
      {saved && (
        <p className="mt-2 text-[10px] text-green">
          saved — restart agent to apply
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red">{error}</p>
      )}
    </section>
  );
}

function highlightToml(text: string) {
  return text.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      return <div key={i} className="text-text-muted">{line}</div>;
    }
    if (/^\[.*\]$/.test(trimmed)) {
      return <div key={i} className="text-accent font-semibold mt-3 first:mt-0">{line}</div>;
    }
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0 && !trimmed.startsWith("[")) {
      const key = line.slice(0, eqIdx);
      const val = line.slice(eqIdx);
      return (
        <div key={i}>
          <span className="text-text">{key}</span>
          <span className="text-text-muted">=</span>
          <span className="text-green">{val.slice(1)}</span>
        </div>
      );
    }
    return <div key={i} className="text-text">{line}</div>;
  });
}

function highlightJson(text: string) {
  return text.split("\n").map((line, i) => {
    const keyMatch = line.match(/^(\s*)"([^"]+)"(\s*:\s*)(.*)/);
    if (keyMatch) {
      const [, indent, key, sep, rest] = keyMatch;
      return (
        <div key={i}>
          <span>{indent}</span>
          <span className="text-text">"{key}"</span>
          <span className="text-text-muted">{sep}</span>
          <span className="text-green">{rest}</span>
        </div>
      );
    }
    return <div key={i} className="text-text-muted">{line}</div>;
  });
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  variant?: "default" | "danger";
}) {
  const base =
    "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "danger"
      ? "border border-red/30 text-red hover:bg-red/10"
      : "border border-border text-text-secondary hover:bg-surface-hover hover:text-text";

  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {icon}
      $ {label}
    </button>
  );
}

function TabLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      replace
      className={`px-5 py-2.5 text-xs font-medium transition-colors ${
        active
          ? "border-b-2 border-accent text-accent"
          : "text-text-secondary hover:text-text"
      }`}
    >
      {children}
    </Link>
  );
}
