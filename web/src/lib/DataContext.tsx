import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentInfo, Project, AgentInstance, CommanderInfo, FluxSyncStatus } from "./types";
import { fetchAgents, fetchProjects, fetchInstances, fetchCommander, fetchDevBackendStatus, fetchFluxStatus } from "./api";
import { cleanDisplayName } from "./format";

interface DataContextValue {
  agents: AgentInfo[];
  projects: Project[];
  instances: AgentInstance[];
  commander: CommanderInfo | null;
  fluxStatus: FluxSyncStatus | null;
  loading: boolean;
  error: string | null;
  /** True when all API fetches failed — backend is likely down or restarting. */
  backendDown: boolean;
  /** True while the dashboard intentionally starts the dev backend. */
  backendStarting: boolean;
  setBackendStarting: (starting: boolean) => void;
  /** True when the user intentionally stopped the dev backend. */
  backendPollingPaused: boolean;
  pauseBackendPolling: () => void;
  resumeBackendPolling: () => void;
  refresh: (isUserInitiated?: boolean) => Promise<void>;
  pendingActions: Record<string, string>;
  setPendingAction: (agentName: string, action: string | null) => void;
}

const DataContext = createContext<DataContextValue | null>(null);
const DEV_BACKEND_STOPPED_KEY = "eyrie-dev-backend-stopped";
const DEV_BACKEND_STOPPED_EVENT = "eyrie-dev-backend-stopped-change";
const DEV_BACKEND_STOPPED_CHANNEL = "eyrie-dev-backend";

