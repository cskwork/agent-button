import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ButtonDefinition, RunAgentInfo } from "@abtn/core";

/**
 * Snapshot the agent identity for a run, display-only. A model declared on the
 * button wins; otherwise the agent CLI's own config is read so the UI shows the
 * value that will actually be used. Anything unknown stays undefined — the UI
 * must never show a guess.
 */
export function resolveAgentInfo(button: ButtonDefinition, home = homedir()): RunAgentInfo | undefined {
  if (button.kind !== "agent-button") return undefined;
  const adapter = button.agent.adapter;
  const declared = button.agent.model && button.agent.model !== "default" ? button.agent.model : undefined;
  const native = readNativeDefaults(adapter, home);
  return { adapter, model: declared ?? native.model, reasoning: native.reasoning };
}

function readNativeDefaults(adapter: string, home: string): { model?: string; reasoning?: string } {
  try {
    if (adapter === "codex") {
      const toml = readFileSync(join(home, ".codex", "config.toml"), "utf8");
      return { model: topLevelTomlString(toml, "model"), reasoning: topLevelTomlString(toml, "model_reasoning_effort") };
    }
    if (adapter === "claude-code") {
      const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")) as Record<string, unknown>;
      return {
        model: typeof settings.model === "string" ? settings.model : undefined,
        reasoning: typeof settings.effortLevel === "string" ? settings.effortLevel : undefined,
      };
    }
  } catch {
    // Missing or unreadable config: show nothing rather than a guess.
  }
  return {};
}

/** Read `key = "value"` from the top-level section only (before any [table]). */
function topLevelTomlString(toml: string, key: string): string | undefined {
  const topLevel = toml.split(/^\[/m)[0] ?? "";
  return topLevel.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
}
