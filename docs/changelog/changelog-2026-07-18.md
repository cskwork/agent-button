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

---

## Web UI: larger type, EN/KO i18n, light/dark glassmorphism

Reworked the web surface (`apps/web/public/`) per user request: bigger overall
text, English default with a Korean toggle, and a light-default glassmorphism
theme with a dark switch.

**Shared token + prefs layer, not per-page duplication.** Added `theme.css`
(design tokens: light default + dark under `[data-theme="dark"]`) and `ui.js`
(theme + language prefs, `t()` translator, static `[data-i18n]` application,
toggle controls). Both `index.html` and `term.html` link them, so the two
pages stay in sync and prefs (localStorage `ab-theme` / `ab-lang`) persist
across them. Rejected: inlining tokens/strings in each page (drift), a build
step or i18n library (this app ships static files with no bundler — a ~60-line
plain-JS dictionary is lighter and matches the existing no-dependency style).

**Font sizes bumped directly, not via a root rem refactor.** The existing CSS
uses absolute px inside `font:` shorthands; converting everything to rem would
be a large, error-prone diff. Bumped base 14→16px and scaled the rest
proportionally. xterm terminal 14→16px.

**Glassmorphism via translucent panels + backdrop-filter.** Light default uses
a soft pastel gradient with blurred colour blobs behind frosted panels
(`rgba` bg + `backdrop-filter: blur`). The web TUI terminal runs
`allowTransparency: true` with a transparent xterm background so the frosted
panel shows through; foreground colour follows the active theme. A pre-paint
inline script sets `data-theme` from localStorage to avoid a flash.

**No emojis in toggles** (repo rule): theme toggle shows the target mode word
("Dark"/"Light", translated); language toggle shows the other language's native
name ("한국어"/"English").

**Korean font stack.** Added "Apple SD Gothic Neo", "Malgun Gothic",
"Noto Sans KR" to the sans stacks so Korean renders cleanly cross-platform.

**Language switch re-renders dynamic content.** `ui.js` retranslates static
markup and calls `window.onLangChange`; the dashboard hook re-runs `refresh()`
and re-renders an open builder form. The web TUI hook re-renders its status
line.

**Deliberate boundary:** the run-detail event log (`formatEvent` in `app.js`)
is left English. It interleaves raw agent output (untranslatable) with technical
markers (step IDs, error codes), so translating it is low value; easy to extend
later if wanted.

Verified: `node --check` on all three JS files; static server serves
`/theme.css` `/ui.js` and both pages with 200 + correct content-types; a
DOM-stub smoke test confirmed default EN/light, `t()` EN/KO with `{param}`
substitution, missing-key fallback, and localStorage persistence on toggle.
No browser driver installed, so no headless render test was run.

---

## Fix: opaque "Premature close" on a missing working folder

**Symptom.** Running the "Write Blog" button (codex adapter, `cwd:
~/Documents/blog`) failed with `Run failed: Premature close`.

**Root cause.** `~/Documents/blog` did not exist. `spawn` reports a missing
`cwd` via an async `error` event (ENOENT) that tears down the child's stdout.
In `streamProcess`, the `error` event was swallowed (`exitPromise` resolved
null) and the `for await` over the destroyed stdout stream threw Node's
`ERR_STREAM_PREMATURE_CLOSE` ("Premature close"), which propagated up as the
run's failure message — accurate to Node, useless to a user.

