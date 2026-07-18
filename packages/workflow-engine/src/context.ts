import type { ApprovalRequest, RunStreamEvent, TemplateScope } from "@abtn/core";
import type { AgentAdapter } from "@abtn/adapters";

export interface EngineContext {
  runId: string;
  adapters: Map<string, AgentAdapter>;
  emit: (event: RunStreamEvent) => void;
  /** Blocks until a human decides. The daemon surfaces this to TUI/CLI. */
  requestApproval: (request: ApprovalRequest) => Promise<"approved" | "rejected">;
  /** Resolves `secret://...` references at the adapter boundary only. */
  resolveSecret: (ref: string) => Promise<string>;
  signal: AbortSignal;
  defaultCwd: string;
  dryRun: boolean;
}

export const SECRET_PREFIX = "secret://";

export function isSecretRef(value: string): boolean {
  return value.startsWith(SECRET_PREFIX);
}

/** Resolve secret refs in a flat string map (env vars, headers, parameters). */
export async function resolveSecretsInMap(
  map: Record<string, string>,
  resolve: (ref: string) => Promise<string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = isSecretRef(value) ? await resolve(value) : value;
  }
  return out;
}

export interface StepRecord {
  status: "succeeded" | "failed" | "skipped";
  [key: string]: unknown;
}

export interface WorkflowScope extends TemplateScope {
  inputs: Record<string, unknown>;
  steps: Record<string, StepRecord>;
}

export function makeScope(inputs: Record<string, unknown>): WorkflowScope {
  // Inputs are exposed both at top level ({{target_branch}}) and under
  // inputs.* — saved step variables also land at top level.
  return { ...inputs, inputs, steps: {} };
}