function readBackendPollingPaused(): boolean {
  try {
    return window.localStorage.getItem(DEV_BACKEND_STOPPED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeBackendPollingPaused(paused: boolean) {
  try {
    if (paused) {
      window.localStorage.setItem(DEV_BACKEND_STOPPED_KEY, "true");
    } else {
      window.localStorage.removeItem(DEV_BACKEND_STOPPED_KEY);
    }
  } catch {
    // private browsing or storage-disabled contexts
  }
  window.dispatchEvent(new CustomEvent(DEV_BACKEND_STOPPED_EVENT, { detail: paused }));
  try {
    const channel = new BroadcastChannel(DEV_BACKEND_STOPPED_CHANNEL);
    channel.postMessage({ stopped: paused });
    channel.close();
  } catch {
    // BroadcastChannel may be unavailable in some browser contexts
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [commander, setCommander] = useState<CommanderInfo | null>(null);
  const [fluxStatus, setFluxStatus] = useState<FluxSyncStatus | null>(null);
  const [loading, setLoading] = useState(() => !readBackendPollingPaused());
  const [error, setError] = useState<string | null>(null);
  const [backendDown, setBackendDown] = useState(readBackendPollingPaused);
  const [backendStarting, setBackendStarting] = useState(false);
  const [backendPollingPaused, setBackendPollingPaused] = useState(readBackendPollingPaused);
  const [pendingActions, setPendingActions] = useState<Record<string, string>>({});

  const setPendingAction = useCallback((agentName: string, action: string | null) => {
    setPendingActions((prev) => {
      if (action === null) {
        const { [agentName]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [agentName]: action };
    });
  }, []);

  // WHY refs instead of state in deps: Including `error`/`backendDown` in the
  // dependency array causes the entire polling loop to tear down and restart
  // on every state transition (null→"error"→null), triggering an extra fetch
  // each time. Refs let the backoff logic read current state without
  // restarting the loop.
  const errorRef = useRef(error);
  useEffect(() => { errorRef.current = error; }, [error]);
  const backendDownRef = useRef(backendDown);
  useEffect(() => { backendDownRef.current = backendDown; }, [backendDown]);
  const backendStartingRef = useRef(backendStarting);
  useEffect(() => { backendStartingRef.current = backendStarting; }, [backendStarting]);
  const backendPollingPausedRef = useRef(backendPollingPaused);
  useEffect(() => { backendPollingPausedRef.current = backendPollingPaused; }, [backendPollingPaused]);

  // WHY consecutive failure count: A single failure could be a transient
  // hiccup (backend recompiling). We only ramp up backoff after sustained
  // failures, keeping reconnection snappy for brief restarts while reducing
  // console noise during extended downtime.
  const failCountRef = useRef(0);

  const applyBackendPollingPaused = useCallback((paused: boolean) => {
    backendPollingPausedRef.current = paused;
    failCountRef.current = 0;
    setBackendPollingPaused(paused);
    setBackendDown(paused);
    if (paused) setBackendStarting(false);
    setError(null);
    setLoading(false);
  }, []);

  const applyBackendStarting = useCallback((starting: boolean) => {
    backendStartingRef.current = starting;
    setBackendStarting(starting);
  }, []);

  const pauseBackendPolling = useCallback(() => {
    writeBackendPollingPaused(true);
    applyBackendPollingPaused(true);
  }, [applyBackendPollingPaused]);

  const resumeBackendPolling = useCallback(() => {
    backendPollingPausedRef.current = false;
    failCountRef.current = 0;
    writeBackendPollingPaused(false);
    setBackendPollingPaused(false);
    setError(null);
  }, []);

  const refresh = useCallback(async (isUserInitiated = true) => {
    if (backendPollingPausedRef.current) {
      if (isUserInitiated) setLoading(false);
      return;
    }

    try {
      if (isUserInitiated) setLoading(true);
      setError(null);
      const errors: string[] = [];

      const [agentResult, projectResult, instanceResult, commanderResult, fluxResult] = await Promise.allSettled([
        fetchAgents(),
        fetchProjects(),
        fetchInstances(),
        fetchCommander(),
        fetchFluxStatus(),
      ]);

      // WHY JSON comparison: Without this, every 30s poll calls setState with
      // a new array/object reference even when data hasn't changed. React
      // re-renders all consumers (AgentDetail, ProjectChat, HierarchyPage, etc.)
      // unnecessarily. JSON.stringify is cheap for our data sizes (<100KB) and
      // prevents cascading re-renders of message lists, chat history, and forms.
      if (agentResult.status === "fulfilled") {
        const mapped = agentResult.value.map((a) => ({ ...a, display_name: cleanDisplayName(a.display_name) || a.display_name }));
        setAgents((prev) => JSON.stringify(prev) === JSON.stringify(mapped) ? prev : mapped);
      } else {
        errors.push(`agents: ${agentResult.reason?.message || "fetch failed"}`);
      }

      if (projectResult.status === "fulfilled") {
        setProjects((prev) => JSON.stringify(prev) === JSON.stringify(projectResult.value) ? prev : projectResult.value);
      } else {
        errors.push(`projects: ${projectResult.reason?.message || "fetch failed"}`);
      }

      if (instanceResult.status === "fulfilled") {
        const mapped = instanceResult.value.map((i) => ({ ...i, display_name: cleanDisplayName(i.display_name) || i.display_name }));
        setInstances((prev) => JSON.stringify(prev) === JSON.stringify(mapped) ? prev : mapped);
      } else {
        errors.push(`instances: ${instanceResult.reason?.message || "fetch failed"}`);
      }

      if (commanderResult.status === "fulfilled") {
        const val = commanderResult.value ?? null;
        setCommander((prev) => JSON.stringify(prev) === JSON.stringify(val) ? prev : val);
      }

      if (fluxResult.status === "fulfilled") {
        const val = fluxResult.value ?? null;
        setFluxStatus((prev) => JSON.stringify(prev) === JSON.stringify(val) ? prev : val);
      }
      // Commander fetch failure is not counted as an error — it's optional
      // (no commander set up yet is a valid state)

      // All three core fetches failed → backend is down. Fewer than three → at least
      // partially reachable, so clear the down flag.
      const allCoreFetchesFailed = errors.length === 3;
      if (allCoreFetchesFailed) {
        try {
          const status = await fetchDevBackendStatus();
          if (status.stopped_by_user) {
            writeBackendPollingPaused(true);
            applyBackendPollingPaused(true);
            return;
          }
        } catch {
          // Vite helper is dev-only; fall back to the regular unreachable state.
        }
      }
      setBackendDown(allCoreFetchesFailed);
      if (errors.length > 0) {
        setError(errors.join("; "));
      }
    } finally {
      setLoading(false);
    }
  }, [applyBackendPollingPaused]);

  useEffect(() => {
    const syncPausedState = () => {
      applyBackendPollingPaused(readBackendPollingPaused());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === DEV_BACKEND_STOPPED_KEY) syncPausedState();
    };
    const handleCustomEvent = (event: Event) => {
      applyBackendPollingPaused(Boolean((event as CustomEvent<boolean>).detail));
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(DEV_BACKEND_STOPPED_CHANNEL);
      channel.onmessage = (event) => {
        applyBackendPollingPaused(Boolean(event.data?.stopped));
      };
    } catch {
      channel = null;
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(DEV_BACKEND_STOPPED_EVENT, handleCustomEvent);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(DEV_BACKEND_STOPPED_EVENT, handleCustomEvent);
      channel?.close();
    };
  }, [applyBackendPollingPaused]);

  useEffect(() => {
    if (!backendPollingPaused) return;

    let cancelled = false;
    const reconcilePausedState = async () => {
      try {
        const status = await fetchDevBackendStatus();
        if (!cancelled && !status.stopped_by_user) {
          resumeBackendPolling();
        }
      } catch {
        // If the dev helper is unavailable, keep the explicit local pause.
      }
    };

    reconcilePausedState();
    const id = setInterval(reconcilePausedState, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [backendPollingPaused, resumeBackendPolling]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const scheduleRefresh = () => {
      if (backendPollingPausedRef.current) return;

      let delay: number;
      if (backendDownRef.current) {
        // Exponential backoff: 5s → 10s → 15s, capped at 15s.
        // Keeps console quiet during extended downtime while still
        // reconnecting within a reasonable window.
        delay = Math.min(5000 + failCountRef.current * 5000, 15000);
      } else {
        delay = 30000;
      }
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        if (backendPollingPausedRef.current) return;
        await refresh(false);
        if (backendPollingPausedRef.current) return;
        if (backendDownRef.current || backendStartingRef.current) {
          failCountRef.current++;
        } else {
          failCountRef.current = 0;
        }
        if (!cancelled) scheduleRefresh();
      }, delay);
    };

    refresh().then(() => {
      if (!cancelled) scheduleRefresh();
    });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [refresh, backendPollingPaused]);

  return (
    <DataContext.Provider value={{ agents, projects, instances, commander, fluxStatus, loading, error, backendDown, backendStarting, setBackendStarting: applyBackendStarting, backendPollingPaused, pauseBackendPolling, resumeBackendPolling, refresh, pendingActions, setPendingAction }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useData must be used within a DataProvider");
  }
  return ctx;
}