**Fix (packages/process-runner/src/index.ts).**
- `assertCwd()` validates the working folder exists and is a directory before
  spawn, in both `runProcess` and `streamProcess`, throwing a `STEP_FAILED`
  with an actionable message ("Working folder does not exist: <path>. Create
  it, or change the automation's working folder.").
- `streamProcess` now captures the child `error` event and wraps the stdout
  `for await` so any other premature close (missing binary, EACCES) surfaces
  the real cause plus captured stderr, instead of "Premature close".
  Cancellation/timeout still fall through to `wasCancelled()`/`wasTimedOut()`.

Rejected: silently creating the folder inside the runner (a run should not
invent filesystem state the user didn't ask for — fail clearly instead).

Also created `~/Documents/blog` so the existing button runs, and restart of the
daemon (`bun run daemon`) picks up the clearer error path.

Tests: added two regression cases (streamProcess + runProcess with a missing
cwd assert the clear message and the absence of "Premature close"). Full suite
38 pass, `tsc --noEmit` clean.

---

## Fix: codex adapter exits 1 outside a git repo

**Symptom.** After the working folder existed, "Write Blog" (codex adapter)
failed: `codex exited 1: ... Not inside a trusted directory and
--skip-git-repo-check was not specified.`

**Root cause.** `codex exec` refuses to run outside a trusted (git) directory
unless `--skip-git-repo-check` is passed. Automations target arbitrary user
folders (`~/Documents/blog`), most not git repos, so the adapter's `codex exec
--json` invocation was rejected before reaching the model.

**Fix (packages/adapters/src/codex.ts).** Added `--skip-git-repo-check` to the
`codex exec` args. Sandbox and network policy are deliberately NOT forced by the
adapter — they come from the user's `~/.codex/config.toml` (here already
`sandbox_mode = "workspace-write"` with `network_access = true`), so a user's
read-only choice is respected rather than overridden.

**QA (real runs, ChatGPT-authed codex).**
1. `codex exec --json --skip-git-repo-check -s workspace-write -C ~/Documents/blog`
   with a trivial write prompt → `turn.completed`, file created.
2. Same without explicit `-s` (mirrors the adapter, relying on config default)
   → `turn.completed`, file created — confirming `--skip-git-repo-check` alone
   is sufficient given the user's config.
3. End-to-end through the actual `CodexAdapter.start()` (the changed code) in
   `~/Documents/blog` → emitted `tool.completed(file_change)` then
   `run.completed`, `failed: null`. File written and verified.

Full suite 38 pass, `tsc --noEmit` clean.

Note: the running daemon must be restarted (`bun run daemon`) to load the updated
adapter before the button succeeds in the app.

---

## Feature: show the model and reasoning effort a run actually used

Per user request: display-only — no editing UI. The run detail (web + TUI) now
shows e.g. `codex · gpt-5.6-sol · reasoning: high`.

**Where the values come from (honesty rule: show only known values, never
guess; unknown fields are simply absent).**
- A model declared on the button wins.
- Otherwise the agent CLI's own config is read at run start:
  codex → `~/.codex/config.toml` top-level `model` / `model_reasoning_effort`;
  claude-code → `~/.claude/settings.json` `model` / `effortLevel`.
- For claude-code, the stream-json `system/init` event reports the model
  actually serving the run; the adapter emits it as a new `agent.info` event
  and the daemon merges it over the config snapshot (ground truth wins).
  codex's exec --json stream carries no model info (verified empirically), so
  its config value is the best available truth.

**Changes.**
- core: `RunRecord.agent?: RunAgentInfo { adapter, model?, reasoning? }`;
  new `AgentEvent` variant `agent.info`.
- daemon: `agent-info.ts` resolver (top-level TOML parse only — table keys are
  deliberately ignored); additive `agent TEXT` column migration on `runs`;
  run-manager snapshots at record creation and merges `agent.info` in emit.
  Workflow runs get no agent field (no single agent to attribute).
- adapters/claude-code: emit `agent.info` from the init message.
- web `app.js` + TUI `run-view.ts`: one dim line under the run id; i18n key
  `reasoning` (ko: 추론).

Rejected: adding a `reasoning` field to the button schema (user chose
display-only); parsing codex profiles/`--profile` overlays (top-level keys only,
keep the parser trivial — a declared button model still wins).

**Verified.** `tsc --noEmit` clean; 42 tests pass (4 new resolver tests: codex
toml top-level only, claude settings, button override, missing-config →
undefined). Live QA against a throwaway daemon: codex dry-run snapshot
`{adapter codex, model gpt-5.6-sol, reasoning high}` (real config values);
real claude-code run succeeded with `{model claude-fable-5[1m], reasoning
high}`; the real claude init event was probed directly and carries
`model: claude-fable-5[1m]`, matching the adapter's parse condition.

## manage-buttons repo skill

**What.** New repo-local Claude Code skill `.claude/skills/manage-buttons/`
(SKILL.md + REFERENCE.md) so an agent can add / edit / remove / validate /
test buttons without rediscovering the system each session.

**Decisions.**
- CRUD goes through the daemon unix-socket API (`POST/DELETE /buttons`), not
  direct file edits: the registry only reloads at boot and on API save/delete,
  so on-disk edits are silently ignored while the daemon runs. Direct file
  editing is documented only for the daemon-stopped case.
- Split per skill best practice: SKILL.md (88 lines) holds the procedure and
  gotchas; REFERENCE.md holds both schemas, all seven step types, template
  scope, API table, and common validation errors — loaded only when needed.
- Edit flow is `GET /buttons/<id>/raw` → modify → POST (upsert by id), to
  start from deployed state and avoid orphaning files on id changes.

Rejected: adding `abtn add/edit/rm` CLI commands (out of scope — the API and
YAML files already cover it; the skill documents the existing surface);
putting the full schema inline in SKILL.md (blows the ~100-line budget).

**Verified.** Live round trip against the running daemon: POST test button
(201, validated), `abtn list` shows it, dry-run prints resolved prompt, real
fake-adapter run succeeded, raw-GET → label edit → re-POST upserted, DELETE
removed the YAML file. Reference field names cross-checked against
button-schema.ts / workflow-schema.ts (fixed jenkins `base_url`/`job`/`build`
and `expect_status` array after the check).
