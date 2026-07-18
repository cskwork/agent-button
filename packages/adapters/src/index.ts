import { ClaudeCodeAdapter } from "./claude-code.ts";
import { CodexAdapter } from "./codex.ts";
import { PlainCliAdapter, type PlainCliConfig } from "./plain-cli.ts";
import { FakeAdapter } from "./fake.ts";
import type { AgentAdapter } from "./types.ts";

export * from "./types.ts";
export { ClaudeCodeAdapter } from "./claude-code.ts";
export { CodexAdapter } from "./codex.ts";
export { PlainCliAdapter, type PlainCliConfig } from "./plain-cli.ts";
export { FakeAdapter } from "./fake.ts";
export { detectBinary } from "./detect.ts";

export interface AdapterRegistryConfig {
  /** Override or add plain-CLI adapters, keyed by adapter id. */
  plainCli?: PlainCliConfig[];
}

/**
 * Built-in adapters. `opencode` and `pi` ship as plain-CLI presets and can be
 * overridden in daemon config if their CLI flags differ on this machine.
 */
export function createAdapterRegistry(config: AdapterRegistryConfig = {}): Map<string, AgentAdapter> {
  const registry = new Map<string, AgentAdapter>();

  registry.set("claude-code", new ClaudeCodeAdapter());
  registry.set("codex", new CodexAdapter());
  registry.set(
    "opencode",
    new PlainCliAdapter({
      id: "opencode",
      executable: "opencode",
      args: ["run", "{{prompt}}"],
      modelArgs: ["--model", "{{model}}"],
    }),
  );
  registry.set(
    "pi",
    new PlainCliAdapter({
      id: "pi",
      executable: "pi",
      args: ["--print", "{{prompt}}"],
    }),
  );
  registry.set("fake", new FakeAdapter());

  for (const custom of config.plainCli ?? []) {
    registry.set(custom.id, new PlainCliAdapter(custom));
  }
  return registry;
}
