import { formatEvent, durationBetween } from "@abtn/client";
import { style } from "../term.ts";
import type { AppState } from "../state.ts";

export function renderRunView(state: AppState, cols: number, rows: number): string[] {
  const lines: string[] = [];
  const run = state.currentRun;
  const screen = state.screen;
  if (screen.name !== "run") return lines;

  lines.push("");
  if (!run) {
    lines.push(`  ${style.dim("Loading run...")}`);
    return lines;
  }

  const statusColor =
    run.status === "succeeded" ? style.green :
    run.status === "failed" ? style.red :
    run.status === "waiting_approval" ? style.yellow : style.accent;
  lines.push(`  ${style.accentBold(run.buttonLabel)}  ${statusColor(run.status)}  ${style.dim(durationBetween(run.startedAt, run.endedAt))}${run.dryRun ? style.dim("  [dry run]") : ""}`);
  lines.push(`  ${style.dim(run.id)}`);
  lines.push("");

  const pendingApprovals = state.approvalsForRun(run.id);
  const footerRows = pendingApprovals.length > 0 ? 6 + Object.keys(pendingApprovals[0]!.request.fields).length : 3;
  const bodyRows = rows - lines.length - footerRows;

  const rendered: string[] = [];
  for (const event of state.runEvents) {
    const line = formatEvent(event);
    if (line === null) continue;
    for (const sub of line.split("\n")) rendered.push(sub);
  }
  const start = Math.max(0, rendered.length - bodyRows - screen.scrollOffset);
  for (const line of rendered.slice(start, start + bodyRows)) {
    lines.push(`  ${line}`);
  }
  while (lines.length < rows - footerRows) lines.push("");

  if (pendingApprovals.length > 0) {
    const approval = pendingApprovals[0]!;
    lines.push(`  ${style.yellow("── APPROVAL REQUIRED ──")}`);
    lines.push(`  ${style.bold(approval.request.title)}`);
    for (const [key, value] of Object.entries(approval.request.fields)) {
      lines.push(`    ${style.dim(key.padEnd(18))} ${String(value).slice(0, cols - 26)}`);
    }
    lines.push(`  ${style.yellow("y")} approve   ${style.yellow("n")} reject`);
    lines.push("");
  }

  for (const artifact of run.artifacts) {
    if (lines.length < rows - 2) lines.push(`  ${style.dim("artifact:")} ${artifact.path}`);
  }

  if (screen.confirmCancel) {
    lines.push(`  ${style.red("Cancel this run? y / n")}`);
  } else {
    lines.push(`  ${style.dim("esc back · c cancel · arrows scroll")}`);
  }
  return lines;
}
