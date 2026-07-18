import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ButtonDefinitionSchema } from "../src/workflow-schema.ts";

const examplesDir = join(import.meta.dir, "../../../examples");

describe("ButtonDefinitionSchema", () => {
  test("accepts every shipped example", () => {
    for (const file of readdirSync(examplesDir).filter((f) => f.endsWith(".yaml"))) {
      const raw = parseYaml(readFileSync(join(examplesDir, file), "utf8"));
      const parsed = ButtonDefinitionSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`${file}: ${JSON.stringify(parsed.error.issues, null, 2)}`);
      }
    }
  });

  test("rejects unknown kinds and bad ids", () => {
    expect(ButtonDefinitionSchema.safeParse({ version: 1, kind: "mystery" }).success).toBe(false);
    expect(
      ButtonDefinitionSchema.safeParse({
        version: 1,
        kind: "agent-button",
        id: "Bad Id!",
        label: "x",
        agent: { adapter: "fake" },
        prompt: { template: "hi" },
      }).success,
    ).toBe(false);
  });

  test("applies defaults", () => {
    const parsed = ButtonDefinitionSchema.parse({
      version: 1,
      kind: "agent-button",
      id: "minimal",
      label: "Minimal",
      agent: { adapter: "fake" },
      prompt: { template: "hi" },
    });
    if (parsed.kind !== "agent-button") throw new Error("wrong kind");
    expect(parsed.execution.timeout_seconds).toBe(1800);
    expect(parsed.execution.concurrency).toBe("reject");
    expect(parsed.permissions.external_side_effects).toBe("confirm");
    expect(parsed.trigger.type).toBe("manual");
  });
});
