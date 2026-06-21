import { Routes, Route, Navigate, useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Play, Power, RefreshCw, GitCommit, AlertTriangle, CheckCircle } from "lucide-react";
import type { AgentInfo } from "./lib/types";
import { formatUptime, formatBytes } from "./lib/format";
import { fetchDevBackendStatus, startDevBackend, stopDevBackend } from "./lib/api";
import { DataProvider, useData } from "./lib/DataContext";
import Sidebar from "./components/Sidebar";
import AgentDetail from "./components/AgentDetail";
import PersonasPage from "./components/PersonasPage";
import HierarchyPage from "./components/HierarchyPage";
import OnboardingFlow from "./components/OnboardingFlow";
import AgentsPage from "./components/AgentsPage";
import ProjectListPage from "./components/ProjectListPage";
import ProjectDetail from "./components/ProjectDetail";
import SettingsPage from "./components/SettingsPage";
import FrameworkDetail from "./components/FrameworkDetail";
import AgentCompare from "./components/AgentCompare";
import FrameworkCompare from "./components/FrameworkCompare";
import MeshStatusPage from "./components/MeshStatusPage";
import CommanderChat from "./components/CommanderChat";
import CommandRoomPage from "./components/CommandRoomPage";
import { useFont } from "./lib/useFont";
import { useTheme } from "./lib/useTheme";
import { useBackendStartMode } from "./lib/useBackendStartMode";

export default function App() {
  return (
    <DataProvider>
      <AppContent />
    </DataProvider>
  );
}

