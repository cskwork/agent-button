// One-off smoke test: run a real claude-code prompt through the daemon.
import { DaemonClient, formatEvent } from "../packages/client/src/index.ts";

const client = new DaemonClient();
await client.saveButton({
  version: 1,
  kind: "agent-button",
  id: "smoke-claude",
  label: "Smoke Claude",
  group: "Demo",
  agent: { adapter: "claude-code" },
  workspace: { cwd: "/tmp" },
  prompt: { template: "Reply with exactly: OK" },
  execution: { timeout_seconds: 240 },
});
const { run } = await client.startRun("smoke-claude");
console.log("run:", run.id);
for await (const ev of client.streamEvents(run.id)) {
  const line = formatEvent(ev);
  if (line) console.log(line);
  if (ev.event.type === "log" && /^Run (succeeded|failed|cancelled)/.test(ev.event.text)) break;
}
const { run: done } = await client.getRun(run.id);
console.log("final status:", done.status);
await client.deleteButton("smoke-claude");
console.log("cleaned up");
process.exit(done.status === "succeeded" ? 0 : 1);
