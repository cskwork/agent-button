import { runProcess } from "@abtn/process-runner";
import type { AgentInstallation } from "./types.ts";

export async function detectBinary(binary: string, versionArgs = ["--version"]): Promise<AgentInstallation> {
  const which = await runProcess({
    executable: "/usr/bin/which",
    args: [binary],
    minimalEnv: false,
    timeoutMs: 5000,
  }).catch(() => null);

  if (!which || which.exitCode !== 0) return { installed: false };
  const path = which.stdout.trim().split("\n")[0];

  const version = await runProcess({
    executable: binary,
    args: versionArgs,
    minimalEnv: false,
    timeoutMs: 10000,
  }).catch(() => null);

  return {
    installed: true,
    path,
    version: version?.stdout.trim().split("\n")[0] || undefined,
  };
}