function AppContent() {
  const { agents, loading, error, backendDown, backendPollingPaused, pauseBackendPolling, resumeBackendPolling, refresh, setBackendStarting } = useData();
  const [backendStartMessage, setBackendStartMessage] = useState<string | null>(null);
  const [backendStartError, setBackendStartError] = useState<string | null>(null);
  const [startingBackend, setStartingBackend] = useState(false);
  const [stoppingBackend, setStoppingBackend] = useState(false);
  const backendStartTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const { mode: backendStartMode } = useBackendStartMode();
  useFont(); // Apply saved font on mount
  useTheme(); // Apply saved theme on mount

  const canStartDevBackend = import.meta.env.DEV;

  function clearBackendStartTimeout() {
    if (!backendStartTimeoutRef.current) return;
    window.clearTimeout(backendStartTimeoutRef.current);
    backendStartTimeoutRef.current = null;
  }

  useEffect(() => {
    if (backendDown || backendPollingPaused) return;
    if (startingBackend) return;
    clearBackendStartTimeout();
    setBackendStartMessage(null);
    setBackendStartError(null);
    setStartingBackend(false);
  }, [backendDown, backendPollingPaused, startingBackend]);

  useEffect(() => () => clearBackendStartTimeout(), []);

  async function waitForDevBackendReachable(timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const status = await fetchDevBackendStatus();
        if (status.backend_reachable) return true;
      } catch {
        // The helper endpoint may lag briefly while Vite is settling.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    return false;
  }

  function finishBackendStartAfterReconcile() {
    clearBackendStartTimeout();
    backendStartTimeoutRef.current = window.setTimeout(() => {
      void refresh(false);
      setBackendStartMessage(null);
      setStartingBackend(false);
      setBackendStarting(false);
      backendStartTimeoutRef.current = null;
    }, 1000);
  }

  async function handleStartBackend() {
    if (startingBackend) return;
    let waitingForReconcile = false;
    clearBackendStartTimeout();
    setStartingBackend(true);
    setBackendStarting(true);
    setBackendStartError(null);
    setBackendStartMessage("starting backend...");
    try {
      resumeBackendPolling();
      const result = await startDevBackend(backendStartMode);
      if (result.status === "already_running") {
        await refresh(false);
        waitingForReconcile = true;
        finishBackendStartAfterReconcile();
        return;
      }
      const reachable = await waitForDevBackendReachable();
      if (reachable) {
        await refresh(false);
        waitingForReconcile = true;
        finishBackendStartAfterReconcile();
        return;
      }
      setBackendStartMessage("backend still starting...");
      window.setTimeout(() => void refresh(false), 3000);
    } catch (err) {
      pauseBackendPolling();
      setBackendStartMessage(null);
      setBackendStartError(err instanceof Error ? err.message : "failed to start backend");
      setBackendStarting(false);
    } finally {
      if (!waitingForReconcile) {
        setStartingBackend(false);
        setBackendStarting(false);
      }
    }
  }

  async function handleStopBackend() {
    clearBackendStartTimeout();
    setBackendStarting(false);
    setStoppingBackend(true);
    setBackendStartError(null);
    setBackendStartMessage("stopping backend...");
    pauseBackendPolling();
    try {
      await stopDevBackend();
      setBackendStartMessage(null);
    } catch (err) {
      setBackendStartMessage("backend polling paused");
      setBackendStartError(err instanceof Error ? err.message : "failed to stop backend");
    } finally {
      setStoppingBackend(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Persistent banner when backend is unreachable — shown across all
            routes so the user always knows why data isn't updating. */}
        {canStartDevBackend && startingBackend && (
          <div className="flex flex-wrap items-center gap-3 border-b border-yellow-500/30 bg-yellow-500/5 px-4 py-2 text-xs text-yellow-400">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
              backend starting...
            </div>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 border border-yellow-400/40 px-2 py-1 text-[11px] text-yellow-300 opacity-50"
              title={backendStartMode === "binary" ? "Starting the Eyrie backend from the fast dev binary" : "Starting the Eyrie backend through make dev-go"}
            >
              <Play className="h-3 w-3" />
              $ starting
            </button>
            {backendStartError && (
              <span className="text-red">{backendStartError}</span>
            )}
          </div>
        )}
        {canStartDevBackend && !startingBackend && !backendDown && !backendPollingPaused && (
          <div className="flex flex-wrap items-center gap-3 border-b border-accent/20 bg-accent/5 px-4 py-2 text-xs text-accent">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              dev backend reachable
            </div>
            <button
              type="button"
              onClick={handleStopBackend}
              disabled={stoppingBackend}
              className="inline-flex items-center gap-1.5 border border-accent/40 px-2 py-1 text-[11px] text-accent transition-colors hover:border-accent hover:text-text disabled:opacity-50"
              title="Stop the Eyrie backend if this Vite dev server started it"
            >
              <Power className="h-3 w-3" />
              {stoppingBackend ? "$ stopping" : "$ stop backend"}
            </button>
            {backendStartMessage && !startingBackend && (
              <span className="text-accent/80">{backendStartMessage}</span>
            )}
            {backendStartError && (
              <span className="text-red">{backendStartError}</span>
            )}
          </div>
        )}
        {canStartDevBackend && !startingBackend && backendPollingPaused && (
          <div className="flex flex-wrap items-center gap-3 border-b border-yellow-500/30 bg-yellow-500/5 px-4 py-2 text-xs text-yellow-400">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
              backend stopped
            </div>
            <button
              type="button"
              onClick={handleStartBackend}
              disabled={startingBackend || stoppingBackend}
              className="inline-flex items-center gap-1.5 border border-yellow-400/40 px-2 py-1 text-[11px] text-yellow-300 transition-colors hover:border-yellow-300 hover:text-yellow-100 disabled:opacity-50"
              title={backendStartMode === "binary" ? "Start the Eyrie backend from the fast dev binary" : "Start the Eyrie backend through make dev-go"}
            >
              <Play className="h-3 w-3" />
              {stoppingBackend ? "$ stopping" : startingBackend ? "$ starting" : "$ start backend"}
            </button>
            {backendStartMessage && !startingBackend && (
              <span className="text-yellow-300/80">{backendStartMessage}</span>
            )}
            {backendStartError && (
              <span className="text-red">{backendStartError}</span>
            )}
          </div>
        )}
        {!startingBackend && backendDown && !backendPollingPaused && (
          <div className="flex flex-wrap items-center gap-3 border-b border-yellow-500/30 bg-yellow-500/5 px-4 py-2 text-xs text-yellow-400">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
              {startingBackend ? "backend starting..." : "backend unreachable — retrying..."}
            </div>
            {canStartDevBackend && (
              <button
                type="button"
                onClick={handleStartBackend}
                disabled={startingBackend}
                className="inline-flex items-center gap-1.5 border border-yellow-400/40 px-2 py-1 text-[11px] text-yellow-300 transition-colors hover:border-yellow-300 hover:text-yellow-100 disabled:opacity-50"
                title={backendStartMode === "binary" ? "Start the Eyrie backend from the fast dev binary" : "Start the Eyrie backend through make dev-go"}
              >
                <Play className="h-3 w-3" />
                {startingBackend ? "$ starting" : "$ start backend"}
              </button>
            )}
            {backendStartMessage && !startingBackend && (
              <span className="text-yellow-300/80">{backendStartMessage}</span>
            )}
            {backendStartError && (
              <span className="text-red">{backendStartError}</span>
            )}
          </div>
        )}
        <FluxStatusBar />
        <div className="min-h-0 flex-1 overflow-hidden">
          <Routes>
            {/* Full-width routes (no padding/max-width) */}
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/mission-control/command-room" element={<CommandRoomPage />} />

            {/* Constrained routes */}
            <Route path="*" element={
              <div className="mx-auto h-full max-w-5xl overflow-y-auto px-8 py-8">
                {error && !backendDown && (
                  <div className="mb-6 rounded border border-red/30 bg-red/5 px-4 py-3 text-xs text-red">
                    {error}
                  </div>
                )}
                <Routes>
                  <Route path="/" element={<OnboardingFlow />} />
                  <Route path="/hierarchy" element={<Navigate to="/mission-control" replace />} />
                  <Route path="/mission-control" element={<HierarchyPage />} />
                  <Route path="/mission-control/agents" element={<AgentsPage />} />
                  <Route path="/mission-control/mesh" element={<MeshStatusPage />} />
                  <Route path="/projects" element={<ProjectListPage />} />
                  <Route
                    path="/agents/overview"
                    element={
                      <AgentList
                        agents={agents}
                        loading={loading}
                        onRefresh={refresh}
                      />
                    }
                  />
                  <Route path="/agents/compare" element={<AgentCompare />} />
                  <Route path="/frameworks" element={<FrameworkCompare />} />
                  <Route path="/frameworks/compare" element={<Navigate to="/frameworks" replace />} />
                  <Route path="/install" element={<Navigate to="/frameworks" replace />} />
                  <Route
                    path="/agents/:name/:tab?"
                    element={<AgentDetailRoute />}
                  />
                  <Route path="/frameworks/:id" element={<FrameworkDetail />} />
                  <Route path="/personas" element={<PersonasPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </div>
            } />
          </Routes>
        </div>
      </main>

      <CommanderChat />
    </div>
  );
}

function AgentList({
  agents,
  loading,
  onRefresh,
}: {
  agents: AgentInfo[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const running = agents.filter((a) => a.alive).length;
  const totalUptime = agents.reduce(
    (sum, a) => sum + (a.health?.uptime ?? 0),
    0,
  );
  const avgUptime = agents.length > 0 ? totalUptime / agents.length : 0;

  return (
    <div className="space-y-6">
      <div className="text-xs text-text-muted">~/agents/overview</div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold"><span className="text-accent">&gt;</span> agent_overview</h1>
          <p className="mt-1 text-xs text-text-muted">
            // monitor agent status and performance
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 text-xs text-text-muted transition-colors hover:text-text disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          $ refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="total_agents" value={String(agents.length)} />
        <StatCard label="running" value={String(running)} highlight />
        <StatCard label="avg_uptime" value={formatUptime(avgUptime)} />
      </div>

      {loading && agents.length === 0 ? (
        <div className="py-12 text-center text-xs text-text-muted">
          Discovering agents...
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded border border-border bg-surface p-8 text-center text-xs text-text-muted">
          No agents discovered. Make sure ZeroClaw or OpenClaw is installed and
          configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-text-muted">
                <th className="px-4 py-2.5 font-medium">name</th>
                <th className="px-4 py-2.5 font-medium">framework</th>
                <th className="px-4 py-2.5 font-medium">status</th>
                <th className="px-4 py-2.5 font-medium">port</th>
                <th className="px-4 py-2.5 font-medium">memory</th>
                <th className="px-4 py-2.5 font-medium">cpu</th>
              </tr>
            </thead>
            <tbody className="[&>tr+tr]:border-t [&>tr+tr]:border-border">
              {agents.map((agent) => (
                <tr
                  key={agent.name}
                  onClick={() => navigate(`/agents/${agent.name}`)}
                  className="group relative cursor-pointer transition-all hover:bg-surface-hover/50 hover:shadow-[inset_0_0_0_1px_var(--color-accent)] hover:z-10"
                >
                  <td className="px-4 py-2.5 transition-colors group-hover:text-accent">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${agent.alive ? "bg-green" : "bg-red"}`}
                      />
                      {agent.display_name || agent.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary transition-colors group-hover:text-accent">
                    {agent.framework}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase ${
                        agent.alive
                          ? "bg-green/10 text-green"
                          : "bg-red/10 text-red"
                      }`}
                    >
                      {agent.alive ? "running" : "stopped"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary transition-colors group-hover:text-accent">
                    :{agent.port}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary transition-colors group-hover:text-accent">
                    {agent.health ? formatBytes(agent.health.ram_bytes) : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary transition-colors group-hover:text-accent">
                    {agent.health?.cpu_percent != null
                      ? `${agent.health.cpu_percent.toFixed(1)}%`
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {agents.length > 0 && (
        <div className="flex justify-end">
          <Link
            to="/agents/compare"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-accent transition-colors"
          >
            compare agent performance →
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <p
        className={`mt-1.5 text-xl font-bold ${highlight ? "text-accent" : "text-text"}`}
      >
        {value}
      </p>
    </div>
  );
}

function AgentDetailRoute() {
  const { name } = useParams<{ name: string }>();
  const { agents, refresh } = useData();
  const agent = agents.find((a) => a.name === name);

  if (!agent) {
    return (
      <div className="py-20 text-center text-xs text-text-muted">
        {agents.length === 0
          ? "Loading agents..."
          : `Agent "${name}" not found.`}
      </div>
    );
  }

  return <AgentDetail agent={agent} onRefresh={refresh} />;
}

function getCommitLink(revision?: string) {
  if (!revision) return null;
  const match = revision.match(/sha1:([a-f0-9]+)/);
  if (match) {
    const sha = match[1];
    return {
      sha: sha.substring(0, 7),
      url: `https://github.com/kenny-k3s/ai_agents/commit/${sha}`
    };
  }
  return null;
}

function formatSyncTime(timeStr?: string) {
  if (!timeStr) return "-";
  try {
    const date = new Date(timeStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + " " + date.toLocaleDateString();
  } catch {
    return timeStr;
  }
}

function FluxStatusBar() {
  const { fluxStatus } = useData();

  if (!fluxStatus || fluxStatus.sync_status === "Disabled") {
    return null;
  }

  const commit = getCommitLink(fluxStatus.last_applied);
  const isFailed = fluxStatus.sync_status === "Failed";
  const isReconciling = fluxStatus.sync_status === "Reconciling";

  let statusIcon = <CheckCircle className="h-3.5 w-3.5 text-green" />;
  if (isFailed) {
    statusIcon = <AlertTriangle className="h-3.5 w-3.5 text-red" />;
  } else if (isReconciling) {
    statusIcon = <RefreshCw className="h-3.5 w-3.5 text-yellow animate-spin" />;
  }

  return (
    <div className="flex items-center justify-between border-b border-border bg-surface-hover/30 px-6 py-2 text-xs">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-medium">
          {statusIcon}
          <span>GitOps: {fluxStatus.sync_status}</span>
        </div>
        {commit && (
          <div className="flex items-center gap-1 border-l border-border pl-3 text-text-muted">
            <GitCommit className="h-3.5 w-3.5" />
            <a
              href={commit.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:text-accent hover:underline"
            >
              {commit.sha}
            </a>
          </div>
        )}
        {fluxStatus.message && isFailed && (
          <span className="truncate max-w-md text-red/80 border-l border-border pl-3" title={fluxStatus.message}>
            {fluxStatus.message}
          </span>
        )}
      </div>
      <div className="text-text-muted">
        synced {formatSyncTime(fluxStatus.last_sync_time)}
      </div>
    </div>
  );
}
