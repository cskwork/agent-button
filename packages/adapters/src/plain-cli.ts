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

export interface PlainCliConfig {
  id: string;
  executable: string;
  /** Args template; the string "{{prompt}}" is replaced by the prompt, "{{model}}" by the model. */
  args: string[];
  /** Args appended only when a model is requested. */
  modelArgs?: string[];
  authHintPattern?: string;
}

/**
 * Adapter for agents that offer a non-interactive text mode but no structured
 * event stream (opencode run, pi, arbitrary CLIs). Stdout is streamed as
 * message deltas; the full text is the result.
 */
export class PlainCliAdapter implements AgentAdapter {
  readonly id: string;
  private readonly config: PlainCliConfig;

  constructor(config: PlainCliConfig) {
    this.id = config.id;
    this.config = config;
  }

  detect() {
    return detectBinary(this.config.executable);
  }

  async authStatus(_profile: string): Promise<AuthStatus> {
    const installed = await this.detect();
    if (!installed.installed) return { state: "unknown", detail: `${this.config.executable} not found` };
    return { state: "ready", detail: "uses native login at run time" };
  }

  async capabilities() {
    return {
      supportsResume: false,
      supportsStructuredEvents: false,
      supportsModelSelection: (this.config.modelArgs?.length ?? 0) > 0,
    };
  }

  async *start(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    let prompt = request.prompt;
    if (request.resultSchema) prompt += schemaInstruction(request.resultSchema);

    const substitute = (arg: string) =>
      arg.replaceAll("{{prompt}}", prompt).replaceAll("{{model}}", request.model ?? "");

    let args = this.config.args.map(substitute);
    if (request.model && request.model !== "default" && this.config.modelArgs) {
      args = [...this.config.modelArgs.map(substitute), ...args];
    }

    const proc = streamProcess({
      executable: this.config.executable,
      args,
      cwd: request.cwd,
      env: request.env,
      minimalEnv: false,
      timeoutMs: request.timeoutMs,
      signal,
    });

    yield { type: "run.started", runId: request.runId };

    let fullText = "";
    for await (const line of proc.lines) {
      fullText += line + "\n";
      yield { type: "message.delta", text: line + "\n" };
    }

    const exitCode = await proc.exitCode();
    if (proc.wasCancelled()) {
      yield { type: "run.failed", error: { code: "CANCELLED", message: "Run cancelled" } };
    } else if (proc.wasTimedOut()) {
      yield { type: "run.failed", error: { code: "TIMEOUT", message: "Agent run timed out" } };
    } else if (exitCode !== 0) {
      const stderr = proc.stderrText();
      const hint = this.config.authHintPattern ?? "log ?in|authenticate|api key";
      const code = new RegExp(hint, "i").test(stderr + fullText) ? "AUTH_REQUIRED" : "AGENT_FAILED";
      yield {
        type: "run.failed",
        error: { code, message: `${this.config.executable} exited ${exitCode}: ${stderr.slice(0, 500)}` },
      };
    } else {
      yield {
        type: "run.completed",
        result: {
          text: fullText,
          exitCode: 0,
          structured: request.resultSchema ? extractJson(fullText) : undefined,
        },
      };
    }
  }

  async cancel(_runId: string): Promise<void> {
    // Cancellation flows through the AbortSignal given to start().
  }
}
