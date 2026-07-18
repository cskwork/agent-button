import { existsSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { abtnHome } from "@abtn/core";
import { createAdapterRegistry } from "@abtn/adapters";
import { DaemonDb } from "./db.ts";
import { ButtonRegistry } from "./registry.ts";
import { ApprovalRegistry } from "./approvals.ts";
import { SecretBroker } from "./secrets.ts";
import { RunManager } from "./run-manager.ts";
import { Scheduler } from "./scheduler.ts";
import { createApiHandler } from "./api.ts";

export interface DaemonHandle {
  socketPath: string;
  stop: () => void;
}

export function startDaemon(home = abtnHome()): DaemonHandle {
  mkdirSync(home, { recursive: true });
  const socketPath = join(home, "daemon.sock");
  if (existsSync(socketPath)) rmSync(socketPath); // stale socket from a dead daemon

  const db = new DaemonDb(home);
  const interrupted = db.markInterrupted();

  const registry = new ButtonRegistry(home);
  seedExamplesIfEmpty(registry.buttonsDir);
  registry.load();

  const approvals = new ApprovalRegistry();
  const secrets = new SecretBroker();
  const adapters = createAdapterRegistry();
  const runs = new RunManager(db, registry, approvals, secrets, adapters);
  const scheduler = new Scheduler(db, registry, runs);
  scheduler.start();

  const server = Bun.serve({
    unix: socketPath,
    fetch: createApiHandler({ db, registry, runs, approvals, scheduler, adapters }),
  });

  console.log(`[daemon] listening on ${socketPath}`);
  console.log(`[daemon] buttons dir: ${registry.buttonsDir} (${registry.list().length} loaded)`);
  for (const err of registry.loadErrors()) {
    console.error(`[daemon] button load error in ${err.file}: ${err.message}`);
  }
  if (interrupted > 0) console.log(`[daemon] marked ${interrupted} stale run(s) as interrupted`);

  return {
    socketPath,
    stop: () => {
      scheduler.stop();
      runs.cancelAllActive();
      server.stop(true);
      if (existsSync(socketPath)) rmSync(socketPath);
    },
  };
}

/** First boot: copy example buttons so the dashboard isn't empty. */
function seedExamplesIfEmpty(buttonsDir: string): void {
  const existing = readdirSync(buttonsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (existing.length > 0) return;
  const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../examples");
  if (!existsSync(examplesDir)) return;
  for (const file of readdirSync(examplesDir)) {
    if (file.endsWith(".yaml")) cpSync(join(examplesDir, file), join(buttonsDir, file));
  }
}

if (import.meta.main) {
  const handle = startDaemon();
  const shutdown = () => {
    console.log("[daemon] shutting down");
    handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
