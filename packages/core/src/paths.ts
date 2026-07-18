import { homedir } from "node:os";
import { join } from "node:path";

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/** Daemon home: state, sockets, button definitions. Override for tests. */
export function abtnHome(): string {
  return process.env.AGENT_BUTTON_HOME ?? join(homedir(), ".agent-button");
}
