/**
 * Build a redactor for resolved secret values. Every log line, event payload,
 * and artifact preview must pass through this before persistence or display.
 */
export function makeRedactor(secrets: Map<string, string>): (text: string) => string {
  // Longest first so overlapping values redact fully.
  const entries = [...secrets.entries()]
    .filter(([, value]) => value.length >= 4)
    .sort((a, b) => b[1].length - a[1].length);
  return (text: string) => {
    let out = text;
    for (const [name, value] of entries) {
      out = out.split(value).join(`[REDACTED:${name}]`);
    }
    return out;
  };
}

export function redactDeep<T>(value: T, redact: (s: string) => string): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, redact);
    return out as T;
  }
  return value;
}
