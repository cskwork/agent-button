import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentButtonSchema } from "@abtn/core";
import { resolveAgentInfo } from "../src/agent-info.ts";

let home: string;

function makeButton(adapter: string, model?: string) {
  return AgentButtonSchema.parse({
    version: 1,
    kind: "agent-button",
    id: "t",
    label: "T",
    agent: { adapter, ...(model ? { model } : {}) },
    prompt: { template: "hi" },
  });
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "abtn-agentinfo-"));
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    join(home, ".codex", "config.toml"),
    'model = "gpt-test"\nmodel_reasoning_effort = "high"\n\n[sandbox_workspace_write]\nnetwork_access = true\nmodel = "not-top-level"\n',
  );
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus-test", effortLevel: "max" }));
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("resolveAgentInfo", () => {
  test("codex defaults come from top-level config.toml only", () => {
    expect(resolveAgentInfo(makeButton("codex"), home)).toEqual({
      adapter: "codex",
      model: "gpt-test",
      reasoning: "high",
    });
  });

  test("claude-code defaults come from settings.json", () => {
    expect(resolveAgentInfo(makeButton("claude-code"), home)).toEqual({
      adapter: "claude-code",
      model: "opus-test",
      reasoning: "max",
    });
  });

  test("button-declared model wins over config default", () => {
    expect(resolveAgentInfo(makeButton("codex", "o3"), home)?.model).toBe("o3");
  });

  test("unknown adapter or missing config shows nothing, not a guess", () => {
    expect(resolveAgentInfo(makeButton("fake"), home)).toEqual({ adapter: "fake", model: undefined, reasoning: undefined });
    const emptyHome = mkdtempSync(join(tmpdir(), "abtn-empty-"));
    try {
      expect(resolveAgentInfo(makeButton("codex"), emptyHome)?.model).toBeUndefined();
    } finally {
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
