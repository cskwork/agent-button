# Agent Button

Local-first agent automation control plane. The product owns buttons, workflows,
schedules, approvals, run history, and artifacts; the agents (Claude Code, Codex,
OpenCode, Pi) own tool selection, native config, and judgment. One click to start;
explicit evidence before declaring success; explicit approval before consequential
side effects.

## Quick start

```bash
bun install
bun run daemon      # local control daemon (unix socket, SQLite, scheduler)
bun run tui         # terminal dashboard
bun run web         # web dashboard + web TUI at http://127.0.0.1:4173
bun run cli list    # CLI: abtn list / run / logs / cancel / approve ...
```

First boot seeds example buttons from `examples/` into `~/.agent-button/buttons/`.
Buttons are versioned YAML files under the hood — but non-developers never need
to see them: the web dashboard has a form-based builder ("+ New automation":
name, instructions, questions, schedule pickers) plus Edit/Delete on every
card. YAML lives behind an "Advanced" toggle for developers.

## Architecture

```
TUI · Web · CLI · (Tauri later)      thin clients
        │  unix socket HTTP + SSE
Local Control Daemon                 button registry · run queue · workflow engine
        │                            scheduler (SQLite lease) · approvals · secrets
Isolated Runner                      deterministic steps (command/http/jenkins)
                                     agent adapters (claude-code/codex/opencode/pi)
```

- `packages/core` — schemas (zod), events, errors, restricted templating, cron
- `packages/process-runner` — `shell:false` spawn, process-group kill, timeouts
- `packages/adapters` — normalized `AgentAdapter` over each agent's native CLI
- `packages/workflow-engine` — command / agent / approval / assertion / http / jenkins steps
- `packages/client` — typed daemon API client (shared by CLI, TUI, web, Tauri)
- `apps/daemon` — API, SQLite persistence, run manager, scheduler, secret broker
- `apps/tui` — dependency-free ANSI dashboard
- `apps/web` — web dashboard + xterm.js web TUI (pty bridge)
- `apps/cli` — `abtn` command

## Button kinds

**agent-button** — one principal agent prompt with inputs, permissions, timeout,
artifact collection, and success criteria (`success.require_artifact`).

**workflow** — deterministic steps mixed with agent steps, approvals, and
assertions. Production-consequence actions (merge, deploy) are deterministic
steps behind approvals; agents never decide whether to deploy.

See `examples/` and `docs/workflow-format.md`.

## Verify

```bash
bun test            # 36 tests: core, runner, engine, daemon e2e
bunx tsc --noEmit   # typecheck
```
