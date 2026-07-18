import type { AgentEvent } from "@abtn/core";

export interface AgentInstallation {
  installed: boolean;
  path?: string;
  version?: string;
}

export interface AuthStatus {
  state: "ready" | "auth_required" | "unknown";
  detail?: string;
}

export interface AgentCapabilities {
  supportsResume: boolean;
  supportsStructuredEvents: boolean;
  supportsModelSelection: boolean;
}

export interface AgentRunRequest {
  runId: string;
  prompt: string;
  cwd: string;
  model?: string;
  profile?: string;
  timeoutMs: number;
  /** Extra env vars overlaid on the agent's native environment. */
  env?: Record<string, string>;
  /** When set, the adapter appends a JSON-output instruction to the prompt. */
  resultSchema?: Record<string, unknown>;
}

/**
 * Normalized adapter contract. Adapters normalize orchestration, events and
 * outputs; they do NOT normalize agent features. Each agent keeps its native
 * config, skills, MCP servers, and subscription auth (spec section 5-7).
 */
export interface AgentAdapter {
  readonly id: string;

  detect(): Promise<AgentInstallation>;
  authStatus(profile: string): Promise<AuthStatus>;
  capabilities(profile: string): Promise<AgentCapabilities>;

  start(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;

  cancel(runId: string): Promise<void>;
}

/** Extract the last top-level JSON object from agent output text. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Fast path: pure JSON output.
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }
  // Look for fenced or embedded JSON, scanning from the last opening brace.
  for (let i = trimmed.lastIndexOf("{"); i >= 0; i = trimmed.lastIndexOf("{", i - 1)) {
    const candidate = balancedSlice(trimmed, i);
    if (candidate === null) continue;
    try {
      return JSON.parse(candidate);
    } catch { /* keep scanning */ }
    if (i === 0) break;
  }
  return undefined;
}

function balancedSlice(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function schemaInstruction(schema: Record<string, unknown>): string {
  return [
    "",
    "---",
    "When you are done, output a final JSON object (and nothing after it)",
    "matching this JSON Schema exactly:",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}
