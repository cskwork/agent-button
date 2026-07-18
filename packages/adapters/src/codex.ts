import type { AgentEvent } from "@abtn/core";
import { streamProcess } from "@abtn/process-runner";
import { detectBinary } from "./detect.ts";
import {
  extractJson,
  schemaInstruction,
  type AgentAdapter,
  type AgentRunRequest,
  type AuthStatus,
} from "./types.ts";

/**
 * Codex adapter using `codex exec --json` (JSONL events on stdout).
 * The full app-server JSON-RPC protocol is a later upgrade; exec --json is
 * the documented non-interactive structured mode.
 */
export class CodexAdapter implements AgentAdapter {
  readonly id = "codex";
  private readonly binary: string;

  constructor(binary = "codex") {
    this.binary = binary;
  }

  detect() {
    return detectBinary(this.binary);
  }

  async authStatus(_profile: string): Promise<AuthStatus> {
    const installed = await this.detect();
    if (!installed.installed) return { state: "unknown", detail: "codex binary not found" };
    return { state: "ready", detail: "uses native login at run time" };
  }

  async capabilities() {
    return {
      supportsResume: false,
      supportsStructuredEvents: true,
      supportsModelSelection: true,
    };
  }

  async *start(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    let prompt = request.prompt;
    if (request.resultSchema) prompt += schemaInstruction(request.resultSchema);

    // Automations run in arbitrary working folders that are usually not git
    // repos; without this codex exits 1 ("Not inside a trusted directory").
    // Sandbox and network policy come from the user's codex config, not forced
    // here, so a deliberate read-only setup is respected.
    const args = ["exec", "--json", "--skip-git-repo-check"];
    if (request.model && request.model !== "default") args.push("-m", request.model);
    args.push(prompt);

    const proc = streamProcess({
      executable: this.binary,
      args,
      cwd: request.cwd,
      env: request.env,
      minimalEnv: false,
      timeoutMs: request.timeoutMs,
      signal,
    });

    yield { type: "run.started", runId: request.runId };

    let lastMessage = "";
    let failed = false;

    for await (const line of proc.lines) {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const type = String(msg.type ?? "");
      const item = msg.item as Record<string, unknown> | undefined;

      if (type === "item.started" && item?.type === "command_execution") {
        yield { type: "tool.started", name: "command", input: item.command };
      } else if (type === "item.completed" && item) {
        if (item.type === "agent_message" && typeof item.text === "string") {
          lastMessage = item.text;
          yield { type: "message.delta", text: item.text };
        } else if (item.type === "command_execution") {
          yield { type: "tool.completed", name: "command", output: item.aggregated_output ?? item.exit_code };
        } else if (item.type === "reasoning") {
          // Skip raw reasoning; keep the stream focused on visible output.
        } else if (item.type === "file_change") {
          yield { type: "tool.completed", name: "file_change", output: item.changes };
        }
      } else if (type === "turn.completed") {
        const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usage) {
          yield { type: "usage.updated", usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } };
        }
      } else if (type === "turn.failed" || type === "error") {
        failed = true;
        yield {
          type: "run.failed",
          error: { code: "AGENT_FAILED", message: String((msg.error as { message?: string })?.message ?? msg.message ?? "codex error") },
        };
      }
    }

    const exitCode = await proc.exitCode();
    if (failed) return;

    if (proc.wasCancelled()) {
      yield { type: "run.failed", error: { code: "CANCELLED", message: "Run cancelled" } };
    } else if (proc.wasTimedOut()) {
      yield { type: "run.failed", error: { code: "TIMEOUT", message: "Agent run timed out" } };
    } else if (exitCode !== 0) {
      const stderr = proc.stderrText();
      const code = /login|authenticate|not logged in/i.test(stderr) ? "AUTH_REQUIRED" : "AGENT_FAILED";
      yield { type: "run.failed", error: { code, message: `codex exited ${exitCode}: ${stderr.slice(0, 500)}` } };
    } else {
      yield {
        type: "run.completed",
        result: {
          text: lastMessage,
          exitCode: 0,
          structured: request.resultSchema ? extractJson(lastMessage) : undefined,
        },
      };
    }
  }

  async cancel(_runId: string): Promise<void> {
    // Cancellation flows through the AbortSignal given to start().
  }
}
