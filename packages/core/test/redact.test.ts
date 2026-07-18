import { describe, expect, test } from "bun:test";
import { makeRedactor, redactDeep } from "../src/redact.ts";

describe("redaction", () => {
  test("replaces secret values everywhere, including nested payloads", () => {
    const redact = makeRedactor(new Map([["jenkins/qa-token", "s3cr3t-token-value"]]));
    const event = {
      type: "step.output",
      text: "curl -u bob:s3cr3t-token-value https://jenkins",
      nested: { arr: ["s3cr3t-token-value"] },
    };
    const safe = redactDeep(event, redact);
    expect(JSON.stringify(safe)).not.toContain("s3cr3t-token-value");
    expect(safe.text).toContain("[REDACTED:jenkins/qa-token]");
  });

  test("ignores values too short to redact safely", () => {
    const redact = makeRedactor(new Map([["x", "ab"]]));
    expect(redact("cable")).toBe("cable");
  });
});
