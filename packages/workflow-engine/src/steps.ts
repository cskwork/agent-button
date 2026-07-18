import {
  AbtnError,
  renderTemplate,
  evaluateCondition,
  type CommandStep,
  type AssertionStep,
  type HttpStep,
} from "@abtn/core";
import { runProcess } from "@abtn/process-runner";
import { resolveSecretsInMap, type EngineContext, type WorkflowScope } from "./context.ts";

function render(value: string, scope: WorkflowScope): string {
  return renderTemplate(value, scope);
}

export async function runCommandStep(
  step: CommandStep,
  scope: WorkflowScope,
  ctx: EngineContext,
): Promise<void> {
  const executable = render(step.executable, scope);
  const args = step.args.map((a) => render(a, scope));
  const env = await resolveSecretsInMap(
    Object.fromEntries(Object.entries(step.env).map(([k, v]) => [k, render(v, scope)])),
    ctx.resolveSecret,
  );

  const result = await runProcess({
    executable,
    args,
    cwd: step.cwd ? render(step.cwd, scope) : ctx.defaultCwd,
    env,
    minimalEnv: false,
    timeoutMs: step.timeout_seconds * 1000,
    signal: ctx.signal,
    onStdout: (chunk) => ctx.emit({ type: "step.output", stepId: step.id, stream: "stdout", text: chunk }),
    onStderr: (chunk) => ctx.emit({ type: "step.output", stepId: step.id, stream: "stderr", text: chunk }),
  });

  if (result.cancelled) throw new AbtnError("CANCELLED", `Step ${step.id} cancelled`);
  if (result.timedOut) throw new AbtnError("TIMEOUT", `Step ${step.id} timed out after ${step.timeout_seconds}s`);

  const stdout = result.stdout;
  scope.steps[step.id] = {
    status: "succeeded",
    stdout: stdout.trim(),
    stderr: result.stderr.trim(),
    exit_code: result.exitCode,
  };

  const expectedExit = step.assertions?.exit_code ?? 0;
  if (result.exitCode !== expectedExit) {
    throw new AbtnError("STEP_FAILED", `${executable} exited ${result.exitCode} (expected ${expectedExit})`, {
      stderr: result.stderr.slice(0, 1000),
    });
  }
  if (step.assertions?.stdout_empty && stdout.trim() !== "") {
    throw new AbtnError("ASSERTION_FAILED", `Step ${step.id}: expected empty stdout`, {
      stdout: stdout.slice(0, 1000),
    });
  }
  if (step.assertions?.stdout_matches && !new RegExp(step.assertions.stdout_matches).test(stdout)) {
    throw new AbtnError("ASSERTION_FAILED", `Step ${step.id}: stdout did not match ${step.assertions.stdout_matches}`);
  }

  if (step.save_stdout_as) scope[step.save_stdout_as] = stdout.trim();
}

export function runAssertionStep(step: AssertionStep, scope: WorkflowScope): void {
  for (const expr of step.require) {
    if (!evaluateCondition(expr, scope)) {
      throw new AbtnError("ASSERTION_FAILED", `Assertion failed: ${expr}`);
    }
  }
  scope.steps[step.id] = { status: "succeeded" };
}

export async function runHttpStep(
  step: HttpStep,
  scope: WorkflowScope,
  ctx: EngineContext,
): Promise<void> {
  const url = render(step.url, scope);
  const headers = await resolveSecretsInMap(
    Object.fromEntries(Object.entries(step.headers).map(([k, v]) => [k, render(v, scope)])),
    ctx.resolveSecret,
  );

  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(step.timeout_seconds * 1000)]);
  const response = await fetch(url, {
    method: step.method,
    headers,
    body: step.body !== undefined ? JSON.stringify(step.body) : undefined,
    signal,
  }).catch((err) => {
    throw new AbtnError("STEP_FAILED", `HTTP ${step.method} ${url} failed: ${String(err)}`);
  });

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch { /* keep raw text */ }

  scope.steps[step.id] = { status: "succeeded", status_code: response.status, response: parsed };
  if (step.save_response_as) scope[step.save_response_as] = parsed;

  if (!step.expect_status.includes(response.status)) {
    throw new AbtnError("STEP_FAILED", `HTTP ${step.method} ${url} returned ${response.status}`, {
      body: text.slice(0, 1000),
    });
  }
}
