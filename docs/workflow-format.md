# Workflow format

A button is a versioned YAML file in `~/.agent-button/buttons/` validated by
`ButtonDefinitionSchema` (`packages/core`). Two kinds: `agent-button` (one
prompt) and `workflow` (deterministic + agent steps). See `examples/`.

## Template scope

`{{ ... }}` resolves against: inputs (top level), variables saved by
`save_stdout_as` / `save_result_as` (top level), and `steps.<id>.*`
(stdout, exit_code, status, result, build_url, ...). Only path lookup and
comparisons (`== != > >= < <=`) are allowed.

## Step types

- `command` — `executable` + `args` array (no shell). Options: `cwd`, `env`
  (values may be `secret://` refs), `save_stdout_as`, `timeout_seconds`,
  `assertions: { stdout_empty, exit_code, stdout_matches }`.
- `agent` — `adapter`, `prompt`, optional `model`, `cwd`, `result_schema`
  (JSON Schema the agent must satisfy), `save_result_as`.
- `approval` — pauses the run (`waiting_approval`); `display.fields` lists
  scope paths shown to the human. Decide via TUI, web, or `abtn approve`.
- `assertion` — `require:` list of expressions; any false one fails the run
  with `ASSERTION_FAILED`.
- `http` — method/url/headers/body, `expect_status`, `save_response_as`.
- `jenkins` — POST `buildWithParameters`, resolves the queue item, saves
  `build_id` / `build_url`. `credential` is a `secret://` ref of `user:token`.
- `jenkins-wait` — polls the saved `build_url` until the build finishes;
  non-SUCCESS results fail the step.

Any step accepts `when:` (expression) — false skips the step.

## Execution semantics

- Steps run strictly in order; the first failure stops the workflow.
- `execution.timeout_seconds` bounds the whole run; each step has its own.
- `execution.concurrency`: `reject` (default) / `queue` / `replace` / `parallel`.
- Dry run compiles and prints every step's resolved plan without executing.

## Scheduling

```yaml
trigger:
  type: schedule
  cron: "0 16 * * 5"        # 5-field cron
  timezone: Asia/Seoul
  missed_run_policy: skip    # skip | run_once | catch_up
  overlap_policy: reject     # reject | queue | replace | parallel
```

`next_run_at` persists in SQLite; a run starts only after winning an atomic
lease, so restarts and overlapping ticks cannot double-fire. RFC 5545 RRULE
support is not yet implemented (cron only).

## Success criteria

```yaml
outputs:
  collect: ["~/Documents/Weekly Reports/*.docx"]
success:
  require_artifact: ["*.docx"]
  require_agent_exit_code: 0
```

Artifacts are collected after the run (only files modified during the run) and
missing required artifacts fail the run with `VALIDATION_FAILED`.
