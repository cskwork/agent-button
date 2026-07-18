import { relativeTime, durationBetween } from "@abtn/client";
import { padVisible, style } from "../term.ts";
import type { AppState, ButtonView } from "../state.ts";

const STATUS_GLYPH: Record<string, string> = {
  succeeded: style.green("✓"),
  running: style.accent("●"),
  waiting_approval: style.yellow("◐"),
  queued: style.dim("○"),
  failed: style.red("✗"),
  cancelled: style.dim("—"),
  interrupted: style.dim("!"),
};

export function renderDashboard(state: AppState, cols: number, rows: number): string[] {
  const lines: string[] = [];
  const daemonStatus = state.daemonOk ? style.dim("daemon ready") : style.red("daemon offline");
  const approvalNote = state.approvals.length > 0 ? style.yellow(`  ${state.approvals.length} approval(s) pending`) : "";

  lines.push("");
  lines.push(`  ${style.accentBold("AUTOMATIONS")}${approvalNote}` + " ".repeat(Math.max(1, cols - 40)) + daemonStatus);
  lines.push("");

  lines.push(...renderButtonGrid(state, cols));
  lines.push("");
  lines.push(`  ${style.bold("Recent runs")}`);
  lines.push(...renderRunList(state, rows - lines.length - 3));
  lines.push("");

  if (state.message) lines.push(`  ${style.red(state.message)}`);
  lines.push(
    "  " +
      style.dim(
        "enter run · d dry-run · space inspect · tab focus · 1-0 shortcuts · a approvals · r refresh · q quit",
      ),
  );
  return lines;
}

function renderButtonGrid(state: AppState, cols: number): string[] {
  const cardWidth = 24;
  const perRow = Math.max(1, Math.floor((cols - 4) / (cardWidth + 2)));
  const lines: string[] = [];
  const buttons = state.buttons;
  if (buttons.length === 0) {
    lines.push(`  ${style.dim("No buttons yet. Add YAML files to the buttons directory.")}`);
    return lines;
  }

  for (let rowStart = 0; rowStart < buttons.length; rowStart += perRow) {
    const row = buttons.slice(rowStart, rowStart + perRow);
    let top = "  ";
    let bottom = "  ";
    row.forEach((button, i) => {
      const index = rowStart + i;
      const selected = state.focus === "buttons" && index === state.buttonIndex;
      const digit = index < 9 ? String(index + 1) : index === 9 ? "0" : " ";
      const label = `[${digit}] ${button.label}`;
      const kindNote = button.kind === "workflow" ? `workflow · ${(button as ButtonView & { risk?: string }).risk ?? ""}` : agentNote(button);
      const scheduleNote = button.schedule?.next_run_at ? ` · ${relativeTime(button.schedule.next_run_at)}` : "";
      const line1 = selected ? style.inverse(padVisible(label, cardWidth)) : style.bold(padVisible(label, cardWidth));
      const line2 = style.dim(padVisible(`    ${kindNote}${scheduleNote}`, cardWidth));
      top += padVisible(line1, cardWidth) + "  ";
      bottom += line2 + "  ";
    });
    lines.push(top, bottom, "");
  }
  lines.pop();
  return lines;
}

function agentNote(button: ButtonView): string {
  const agent = (button as { agent?: { adapter?: string } }).agent;
  return agent?.adapter ?? "agent";
}

function renderRunList(state: AppState, maxRows: number): string[] {
  const lines: string[] = [];
  const runs = state.runs.slice(0, Math.max(3, maxRows));
  if (runs.length === 0) {
    lines.push(`  ${style.dim("No runs yet.")}`);
    return lines;
  }
  runs.forEach((run, index) => {
    const selected = state.focus === "runs" && index === state.runIndex;
    const glyph = STATUS_GLYPH[run.status] ?? " ";
    const when = run.status === "running" || run.status === "waiting_approval"
      ? durationBetween(run.startedAt)
      : relativeTime(run.startedAt);
    const artifactNote = run.artifacts.length > 0
      ? style.dim(`  ${run.artifacts[run.artifacts.length - 1]!.path.split("/").pop()}`)
      : "";
    const dryNote = run.dryRun ? style.dim(" [dry]") : "";
    const label = padVisible(run.buttonLabel, 24);
    const statusText = padVisible(run.status === "waiting_approval" ? "needs approval" : run.status, 15);
    const body = `${glyph} ${label} ${statusText} ${style.dim(when)}${dryNote}${artifactNote}`;
    lines.push(selected ? `  ${style.inverse(body)}` : `  ${body}`);
  });
  return lines;
}
