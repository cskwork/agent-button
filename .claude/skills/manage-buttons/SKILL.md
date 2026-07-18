---
name: manage-buttons
description: Add, edit, remove, validate, and test agent-button automation buttons (agent-button and workflow YAML definitions) through the daemon API or the buttons directory. Use when the user asks to create, change, delete, schedule, or debug a button, workflow, or automation in this repo, or when a button fails to load or validate.
---

# Manage automation buttons

A button is one YAML file, `<id>.yaml`, in `$AGENT_BUTTON_HOME/buttons/`
(default `~/.agent-button/buttons/`). Two kinds: `agent-button` (single
prompt) and `workflow` (ordered steps). Full field reference, step types,
and API details: [REFERENCE.md](REFERENCE.md). Working samples: `examples/`.

## Critical rule: go through the daemon API

The daemon reads the buttons directory only at boot and after an API
save/delete. Editing a YAML file on disk while the daemon runs is silently
ignored. Therefore:

- Daemon running (`bun run cli health` succeeds) — always use the API below.
- Daemon stopped — editing files directly is fine; they load at next boot.

API base: unix socket `~/.agent-button/daemon.sock` (host name is arbitrary):

```bash
SOCK=~/.agent-button/daemon.sock
curl -s --unix-socket $SOCK http://d/buttons                  # list + loadErrors
curl -s --unix-socket $SOCK http://d/buttons/<id>             # parsed JSON
curl -s --unix-socket $SOCK http://d/buttons/<id>/raw         # raw YAML
curl -s --unix-socket $SOCK -X POST --data-binary @b.yaml http://d/buttons   # create/update
curl -s --unix-socket $SOCK -X DELETE http://d/buttons/<id>   # delete
```

POST accepts raw YAML or JSON, validates against `ButtonDefinitionSchema`
(`packages/core/src/button-schema.ts`, `workflow-schema.ts`), upserts by
`id`, and re-syncs schedules. On validation failure it returns
`VALIDATION_FAILED` with per-field issues — fix and re-POST.

## Add a button

1. Pick the kind: one prompt to one agent → `agent-button`; deterministic
   commands, approvals, HTTP/Jenkins, or multiple agents → `workflow`.
2. Copy the closest file in `examples/` (`hello-world.yaml` for
   agent-button, `demo-workflow.yaml` or `deploy-qa.yaml` for workflow).
3. Set identity: kebab-case `id` (unique — check the list first), `label`,
   `group`, optional single-digit `shortcut` (must not collide), `pinned`.
4. Write the body. Use the `fake` adapter while testing; check real adapter
   auth with `bun run cli adapters` before shipping `claude-code`/`codex`.
5. POST it, then verify (below).

## Edit a button

1. `GET /buttons/<id>/raw` — start from what is deployed, not from memory.
2. Modify, keeping `id` unchanged. Changing `id` creates a new file and
   orphans the old one — if a rename is intended, POST the new id then
   DELETE the old id.
3. POST back and verify.

## Remove a button

Destructive — confirm with the user unless they named the exact button.
`DELETE /buttons/<id>` removes the YAML file and unschedules it. To let the
user keep a copy, fetch `/raw` first.

## Verify (always, after any change)

```bash
bun run cli list                       # button appears; stderr shows load errors
bun run cli run <id> --dry-run         # compiles and prints the resolved plan
bun run cli run <id> --input k=v       # real run, streams events, exit 0 = success
```

For scheduled buttons also confirm `next: ...` appears in `list` output.
Follow a running/finished run with `bun run cli runs` and
`bun run cli logs <run-id>`; `approval` steps pause the run until
`bun run cli approve <approval-id>`.

## Gotchas

- `version: 1` and `kind` are required literals; `id` must be kebab-case.
- The two kinds declare `inputs` differently (agent-button: JSON-schema
  subset under `properties`; workflow: flat map). See REFERENCE.md.
- `command` steps take `executable` + `args` array — there is no shell, so
  no pipes, globs, or `&&`. Wrap shell-isms as `executable: sh, args: [-c, ...]`
  only when unavoidable, and prefer explicit args.
- Secrets: never inline; use `secret://` refs in `env` / `credential`.
- Duplicate `id` across files is a load error: the daemon keeps the first
  file (sorted) and reports the rest in `loadErrors`.
- Cron is 5-field, no RRULE. Set `timezone` explicitly (e.g. `Asia/Seoul`).
