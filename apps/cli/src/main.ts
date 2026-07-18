#!/usr/bin/env bun
import { DaemonClient, formatEvent, relativeTime, durationBetween } from "@abtn/client";
import { serializeError } from "@abtn/core";

const HELP = `abtn — agent automation control plane CLI

Usage:
  abtn list                          List buttons
  abtn run <button-id> [opts]        Run a button
      --input key=value              Provide an input (repeatable)
      --dry-run                      Compile and show the plan without side effects
      --no-follow                    Do not stream events; print run id and exit
  abtn runs [--limit N]              Recent runs
  abtn logs <run-id> [--follow]      Show run events
  abtn cancel <run-id>               Cancel a run
  abtn approvals                     List pending approvals
  abtn approve <approval-id>         Approve
  abtn reject <approval-id>          Reject
  abtn adapters                      Agent adapter status
  abtn health                        Daemon health`;

function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string[]> } {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const boolFlags = ["dry-run", "follow", "no-follow"];
      const value = boolFlags.includes(name) ? "true" : args[++i] ?? "true";
      flags.set(name, [...(flags.get(name) ?? []), value]);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function parseInputs(flags: Map<string, string[]>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const pair of flags.get("input") ?? []) {
    const idx = pair.indexOf("=");
    if (idx <= 0) throw new Error(`--input expects key=value, got: ${pair}`);
    inputs[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return inputs;
}

async function followRun(client: DaemonClient, runId: string): Promise<number> {
  for await (const event of client.streamEvents(runId)) {
    const line = formatEvent(event);
    if (line !== null) console.log(line);
    const type = event.event.type;
    if (type === "log" && "text" in event.event && /^Run (succeeded|failed|cancelled)/.test(event.event.text)) break;
  }
  const { run } = await client.getRun(runId);
  console.log(`\nstatus: ${run.status}  duration: ${durationBetween(run.startedAt, run.endedAt)}`);
  for (const artifact of run.artifacts) console.log(`artifact: ${artifact.path}`);
  return run.status === "succeeded" ? 0 : 1;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  const client = new DaemonClient();

  switch (command) {
    case "list": {
      const { buttons, loadErrors } = await client.listButtons();
      for (const button of buttons) {
        const schedule = button.schedule?.next_run_at
          ? `  next: ${relativeTime(button.schedule.next_run_at)}`
          : "";
        console.log(`${(button.shortcut ?? " ").padEnd(2)}${button.id.padEnd(28)} ${button.kind.padEnd(13)} ${button.label}${schedule}`);
      }
      for (const err of loadErrors) console.error(`load error ${err.file}: ${err.message}`);
      return 0;
    }
    case "run": {
      const buttonId = positional[0];
      if (!buttonId) throw new Error("Usage: abtn run <button-id>");
      const { run } = await client.startRun(buttonId, parseInputs(flags), flags.has("dry-run"));
      console.log(`run ${run.id} started (${run.status})`);
      if (flags.has("no-follow")) return 0;
      return followRun(client, run.id);
    }
    case "runs": {
      const { runs } = await client.listRuns(Number(flags.get("limit")?.[0] ?? "20"));
      for (const run of runs) {
        console.log(
          `${run.id}  ${run.status.padEnd(16)} ${run.buttonLabel.padEnd(24)} ${relativeTime(run.startedAt)}${run.dryRun ? "  [dry-run]" : ""}`,
        );
      }
      return 0;
    }
    case "logs": {
      const runId = positional[0];
      if (!runId) throw new Error("Usage: abtn logs <run-id>");
      if (flags.has("follow")) return followRun(client, runId);
      const { events } = await client.runEvents(runId);
      for (const event of events) {
        const line = formatEvent(event);
        if (line !== null) console.log(line);
      }
      return 0;
    }
    case "cancel": {
      const runId = positional[0];
      if (!runId) throw new Error("Usage: abtn cancel <run-id>");
      await client.cancelRun(runId);
      console.log(`cancelled ${runId}`);
      return 0;
    }
    case "approvals": {
      const { approvals } = await client.listApprovals();
      if (approvals.length === 0) console.log("no pending approvals");
      for (const approval of approvals) {
        console.log(`${approval.request.id}  ${approval.request.title}  (run ${approval.runId})`);
        for (const [key, value] of Object.entries(approval.request.fields)) {
          console.log(`    ${key}: ${value}`);
        }
      }
      return 0;
    }
    case "approve":
    case "reject": {
      const approvalId = positional[0];
      if (!approvalId) throw new Error(`Usage: abtn ${command} <approval-id>`);
      await client.decideApproval(approvalId, command === "approve" ? "approved" : "rejected");
      console.log(`${command}d ${approvalId}`);
      return 0;
    }
    case "adapters": {
      const { adapters } = await client.listAdapters();
      for (const [id, info] of Object.entries(adapters)) {
        const status = info.installed ? `${info.version ?? "installed"} (${info.auth?.state ?? "?"})` : "not installed";
        console.log(`${id.padEnd(14)} ${status}`);
      }
      return 0;
    }
    case "health": {
      console.log(JSON.stringify(await client.health()));
      return 0;
    }
    default:
      console.log(HELP);
      return command === undefined || command === "help" ? 0 : 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const serialized = serializeError(err);
    console.error(`[${serialized.code}] ${serialized.message}`);
    process.exit(1);
  });
