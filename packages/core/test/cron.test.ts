import { describe, expect, test } from "bun:test";
import { nextCronRun, parseCron } from "../src/cron.ts";

describe("parseCron", () => {
  test("parses fields, steps, ranges, lists", () => {
    const spec = parseCron("*/15 9-17 1,15 * 1-5");
    expect([...spec.minute]).toEqual([0, 15, 30, 45]);
    expect(spec.hour.has(9)).toBe(true);
    expect(spec.hour.has(18)).toBe(false);
    expect([...spec.dom]).toEqual([1, 15]);
    expect(spec.dow.has(0)).toBe(false);
  });

  test("rejects invalid expressions", () => {
    expect(() => parseCron("* * * *")).toThrow();
    expect(() => parseCron("61 * * * *")).toThrow();
  });
});

describe("nextCronRun", () => {
  test("finds next Friday 16:00 in Asia/Seoul", () => {
    // 2026-07-18 is a Saturday.
    const after = new Date("2026-07-18T03:00:00Z");
    const next = nextCronRun("0 16 * * 5", after, "Asia/Seoul");
    expect(next).not.toBeNull();
    // Friday 2026-07-24 16:00 KST == 07:00 UTC
    expect(next!.toISOString()).toBe("2026-07-24T07:00:00.000Z");
  });

  test("next minute match in UTC", () => {
    const after = new Date("2026-01-01T00:00:30Z");
    const next = nextCronRun("* * * * *", after, "UTC");
    expect(next!.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });
});
