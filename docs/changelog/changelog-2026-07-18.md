# 2026-07-18 — Initial implementation (v0.1)

Built the MVP of the agent automation control plane from the product definition:
Bun/TypeScript monorepo with daemon, workflow engine, agent adapters, CLI,
terminal TUI, and web dashboard + web TUI.

## Decisions and rejected alternatives

**Hand-rolled ANSI TUI instead of OpenTUI.** The spec recommended
`@opentui/solid`. Chose a dependency-free ANSI layer (`apps/tui/src/term.ts`)
because it keeps the client thin, needs no native Zig core, and is fully
verifiable headlessly. UI logic is isolated behind the shared `@abtn/client`
API client, so swapping to OpenTUI (or shipping the same views in Tauri) does
not touch execution logic. Rejected: OpenTUI now (API surface risk without a
TTY to iterate against), Ink (React dependency for a 4-screen dashboard).

**Web TUI via python3 `pty.spawn`, not node-pty or macOS `script`.** The
"textual-web"-style bridge (xterm.js + WebSocket) needs a pty. macOS `script`
aborts with `tcgetattr ... not supported on socket` when spawned from Bun
(socketpair stdio); node-pty is a native build dependency. python3 ships with
macOS and its `pty.spawn` tolerates non-tty stdin. Terminal size is passed via
`ABTN_TUI_COLS/ROWS` env because SIGWINCH cannot reach through this bridge.

**Codex via `exec --json`, OpenCode/Pi via plain-CLI presets.** Full app-server
JSON-RPC (Codex) and headless-server SDK (OpenCode) integrations are upgrades
behind the same `AgentAdapter` interface; the structured/plain CLI modes were
verifiable today. Pi's non-interactive flags vary by version, so its preset is
overridable through `createAdapterRegistry({ plainCli })`.

**zod pinned to 3.23.8.** `^3.23.8` resolved to 3.25.76, whose dual v3/v4 type
packaging broke `z.infer` on the 7-member discriminated step union (TS2589 →
`any` discriminators → no narrowing). 3.23.8 restores clean inference. Also
export Jenkins step types from core instead of re-inferring across packages.

**Buttons as YAML files + SQLite for state.** Definitions are human-editable,
git-trackable files (`~/.agent-button/buttons/`); runs, events, and schedule
leases live in SQLite (WAL). Rejected: everything in SQLite (hurts
import/export and versioning), Redis/K8s (single-user local product).

**Cancellation semantics fix.** The engine reports step failures as results,
not exceptions, so the run manager must distinguish an abort-induced failure:
`abortReason` on the active-run entry decides `cancelled`/`TIMEOUT` before the
generic `failed` path. Daemon shutdown now cancels all active runs so no child
process trees (agents + their MCP servers) are orphaned.

**Scheduler correctness.** `next_run_at` persists per button; a tick must win a
SQLite `UPDATE ... WHERE lease_until IS NULL OR lease_until < now` lease before
starting a run — duplicate-fire protection across restarts and adjacent ticks.
RRULE was cut from v0.1 (cron only), documented in workflow-format.md.

## Non-developer UX pass (same day)

User feedback: "yaml is too developer level". Reworked the web dashboard so
YAML never appears in the default path:

- **Form-based automation builder** (`apps/web/public/builder.js`): name,
  plain-language instructions, "questions to ask before each run" rows
  (text/choice/number/yes-no, default, required), schedule pickers (daily /
  weekly day-chips / monthly / custom cron) that generate cron + browser
  timezone, timeout in minutes, pin + shortcut. Editing preserves advanced
  fields (permissions, outputs, success) the form does not surface.
- **Run-time question modal** replaces browser `prompt()` chains; enum inputs
  render as dropdowns, defaults prefilled. Buttons whose inputs all have
  defaults still run in one click.
- **Edit / Delete** on every card; duplicate-name guard on create.
- YAML moved behind an "Advanced" toggle backed by a new
  `GET /buttons/:id/raw` endpoint (returns the raw file). `POST /buttons`
  accepts JSON or YAML. Workflows open in the advanced editor for now — a
  step-by-step workflow builder is future work.
- Polling pauses while a form is open so re-renders never clobber typing.

Rejected: building the form UI in the TUI first (office users get the web/
Tauri surface; TUI stays developer-focused), and client-side YAML generation
(the daemon already validates and persists YAML server-side).

## Verified

- `bun test`: 36 tests pass (template security, cron/timezone, redaction,
  schemas vs shipped examples, process kill/timeout/output-cap, engine step
  semantics incl. approval reject and dry-run, daemon e2e over the unix socket:
  approvals, concurrency reject, cancel, restart-marks-interrupted).
- `bunx tsc --noEmit`: clean.
- Live smoke: daemon + CLI (`list/run/approve/logs/dry-run`), real
  `claude-code` run through the daemon (stream-json parsed, result "OK"),
  adapter detection (claude 2.1.214, codex 0.144.5, pi 0.80.3), web dashboard
  API proxy, web TUI WebSocket bridge rendering the live dashboard.

## Not in v0.1 (documented gaps)

OS-level filesystem/network sandbox enforcement, approval timeouts, RRULE
schedules, resume of interrupted runs, Jira ACLI deterministic step (weekly
report currently instructs the agent to call `acli` itself), marketplace/
cloud/multi-user (explicitly out of MVP scope).
