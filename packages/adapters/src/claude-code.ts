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
 * Claude Code adapter using `claude -p --output-format stream-json`.
 * Runs under the user's native authenticated profile (subscription login,
 * CLAUDE.md, skills, MCP servers all inherited) — never --bare, never
 * copied credentials (spec section 7).
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = "claude-code";
  private readonly binary: string;

  constructor(binary = "claude") {
    this.binary = binary;
  }

  detect() {
    return detectBinary(this.binary);
  }

  async authStatus(_profile: string): Promise<AuthStatus> {
    const installed = await this.detect();
    if (!installed.installed) return { state: "unknown", detail: "claude binary not found" };
    return { state: "ready", detail: "uses native keychain login at run time" };
  }

  async capabilities() {
    return {
      supportsResume: true,
      supportsStructuredEvents: true,
      supportsModelSelection: true,
    };
  }

  async *start(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    let prompt = request.prompt;
    if (request.resultSchema) prompt += schemaInstruction(request.resultSchema);

    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
    if (request.model && request.model !== "default") args.push("--model", request.model);

    const proc = streamProcess({
      executable: this.binary,
      args,
      cwd: request.cwd,
      env: request.env,
      minimalEnv: false, // inherit native profile: keychain, config, MCP
      timeoutMs: request.timeoutMs,
      signal,
    });

    yield { type: "run.started", runId: request.runId };

    const toolNames = new Map<string, string>();
    let resultText = "";
    let sawResult = false;

    for await (const line of proc.lines) {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // non-JSON noise on stdout
      }
      const events = mapClaudeMessage(msg, toolNames);
      for (const ev of events) {
        if (ev.type === "run.completed") {
          sawResult = true;
          resultText = ev.result.text ?? "";
          ev.result.structured = request.resultSchema ? extractJson(resultText) : undefined;
        }
        if (ev.type === "run.failed") sawResult = true;
        yield ev;
      }
    }

    const exitCode = await proc.exitCode();
    if (!sawResult) {
      const stderr = proc.stderrText();
      if (proc.wasCancelled()) {
        yield { type: "run.failed", error: { code: "CANCELLED", message: "Run cancelled" } };
      } else if (proc.wasTimedOut()) {
        yield { type: "run.failed", error: { code: "TIMEOUT", message: "Agent run timed out" } };
      } else if (/log\s?in|authenticate|not authenticated|API key/i.test(stderr)) {
        yield { type: "run.failed", error: { code: "AUTH_REQUIRED", message: stderr.slice(0, 500) } };
      } else {
        yield {
          type: "run.failed",
          error: { code: "AGENT_FAILED", message: `claude exited ${exitCode}: ${stderr.slice(0, 500)}` },
        };
      }
    }
  }

  async cancel(_runId: string): Promise<void> {
    // Cancellation flows through the AbortSignal given to start().
  }
}

type ContentBlock = { type: string; text?: string; name?: string; input?: unknown; id?: string; tool_use_id?: string; content?: unknown };

function mapClaudeMessage(msg: Record<string, unknown>, toolNames: Map<string, string>): AgentEvent[] {
  const events: AgentEvent[] = [];
  const type = msg.type as string;

  if (type === "assistant" || type === "user") {
    const message = msg.message as { content?: ContentBlock[] } | undefined;
    for (const block of message?.content ?? []) {
      if (block.type === "text" && block.text) {
        events.push({ type: "message.delta", text: block.text });
      } else if (block.type === "tool_use" && block.name) {
        if (block.id) toolNames.set(block.id, block.name);
        events.push({ type: "tool.started", name: block.name, input: block.input });
      } else if (block.type === "tool_result") {
        const name = (block.tool_use_id && toolNames.get(block.tool_use_id)) || "tool";
        events.push({ type: "tool.completed", name, output: summarizeToolOutput(block.content) });
      }
    }
  } else if (type === "result") {
    const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage || msg.total_cost_usd !== undefined) {
      events.push({
        type: "usage.updated",
        usage: {
          inputTokens: usage?.input_tokens,
          outputTokens: usage?.output_tokens,
          costUsd: msg.total_cost_usd as number | undefined,
        },
      });
    }
    if (msg.is_error) {
      events.push({
        type: "run.failed",
        error: { code: "AGENT_FAILED", message: String(msg.result ?? msg.subtype ?? "agent error") },
      });
    } else {
      events.push({
        type: "run.completed",
        result: { text: String(msg.result ?? ""), exitCode: 0, sessionId: msg.session_id as string | undefined },
      });
    }
  }
  return events;
}

function summarizeToolOutput(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 2000);
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: unknown }).text) : ""))
      .join("")
      .slice(0, 2000);
  }
  return "";
}
