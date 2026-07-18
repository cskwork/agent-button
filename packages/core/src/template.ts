import { AbtnError } from "./errors.ts";

/**
 * Restricted template engine. Supports only:
 *   {{ path.to.value }}            — variable substitution
 *   {{ path == 'literal' }}        — comparison (==, !=, >, >=, <, <=)
 * No function calls, no arithmetic, no arbitrary code. This is a deliberate
 * security boundary: button definitions are data, never executable JS.
 */
export type TemplateScope = Record<string, unknown>;

const EXPR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function resolvePath(scope: TemplateScope, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = scope;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

type Token = { kind: "path"; value: string } | { kind: "literal"; value: unknown };

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;

function parseOperand(raw: string): Token {
  const trimmed = raw.trim();
  if (/^'[^']*'$/.test(trimmed) || /^"[^"]*"$/.test(trimmed)) {
    return { kind: "literal", value: trimmed.slice(1, -1) };
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { kind: "literal", value: Number(trimmed) };
  if (trimmed === "true") return { kind: "literal", value: true };
  if (trimmed === "false") return { kind: "literal", value: false };
  if (trimmed === "null") return { kind: "literal", value: null };
  if (PATH_RE.test(trimmed)) return { kind: "path", value: trimmed };
  throw new AbtnError("VALIDATION_FAILED", `Invalid template operand: ${trimmed}`);
}

function operandValue(token: Token, scope: TemplateScope): unknown {
  return token.kind === "literal" ? token.value : resolvePath(scope, token.value);
}

const OPERATORS = ["==", "!=", ">=", "<=", ">", "<"] as const;

export function evaluateExpression(expr: string, scope: TemplateScope): unknown {
  const trimmed = expr.trim();
  for (const op of OPERATORS) {
    const idx = trimmed.indexOf(op);
    if (idx <= 0) continue;
    // Skip ">" / "<" hits that are part of ">=" / "<=".
    if ((op === ">" || op === "<") && trimmed[idx + 1] === "=") continue;
    const left = operandValue(parseOperand(trimmed.slice(0, idx)), scope);
    const right = operandValue(parseOperand(trimmed.slice(idx + op.length)), scope);
    switch (op) {
      case "==": return looseEquals(left, right);
      case "!=": return !looseEquals(left, right);
      case ">=": return Number(left) >= Number(right);
      case "<=": return Number(left) <= Number(right);
      case ">": return Number(left) > Number(right);
      case "<": return Number(left) < Number(right);
    }
  }
  return operandValue(parseOperand(trimmed), scope);
}

/** Compare with number/string coercion: "0" == 0, otherwise strict. */
function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return a === b;
}

export function renderTemplate(template: string, scope: TemplateScope): string {
  return template.replace(EXPR_RE, (_match, expr: string) => {
    const value = evaluateExpression(expr, scope);
    if (value === undefined || value === null) {
      throw new AbtnError("VALIDATION_FAILED", `Template variable not found: ${expr.trim()}`);
    }
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

/** Render every string leaf of a value tree (args arrays, header maps, ...). */
export function renderDeep<T>(value: T, scope: TemplateScope): T {
  if (typeof value === "string") return renderTemplate(value, scope) as T;
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, scope)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderDeep(v, scope);
    return out as T;
  }
  return value;
}

export function evaluateCondition(expr: string, scope: TemplateScope): boolean {
  const inner = expr.trim().replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
  return Boolean(evaluateExpression(inner, scope));
}
