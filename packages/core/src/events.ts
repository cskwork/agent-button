import type { SerializedError } from "./errors.ts";

export interface Artifact {
  path: string;
  bytes?: number;
  createdAt: string;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface AgentResult {
  text?: string;
  structured?: unknown;
  exitCode?: number;
  sessionId?: string;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  fields: Record<string, unknown>;
}

/**
 * Snapshot of what actually ran: adapter id plus the model / reasoning effort
 * in effect (from the button if declared, else the agent's native config).
 * Display-only; omitted fields mean "unknown", never guessed.
 */
export interface RunAgentInfo {
  adapter: string;
  model?: string;
  reasoning?: string;
}

/** Events emitted by agent adapters (normalized across agents). */
export type AgentEvent =
  | { type: "run.started"; runId: string }
  | { type: "agent.info"; model?: string; reasoning?: string }
  | { type: "message.delta"; text: string }
  | { type: "tool.started"; name: string; input?: unknown }
  | { type: "tool.completed"; name: string; output?: unknown }
  | { type: "approval.requested"; request: ApprovalRequest }
  | { type: "artifact.created"; artifact: Artifact }
  | { type: "usage.updated"; usage: Usage }
  | { type: "run.completed"; result: AgentResult }
  | { type: "run.failed"; error: SerializedError };

/** Events emitted by the workflow engine around deterministic steps. */
export type WorkflowEvent =
  | { type: "step.started"; stepId: string; stepType: string }
  | { type: "step.output"; stepId: string; stream: "stdout" | "stderr"; text: string }
  | { type: "step.completed"; stepId: string; summary?: string }
  | { type: "step.failed"; stepId: string; error: SerializedError }
  | { type: "step.skipped"; stepId: string; reason: string };

export type RunStreamEvent = AgentEvent | WorkflowEvent | { type: "log"; level: "info" | "warn" | "error"; text: string };

/** Envelope persisted to the audit log and streamed to clients. */
export interface RunEvent {
  runId: string;
  seq: number;
  ts: string;
  event: RunStreamEvent;
}

export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunRecord {
  id: string;
  buttonId: string;
  buttonLabel: string;
  kind: "agent-button" | "workflow";
  status: RunStatus;
  inputs: Record<string, unknown>;
  startedAt: string;
  endedAt?: string;
  error?: SerializedError;
  artifacts: Artifact[];
  trigger: "manual" | "schedule" | "cli";
  dryRun?: boolean;
  agent?: RunAgentInfo;
}
