import type { AgentEvent } from "@abtn/core";
import type { AgentAdapter, AgentRunRequest, AuthStatus } from "./types.ts";

/**
 * Deterministic in-process adapter for tests and dry runs. Echoes the prompt
 * and optionally returns a canned structured result.
 */
export class FakeAdapter implements AgentAdapter {
  readonly id: string;
  private readonly scripted: AgentEvent[] | null;
  readonly requests: AgentRunRequest[] = [];

  constructor(id = "fake", scripted: AgentEvent[] | null = null) {
    this.id = id;
    this.scripted = scripted;
  }

  async detect() {
    return { installed: true, path: "internal:fake", version: "0.0.0" };
  }

  async authStatus(_profile: string): Promise<AuthStatus> {
    return { state: "ready" };
  }

  async capabilities() {
    return { supportsResume: false, supportsStructuredEvents: true, supportsModelSelection: false };
  }

  async *start(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    this.requests.push(request);
    if (this.scripted) {
      for (const ev of this.scripted) {
        if (signal.aborted) {
          yield { type: "run.failed", error: { code: "CANCELLED", message: "Run cancelled" } };
          return;
        }
        yield ev;
      }
      return;
    }
    yield { type: "run.started", runId: request.runId };
    yield { type: "message.delta", text: `[fake] ${request.prompt.slice(0, 200)}` };
    yield {
      type: "run.completed",
      result: { text: `[fake] done: ${request.prompt.slice(0, 100)}`, exitCode: 0 },
    };
  }

  async cancel(_runId: string): Promise<void> {}
}
