import { describe, expect, test } from "bun:test";
import { WorkflowSchema, type RunStreamEvent } from "@abtn/core";
import { FakeAdapter, type AgentAdapter } from "@abtn/adapters";
import { executeWorkflow, type EngineContext } from "../src/index.ts";

function makeCtx(overrides: Partial<EngineContext> = {}): { ctx: EngineContext; events: RunStreamEvent[] } {
  const events: RunStreamEvent[] = [];
  const adapters = new Map<string, AgentAdapter>([["fake", new FakeAdapter()]]);
  const ctx: EngineContext = {
    runId: "run_test",
    adapters,
    emit: (event) => events.push(event),
    requestApproval: async () => "approved",
    resolveSecret: async (ref) => `resolved:${ref}`,
    signal: new AbortController().signal,
    defaultCwd: process.cwd(),
    dryRun: false,
    ...overrides,
  };
  return { ctx, events };
}

const baseWorkflow = {
  version: 1,
  kind: "workflow",
  id: "test-flow",
  label: "Test Flow",
  steps: [] as unknown[],
};

describe("executeWorkflow", () => {
  test("command step saves stdout and downstream steps see it", async () => {
    const workflow = WorkflowSchema.parse({
      ...baseWorkflow,
      steps: [
        { id: "emit", type: "command", executable: "echo", args: ["pinned-sha-123"], save_stdout_as: "sha" },
        { id: "use", type: "command", executable: "echo", args: ["value:{{sha}}"], save_stdout_as: "echoed" },
        { id: "check", type: "assertion", require: ["{{echoed == 'value:pinned-sha-123'}}"] },
      ],
    });
    const { ctx } = makeCtx();
    const result = await executeWorkflow(workflow, {}, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.scope.sha).toBe("pinned-sha-123");
  });

  test("failed assertion stops the workflow with ASSERTION_FAILED", async () => {
    const workflow = WorkflowSchema.parse({
      ...baseWorkflow,
      steps: [
        { id: "emit", type: "command", executable: "echo", args: ["dirty"], save_stdout_as: "state" },
        { id: "gate", type: "assertion", require: ["{{state == 'clean'}}"] },
        { id: "never", type: "command", executable: "echo", args: ["should not run"] },
      ],
    });
    const { ctx, events } = makeCtx();
    const result = await executeWorkflow(workflow, {}, ctx);
    expect(result.status).toBe("failed");
    expect(result.scope.steps.never).toBeUndefined();
    expect(result.error?.code).toBe("ASSERTION_FAILED");
    expect(events.some((e) => e.type === "step.failed")).toBe(true);
  });

  test("stdout_empty preflight assertion", async () => {
    const workflow = WorkflowSchema.parse({
      ...baseWorkflow,
      steps: [
        { id: "preflight", type: "command", executable: "echo", args: ["uncommitted"], assertions: { stdout_empty: true } },
      ],
    });
    const { ctx } = makeCtx();
    const result = await executeWorkflow(workflow, {}, ctx);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("ASSERTION_FAILED");
  });

  test("agent step runs through the adapter and records a result", async () => {
    const workflow = WorkflowSchema.parse({
      ...baseWorkflow,
      steps: [
        { id: "think", type: "agent", adapter: "fake", prompt: "analyze {{topic}}" },
        { id: "check", type: "assertion", require: ["{{steps.think.status == 'succeeded'}}"] },
      ],
    });
    const { ctx, events } = makeCtx();
    const result = await executeWorkflow(workflow, { topic: "deployment" }, ctx);
    expect(result.status).toBe("succeeded");
    expect(events.some((e) => e.type === "message.delta")).toBe(true);
    const adapter = ctx.adapters.get("fake") as FakeAdapter;
    expect(adapter.requests[0]!.prompt).toContain("analyze deployment");
  });

  test("rejected approval fails the workflow with APPROVAL_REJECTED", async () => {
    const workflow = WorkflowSchema.parse({
      ...baseWorkflow,
      steps: [
        { id: "gate", type: "approval", display: { title: "Deploy?", fields: [] } },
        { id: "never", type: "command", executable: "echo", args: ["nope"] },
      ],
    });
    const { ctx } = makeCtx({ requestApproval: async () => "rejected" });
    const result = await executeWorkflow(workflow, {}, ctx);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("APPROVAL_REJECTED");
    expect(result.scope.steps.never).toBeUndefined();
  });

  test("when: false skips the step", async () => {
    const workflow = WorkflowSchema.parse({
      ...baseWorkflow,
      steps: [
        { id: "flag", type: "command", executable: "echo", args: ["hold"], save_stdout_as: "decision" },
        { id: "gated", type: "command", executable: "echo", args: ["ran"], when: "{{decision == 'proceed'}}" },
      ],
    });
    const { ctx } = makeCtx();
    const result = await executeWorkflow(workflow, {}, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.scope.steps.gated?.status).toBe("skipped");
  });

  test("dry run executes nothing but reports the plan", async () => {
    const workflow = WorkflowSchema.parse({
      ...baseWorkflow,
      steps: [
        { id: "danger", type: "command", executable: "rm", args: ["-rf", "/tmp/nonexistent-abtn-test"] },
      ],
    });
    const { ctx, events } = makeCtx({ dryRun: true });
    const result = await executeWorkflow(workflow, {}, ctx);
    expect(result.status).toBe("succeeded");
    const skipped = events.find((e) => e.type === "step.skipped");
    expect(skipped && "reason" in skipped ? skipped.reason : "").toContain("dry-run");
  });

  test("secret refs resolve in env but are never required in prompts", async () => {
    const workflow = WorkflowSchema.parse({
      ...baseWorkflow,
      steps: [
        {
          id: "env-secret",
          type: "command",
          executable: "sh",
          args: ["-c", "echo $TOKEN"],
          env: { TOKEN: "secret://keychain/test/token" },
          save_stdout_as: "leaked",
        },
      ],
    });
    const { ctx } = makeCtx();
    const result = await executeWorkflow(workflow, {}, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.scope.leaked).toBe("resolved:secret://keychain/test/token");
  });
});
