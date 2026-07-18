# Security model

## Risk levels

| Level | Examples | Default |
| --- | --- | --- |
| Read-only | research, summarize | run immediately |
| Local write | generate files, branches | runs; artifacts audited |
| External write | Jira update, publish | `external_side_effects: confirm` |
| Destructive / production | merge, deploy | approval step after preflight |

## Mandatory controls (implemented)

**No raw shell interpolation.** Every process spawn uses executable + argument
arrays with `shell: false` (`packages/process-runner`). Template substitution
happens per-argument, never by building a shell string.

**Restricted templating.** `{{ ... }}` supports only path lookup and simple
comparisons (`packages/core/src/template.ts`). No function calls, no eval.
Unknown variables throw `VALIDATION_FAILED` instead of emitting blanks.

**Secret references, not values.** `secret://keychain/<service>/<account>` and
`secret://env/<NAME>` resolve at the integration boundary (Jenkins auth header,
step env) via the macOS keychain (`apps/daemon/src/secrets.ts`). Resolved values
are registered with a redactor; every persisted or streamed event passes through
`redactDeep` first. Secrets never enter prompts or SQLite.

**Process isolation.** Each run gets its own child-process group (`detached`),
explicit cwd, timeouts, and output caps. Cancellation SIGTERMs the group and
escalates to SIGKILL, so agent-spawned MCP subprocesses die too. Daemon shutdown
cancels all active runs.

**Approval after preflight.** Approval steps display resolved facts (pinned SHA,
test summary) from earlier deterministic steps, not intentions. A rejected or
daemon-restarted approval fails the run (`APPROVAL_REJECTED` / `interrupted`).

**Success requires evidence.** `success.require_artifact` globs must match files
modified during the run; workflow assertions check Jenkins results and agent
report fields. An agent saying "done" is never sufficient.

## Subscription authentication

Adapters launch official agent binaries under the current OS user with their
native authenticated profiles (Claude subscription login, keychain). The daemon
stores only binary paths and profile identifiers — never OAuth tokens. Failed
logins surface as `AUTH_REQUIRED`, not generic failures.

## Known gaps (v0.1)

- `permissions.filesystem/network` are declared and shown but not yet enforced
  by an OS sandbox; enforcement is the agent's native permission system.
- Approval steps have no timeout enforcement (daemon restart interrupts them).
- Web dashboard binds to 127.0.0.1 with no auth; do not port-forward it.
