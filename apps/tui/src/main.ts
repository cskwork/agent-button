#!/usr/bin/env bun
import { Terminal, decodeKeys, type Key } from "./term.ts";
import { AppState, type ButtonView } from "./state.ts";
import { renderDashboard } from "./views/dashboard.ts";
import { renderRunView } from "./views/run-view.ts";
import { renderApprovals, renderForm, renderInspect } from "./views/misc-views.ts";

const term = new Terminal();
const state = new AppState();

function render(): void {
  const { rows, cols } = term.size;
  let lines: string[];
  switch (state.screen.name) {
    case "dashboard": lines = renderDashboard(state, cols, rows); break;
    case "run": lines = renderRunView(state, cols, rows); break;
    case "inspect": lines = renderInspect(state, rows); break;
    case "form": lines = renderForm(state, cols); break;
    case "approvals": lines = renderApprovals(state, cols); break;
  }
  term.render(lines);
}

function gridColumns(): number {
  return Math.max(1, Math.floor((term.size.cols - 4) / 26));
}

async function runButton(button: ButtonView, dryRun: boolean): Promise<void> {
  const fields = state.buildForm(button);
  if (fields) {
    state.screen = { name: "form", buttonId: button.id, dryRun, fields, active: 0 };
    return;
  }
  await state.startRun(button.id, {}, dryRun);
}

async function handleDashboardKey(key: Key): Promise<boolean> {
  if (key.kind === "ctrl-c") return true;
  if (key.kind === "tab") {
    state.focus = state.focus === "buttons" ? "runs" : "buttons";
  } else if (key.kind === "up" || key.kind === "down" || key.kind === "left" || key.kind === "right") {
    moveSelection(key.kind);
  } else if (key.kind === "enter") {
    if (state.focus === "buttons") {
      const button = state.selectedButton();
      if (button) await runButton(button, false);
    } else {
      const run = state.runs[state.runIndex];
      if (run) state.screen = { name: "run", runId: run.id, confirmCancel: false, scrollOffset: 0 };
    }
  } else if (key.kind === "char") {
    const ch = key.char.toLowerCase();
    if (ch === "q") return true;
    if (/[0-9]/.test(ch)) {
      const button = state.buttonForDigit(ch);
      if (button) await runButton(button, false);
    } else if (ch === "d") {
      const button = state.selectedButton();
      if (button) await runButton(button, true);
    } else if (ch === " ") {
      const button = state.selectedButton();
      if (button) state.screen = { name: "inspect", buttonId: button.id, scrollOffset: 0 };
    } else if (ch === "a") {
      state.screen = { name: "approvals", selected: 0 };
    } else if (ch === "r") {
      await state.refresh();
    }
  }
  return false;
}

function moveSelection(dir: "up" | "down" | "left" | "right"): void {
  if (state.focus === "buttons") {
    const per = gridColumns();
    const delta = dir === "left" ? -1 : dir === "right" ? 1 : dir === "up" ? -per : per;
    const next = state.buttonIndex + delta;
    if (next >= 0 && next < state.buttons.length) state.buttonIndex = next;
    else if (dir === "down" && state.runs.length > 0) state.focus = "runs";
  } else {
    if (dir === "up" && state.runIndex === 0) { state.focus = "buttons"; return; }
    const delta = dir === "up" ? -1 : dir === "down" ? 1 : 0;
    state.runIndex = Math.min(Math.max(0, state.runIndex + delta), Math.max(0, state.runs.length - 1));
  }
}

