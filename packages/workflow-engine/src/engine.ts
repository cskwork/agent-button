import {
  AbtnError,
  evaluateCondition,
  expandHome,
  newId,
  renderTemplate,
  resolvePath,
  serializeError,
  type AgentButton,
  type AgentResult,
  type SerializedError,
  type Workflow,
  type WorkflowStep,
} from "@abtn/core";
import { collectAgentRun, runAgentStep } from "./agent.ts";
import { makeScope, type EngineContext, type WorkflowScope } from "./context.ts";
import { runAssertionStep, runCommandStep, runHttpStep } from "./steps.ts";
import { runJenkinsStep, runJenkinsWaitStep } from "./jenkins.ts";

export interface WorkflowResult {
  status: "succeeded" | "failed";
  error?: SerializedError;
  scope: WorkflowScope;
}

export async function executeWorkflow(
  workflow: Workflow,
  inputs: Record<string, unknown>,
  ctx: EngineContext,
): Promise<WorkflowResult> {
  const scope = makeScope(inputs);

  for (const step of workflow.steps) {
    ctx.signal.throwIfAborted();

    if (step.when && !safeCondition(step.when, scope)) {
      scope.steps[step.id] = { status: "skipped" };
      ctx.emit({ type: "step.skipped", stepId: step.id, reason: `when: ${step.when}` });
      continue;
    }

    ctx.emit({ type: "step.started", stepId: step.id, stepType: step.type });

    if (ctx.dryRun) {
      scope.steps[step.id] = { status: "skipped" };
      ctx.emit({ type: "step.skipped", stepId: step.id, reason: describeDryRun(step, scope) });
      continue;
    }

    try {
      await executeStep(step, scope, ctx);
      ctx.emit({ type: "step.completed", stepId: step.id });
    } catch (err) {
      const serialized = serializeError(err);
      if (scope.steps[step.id] === undefined || scope.steps[step.id]?.status === "succeeded") {
        scope.steps[step.id] = { ...(scope.steps[step.id] ?? {}), status: "failed" };
      }
      ctx.emit({ type: "step.failed", stepId: step.id, error: serialized });
      return { status: "failed", error: serialized, scope };
    }
  }

  return { status: "succeeded", scope };
}

async function executeStep(step: WorkflowStep, scope: WorkflowScope, ctx: EngineContext): Promise<void> {
  switch (step.type) {
    case "command":
      return runCommandStep(step, scope, ctx);
    case "agent":
      return runAgentStep(step, scope, ctx);
    case "assertion":
      return runAssertionStep(step, scope);
    case "http":
      return runHttpStep(step, scope, ctx);
    case "jenkins":
      return runJenkinsStep(step, scope, ctx);
    case "jenkins-wait":
      return runJenkinsWaitStep(step, scope, ctx);
    case "approval":
      return runApprovalStep(step, scope, ctx);
  }
}

async function runApprovalStep(
  step: Extract<WorkflowStep, { type: "approval" }>,
  scope: WorkflowScope,
  ctx: EngineContext,
): Promise<void> {
  // Approval happens AFTER preflight: fields show resolved facts, not intentions.
  const fields: Record<string, unknown> = {};
  for (const field of step.display.fields) {
    fields[field] = resolvePath(scope, field) ?? "(not set)";
  }
  const request = {
    id: newId("apr"),
    title: renderTemplate(step.display.title, scope),
    fields,
  };
  ctx.emit({ type: "approval.requested", request });

  const decision = await ctx.requestApproval(request);
  if (decision !== "approved") {
    scope.steps[step.id] = { status: "failed", decision };
    throw new AbtnError("APPROVAL_REJECTED", `Approval rejected: ${request.title}`);
  }
  scope.steps[step.id] = { status: "succeeded", decision };
}

function safeCondition(expr: string, scope: WorkflowScope): boolean {
  try {
    return evaluateCondition(expr, scope);
  } catch {
    return false;
  }
}

function describeDryRun(step: WorkflowStep, scope: WorkflowScope): string {
  try {
    if (step.type === "command") {
      const args = step.args.map((a) => renderTemplate(a, scope)).join(" ");
      return `dry-run: would execute ${renderTemplate(step.executable, scope)} ${args}`;
    }
    if (step.type === "agent") return `dry-run: would run agent ${step.adapter}`;
    if (step.type === "approval") return `dry-run: would request approval "${step.display.title}"`;
    if (step.type === "http") return `dry-run: would ${step.method} ${step.url}`;
  } catch {
    /* unresolvable templates are expected in dry runs */
  }
  return `dry-run: would run ${step.type} step`;
}

/** Execute a single-prompt agent button. */
export async function executeAgentButton(
  button: AgentButton,
  inputs: Record<string, unknown>,
  ctx: EngineContext,
): Promise<AgentResult> {
  const adapter = ctx.adapters.get(button.agent.adapter);
  if (!adapter) throw new AbtnError("ADAPTER_UNAVAILABLE", `Unknown adapter: ${button.agent.adapter}`);

  const scope = makeScope(inputs);
  const prompt = renderTemplate(button.prompt.template, scope);
  const cwd = expandHome(button.workspace.cwd);

  if (ctx.dryRun) {
    ctx.emit({ type: "log", level: "info", text: `dry-run: would run ${adapter.id} in ${cwd}\n--- prompt ---\n${prompt}` });
    return { text: "(dry run)", exitCode: 0 };
  }

  return collectAgentRun(
    adapter,
    {
      runId: ctx.runId,
      prompt,
      cwd,
      model: button.agent.model,
      profile: button.agent.profile,
      timeoutMs: button.execution.timeout_seconds * 1000,
      env: button.capabilities.environment,
    },
    ctx,
  );
}
