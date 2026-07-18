import type { RunEvent } from "@abtn/core";

/** One-line, human-readable rendering of a run event (CLI and TUI share this). */
export function formatEvent(event: RunEvent): string | null {
  const e = event.event;
  switch (e.type) {
    case "run.started":
      return "run started";
    case "message.delta":
      return e.text.replace(/\n$/, "");
    case "tool.started":
      return `> ${e.name}${e.input !== undefined ? ` ${truncate(JSON.stringify(e.input), 120)}` : ""}`;
    case "tool.completed":
      return null; // keep the stream quiet; tool starts are enough context
    case "approval.requested": {
      const fields = Object.entries(e.request.fields)
        .map(([k, v]) => `  ${k}: ${truncate(String(v), 80)}`)
        .join("\n");
      return `APPROVAL REQUIRED: ${e.request.title} (id: ${e.request.id})\n${fields}`;
    }
    case "artifact.created":
      return `artifact: ${e.artifact.path}`;
    case "usage.updated":
      return null;
    case "run.completed":
      return e.result.text ? `result: ${truncate(e.result.text, 500)}` : "run completed";
    case "run.failed":
      return `FAILED [${e.error.code}] ${e.error.message}`;
    case "step.started":
      return `── step ${e.stepId} (${e.stepType})`;
    case "step.output":
      return e.text.replace(/\n$/, "");
    case "step.completed":
      return `   step ${e.stepId} ok`;
    case "step.failed":
      return `   step ${e.stepId} FAILED [${e.error.code}] ${e.error.message}`;
    case "step.skipped":
      return `   step ${e.stepId} skipped: ${e.reason}`;
    case "log":
      return e.level === "error" ? `ERROR: ${e.text}` : e.text;
    default:
      return null;
  }
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 3600000) return `in ${Math.round(ahead / 60000)}m`;
    if (ahead < 86400000) return `in ${Math.round(ahead / 3600000)}h`;
    return `in ${Math.round(ahead / 86400000)}d`;
  }
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

export function durationBetween(startIso: string, endIso?: string): string {
  const ms = (endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso);
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
