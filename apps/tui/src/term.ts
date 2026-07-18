/**
 * Minimal ANSI terminal layer: raw mode, alternate screen, key decoding,
 * full-frame rendering. Deliberately dependency-free; the TUI is a thin
 * client over the daemon API so it can be swapped for OpenTUI or Tauri
 * without touching execution logic (spec section 11).
 */

export const ESC = "\x1b";
const ACCENT_COLORS: Record<string, string> = {
  cyan: "36", blue: "34", green: "32", magenta: "35", yellow: "33", white: "37",
};
const ACCENT = ACCENT_COLORS[process.env.ABTN_ACCENT ?? "cyan"] ?? "36";

export const style = {
  reset: `${ESC}[0m`,
  bold: (s: string) => `${ESC}[1m${s}${ESC}[0m`,
  dim: (s: string) => `${ESC}[2m${s}${ESC}[0m`,
  accent: (s: string) => `${ESC}[${ACCENT}m${s}${ESC}[0m`,
  accentBold: (s: string) => `${ESC}[1;${ACCENT}m${s}${ESC}[0m`,
  inverse: (s: string) => `${ESC}[7m${s}${ESC}[0m`,
  red: (s: string) => `${ESC}[31m${s}${ESC}[0m`,
  green: (s: string) => `${ESC}[32m${s}${ESC}[0m`,
  yellow: (s: string) => `${ESC}[33m${s}${ESC}[0m`,
};

export type Key =
  | { kind: "char"; char: string }
  | { kind: "up" | "down" | "left" | "right" | "enter" | "escape" | "backspace" | "tab" | "ctrl-c" };

export function decodeKeys(data: string): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]!;
    if (ch === ESC) {
      const seq = data.slice(i, i + 3);
      if (seq === `${ESC}[A`) { keys.push({ kind: "up" }); i += 2; continue; }
      if (seq === `${ESC}[B`) { keys.push({ kind: "down" }); i += 2; continue; }
      if (seq === `${ESC}[C`) { keys.push({ kind: "right" }); i += 2; continue; }
      if (seq === `${ESC}[D`) { keys.push({ kind: "left" }); i += 2; continue; }
      keys.push({ kind: "escape" });
      continue;
    }
    if (ch === "\r" || ch === "\n") { keys.push({ kind: "enter" }); continue; }
    if (ch === "\x7f" || ch === "\b") { keys.push({ kind: "backspace" }); continue; }
    if (ch === "\t") { keys.push({ kind: "tab" }); continue; }
    if (ch === "\x03") { keys.push({ kind: "ctrl-c" }); continue; }
    if (ch >= " ") keys.push({ kind: "char", char: ch });
  }
  return keys;
}

export class Terminal {
  private lastFrame = "";

  get size(): { rows: number; cols: number } {
    // Env override lets the web pty bridge control layout when SIGWINCH
    // cannot reach us through the `script` pty.
    const envRows = Number(process.env.ABTN_TUI_ROWS ?? "");
    const envCols = Number(process.env.ABTN_TUI_COLS ?? "");
    return {
      rows: envRows > 0 ? envRows : process.stdout.rows || 24,
      cols: envCols > 0 ? envCols : process.stdout.columns || 80,
    };
  }

  enter(): void {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[2J`);
  }

  exit(): void {
    process.stdout.write(`${ESC}[?25h${ESC}[?1049l${style.reset}`);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  }

  /** Repaint the full frame; skip if unchanged to avoid flicker. */
  render(lines: string[]): void {
    const { rows, cols } = this.size;
    const frame = lines
      .slice(0, rows)
      .map((line) => clipAnsi(line, cols))
      .join(`${ESC}[K\r\n`);
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    process.stdout.write(`${ESC}[H${frame}${ESC}[K${ESC}[0J`);
  }

  invalidate(): void {
    this.lastFrame = "";
  }
}

/** Clip a string to a visible width, preserving ANSI sequences. */
export function clipAnsi(text: string, width: number): string {
  let visible = 0;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ESC) {
      const end = text.indexOf("m", i);
      if (end === -1) break;
      out += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (visible >= width) continue;
    out += text[i];
    visible++;
  }
  return out + style.reset;
}

export function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function padVisible(text: string, width: number): string {
  const len = visibleLength(text);
  return len >= width ? text : text + " ".repeat(width - len);
}
