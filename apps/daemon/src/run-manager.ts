import {
  AbtnError,
  expandHome,
  newId,
  redactDeep,
  serializeError,
  type ApprovalRequest,
  type Artifact,
  type ButtonDefinition,
  type RunEvent,
  type RunRecord,
  type RunStatus,
  type RunStreamEvent,
} from "@abtn/core";
import type { AgentAdapter } from "@abtn/adapters";
import { executeAgentButton, executeWorkflow, type EngineContext } from "@abtn/workflow-engine";
import type { DaemonDb } from "./db.ts";
import type { ButtonRegistry } from "./registry.ts";
import type { ApprovalRegistry } from "./approvals.ts";
import type { SecretBroker } from "./secrets.ts";
import { collectArtifacts, missingRequiredArtifacts } from "./artifacts.ts";
import { resolveInputs } from "./inputs.ts";

export interface StartRunOptions {
  trigger: RunRecord["trigger"];
  dryRun?: boolean;
  /** Scheduler passes the schedule's overlap policy here. */
  policyOverride?: "reject" | "queue" | "replace" | "parallel";
}

interface ActiveRun {
  controller: AbortController;
  abortReason: "cancel" | "timeout" | null;
}

interface QueuedRun {
  record: RunRecord;
  inputs: Record<string, unknown>;
  dryRun: boolean;
}

export class RunManager {
  private active = new Map<string, ActiveRun>();
  private queues = new Map<string, QueuedRun[]>();
  private subscribers = new Set<(event: RunEvent) => void>();
  private seqs = new Map<string, number>();

  constructor(
    private readonly db: DaemonDb,
    private readonly registry: ButtonRegistry,
    private readonly approvals: ApprovalRegistry,
    private readonly secrets: SecretBroker,
    private readonly adapters: Map<string, AgentAdapter>,
  ) {}

