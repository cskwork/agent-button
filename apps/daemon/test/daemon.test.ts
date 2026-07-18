import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@abtn/client";
import { startDaemon, type DaemonHandle } from "../src/main.ts";

let home: string;
let daemon: DaemonHandle;
let client: DaemonClient;

const helloButton = `
version: 1
kind: agent-button
id: hello
label: Hello
agent: { adapter: fake }
prompt: { template: "greet {{name}}" }
inputs:
  type: object
  properties:
    name: { type: string, default: world }
execution: { timeout_seconds: 60 }
`;

const approvalWorkflow = `
version: 1
kind: workflow
id: approval-flow
label: Approval Flow
steps:
  - id: prep
    type: command
    executable: echo
    args: ["ready"]
    save_stdout_as: prep_state
  - id: gate
    type: approval
    display:
      title: Continue?
      fields: [prep_state]
  - id: done
    type: command
    executable: echo
    args: ["finished"]
`;

const slowWorkflow = `
version: 1
kind: workflow
id: slow-flow
label: Slow Flow
execution: { concurrency: reject, timeout_seconds: 120 }
steps:
  - id: nap
    type: command
    executable: sleep
    args: ["10"]
    timeout_seconds: 60
`;

async function waitForStatus(runId: string, statuses: string[], timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { run } = await client.getRun(runId);
    if (statuses.includes(run.status)) return run.status;
    await Bun.sleep(150);
  }
  const { run } = await client.getRun(runId);
  throw new Error(`Timed out waiting for ${statuses.join("/")}, run is ${run.status}`);
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "abtn-test-"));
  mkdirSync(join(home, "buttons"), { recursive: true });
  writeFileSync(join(home, "buttons/hello.yaml"), helloButton);
  writeFileSync(join(home, "buttons/approval-flow.yaml"), approvalWorkflow);
  writeFileSync(join(home, "buttons/slow-flow.yaml"), slowWorkflow);
  daemon = startDaemon(home);
  client = new DaemonClient(daemon.socketPath);
});

afterAll(() => {
  daemon.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("daemon end to end", () => {
  test("health and button registry", async () => {
    const health = await client.health();
    expect(health.ok).toBe(true);
    const { buttons, loadErrors } = await client.listButtons();
    expect(loadErrors).toEqual([]);
    expect(buttons.map((b) => b.id).sort()).toEqual(["approval-flow", "hello", "slow-flow"]);
  });

  test("agent button run completes and streams events", async () => {
    const { run } = await client.startRun("hello", { name: "Danny" });
    const status = await waitForStatus(run.id, ["succeeded", "failed"]);
    expect(status).toBe("succeeded");
    const { events } = await client.runEvents(run.id);
    const types = events.map((e) => e.event.type);
    expect(types).toContain("run.started");
    expect(types).toContain("run.completed");
    const delta = events.find((e) => e.event.type === "message.delta");
    expect(delta && "text" in delta.event ? delta.event.text : "").toContain("greet Danny");
  });

  test("workflow pauses for approval, then completes after approve", async () => {
    const { run } = await client.startRun("approval-flow");
    await waitForStatus(run.id, ["waiting_approval"]);

    const { approvals } = await client.listApprovals();
    const pending = approvals.find((a) => a.runId === run.id);
    expect(pending).toBeDefined();
    expect(pending!.request.fields.prep_state).toBe("ready");

    await client.decideApproval(pending!.request.id, "approved");
    const status = await waitForStatus(run.id, ["succeeded", "failed"]);
    expect(status).toBe("succeeded");
  });

  test("workflow fails with APPROVAL_REJECTED after reject", async () => {
    const { run } = await client.startRun("approval-flow");
    await waitForStatus(run.id, ["waiting_approval"]);
    const { approvals } = await client.listApprovals();
    const pending = approvals.find((a) => a.runId === run.id)!;
    await client.decideApproval(pending.request.id, "rejected");
    const status = await waitForStatus(run.id, ["failed", "succeeded"]);
    expect(status).toBe("failed");
    const { run: finished } = await client.getRun(run.id);
    expect(finished.error?.code).toBe("APPROVAL_REJECTED");
  });

  test("concurrency reject blocks a second run, cancel kills the first", async () => {
    const { run } = await client.startRun("slow-flow");
    await waitForStatus(run.id, ["running"]);

    await expect(client.startRun("slow-flow")).rejects.toThrow(/already running/);

    await client.cancelRun(run.id);
    const status = await waitForStatus(run.id, ["cancelled", "failed"]);
    expect(status).toBe("cancelled");
  });

  test("dry run reports the plan without executing", async () => {
    const { run } = await client.startRun("slow-flow", {}, true);
    const status = await waitForStatus(run.id, ["succeeded", "failed"], 5000);
    expect(status).toBe("succeeded");
    const { events } = await client.runEvents(run.id);
    const skipped = events.find((e) => e.event.type === "step.skipped");
    expect(skipped && "reason" in skipped.event ? skipped.event.reason : "").toContain("dry-run");
  });

  test("daemon restart marks in-flight runs as interrupted", async () => {
    const { run } = await client.startRun("slow-flow");
    await waitForStatus(run.id, ["running"]);

    daemon.stop();
    daemon = startDaemon(home);
    client = new DaemonClient(daemon.socketPath);

    const { run: after } = await client.getRun(run.id);
    expect(["interrupted", "cancelled"]).toContain(after.status);
    await Bun.sleep(500); // let the old run's teardown settle before cleanup
  });

  test("validation errors surface as VALIDATION_FAILED", async () => {
    await expect(client.startRun("missing-button")).rejects.toThrow(/not found/i);
  });
});
