import { AbtnError, renderTemplate, type JenkinsStep, type JenkinsWaitStep } from "@abtn/core";
import { isSecretRef, type EngineContext, type WorkflowScope } from "./context.ts";

/**
 * Deterministic Jenkins adapter over the remote access API: trigger a
 * parameterized build, resolve the queue item to a build URL, poll for the
 * result. The agent never constructs Jenkins requests (spec section 4).
 */
async function authHeader(credential: string | undefined, ctx: EngineContext): Promise<Record<string, string>> {
  if (!credential) return {};
  const resolved = isSecretRef(credential) ? await ctx.resolveSecret(credential) : credential;
  // Expected form: "user:apitoken" (Jenkins-recommended token auth).
  return { Authorization: `Basic ${Buffer.from(resolved).toString("base64")}` };
}

export async function runJenkinsStep(
  step: JenkinsStep,
  scope: WorkflowScope,
  ctx: EngineContext,
): Promise<void> {
  const base = renderTemplate(step.base_url, scope).replace(/\/$/, "");
  const job = renderTemplate(step.job, scope);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(step.parameters)) {
    params.set(key, renderTemplate(value, scope));
  }
  const headers = {
    ...(await authHeader(step.credential, ctx)),
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const url = `${base}/job/${encodeURIComponent(job)}/buildWithParameters`;
  const response = await fetch(url, { method: "POST", headers, body: params.toString(), signal: ctx.signal });
  if (response.status !== 201) {
    throw new AbtnError("STEP_FAILED", `Jenkins trigger returned ${response.status} for ${job}`);
  }
  const queueUrl = response.headers.get("Location");
  if (!queueUrl) throw new AbtnError("STEP_FAILED", "Jenkins did not return a queue Location header");

  // Resolve queue item to a concrete build.
  const deadline = Date.now() + 120000;
  let buildUrl: string | undefined;
  let buildId: number | undefined;
  while (Date.now() < deadline && !buildUrl) {
    ctx.signal.throwIfAborted();
    const q = await fetch(`${queueUrl.replace(/\/$/, "")}/api/json`, { headers, signal: ctx.signal });
    if (q.ok) {
      const item = (await q.json()) as { executable?: { number: number; url: string }; cancelled?: boolean };
      if (item.cancelled) throw new AbtnError("STEP_FAILED", "Jenkins queue item was cancelled");
      if (item.executable) {
        buildUrl = item.executable.url;
        buildId = item.executable.number;
      }
    }
    if (!buildUrl) await sleep(3000, ctx.signal);
  }
  if (!buildUrl) throw new AbtnError("TIMEOUT", "Jenkins build did not leave the queue within 120s");

  scope.steps[step.id] = { status: "succeeded", build_id: buildId, build_url: buildUrl };
}

export async function runJenkinsWaitStep(
  step: JenkinsWaitStep,
  scope: WorkflowScope,
  ctx: EngineContext,
): Promise<void> {
  const headers = await authHeader(step.credential, ctx);
  // `build` accepts a full build URL (saved by the jenkins step as build_url).
  const buildRef = renderTemplate(step.build, scope).replace(/\/$/, "");
  const buildUrl = /^https?:\/\//.test(buildRef)
    ? buildRef
    : `${renderTemplate(step.base_url, scope).replace(/\/$/, "")}/${buildRef}`;

  const deadline = Date.now() + step.timeout_seconds * 1000;
  while (Date.now() < deadline) {
    ctx.signal.throwIfAborted();
    const response = await fetch(`${buildUrl}/api/json`, { headers, signal: ctx.signal });
    if (response.ok) {
      const build = (await response.json()) as { building?: boolean; result?: string | null };
      if (!build.building && build.result) {
        scope.steps[step.id] = { status: "succeeded", result: build.result, build_url: buildUrl };
        if (build.result !== "SUCCESS") {
          throw new AbtnError("STEP_FAILED", `Jenkins build finished with ${build.result}`, { buildUrl });
        }
        return;
      }
    }
    await sleep(step.poll_seconds * 1000, ctx.signal);
  }
  throw new AbtnError("TIMEOUT", `Jenkins build did not finish within ${step.timeout_seconds}s`);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AbtnError("CANCELLED", "Cancelled while waiting"));
      },
      { once: true },
    );
  });
}
