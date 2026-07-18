import { AbtnError } from "./errors.ts";

/**
 * Minimal 5-field cron parser: minute hour day-of-month month day-of-week.
 * Supports "*", "*\/n", "a-b", "a,b,c" and combinations. Timezone-aware via Intl.
 */
export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new AbtnError("VALIDATION_FAILED", `Invalid cron step: ${part}`);
    }
    let lo = min;
    let hi = max;
    if (rangePart !== "*" && rangePart !== undefined && rangePart !== "") {
      const range = rangePart.split("-");
      if (range.length === 2) {
        lo = Number(range[0]);
        hi = Number(range[1]);
      } else {
        lo = hi = Number(rangePart);
      }
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo < min || hi > max || lo > hi) {
      throw new AbtnError("VALIDATION_FAILED", `Invalid cron field: ${field} (${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new AbtnError("VALIDATION_FAILED", `Cron must have 5 fields, got: "${expr}"`);
  }
  return {
    minute: parseField(fields[0]!, 0, 59),
    hour: parseField(fields[1]!, 0, 23),
    dom: parseField(fields[2]!, 1, 31),
    month: parseField(fields[3]!, 1, 12),
    dow: parseField(fields[4]!, 0, 6),
  };
}

interface ZonedParts {
  minute: number;
  hour: number;
  dom: number;
  month: number;
  dow: number;
}

const DOW_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function partsInZone(date: Date, timezone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "numeric",
    hour: "numeric",
    hour12: false,
    day: "numeric",
    month: "numeric",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour) % 24,
    dom: Number(parts.day),
    month: Number(parts.month),
    dow: DOW_INDEX[parts.weekday ?? "Sun"] ?? 0,
  };
}

export function cronMatches(spec: CronSpec, date: Date, timezone: string): boolean {
  const p = partsInZone(date, timezone);
  return (
    spec.minute.has(p.minute) &&
    spec.hour.has(p.hour) &&
    spec.dom.has(p.dom) &&
    spec.month.has(p.month) &&
    spec.dow.has(p.dow)
  );
}

/** Next matching instant strictly after `after`, scanning minute-by-minute (max 1 year). */
export function nextCronRun(expr: string, after: Date, timezone = "UTC"): Date | null {
  const spec = parseCron(expr);
  const start = new Date(Math.ceil((after.getTime() + 1) / 60000) * 60000);
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    const candidate = new Date(start.getTime() + i * 60000);
    if (cronMatches(spec, candidate, timezone)) return candidate;
  }
  return null;
}
