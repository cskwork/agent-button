import { statSync } from "node:fs";
import { dirname } from "node:path";
import { Glob } from "bun";
import { expandHome, type Artifact } from "@abtn/core";

/**
 * Collect artifacts matching the button's output globs, keeping only files
 * modified after the run started (evidence, not stale leftovers).
 */
export function collectArtifacts(patterns: string[], runStartedAt: string): Artifact[] {
  const startedMs = Date.parse(runStartedAt) - 5000; // small clock slack
  const artifacts: Artifact[] = [];

  for (const pattern of patterns) {
    const expanded = expandHome(pattern);
    // Split into a static base directory and a glob remainder.
    const firstGlob = expanded.search(/[*?[{]/);
    const base = firstGlob === -1 ? dirname(expanded) : dirname(expanded.slice(0, firstGlob) + "x");
    const rest = expanded.slice(base.length).replace(/^\//, "");

    try {
      const glob = new Glob(rest.length > 0 ? rest : "*");
      for (const rel of glob.scanSync({ cwd: base, absolute: true, onlyFiles: true })) {
        const stat = statSync(rel);
        if (stat.mtimeMs >= startedMs) {
          artifacts.push({ path: rel, bytes: stat.size, createdAt: new Date(stat.mtimeMs).toISOString() });
        }
      }
    } catch {
      // Missing directories simply yield no artifacts.
    }
  }

  // De-duplicate by path.
  const seen = new Set<string>();
  return artifacts.filter((a) => (seen.has(a.path) ? false : (seen.add(a.path), true)));
}

/** Reveal an artifact in the OS file manager (Finder on macOS, folder elsewhere). */
export function revealArtifact(path: string): void {
  const cmd = process.platform === "darwin" ? ["open", "-R", path] : ["xdg-open", dirname(path)];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

/** Check success.require_artifact globs against collected artifacts. */
export function missingRequiredArtifacts(required: string[], collected: Artifact[]): string[] {
  const missing: string[] = [];
  for (const pattern of required) {
    const glob = new Glob(pattern);
    const found = collected.some((a) => glob.match(a.path.split("/").pop() ?? a.path) || glob.match(a.path));
    if (!found) missing.push(pattern);
  }
  return missing;
}
