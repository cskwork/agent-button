import { stringify as stringifyYaml } from "yaml";
import { style } from "../term.ts";
import type { AppState } from "../state.ts";

export function renderInspect(state: AppState, rows: number): string[] {
  const screen = state.screen;
  if (screen.name !== "inspect") return [];
  const button = state.buttons.find((b) => b.id === screen.buttonId);
  const lines: string[] = [""];
  if (!button) {
    lines.push(`  ${style.red("Button not found")}`);
    return lines;
  }
  lines.push(`  ${style.accentBold(button.label)}  ${style.dim(button.kind)}`);
  lines.push("");
  const { schedule: _s, ...definition } = button;
  const yamlLines = stringifyYaml(definition).split("\n");
  for (const line of yamlLines.slice(screen.scrollOffset, screen.scrollOffset + rows - 6)) {
    lines.push(`  ${style.dim(line)}`);
  }
  lines.push("");
  lines.push(`  ${style.dim("esc back · arrows scroll")}`);
  return lines;
}

export function renderForm(state: AppState, cols: number): string[] {
  const screen = state.screen;
  if (screen.name !== "form") return [];
  const button = state.buttons.find((b) => b.id === screen.buttonId);
  const lines: string[] = [""];
  lines.push(`  ${style.accentBold(`Run: ${button?.label ?? screen.buttonId}`)}${screen.dryRun ? style.dim("  [dry run]") : ""}`);
  lines.push("");
  screen.fields.forEach((field, index) => {
    const active = index === screen.active;
    const marker = active ? style.accent("›") : " ";
    let valueDisplay: string;
    if (field.type === "enum" && field.values) {
      valueDisplay = field.values
        .map((v) => (v === field.value ? style.inverse(` ${v} `) : style.dim(` ${v} `)))
        .join(" ");
    } else {
      valueDisplay = active ? style.inverse(`${field.value} `) : field.value || style.dim("(empty)");
    }
    lines.push(`  ${marker} ${style.bold(field.name.padEnd(18))} ${valueDisplay}`);
    if (field.description && active) lines.push(`      ${style.dim(field.description.slice(0, cols - 8))}`);
  });
  lines.push("");
  lines.push(`  ${style.dim("type to edit · ←/→ choose enum · ↑/↓ field · enter run · esc cancel")}`);
  return lines;
}

export function renderApprovals(state: AppState, cols: number): string[] {
  const screen = state.screen;
  if (screen.name !== "approvals") return [];
  const lines: string[] = [""];
  lines.push(`  ${style.accentBold("Pending approvals")}`);
  lines.push("");
  if (state.approvals.length === 0) {
    lines.push(`  ${style.dim("Nothing pending.")}`);
  }
  state.approvals.forEach((approval, index) => {
    const selected = index === screen.selected;
    const header = `${approval.request.title}  ${style.dim(`run ${approval.runId}`)}`;
    lines.push(selected ? `  ${style.inverse(header)}` : `  ${header}`);
    for (const [key, value] of Object.entries(approval.request.fields)) {
      lines.push(`      ${style.dim(key.padEnd(18))} ${String(value).slice(0, cols - 28)}`);
    }
    lines.push("");
  });
  lines.push(`  ${style.dim("y approve · n reject · ↑/↓ select · esc back")}`);
  return lines;
}
