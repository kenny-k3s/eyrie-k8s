import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";

let backendProcess: ChildProcess | null = null;
let cleanupHooksInstalled = false;
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const backendBinaryPath = fileURLToPath(new URL("../bin/eyrie", import.meta.url));
const backendLogPath = "/tmp/eyrie-dev-backend.log";
const backendPidPath = "/tmp/eyrie-dev-backend.pid";
const backendStoppedPath = "/tmp/eyrie-dev-backend.stopped";
type BackendStartMode = "binary" | "make-dev";

async function isBackendReachable(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:7200/api/agents", {
      signal: AbortSignal.timeout(750),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForBackendUnreachable(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isBackendReachable())) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !(await isBackendReachable());
}

function json(res: import("node:http").ServerResponse, status: number, body: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBackendPid(): number | null {
  try {
    const pid = Number.parseInt(readFileSync(backendPidPath, "utf8"), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function clearBackendPid(pid?: number) {
  try {
    if (pid !== undefined && readBackendPid() !== pid) return;
    unlinkSync(backendPidPath);
  } catch {
    // pid file may not exist
  }
}

function backendStoppedByUser(): boolean {
  return existsSync(backendStoppedPath);
}

function setBackendStoppedByUser(stopped: boolean) {
  try {
    if (stopped) {
      writeFileSync(backendStoppedPath, String(Date.now()));
    } else {
      unlinkSync(backendStoppedPath);
    }
  } catch {
    // stopped marker may not exist
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ownedBackendPid(): number | null {
  if (backendProcess && backendProcess.exitCode === null && backendProcess.pid) {
    return backendProcess.pid;
  }

  const pid = readBackendPid();
  if (!pid) return null;
  if (processExists(pid)) return pid;
  clearBackendPid(pid);
  return null;
}

function stopBackendProcess(): boolean {
  const child = backendProcess;
  const pid = child?.pid ?? readBackendPid();
  backendProcess = null;
  if (!pid) return false;
  clearBackendPid(pid);

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch { /* already stopped */ }
  }
  return true;
}

function ensureBackendBinary() {
  if (existsSync(backendBinaryPath)) return;

  const out = openSync(backendLogPath, "a");
  try {
    const result = spawnSync("go", [
      "build",
      "-ldflags",
      "-X github.com/Audacity88/eyrie/internal/config.Version=dev",
      "-o",
      backendBinaryPath,
      "./cmd/eyrie",
    ], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", out, out],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`go build exited with ${result.status ?? "unknown"}`);
    }
  } finally {
    closeSync(out);
  }
}

function normalizeBackendStartMode(value: unknown): BackendStartMode {
  return value === "make-dev" ? "make-dev" : "binary";
}

function readRequestBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseBackendStartMode(req: import("node:http").IncomingMessage): Promise<BackendStartMode> {
  const raw = await readRequestBody(req);
  if (!raw.trim()) return "binary";
  try {
    const parsed = JSON.parse(raw);
    return normalizeBackendStartMode(parsed?.mode);
  } catch {
    return "binary";
  }
}

function startBackendProcess(server: ViteDevServer, mode: BackendStartMode = "binary"): "started" | "starting" {
  if (ownedBackendPid()) return "starting";
  setBackendStoppedByUser(false);

  if (mode === "binary") ensureBackendBinary();

  const out = openSync(backendLogPath, "a");
  backendProcess = mode === "make-dev" ? spawn("make", ["dev-go"], {
    cwd: projectRoot,
    env: process.env,
    detached: true,
    stdio: ["ignore", out, out],
  }) : spawn(backendBinaryPath, ["dashboard", "--no-open"], {
    cwd: projectRoot,
    env: process.env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  closeSync(out);
  const child = backendProcess;
  const childPid = child.pid;
  if (childPid) writeFileSync(backendPidPath, String(childPid));

  child.on("exit", (code, signal) => {
    server.config.logger.info(
      `[eyrie-dev] backend exited with ${code ?? signal ?? "unknown"}`,
    );
    if (backendProcess === child) backendProcess = null;
    if (childPid) clearBackendPid(childPid);
  });

  child.on("error", (err) => {
    server.config.logger.error(`[eyrie-dev] failed to start backend: ${err.message}`);
    if (backendProcess === child) backendProcess = null;
    if (childPid) clearBackendPid(childPid);
  });

  return "started";
}

function installCleanupHooks(server: ViteDevServer) {
  server.httpServer?.once("close", stopBackendProcess);
  if (cleanupHooksInstalled) return;
  cleanupHooksInstalled = true;
  process.once("exit", stopBackendProcess);
  process.once("SIGINT", () => {
    stopBackendProcess();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stopBackendProcess();
    process.exit(143);
  });
}

function eyrieDevBackendStarter() {
  return {
    name: "eyrie-dev-backend-starter",
    configureServer(server: ViteDevServer) {
      installCleanupHooks(server);
      if (process.env.EYRIE_DEV_AUTOSTART_BACKEND === "1") {
        setTimeout(async () => {
          if (backendStoppedByUser()) return;
          if (await isBackendReachable()) return;
          startBackendProcess(server, normalizeBackendStartMode(process.env.EYRIE_DEV_BACKEND_MODE));
        }, 0);
      }

      server.middlewares.use("/__eyrie-dev/backend-status", async (req, res) => {
        if (req.method !== "GET") {
          json(res, 405, { error: "method not allowed" });
          return;
        }

        const reachable = await isBackendReachable();
        json(res, 200, {
          backend_reachable: reachable,
          owned_backend_pid: ownedBackendPid(),
          stopped_by_user: backendStoppedByUser(),
        });
      });

      server.middlewares.use("/__eyrie-dev/start-backend", async (req, res) => {
        if (req.method !== "POST") {
          json(res, 405, { error: "method not allowed" });
          return;
        }

        const wasStoppedByUser = backendStoppedByUser();
        if (wasStoppedByUser) {
          await waitForBackendUnreachable();
        }

        if (!wasStoppedByUser && await isBackendReachable()) {
          setBackendStoppedByUser(false);
          json(res, 200, { status: "already_running" });
          return;
        }

        const mode = await parseBackendStartMode(req);
        try {
          const status = startBackendProcess(server, mode);
          json(res, 202, { status, mode, log_path: backendLogPath });
        } catch (err) {
          json(res, 500, {
            error: err instanceof Error ? err.message : "failed to start backend",
            mode,
          });
        }
      });

      server.middlewares.use("/__eyrie-dev/stop-backend", async (req, res) => {
        if (req.method !== "POST") {
          json(res, 405, { error: "method not allowed" });
          return;
        }

        if (ownedBackendPid()) {
          setBackendStoppedByUser(true);
          stopBackendProcess();
          json(res, 202, { status: "stopping" });
          return;
        }

        if (await isBackendReachable()) {
          json(res, 409, {
            error: "backend is running outside this Vite dev server",
            status: "external_backend",
          });
          return;
        }

        setBackendStoppedByUser(true);
        json(res, 200, { status: "already_stopped" });
      });
    },
  };
}

// Suppress Vite's "[vite] ws proxy socket error: EPIPE" noise.
// When the browser closes a tmux WebSocket, Vite's internal WS proxy
// handler catches the EPIPE from the dead upstream socket and logs it
// via the Vite logger before our proxy event handlers can intercept it.
// This is harmless (tmux session persists regardless), but the full
// stack trace clutters the dev terminal. Vite doesn't expose a config
// option to silence it, so we filter it at the logger level.
const _origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = typeof args[0] === "string" ? args[0] : "";
  if (first.includes("ws proxy socket error") || first.includes("write EPIPE")) return;
  _origConsoleError(...args);
};

export default defineConfig({
  plugins: [react(), tailwindcss(), eyrieDevBackendStarter()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    hmr: {
      // Reduce console noise when backend is down — Vite's HMR client
      // retries every 1s by default, flooding the console with WebSocket
      // errors. A longer interval keeps the connection alive without spam.
      timeout: 30000,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7200",
        ws: true,
        timeout: 0,
        proxyTimeout: 0,
        // Disable response compression so SSE events stream in real-time
        // instead of being buffered until the response completes.
        headers: { "Accept-Encoding": "identity" },
        // WHY: When the Go backend restarts (hot reload), the proxy gets
        // ECONNREFUSED for a few seconds. Vite logs noisy red errors for
        // each failed request. This handler suppresses ECONNREFUSED errors
        // and returns a quiet 503 so the frontend retries on next poll.
        configure: (proxy, _options, server) => {
          // Replace Vite's default error listener to suppress noisy
          // ECONNREFUSED logs when the Go backend is restarting.
          proxy.removeAllListeners("error");
          proxy.on("error", (err: any, _req, res) => {
            // Only log non-ECONNREFUSED errors
            if (err?.code !== "ECONNREFUSED" && err?.code !== "EPIPE") {
              server?.config?.logger?.error(`[proxy] ${err.message}`);
            }
            if (res && "writeHead" in res) {
              // HTTP response — send 503 so the frontend retries
              try {
                (res as any).writeHead(503, { "Content-Type": "application/json" });
                (res as any).end(JSON.stringify({ error: "backend restarting" }));
              } catch {
                // Response may already be sent
              }
            } else if (res && "destroy" in res) {
              // WebSocket socket — clean up so the browser reconnects
              try { (res as any).destroy(); } catch { /* already closed */ }
            }
          });
          // Suppress EPIPE/ECONNRESET on BOTH sides of the WS proxy.
          // Vite's http-proxy pipes two sockets together — the error can
          // come from either the upstream (backend) or downstream (browser)
          // socket. Catching on proxyReqWs alone misses the response side.
          for (const event of ["proxyReqWs", "open"] as const) {
            proxy.on(event, (_arg1: any, _arg2: any, socket: any) => {
              if (socket && typeof socket.on === "function" && !socket.__eyrieErrorHandled) {
                socket.__eyrieErrorHandled = true;
                socket.on("error", (err: any) => {
                  if (err?.code !== "EPIPE" && err?.code !== "ECONNRESET") {
                    server?.config?.logger?.error(`[ws proxy] ${err.message}`);
                  }
                });
              }
            });
          }
        },
      },
      "/ws": {
        target: "ws://127.0.0.1:7200",
        ws: true,
        configure: (proxy) => {
          proxy.removeAllListeners("error");
          proxy.on("error", () => {}); // suppress EPIPE/ECONNREFUSED noise
        },
      },
    },
  },
});
