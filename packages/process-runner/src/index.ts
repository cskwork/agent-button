import { spawn, type ChildProcess } from "node:child_process";
import { AbtnError } from "@abtn/core";

export interface RunProcessOptions {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Merge with a minimal base env (PATH, HOME, LANG) instead of full process.env. */
  minimalEnv?: boolean;
  stdin?: string;
  timeoutMs?: number;
  /** Cap per-stream captured output; excess is dropped with a marker. Default 4 MiB. */
  maxOutputBytes?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

const DEFAULT_MAX_OUTPUT = 4 * 1024 * 1024;
const KILL_GRACE_MS = 3000;

function baseEnv(): Record<string, string> {
  const keep = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER", "SHELL", "TERM"];
  const out: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** SIGTERM the whole process group, escalate to SIGKILL after a grace period. */
export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
  setTimeout(() => {
    try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  }, KILL_GRACE_MS).unref();
}

/**
 * Run a command with shell:false and its own process group, so cancellation
 * reliably terminates the full child tree (agents spawn MCP subprocesses).
 * Never interpolates user input into a shell string.
 */
export function runProcess(opts: RunProcessOptions): Promise<ProcessResult> {
  const started = Date.now();
  const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return new Promise((resolve, reject) => {
    const env = opts.minimalEnv === false
      ? { ...process.env as Record<string, string>, ...opts.env }
      : { ...baseEnv(), ...opts.env };

    let child: ChildProcess;
    try {
      child = spawn(opts.executable, opts.args, {
        cwd: opts.cwd,
        env,
        shell: false,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      reject(new AbtnError("STEP_FAILED", `Failed to spawn ${opts.executable}: ${String(err)}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const truncated = { stdout: false, stderr: false };

    const append = (target: "stdout" | "stderr", chunk: string) => {
      if (truncated[target]) return;
      const current = target === "stdout" ? stdout : stderr;
      if (current.length + chunk.length > maxBytes) {
        truncated[target] = true;
        const room = Math.max(0, maxBytes - current.length);
        const clipped = chunk.slice(0, room) + "\n[output truncated]\n";
        if (target === "stdout") stdout += clipped;
        else stderr += clipped;
        return;
      }
      if (target === "stdout") stdout += chunk;
      else stderr += chunk;
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      append("stdout", chunk);
      opts.onStdout?.(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      append("stderr", chunk);
      opts.onStderr?.(chunk);
    });

    if (opts.stdin !== undefined) child.stdin?.write(opts.stdin);
    child.stdin?.end();

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
        }, opts.timeoutMs)
      : undefined;

    const onAbort = () => {
      cancelled = true;
      killProcessTree(child);
    };
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
        cancelled,
        durationMs: Date.now() - started,
      });
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new AbtnError("STEP_FAILED", `Process error for ${opts.executable}: ${err.message}`));
    });
    child.on("close", (code) => finish(code));
  });
}

/**
 * Spawn a long-lived process and iterate its stdout line-by-line.
 * Used by streaming agent adapters (JSONL protocols).
 */
export interface StreamingProcess {
  lines: AsyncIterable<string>;
  stderrText: () => string;
  exitCode: () => Promise<number | null>;
  kill: () => void;
  wasCancelled: () => boolean;
  wasTimedOut: () => boolean;
}

export function streamProcess(opts: RunProcessOptions): StreamingProcess {
  const env = opts.minimalEnv === false
    ? { ...process.env as Record<string, string>, ...opts.env }
    : { ...baseEnv(), ...opts.env };

  const child = spawn(opts.executable, opts.args, {
    cwd: opts.cwd,
    env,
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  let cancelled = false;
  let timedOut = false;

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    if (stderr.length < DEFAULT_MAX_OUTPUT) stderr += chunk;
    opts.onStderr?.(chunk);
  });

  if (opts.stdin !== undefined) child.stdin?.write(opts.stdin);
  child.stdin?.end();

  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
      }, opts.timeoutMs)
    : undefined;

  const onAbort = () => {
    cancelled = true;
    killProcessTree(child);
  };
  if (opts.signal?.aborted) onAbort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const exitPromise = new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(code);
    });
    child.on("error", () => {
      if (timer) clearTimeout(timer);
      resolve(null);
    });
  });

  async function* lineIterator(): AsyncIterable<string> {
    let buffer = "";
    const stdout = child.stdout;
    if (!stdout) return;
    stdout.setEncoding("utf8");
    for await (const chunk of stdout) {
      buffer += chunk as string;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim().length > 0) yield line;
      }
    }
    if (buffer.trim().length > 0) yield buffer;
  }

  return {
    lines: lineIterator(),
    stderrText: () => stderr,
    exitCode: () => exitPromise,
    kill: () => killProcessTree(child),
    wasCancelled: () => cancelled,
    wasTimedOut: () => timedOut,
  };
}
