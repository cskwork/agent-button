import type { RunEvent, RunRecord, ButtonDefinition } from "@abtn/core";
import { DaemonClient, type ButtonWithSchedule, type PendingApprovalView } from "@abtn/client";

export type ButtonView = ButtonDefinition & ButtonWithSchedule;

export interface FormField {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  values?: string[];
  value: string;
  description?: string;
}

export type Screen =
  | { name: "dashboard" }
  | { name: "run"; runId: string; confirmCancel: boolean; scrollOffset: number }
  | { name: "inspect"; buttonId: string; scrollOffset: number }
  | { name: "form"; buttonId: string; dryRun: boolean; fields: FormField[]; active: number }
  | { name: "approvals"; selected: number };

export class AppState {
  readonly client = new DaemonClient();
  screen: Screen = { name: "dashboard" };

  buttons: ButtonView[] = [];
  runs: RunRecord[] = [];
  approvals: PendingApprovalView[] = [];
  daemonOk = false;
  message = "";

  // Dashboard selection
  focus: "buttons" | "runs" = "buttons";
  buttonIndex = 0;
  runIndex = 0;

  // Run screen event cache
  runEvents: RunEvent[] = [];
  runEventsFor = "";
  currentRun: RunRecord | null = null;

  async refresh(): Promise<void> {
    try {
      const [buttons, runs, approvals] = await Promise.all([
        this.client.listButtons(),
        this.client.listRuns(12),
        this.client.listApprovals(),
      ]);
      this.buttons = sortButtons(buttons.buttons as ButtonView[]);
      this.runs = runs.runs;
      this.approvals = approvals.approvals;
      this.daemonOk = true;
      if (this.screen.name === "run") await this.refreshRun(this.screen.runId);
    } catch {
      this.daemonOk = false;
    }
  }

  private async refreshRun(runId: string): Promise<void> {
    if (this.runEventsFor !== runId) {
      this.runEvents = [];
      this.runEventsFor = runId;
    }
    const lastSeq = this.runEvents.length > 0 ? this.runEvents[this.runEvents.length - 1]!.seq : 0;
    const [detail, events] = await Promise.all([
      this.client.getRun(runId),
      this.client.runEvents(runId, lastSeq),
    ]);
    this.currentRun = detail.run;
    this.runEvents.push(...events.events);
  }

  selectedButton(): ButtonView | undefined {
    return this.buttons[this.buttonIndex];
  }

  /** Digit shortcuts follow pinned-first dashboard order: 1-9 then 0. */
  buttonForDigit(digit: string): ButtonView | undefined {
    const index = digit === "0" ? 9 : Number(digit) - 1;
    return this.buttons[index];
  }

  approvalsForRun(runId: string): PendingApprovalView[] {
    return this.approvals.filter((a) => a.runId === runId);
  }

  async startRun(buttonId: string, inputs: Record<string, unknown>, dryRun: boolean): Promise<void> {
    try {
      const { run } = await this.client.startRun(buttonId, inputs, dryRun);
      this.screen = { name: "run", runId: run.id, confirmCancel: false, scrollOffset: 0 };
      this.message = "";
      await this.refresh();
    } catch (err) {
      this.message = err instanceof Error ? err.message : String(err);
    }
  }

  /** Build the input form; returns null when every declared input already has a value. */
  buildForm(button: ButtonView): FormField[] | null {
    const decls =
      button.kind === "agent-button"
        ? (button.inputs?.properties ?? {})
        : ((button.inputs ?? {}) as Record<string, { type?: string; values?: string[]; default?: unknown; description?: string }>);
    const fields: FormField[] = [];
    let needsForm = false;
    for (const [name, decl] of Object.entries(decls)) {
      const hasDefault = decl.default !== undefined;
      if (!hasDefault) needsForm = true;
      fields.push({
        name,
        type: (decl.type as FormField["type"]) ?? "string",
        values: decl.values,
        value: decl.default !== undefined ? String(decl.default) : (decl.values?.[0] ?? ""),
        description: decl.description,
      });
    }
    return needsForm && fields.length > 0 ? fields : null;
  }
}

function sortButtons(buttons: ButtonView[]): ButtonView[] {
  const byShortcut = (b: ButtonView) => (b.shortcut ? Number(b.shortcut === "0" ? 10 : b.shortcut) : 99);
  return [...buttons].sort((a, b) => {
    if ((b.pinned ? 1 : 0) !== (a.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (byShortcut(a) !== byShortcut(b)) return byShortcut(a) - byShortcut(b);
    return a.label.localeCompare(b.label);
  });
}
