import { nextCronRun, type ButtonDefinition } from "@abtn/core";
import type { DaemonDb } from "./db.ts";
import type { ButtonRegistry } from "./registry.ts";
import type { RunManager } from "./run-manager.ts";

const TICK_MS = 30000;
const LEASE_MS = 5 * 60000;
/** A run more than this late is governed by missed_run_policy. */
const LATE_THRESHOLD_MS = 5 * 60000;

/**
 * SQLite-backed scheduler. next_run_at is persisted; a lease must be won
 * before a run starts, so a daemon restart or overlapping ticks can never
 * launch duplicates (spec section 9).
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly db: DaemonDb,
    private readonly registry: ButtonRegistry,
    private readonly runs: RunManager,
  ) {}

  /** Sync schedule rows with button definitions (call after registry reload). */
  syncSchedules(): void {
    const scheduled = new Map<string, ButtonDefinition>();
    for (const button of this.registry.list()) {
      if (button.trigger.type === "schedule" && button.trigger.cron) scheduled.set(button.id, button);
    }
    for (const row of this.db.listSchedules()) {
      if (!scheduled.has(row.button_id)) this.db.deleteSchedule(row.button_id);
    }
    const now = new Date();
    for (const [id, button] of scheduled) {
      const existing = this.db.getSchedule(id);
      if (!existing || !existing.next_run_at) {
        const next = nextCronRun(button.trigger.cron!, now, button.trigger.timezone ?? localTimezone());
        this.db.upsertSchedule(id, next ? next.toISOString() : null);
      }
    }
  }

  start(): void {
    this.syncSchedules();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const now = new Date();
    for (const row of this.db.listSchedules()) {
      if (row.paused || !row.next_run_at) continue;
      if (Date.parse(row.next_run_at) > now.getTime()) continue;

      const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
      if (!this.db.acquireLease(row.button_id, now.toISOString(), leaseUntil)) continue;

      let lastRunId: string | null = null;
      try {
        const button = this.registry.get(row.button_id);
        const cron = button.trigger.cron!;
        const tz = button.trigger.timezone ?? localTimezone();
        const lateMs = now.getTime() - Date.parse(row.next_run_at);
        const shouldRun = lateMs <= LATE_THRESHOLD_MS || button.trigger.missed_run_policy !== "skip";

        if (shouldRun) {
          try {
            const record = this.runs.startRun(button.id, {}, {
              trigger: "schedule",
              policyOverride: button.trigger.overlap_policy,
            });
            lastRunId = record.id;
          } catch {
            // Overlap policy "reject" while previous run is active: skip this slot.
          }
        }
        const next = nextCronRun(cron, now, tz);
        this.db.completeLease(button.id, next ? next.toISOString() : null, lastRunId);
      } catch {
        // Button vanished between reload and tick; drop its schedule.
        this.db.deleteSchedule(row.button_id);
      }
    }
  }
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}