  subscribe(fn: (event: RunEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  startRun(buttonId: string, providedInputs: Record<string, unknown>, opts: StartRunOptions): RunRecord {
    const button = this.registry.get(buttonId);
    const inputs = resolveInputs(button, providedInputs);
    const policy = opts.policyOverride ?? button.execution.concurrency;
    const activeRuns = this.db.activeRunsForButton(buttonId);

    if (activeRuns.length > 0) {
      if (policy === "reject") {
        throw new AbtnError("CONFLICT", `${button.label} is already running (concurrency: reject)`);
      }
      if (policy === "replace") {
        for (const run of activeRuns) this.cancelRun(run.id);
      }
      if (policy === "queue") {
        const record = this.newRecord(button, inputs, opts, "queued");
        this.db.insertRun(record);
        const queue = this.queues.get(buttonId) ?? [];
        queue.push({ record, inputs, dryRun: opts.dryRun ?? false });
        this.queues.set(buttonId, queue);
        return record;
      }
    }

    const record = this.newRecord(button, inputs, opts, "running");
    this.db.insertRun(record);
    void this.execute(record, button, inputs, opts.dryRun ?? false);
    return record;
  }

  cancelRun(runId: string): void {
    const entry = this.active.get(runId);
    if (entry) {
      entry.abortReason = "cancel";
      entry.controller.abort();
      this.approvals.rejectForRun(runId);
      return;
    }
    // Cancel a queued run that hasn't started.
    for (const [buttonId, queue] of this.queues) {
      const idx = queue.findIndex((q) => q.record.id === runId);
      if (idx >= 0) {
        queue.splice(idx, 1);
        this.db.updateRunStatus(runId, "cancelled");
        this.queues.set(buttonId, queue);
        return;
      }
    }
    const run = this.db.getRun(runId);
    if (!run) throw new AbtnError("NOT_FOUND", `Run not found: ${runId}`);
    if (!["queued", "running", "waiting_approval"].includes(run.status)) {
      throw new AbtnError("CONFLICT", `Run ${runId} already ${run.status}`);
    }
  }

  activeCount(): number {
    return this.active.size;
  }

  /** Graceful shutdown: abort every active run so no child trees are orphaned. */
  cancelAllActive(): void {
    for (const [runId, entry] of this.active) {
      entry.abortReason = "cancel";
      entry.controller.abort();
      this.approvals.rejectForRun(runId);
    }
  }

  private newRecord(
    button: ButtonDefinition,
    inputs: Record<string, unknown>,
    opts: StartRunOptions,
    status: RunStatus,
  ): RunRecord {
    return {
      id: newId("run"),
      buttonId: button.id,
      buttonLabel: button.label,
      kind: button.kind,
      status,
      inputs,
      startedAt: new Date().toISOString(),
      artifacts: [],
      trigger: opts.trigger,
      dryRun: opts.dryRun,
    };
  }

  private emit(runId: string, event: RunStreamEvent): void {
    const redact = this.secrets.redactor();
    const safe = redactDeep(event, redact);
    const seq = (this.seqs.get(runId) ?? 0) + 1;
    this.seqs.set(runId, seq);
    const envelope: RunEvent = { runId, seq, ts: new Date().toISOString(), event: safe };
    this.db.insertEvent(envelope);
    for (const fn of this.subscribers) {
      try { fn(envelope); } catch { /* subscriber errors must not kill runs */ }
    }
  }

  private makeContext(record: RunRecord, controller: AbortController, dryRun: boolean, cwd: string): EngineContext {
    return {
      runId: record.id,
      adapters: this.adapters,
      emit: (event) => this.emit(record.id, event),
      requestApproval: async (request: ApprovalRequest) => {
        this.setStatus(record.id, "waiting_approval");
        const decision = await this.approvals.wait(record.id, request);
        this.setStatus(record.id, "running");
        this.emit(record.id, { type: "log", level: "info", text: `Approval ${request.id}: ${decision}` });
        return decision;
      },
      resolveSecret: (ref) => this.secrets.resolve(ref),
      signal: controller.signal,
      defaultCwd: cwd,
      dryRun,
    };
  }

  private setStatus(runId: string, status: RunStatus): void {
    this.db.updateRunStatus(runId, status);
  }

  private async execute(
    record: RunRecord,
    button: ButtonDefinition,
    inputs: Record<string, unknown>,
    dryRun: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    const entry: ActiveRun = { controller, abortReason: null };
    this.active.set(record.id, entry);

    const timeoutMs = button.execution.timeout_seconds * 1000;
    const timer = setTimeout(() => {
      entry.abortReason = "timeout";
      controller.abort();
    }, timeoutMs + 5000);

    const cwd = button.kind === "agent-button" ? expandHome(button.workspace.cwd) : process.cwd();
    const ctx = this.makeContext(record, controller, dryRun, cwd);

    try {
      let failure: ReturnType<typeof serializeError> | undefined;
      let agentExitCode: number | undefined;

      if (button.kind === "agent-button") {
        const result = await executeAgentButton(button, inputs, ctx);
        agentExitCode = result.exitCode;
      } else {
        const wf = await executeWorkflow(button, inputs, ctx);
        if (wf.status === "failed") failure = wf.error;
      }

      const artifacts = dryRun ? [] : collectArtifacts(button.outputs.collect, record.startedAt);
      for (const artifact of artifacts) this.emit(record.id, { type: "artifact.created", artifact });

      if (!failure && !dryRun) {
        failure = this.checkSuccess(button, artifacts, agentExitCode);
      }

      // A workflow that "failed" because we aborted it is cancelled/timed out,
      // not failed: the engine reports step errors as results, not exceptions.
      if (entry.abortReason === "cancel" || failure?.code === "CANCELLED") {
        this.emit(record.id, { type: "log", level: "info", text: "Run cancelled" });
        this.db.updateRunStatus(record.id, "cancelled", failure, artifacts);
        return;
      }
      if (entry.abortReason === "timeout") {
        const timeoutError = { code: "TIMEOUT" as const, message: `Run exceeded ${button.execution.timeout_seconds}s timeout` };
        this.emit(record.id, { type: "log", level: "error", text: `Run failed: ${timeoutError.message}` });
        this.db.updateRunStatus(record.id, "failed", timeoutError, artifacts);
        return;
      }

      if (failure) {
        this.emit(record.id, { type: "log", level: "error", text: `Run failed: ${failure.message}` });
        this.db.updateRunStatus(record.id, "failed", failure, artifacts);
      } else {
        this.emit(record.id, { type: "log", level: "info", text: "Run succeeded" });
        this.db.updateRunStatus(record.id, "succeeded", undefined, artifacts);
      }
    } catch (err) {
      const status = this.terminalStatusFor(entry, err);
      const serialized = entry.abortReason === "timeout"
        ? { code: "TIMEOUT" as const, message: `Run exceeded ${button.execution.timeout_seconds}s timeout` }
        : serializeError(err);
      this.emit(record.id, { type: "log", level: "error", text: `Run ${status}: ${serialized.message}` });
      this.db.updateRunStatus(record.id, status, serialized);
    } finally {
      clearTimeout(timer);
      this.active.delete(record.id);
      this.approvals.rejectForRun(record.id);
      this.drainQueue(button.id);
    }
  }

  private checkSuccess(
    button: ButtonDefinition,
    artifacts: Artifact[],
    agentExitCode: number | undefined,
  ): ReturnType<typeof serializeError> | undefined {
    const missing = missingRequiredArtifacts(button.success.require_artifact, artifacts);
    if (missing.length > 0) {
      return { code: "VALIDATION_FAILED", message: `Required artifacts missing: ${missing.join(", ")}` };
    }
    const requiredExit = button.success.require_agent_exit_code;
    if (requiredExit !== undefined && agentExitCode !== undefined && agentExitCode !== requiredExit) {
      return { code: "VALIDATION_FAILED", message: `Agent exit code ${agentExitCode}, required ${requiredExit}` };
    }
    return undefined;
  }

  private terminalStatusFor(entry: ActiveRun, err: unknown): RunStatus {
    if (entry.abortReason === "cancel") return "cancelled";
    if (entry.abortReason === "timeout") return "failed";
    if (err instanceof AbtnError && err.code === "CANCELLED") return "cancelled";
    return "failed";
  }

  private drainQueue(buttonId: string): void {
    const queue = this.queues.get(buttonId);
    if (!queue || queue.length === 0) return;
    if (this.db.activeRunsForButton(buttonId).some((r) => r.status === "running" || r.status === "waiting_approval")) return;
    const next = queue.shift()!;
    this.queues.set(buttonId, queue);
    const button = this.registry.get(buttonId);
    this.setStatus(next.record.id, "running");
    void this.execute(next.record, button, next.inputs, next.dryRun);
  }
}
