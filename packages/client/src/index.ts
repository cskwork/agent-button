export * from "./format.ts";

import { join } from "node:path";
import { abtnHome, AbtnError, type ButtonDefinition, type RunEvent, type RunRecord, type SerializedError } from "@abtn/core";

export interface ButtonWithSchedule extends Record<string, unknown> {
  id: string;
  kind: "agent-button" | "workflow";
  label: string;
  description: string;
  group: string;
  shortcut?: string;
  pinned?: boolean;
  schedule?: { next_run_at: string | null; paused: number; last_run_id: string | null };
}

export interface PendingApprovalView {
  request: { id: string; title: string; fields: Record<string, unknown> };
  runId: string;
  createdAt: string;
}

/** Typed client for the daemon's unix-socket HTTP API (shared by CLI/TUI/Tauri shell). */
export class DaemonClient {
  readonly socketPath: string;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? join(abtnHome(), "daemon.sock");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`http://daemon${path}`, {
        method,
        unix: this.socketPath,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new AbtnError("INTERNAL", `Daemon not reachable at ${this.socketPath}. Start it with: bun run daemon (${String(err)})`);
    }
    const data = (await response.json()) as T & { error?: SerializedError };
    if (!response.ok && data.error) throw new AbtnError(data.error.code, data.error.message, data.error.details);
    if (!response.ok) throw new AbtnError("INTERNAL", `Daemon returned ${response.status}`);
    return data;
  }

  health(): Promise<{ ok: boolean; activeRuns: number; pid: number }> {
    return this.request("GET", "/health");
  }

  listButtons(): Promise<{ buttons: (ButtonDefinition & ButtonWithSchedule)[]; loadErrors: { file: string; message: string }[] }> {
    return this.request("GET", "/buttons");
  }

  saveButton(definition: unknown): Promise<{ button: ButtonDefinition }> {
    return this.request("POST", "/buttons", definition);
  }

  deleteButton(id: string): Promise<{ deleted: string }> {
    return this.request("DELETE", `/buttons/${id}`);
  }

  listAdapters(): Promise<{ adapters: Record<string, { installed: boolean; path?: string; version?: string; auth?: { state: string; detail?: string } }> }> {
    return this.request("GET", "/adapters");
  }

  startRun(buttonId: string, inputs: Record<string, unknown> = {}, dryRun = false): Promise<{ run: RunRecord }> {
    return this.request("POST", "/runs", { buttonId, inputs, dryRun });
  }

  listRuns(limit = 50): Promise<{ runs: RunRecord[] }> {
    return this.request("GET", `/runs?limit=${limit}`);
  }

  getRun(runId: string): Promise<{ run: RunRecord; approvals: PendingApprovalView[] }> {
    return this.request("GET", `/runs/${runId}`);
  }

  runEvents(runId: string, since = 0): Promise<{ events: RunEvent[] }> {
    return this.request("GET", `/runs/${runId}/events?since=${since}`);
  }

  cancelRun(runId: string): Promise<{ cancelled: string }> {
    return this.request("POST", `/runs/${runId}/cancel`);
  }

  listApprovals(): Promise<{ approvals: PendingApprovalView[] }> {
    return this.request("GET", "/approvals");
  }

  decideApproval(approvalId: string, decision: "approved" | "rejected"): Promise<unknown> {
    return this.request("POST", `/approvals/${approvalId}`, { decision });
  }

  pauseSchedule(buttonId: string, paused: boolean): Promise<unknown> {
    return this.request("POST", `/schedules/${buttonId}/${paused ? "pause" : "resume"}`);
  }

  /** Stream run events over SSE. Yields until the stream closes or signal aborts. */
  async *streamEvents(runId?: string, since = 0, signal?: AbortSignal): AsyncIterable<RunEvent> {
    const path = runId ? `/runs/${runId}/stream?since=${since}` : "/events/stream";
    const response = await fetch(`http://daemon${path}`, { unix: this.socketPath, signal });
    if (!response.ok || !response.body) throw new AbtnError("INTERNAL", `SSE failed: ${response.status}`);

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              yield JSON.parse(line.slice(6)) as RunEvent;
            } catch { /* skip malformed frame */ }
          }
        }
      }
    }
  }
}
