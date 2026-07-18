import { parse as parseYaml } from "yaml";
import { AbtnError, serializeError, type RunEvent } from "@abtn/core";
import { revealArtifact } from "./artifacts.ts";
import type { AgentAdapter } from "@abtn/adapters";
import type { DaemonDb } from "./db.ts";
import type { ButtonRegistry } from "./registry.ts";
import type { RunManager } from "./run-manager.ts";
import type { ApprovalRegistry } from "./approvals.ts";
import type { Scheduler } from "./scheduler.ts";

export interface ApiDeps {
  db: DaemonDb;
  registry: ButtonRegistry;
  runs: RunManager;
  approvals: ApprovalRegistry;
  scheduler: Scheduler;
  adapters: Map<string, AgentAdapter>;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(err: unknown): Response {
  const serialized = serializeError(err);
  const status =
    serialized.code === "NOT_FOUND" ? 404 :
    serialized.code === "VALIDATION_FAILED" ? 400 :
    serialized.code === "CONFLICT" ? 409 :
    serialized.code === "AUTH_REQUIRED" ? 401 : 500;
  return json({ error: serialized }, status);
}

/** SSE stream of run events; `runId` filters to one run, otherwise global. */
function sseStream(runs: RunManager, db: DaemonDb, runId?: string, sinceSeq = 0): Response {
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      if (runId) {
        for (const event of db.eventsSince(runId, sinceSeq, 2000)) send(event);
      }
      unsubscribe = runs.subscribe((event) => {
        if (!runId || event.runId === runId) {
          try { send(event); } catch { /* stream closed */ }
        }
      });
      controller.enqueue(encoder.encode(": connected\n\n"));
    },
    cancel() {
      unsubscribe?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function createApiHandler(deps: ApiDeps): (req: Request) => Promise<Response> {
  const { db, registry, runs, approvals, scheduler, adapters } = deps;

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const method = req.method;

    try {
      if (method === "GET" && path === "/health") {
        return json({ ok: true, activeRuns: runs.activeCount(), pid: process.pid });
      }

      if (method === "GET" && path === "/buttons") {
        const definitions = registry.list().map((b) => ({
          ...b,
          schedule: db.getSchedule(b.id) ?? undefined,
        }));
        return json({ buttons: definitions, loadErrors: registry.loadErrors() });
      }
      if (method === "POST" && path === "/buttons") {
        // Accept JSON or raw YAML (custom buttons pasted from editors).
        const text = await req.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = parseYaml(text);
        }
        const saved = registry.save(body);
        scheduler.syncSchedules();
        return json({ button: saved }, 201);
      }
      const buttonMatch = /^\/buttons\/([a-z0-9-]+)(\/raw)?$/.exec(path);
      if (buttonMatch) {
        const id = buttonMatch[1]!;
        if (method === "GET" && buttonMatch[2] === "/raw") {
          return new Response(registry.raw(id), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        if (method === "GET") return json({ button: registry.get(id) });
        if (method === "DELETE") {
          registry.delete(id);
          scheduler.syncSchedules();
          return json({ deleted: id });
        }
      }

      if (method === "GET" && path === "/adapters") {
        const out: Record<string, unknown> = {};
        for (const [id, adapter] of adapters) {
          const installation = await adapter.detect();
          out[id] = {
            ...installation,
            auth: installation.installed ? await adapter.authStatus("default") : undefined,
          };
        }
        return json({ adapters: out });
      }

      if (method === "POST" && path === "/runs") {
        const body = (await req.json()) as {
          buttonId: string;
          inputs?: Record<string, unknown>;
          dryRun?: boolean;
        };
        if (!body.buttonId) throw new AbtnError("VALIDATION_FAILED", "buttonId is required");
        const record = runs.startRun(body.buttonId, body.inputs ?? {}, {
          trigger: "manual",
          dryRun: body.dryRun,
        });
        return json({ run: record }, 201);
      }
      if (method === "GET" && path === "/runs") {
        const limit = Number(url.searchParams.get("limit") ?? "50");
        return json({ runs: db.listRuns(limit) });
      }

      const runMatch = /^\/runs\/([a-z0-9_]+)(\/events|\/stream|\/cancel|\/reveal)?$/.exec(path);
      if (runMatch) {
        const runId = runMatch[1]!;
        const sub = runMatch[2];
        if (method === "GET" && !sub) {
          const run = db.getRun(runId);
          if (!run) throw new AbtnError("NOT_FOUND", `Run not found: ${runId}`);
          return json({ run, approvals: approvals.forRun(runId) });
        }
        if (method === "GET" && sub === "/events") {
          const since = Number(url.searchParams.get("since") ?? "0");
          return json({ events: db.eventsSince(runId, since) });
        }
        if (method === "GET" && sub === "/stream") {
          const since = Number(url.searchParams.get("since") ?? "0");
          return sseStream(runs, db, runId, since);
        }
        if (method === "POST" && sub === "/cancel") {
          runs.cancelRun(runId);
          return json({ cancelled: runId });
        }
        if (method === "POST" && sub === "/reveal") {
          const run = db.getRun(runId);
          if (!run) throw new AbtnError("NOT_FOUND", `Run not found: ${runId}`);
          const body = (await req.json()) as { path?: string };
          // Only paths the daemon itself recorded may be revealed — never arbitrary input.
          const artifact = run.artifacts.find((a) => a.path === body.path);
          if (!artifact) throw new AbtnError("VALIDATION_FAILED", `Path is not an artifact of run ${runId}`);
          revealArtifact(artifact.path);
          return json({ revealed: artifact.path });
        }
      }

      if (method === "GET" && path === "/events/stream") {
        return sseStream(runs, db);
      }

      if (method === "GET" && path === "/approvals") {
        return json({ approvals: approvals.list() });
      }
      const approvalMatch = /^\/approvals\/([a-z0-9_]+)$/.exec(path);
      if (approvalMatch && method === "POST") {
        const body = (await req.json()) as { decision: "approved" | "rejected" };
        if (body.decision !== "approved" && body.decision !== "rejected") {
          throw new AbtnError("VALIDATION_FAILED", "decision must be 'approved' or 'rejected'");
        }
        const entry = approvals.decide(approvalMatch[1]!, body.decision);
        return json({ approval: entry, decision: body.decision });
      }

      const scheduleMatch = /^\/schedules\/([a-z0-9-]+)\/(pause|resume)$/.exec(path);
      if (scheduleMatch && method === "POST") {
        db.setSchedulePaused(scheduleMatch[1]!, scheduleMatch[2] === "pause");
        return json({ buttonId: scheduleMatch[1], paused: scheduleMatch[2] === "pause" });
      }

      throw new AbtnError("NOT_FOUND", `No route: ${method} ${path}`);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
