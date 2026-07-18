# Adapter contract

Adapters normalize orchestration, events, permissions, and outputs. They do NOT
normalize agent features: each agent keeps its native config (AGENTS.md /
CLAUDE.md), skills, MCP servers, plugins, and subscription auth.

```ts
interface AgentAdapter {
  readonly id: string;
  detect(): Promise<AgentInstallation>;
  authStatus(profile: string): Promise<AuthStatus>;
  capabilities(profile: string): Promise<AgentCapabilities>;
  start(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
}
```

Events: `run.started`, `message.delta`, `tool.started/completed`,
`approval.requested`, `artifact.created`, `usage.updated`,
`run.completed`, `run.failed` (see `packages/core/src/events.ts`).

## Built-in adapters

| Adapter | Integration | Notes |
| --- | --- | --- |
| claude-code | `claude -p --output-format stream-json --verbose` | full event mapping incl. tools/usage; never `--bare` (subscription profile required) |
| codex | `codex exec --json` | JSONL items mapped; app-server JSON-RPC is a later upgrade |
| opencode | `opencode run` (plain-CLI preset) | headless server + SDK is a later upgrade |
| pi | `pi --print` (plain-CLI preset) | flags configurable via `createAdapterRegistry({ plainCli })` if they differ locally |
| fake | in-process | tests, demos, dry runs |

`PlainCliAdapter` also serves as the generic CLI adapter: any binary with a
non-interactive text mode can be registered with an args template
(`{{prompt}}`, `{{model}}` placeholders).

## Structured results

When a workflow agent step declares `result_schema`, the adapter appends a
JSON-output instruction to the prompt and extracts the final JSON object from
the output (`extractJson`). A missing or unparseable object fails the step with
`VALIDATION_FAILED` — downstream steps never consume prose as data.

## Error mapping

Adapters must yield `run.failed` with a typed code: `AUTH_REQUIRED` (login
expired), `TIMEOUT`, `CANCELLED`, `AGENT_FAILED` (anything else). Cancellation
flows through the AbortSignal passed to `start`; the process runner kills the
child's whole process group.
