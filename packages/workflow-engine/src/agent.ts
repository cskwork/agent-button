import {
  AbtnError,
  expandHome,
  renderTemplate,
  type AgentResult,
  type AgentStep,
} from "@abtn/core";
import type { AgentAdapter, AgentRunRequest } from "@abtn/adapters";
import type { EngineContext, WorkflowScope } from "./context.ts";

/**
 * Drive one adapter run to completion, forwarding every event to the run
 * stream. Throws a typed AbtnError when the agent reports failure.
 */
export async function collectAgentRun(
  adapter: AgentAdapter,
  request: AgentRunRequest,
  ctx: EngineContext,
): Promise<AgentResult> {
  let result: AgentResult | undefined;
  for await (const event of adapter.start(request, ctx.signal)) {
    ctx.emit(event);
    if (event.type === "run.completed") result = event.result;
    if (event.type === "run.failed") {
      throw new AbtnError(event.error.code, event.error.message, event.error.details);
    }
  }
  if (!result) throw new AbtnError("AGENT_FAILED", `${adapter.id} ended without a result`);
  return result;
}

export async function runAgentStep(
  step: AgentStep,
  scope: WorkflowScope,
  ctx: EngineContext,
): Promise<void> {
  const adapter = ctx.adapters.get(step.adapter);
  if (!adapter) throw new AbtnError("ADAPTER_UNAVAILABLE", `Unknown adapter: ${step.adapter}`);

  const prompt = renderTemplate(step.prompt, scope);
  const result = await collectAgentRun(
    adapter,
    {
      runId: ctx.runId,
      prompt,
      cwd: step.cwd ? expandHome(renderTemplate(step.cwd, scope)) : ctx.defaultCwd,
      model: step.model,
      profile: step.profile,
      timeoutMs: step.timeout_seconds * 1000,
      resultSchema: step.result_schema,
    },
    ctx,
  );

  if (step.result_schema && result.structured === undefined) {
    throw new AbtnError("VALIDATION_FAILED", `Step ${step.id}: agent did not return JSON matching result_schema`);
  }

  scope.steps[step.id] = {
    status: "succeeded",
    result: result.structured ?? { text: result.text },
    text: result.text,
  };
  if (step.save_result_as) scope[step.save_result_as] = result.structured ?? result.text;
}