async function handleRunKey(key: Key): Promise<void> {
  const screen = state.screen;
  if (screen.name !== "run") return;
  const pending = state.approvalsForRun(screen.runId);

  if (screen.confirmCancel) {
    if (key.kind === "char" && key.char.toLowerCase() === "y") {
      await state.client.cancelRun(screen.runId).catch(() => undefined);
      screen.confirmCancel = false;
    } else if (key.kind !== "ctrl-c") {
      screen.confirmCancel = false;
    }
    return;
  }

  if (key.kind === "escape") {
    state.screen = { name: "dashboard" };
  } else if (key.kind === "up") {
    screen.scrollOffset += 3;
  } else if (key.kind === "down") {
    screen.scrollOffset = Math.max(0, screen.scrollOffset - 3);
  } else if (key.kind === "ctrl-c" || (key.kind === "char" && key.char.toLowerCase() === "c")) {
    screen.confirmCancel = true;
  } else if (key.kind === "char" && pending.length > 0) {
    const ch = key.char.toLowerCase();
    if (ch === "y" || ch === "n") {
      await state.client
        .decideApproval(pending[0]!.request.id, ch === "y" ? "approved" : "rejected")
        .catch(() => undefined);
      await state.refresh();
    }
  }
}

async function handleFormKey(key: Key): Promise<void> {
  const screen = state.screen;
  if (screen.name !== "form") return;
  const field = screen.fields[screen.active];

  if (key.kind === "escape") {
    state.screen = { name: "dashboard" };
  } else if (key.kind === "up") {
    screen.active = Math.max(0, screen.active - 1);
  } else if (key.kind === "down" || key.kind === "tab") {
    screen.active = Math.min(screen.fields.length - 1, screen.active + 1);
  } else if ((key.kind === "left" || key.kind === "right") && field?.type === "enum" && field.values) {
    const idx = field.values.indexOf(field.value);
    const next = key.kind === "left" ? idx - 1 : idx + 1;
    field.value = field.values[(next + field.values.length) % field.values.length]!;
  } else if (key.kind === "backspace" && field && field.type !== "enum") {
    field.value = field.value.slice(0, -1);
  } else if (key.kind === "char" && field && field.type !== "enum") {
    field.value += key.char;
  } else if (key.kind === "enter") {
    const inputs: Record<string, unknown> = {};
    for (const f of screen.fields) if (f.value !== "") inputs[f.name] = f.value;
    await state.startRun(screen.buttonId, inputs, screen.dryRun);
  }
}

async function handleApprovalsKey(key: Key): Promise<void> {
  const screen = state.screen;
  if (screen.name !== "approvals") return;
  if (key.kind === "escape") {
    state.screen = { name: "dashboard" };
  } else if (key.kind === "up") {
    screen.selected = Math.max(0, screen.selected - 1);
  } else if (key.kind === "down") {
    screen.selected = Math.min(Math.max(0, state.approvals.length - 1), screen.selected + 1);
  } else if (key.kind === "char") {
    const ch = key.char.toLowerCase();
    const approval = state.approvals[screen.selected];
    if (approval && (ch === "y" || ch === "n")) {
      await state.client
        .decideApproval(approval.request.id, ch === "y" ? "approved" : "rejected")
        .catch(() => undefined);
      await state.refresh();
    }
  }
}

async function handleInspectKey(key: Key): Promise<void> {
  const screen = state.screen;
  if (screen.name !== "inspect") return;
  if (key.kind === "escape") state.screen = { name: "dashboard" };
  else if (key.kind === "up") screen.scrollOffset = Math.max(0, screen.scrollOffset - 3);
  else if (key.kind === "down") screen.scrollOffset += 3;
}

async function main(): Promise<void> {
  term.enter();
  const cleanup = () => {
    term.exit();
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);

  await state.refresh();
  render();

  const ticker = setInterval(async () => {
    await state.refresh();
    render();
  }, 1000);

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data: string) => {
    void (async () => {
      for (const key of decodeKeys(data)) {
        let quit = false;
        switch (state.screen.name) {
          case "dashboard": quit = await handleDashboardKey(key); break;
          case "run": await handleRunKey(key); break;
          case "form": await handleFormKey(key); break;
          case "approvals": await handleApprovalsKey(key); break;
          case "inspect": await handleInspectKey(key); break;
        }
        if (quit) {
          clearInterval(ticker);
          cleanup();
          return;
        }
      }
      term.invalidate();
      render();
    })();
  });

  process.stdout.on("resize", () => {
    term.invalidate();
    render();
  });
}

void main();
