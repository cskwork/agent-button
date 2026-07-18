import { AbtnError, type ButtonDefinition } from "@abtn/core";

/** ISO-8601 week label, e.g. 2026-W29. */
export function isoWeekString(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

interface InputDecl {
  type: string;
  values?: string[];
  format?: string;
  default?: string | number | boolean;
  required?: boolean;
}

function declarations(button: ButtonDefinition): Record<string, InputDecl> {
  return button.kind === "agent-button" ? button.inputs.properties : button.inputs;
}

/** Apply defaults, resolve dynamic defaults, validate enums and requireds. */
export function resolveInputs(
  button: ButtonDefinition,
  provided: Record<string, unknown>,
): Record<string, unknown> {
  const decls = declarations(button);
  const out: Record<string, unknown> = {};

  for (const [name, decl] of Object.entries(decls)) {
    let value = provided[name];
    if (value === undefined || value === "") {
      value = resolveDefault(decl);
    }
    if (value === undefined) {
      if (decl.required) throw new AbtnError("VALIDATION_FAILED", `Missing required input: ${name}`);
      continue;
    }
    if (decl.type === "enum" && decl.values && !decl.values.includes(String(value))) {
      throw new AbtnError("VALIDATION_FAILED", `Input ${name} must be one of: ${decl.values.join(", ")}`);
    }
    if (decl.type === "number") value = Number(value);
    if (decl.type === "boolean") value = value === true || value === "true";
    out[name] = value;
  }

  // Pass through extras (workflow steps may reference them), but declared
  // inputs take precedence.
  for (const [name, value] of Object.entries(provided)) {
    if (!(name in out) && value !== undefined) out[name] = value;
  }
  return out;
}

function resolveDefault(decl: InputDecl): unknown {
  if (decl.default === "current" && decl.format === "iso-week") return isoWeekString(new Date());
  if (decl.default === "today" && decl.format === "date") return new Date().toISOString().slice(0, 10);
  return decl.default;
}
