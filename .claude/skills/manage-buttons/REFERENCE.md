# Button reference

Source of truth: `packages/core/src/button-schema.ts` and
`packages/core/src/workflow-schema.ts` (zod). Re-check them if validation
disagrees with this file. `docs/workflow-format.md` documents semantics.

## Shared identity fields (both kinds)

| Field | Rule |
|-------|------|
| `version` | literal `1` |
| `kind` | `agent-button` or `workflow` |
| `id` | `^[a-z0-9][a-z0-9-]*$`, unique, becomes the filename |
| `label` | required, non-empty |
| `description` | optional string |
| `icon` | optional |
| `group` | default `Default`; groups the TUI/web list |
| `shortcut` | optional single digit `0-9`, unique across buttons |
| `pinned` | default `false` |

Shared sections (both kinds): `execution`, `trigger`, `outputs`, `success`.

```yaml
execution:
  timeout_seconds: 1800        # whole-run bound
  concurrency: reject          # reject | queue | replace | parallel
trigger:
  type: manual                 # manual | schedule
  cron: "0 16 * * 5"           # 5-field, required when type: schedule
  timezone: Asia/Seoul
  missed_run_policy: skip      # skip | run_once | catch_up
  overlap_policy: reject       # reject | queue | replace | parallel
outputs:
  collect: ["~/reports/*.docx"]   # globs collected after the run
success:
  require_artifact: ["*.docx"]    # missing → VALIDATION_FAILED
  require_agent_exit_code: 0
```

## kind: agent-button

```yaml
agent:
  adapter: claude-code         # claude-code | codex | opencode | pi | fake
  profile: default
  model: claude-sonnet-5       # optional
  inherit_native_config: true
workspace:
  cwd: "~/projects/foo"        # ~ expands
prompt:
  template: |
    Do X for {{topic}}.
inputs:                        # JSON-schema subset — note the wrapper
  type: object
  properties:
    topic:
      type: string             # string | number | boolean | enum
      values: [a, b]           # enum only
      default: a
      required: false
      description: shown in run forms
capabilities:
  mode: inherit                # inherit | overlay | isolated
  environment: { KEY: value }  # values may be secret:// refs
permissions:                   # declared, NOT OS-enforced in v0.1
  filesystem: { read: [], write: [] }
  network: { allow: [] }
  commands: { policy: agent-native }   # agent-native | deny
  external_side_effects: confirm       # allow | confirm | deny
```

## kind: workflow

Extra top-level fields: `risk` (`read-only | local-write | external-write |
high`, default `local-write`), flat `inputs`, and `steps` (min 1, run
strictly in order; first failure stops the run).

```yaml
risk: read-only
inputs:                        # flat map — no type/properties wrapper
  greeting: { type: string, default: hello }
steps:
  - id: build                  # every step: unique id + type; optional when:
    type: command
    executable: echo           # no shell — args is an array
    args: ["{{greeting}}"]
    cwd: "~"                   # optional
    env: { TOKEN: "secret://ci-token" }
    save_stdout_as: built
    timeout_seconds: 600
    assertions: { exit_code: 0, stdout_empty: false, stdout_matches: "ok" }
  - id: summarize
    type: agent
    adapter: fake
    prompt: "Summarize {{built}}"
    model: optional
    result_schema: { type: object }    # JSON Schema the agent must satisfy
    save_result_as: summary
  - id: gate
    type: approval             # pauses run as waiting_approval
    display:
      title: Ship it?
      fields: [built, summary] # scope paths shown to the approver
  - id: check
    type: assertion
    require:
      - "{{steps.build.status == 'succeeded'}}"
  - id: notify
    type: http
    method: POST               # GET | POST | PUT | PATCH | DELETE
    url: https://example.com/hook
    headers: { X-K: v }
    body: { msg: "{{summary}}" }       # any YAML value
    expect_status: [200, 201]          # array; default [200, 201, 204]
    save_response_as: resp
  - id: deploy
    type: jenkins              # POST buildWithParameters, saves build_id/build_url
    base_url: https://jenkins.example.com
    job: deploy
    parameters: { ENV: qa }
    credential: "secret://jenkins-cred"   # user:token
  - id: wait
    type: jenkins-wait         # polls until the build finishes; non-SUCCESS fails
    base_url: https://jenkins.example.com
    build: "{{steps.deploy.build_url}}"
    credential: "secret://jenkins-cred"
    poll_seconds: 15           # timeout_seconds default 1800
```

Template scope for `{{ ... }}`: inputs (top level), variables saved via
`save_stdout_as` / `save_result_as` / `save_response_as` (top level), and
`steps.<id>.*` (`stdout`, `exit_code`, `status`, `result`, `build_url`, ...).
Only path lookup and comparisons (`== != > >= < <=`); no arithmetic or calls.
Any step accepts `when: "{{expr}}"` — false skips it.

## Daemon API (unix socket `$AGENT_BUTTON_HOME/daemon.sock`)

| Method and path | Effect |
|-----------------|--------|
| `GET /health` | `{ ok, activeRuns, pid }` |
| `GET /buttons` | all buttons + schedules + `loadErrors` |
| `POST /buttons` | body = raw YAML or JSON; validate, upsert by id, sync schedules; 201 |
| `GET /buttons/<id>` | parsed definition |
| `GET /buttons/<id>/raw` | raw YAML text |
| `DELETE /buttons/<id>` | delete file + unschedule |
| `GET /adapters` | install/auth status per adapter |
| `POST /runs` | `{ buttonId, inputs, dryRun }` |

Errors return `{ error: { code, message, details } }`; validation issues
list `path: message` per field.

## Common validation failures

- `id: id must be kebab-case` — no uppercase, underscores, or leading dash.
- `kind: Invalid discriminator value` — typo in `kind`, or workflow fields
  (e.g. `steps`) under `kind: agent-button`.
- `inputs.properties: Required`-style errors on a workflow — you used the
  agent-button inputs shape (or vice versa).
- `steps: Array must contain at least 1 element(s)` — empty workflow.
- Duplicate id reported in `loadErrors`, not at POST time, when two files
  declare the same id.
