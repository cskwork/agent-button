import { describe, expect, test } from "bun:test";
import { evaluateCondition, evaluateExpression, renderTemplate, resolvePath } from "../src/template.ts";

const scope = {
  report_week: "2026-W29",
  target_branch: "develop",
  count: 3,
  steps: {
    "analyze-change": { result: { recommendation: "proceed", blocking_issues: 0 } },
    "wait-for-build": { status: "SUCCESS" },
  },
};

describe("renderTemplate", () => {
  test("substitutes simple and nested paths", () => {
    expect(renderTemplate("week {{report_week}} on {{target_branch}}", scope)).toBe(
      "week 2026-W29 on develop",
    );
    expect(renderTemplate("{{steps.analyze-change.result.recommendation}}", scope)).toBe("proceed");
  });

  test("throws on unknown variables instead of silently emitting blanks", () => {
    expect(() => renderTemplate("{{missing_var}}", scope)).toThrow("Template variable not found");
  });

  test("rejects code-like expressions", () => {
    expect(() => renderTemplate("{{process.exit(1)}}", scope)).toThrow();
    expect(() => renderTemplate("{{a; rm -rf /}}", scope)).toThrow();
  });
});

describe("evaluateExpression", () => {
  test("comparisons", () => {
    expect(evaluateExpression("steps.analyze-change.result.recommendation == 'proceed'", scope)).toBe(true);
    expect(evaluateExpression("steps.analyze-change.result.blocking_issues == 0", scope)).toBe(true);
    expect(evaluateExpression("count >= 2", scope)).toBe(true);
    expect(evaluateExpression("count < 3", scope)).toBe(false);
    expect(evaluateExpression("steps.wait-for-build.status != 'SUCCESS'", scope)).toBe(false);
  });
});

describe("evaluateCondition", () => {
  test("accepts wrapped and bare expressions", () => {
    expect(evaluateCondition("{{steps.wait-for-build.status == 'SUCCESS'}}", scope)).toBe(true);
    expect(evaluateCondition("count == 3", scope)).toBe(true);
  });
});

describe("resolvePath", () => {
  test("returns undefined for missing paths", () => {
    expect(resolvePath(scope, "steps.nope.result")).toBeUndefined();
  });
});
