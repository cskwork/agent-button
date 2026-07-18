import { AbtnError, type ApprovalRequest } from "@abtn/core";

export interface PendingApproval {
  request: ApprovalRequest;
  runId: string;
  createdAt: string;
}

type Decision = "approved" | "rejected";

export class ApprovalRegistry {
  private pending = new Map<string, PendingApproval & { resolve: (d: Decision) => void }>();

  wait(runId: string, request: ApprovalRequest): Promise<Decision> {
    return new Promise<Decision>((resolve) => {
      this.pending.set(request.id, {
        request,
        runId,
        createdAt: new Date().toISOString(),
        resolve,
      });
    });
  }

  list(): PendingApproval[] {
    return [...this.pending.values()].map(({ resolve: _r, ...rest }) => rest);
  }

  forRun(runId: string): PendingApproval[] {
    return this.list().filter((p) => p.runId === runId);
  }

  decide(approvalId: string, decision: Decision): PendingApproval {
    const entry = this.pending.get(approvalId);
    if (!entry) throw new AbtnError("NOT_FOUND", `No pending approval: ${approvalId}`);
    this.pending.delete(approvalId);
    entry.resolve(decision);
    const { resolve: _r, ...rest } = entry;
    return rest;
  }

  /** Reject everything attached to a cancelled run so the engine unblocks. */
  rejectForRun(runId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.runId === runId) {
        this.pending.delete(id);
        entry.resolve("rejected");
      }
    }
  }
}
