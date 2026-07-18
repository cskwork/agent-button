import { describe, expect, test } from "bun:test";
import { runProcess, streamProcess } from "../src/index.ts";

describe("runProcess", () => {
  test("runs a command with shell:false and captures output", async () => {
    const result = await runProcess({ executable: "echo", args: ["hello $HOME"], minimalEnv: false });
    expect(result.exitCode).toBe(0);
    // No shell interpolation: $HOME must arrive literally.
    expect(result.stdout.trim()).toBe("hello $HOME");
  });

  test("enforces timeouts by killing the process group", async () => {
    const started = Date.now();
    const result = await runProcess({
      executable: "sleep",
      args: ["30"],
      minimalEnv: false,
      timeoutMs: 500,
    });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10000);
  });

  test("cancellation via AbortSignal kills the child", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const result = await runProcess({
      executable: "sleep",
      args: ["30"],
      minimalEnv: false,
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
  });

  test("caps output size", async () => {
    const result = await runProcess({
      executable: "yes",
      args: ["data"],
      minimalEnv: false,
      timeoutMs: 800,
      maxOutputBytes: 10000,
    });
    expect(result.stdout.length).toBeLessThan(11000);
    expect(result.stdout).toContain("[output truncated]");
  });
});

describe("streamProcess", () => {
  test("yields stdout line by line", async () => {
    const proc = streamProcess({
      executable: "printf",
      args: ["a\nb\nc\n"],
      minimalEnv: false,
    });
    const lines: string[] = [];
    for await (const line of proc.lines) lines.push(line);
    expect(lines).toEqual(["a", "b", "c"]);
    expect(await proc.exitCode()).toBe(0);
  });

  // Regression: a missing working folder used to surface as "Premature close"
  // from the destroyed stdout stream. It must now fail with a clear message.
  test("reports a missing working folder clearly, not 'Premature close'", async () => {
    let message = "";
    try {
      const proc = streamProcess({
        executable: "echo",
        args: ["hi"],
        cwd: "/no/such/folder/agent-button-test",
        minimalEnv: false,
      });
      for await (const _ of proc.lines) { /* drain */ }
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("Working folder does not exist");
    expect(message).not.toContain("Premature close");
  });
});

describe("runProcess", () => {
  test("rejects with a clear message when the working folder is missing", async () => {
    let message = "";
    try {
      await runProcess({ executable: "echo", args: ["hi"], cwd: "/no/such/folder/agent-button-test", minimalEnv: false });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("Working folder does not exist");
  });
});
