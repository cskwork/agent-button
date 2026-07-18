import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { abtnHome } from "@abtn/core";

/**
 * Web dashboard + web TUI bridge.
 *  - Serves a static single-page dashboard on localhost, proxying /api/* to
 *    the daemon's unix socket (the same page can front a future Tauri shell).
 *  - /ws/tui upgrades to a WebSocket wired to a real TUI process running in
 *    a pty (via `script`), textual-web style: browser keys go straight to
 *    the terminal app.
 * Localhost-only by design.
 */
const PORT = Number(process.env.ABTN_WEB_PORT ?? 4173);
const socketPath = process.env.ABTN_SOCKET ?? join(abtnHome(), "daemon.sock");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");

interface TuiSession {
  child: ChildProcess;
}

const server = Bun.serve<TuiSession>({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 120,
  async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === "/ws/tui") {
      const cols = clampInt(url.searchParams.get("cols"), 40, 400, 100);
      const rows = clampInt(url.searchParams.get("rows"), 10, 200, 30);
      const child = spawnTui(cols, rows);
      if (srv.upgrade(req, { data: { child } })) return;
      child.kill("SIGTERM");
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname.startsWith("/api/")) {
      const target = url.pathname.slice(4) + url.search;
      try {
        const upstream = await fetch(`http://daemon${target}`, {
          method: req.method,
          unix: socketPath,
          headers: { "Content-Type": "application/json" },
          body: req.method === "GET" ? undefined : await req.text(),
        });
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
        });
      } catch {
        return new Response(
          JSON.stringify({ error: { code: "INTERNAL", message: `Daemon not reachable at ${socketPath}. Start it with: bun run daemon` } }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    const file = Bun.file(join(publicDir, url.pathname === "/" ? "index.html" : url.pathname.slice(1)));
    if (await file.exists()) return new Response(file);
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const { child } = ws.data;
      child.stdout?.on("data", (chunk: Buffer) => ws.send(chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => ws.send(chunk.toString("utf8")));
      child.on("close", () => ws.close());
    },
    message(ws, message) {
      const text = typeof message === "string" ? message : Buffer.from(message).toString("utf8");
      ws.data.child.stdin?.write(text);
    },
    close(ws) {
      ws.data.child.kill("SIGTERM");
      setTimeout(() => ws.data.child.kill("SIGKILL"), 2000).unref();
    },
  },
});

/**
 * Allocate a pty without native bindings: python3's pty.spawn tolerates a
 * non-tty stdin (macOS `script` aborts with tcgetattr on socket stdio).
 */
function spawnTui(cols: number, rows: number): ChildProcess {
  const pyBridge = "import pty, sys; pty.spawn(sys.argv[1:])";
  return spawn("python3", ["-c", pyBridge, "bun", "run", join(repoRoot, "apps/tui/src/main.ts")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ABTN_TUI_COLS: String(cols),
      ABTN_TUI_ROWS: String(rows),
      TERM: "xterm-256color",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

console.log(`[web] dashboard on http://127.0.0.1:${server.port} (daemon: ${socketPath})`);
console.log(`[web] web TUI at http://127.0.0.1:${server.port}/term.html`);
