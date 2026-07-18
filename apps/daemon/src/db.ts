import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { RunEvent, RunRecord, RunStatus, SerializedError, Artifact } from "@abtn/core";

export class DaemonDb {
  readonly db: Database;

  constructor(home: string) {
    mkdirSync(home, { recursive: true });
    this.db = new Database(join(home, "state.sqlite"), { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        button_id TEXT NOT NULL,
        button_label TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        inputs TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        error TEXT,
        artifacts TEXT NOT NULL DEFAULT '[]',
        trigger_kind TEXT NOT NULL DEFAULT 'manual',
        dry_run INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_runs_started ON runs (started_at DESC);
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        ts TEXT NOT NULL,
        event TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE TABLE IF NOT EXISTS schedules (
        button_id TEXT PRIMARY KEY,
        next_run_at TEXT,
        lease_until TEXT,
        paused INTEGER NOT NULL DEFAULT 0,
        last_run_id TEXT
      );
    `);
    // Additive migration: agent snapshot (adapter/model/reasoning) per run.
    const runCols = this.db.query("PRAGMA table_info(runs)").all() as { name: string }[];
    if (!runCols.some((c) => c.name === "agent")) {
      this.db.exec("ALTER TABLE runs ADD COLUMN agent TEXT");
    }
  }

  insertRun(run: RunRecord): void {
    this.db
      .query(
        `INSERT INTO runs (id, button_id, button_label, kind, status, inputs, started_at, trigger_kind, dry_run, agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.buttonId,
        run.buttonLabel,
        run.kind,
        run.status,
        JSON.stringify(run.inputs),
        run.startedAt,
        run.trigger,
        run.dryRun ? 1 : 0,
        run.agent ? JSON.stringify(run.agent) : null,
      );
  }

  /** Runtime told us the model actually in use (e.g. claude init event). */
  updateRunAgent(id: string, agent: RunRecord["agent"]): void {
    this.db.query("UPDATE runs SET agent = ? WHERE id = ?").run(agent ? JSON.stringify(agent) : null, id);
  }

  updateRunStatus(id: string, status: RunStatus, error?: SerializedError, artifacts?: Artifact[]): void {
    const ended = ["succeeded", "failed", "cancelled", "interrupted"].includes(status)
      ? new Date().toISOString()
      : null;
    this.db
      .query(
        `UPDATE runs SET status = ?, ended_at = COALESCE(?, ended_at),
         error = COALESCE(?, error), artifacts = COALESCE(?, artifacts) WHERE id = ?`,
      )
      .run(status, ended, error ? JSON.stringify(error) : null, artifacts ? JSON.stringify(artifacts) : null, id);
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.query("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | null;
    return row ? rowToRun(row) : null;
  }

  listRuns(limit = 50): RunRecord[] {
    const rows = this.db
      .query("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?")
      .all(limit) as RunRow[];
    return rows.map(rowToRun);
  }

  activeRunsForButton(buttonId: string): RunRecord[] {
    const rows = this.db
      .query("SELECT * FROM runs WHERE button_id = ? AND status IN ('queued','running','waiting_approval')")
      .all(buttonId) as RunRow[];
    return rows.map(rowToRun);
  }

  /** Consistency on boot: anything still 'active' from a previous daemon is interrupted. */
  markInterrupted(): number {
    const result = this.db
      .query("UPDATE runs SET status = 'interrupted', ended_at = ? WHERE status IN ('queued','running','waiting_approval')")
      .run(new Date().toISOString());
    return result.changes;
  }

  insertEvent(event: RunEvent): void {
    this.db
      .query("INSERT INTO run_events (run_id, seq, ts, event) VALUES (?, ?, ?, ?)")
      .run(event.runId, event.seq, event.ts, JSON.stringify(event.event));
  }

  eventsSince(runId: string, afterSeq: number, limit = 500): RunEvent[] {
    const rows = this.db
      .query("SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(runId, afterSeq, limit) as { run_id: string; seq: number; ts: string; event: string }[];
    return rows.map((r) => ({ runId: r.run_id, seq: r.seq, ts: r.ts, event: JSON.parse(r.event) }));
  }

  // --- schedules ---

  upsertSchedule(buttonId: string, nextRunAt: string | null): void {
    this.db
      .query(
        `INSERT INTO schedules (button_id, next_run_at) VALUES (?, ?)
         ON CONFLICT(button_id) DO UPDATE SET next_run_at = excluded.next_run_at`,
      )
      .run(buttonId, nextRunAt);
  }

  getSchedule(buttonId: string): ScheduleRow | null {
    return this.db.query("SELECT * FROM schedules WHERE button_id = ?").get(buttonId) as ScheduleRow | null;
  }

  listSchedules(): ScheduleRow[] {
    return this.db.query("SELECT * FROM schedules").all() as ScheduleRow[];
  }

  deleteSchedule(buttonId: string): void {
    this.db.query("DELETE FROM schedules WHERE button_id = ?").run(buttonId);
  }

  setSchedulePaused(buttonId: string, paused: boolean): void {
    this.db.query("UPDATE schedules SET paused = ? WHERE button_id = ?").run(paused ? 1 : 0, buttonId);
  }

  /**
   * Atomically claim a due schedule. Returns true only for the single caller
   * that wins the lease — prevents duplicate runs across scheduler ticks or
   * daemon restarts (spec section 9).
   */
  acquireLease(buttonId: string, now: string, leaseUntil: string): boolean {
    const result = this.db
      .query(
        `UPDATE schedules SET lease_until = ?
         WHERE button_id = ? AND paused = 0 AND next_run_at IS NOT NULL AND next_run_at <= ?
           AND (lease_until IS NULL OR lease_until < ?)`,
      )
      .run(leaseUntil, buttonId, now, now);
    return result.changes === 1;
  }

  completeLease(buttonId: string, nextRunAt: string | null, lastRunId: string | null): void {
    this.db
      .query("UPDATE schedules SET lease_until = NULL, next_run_at = ?, last_run_id = COALESCE(?, last_run_id) WHERE button_id = ?")
      .run(nextRunAt, lastRunId, buttonId);
  }
}

interface RunRow {
  id: string;
  button_id: string;
  button_label: string;
  kind: string;
  status: string;
  inputs: string;
  started_at: string;
  ended_at: string | null;
  error: string | null;
  artifacts: string;
  trigger_kind: string;
  dry_run: number;
  agent: string | null;
}

export interface ScheduleRow {
  button_id: string;
  next_run_at: string | null;
  lease_until: string | null;
  paused: number;
  last_run_id: string | null;
}

function rowToRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    buttonId: row.button_id,
    buttonLabel: row.button_label,
    kind: row.kind as RunRecord["kind"],
    status: row.status as RunRecord["status"],
    inputs: JSON.parse(row.inputs),
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    error: row.error ? JSON.parse(row.error) : undefined,
    artifacts: JSON.parse(row.artifacts),
    trigger: row.trigger_kind as RunRecord["trigger"],
    dryRun: row.dry_run === 1,
    agent: row.agent ? JSON.parse(row.agent) : undefined,
  };
}
