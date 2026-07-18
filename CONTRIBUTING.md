# Contributing

Thanks for your interest in Agent Button.

## Development

```bash
bun install
bun run daemon      # terminal 1 — the local control daemon
bun run web         # terminal 2 — web dashboard at http://127.0.0.1:4173
bun run tui         # or the terminal dashboard
```

## Before opening a PR

```bash
bun test            # all tests must pass
bunx tsc --noEmit   # typecheck must be clean
```

- Keep changes surgical and match the existing style.
- Record the reasoning behind non-obvious decisions in
  `docs/changelog/changelog-YYYY-MM-DD.md`.
- New agent integrations go behind the `AgentAdapter` interface
  (`packages/adapters`) — see `docs/adapter-contract.md`.
- New workflow step types extend the discriminated union in
  `packages/core/src/workflow-schema.ts` and get an executor in
  `packages/workflow-engine`.

## Architecture

Clients (TUI / web / CLI) are thin and talk to the daemon over a unix socket.
UI logic is kept separate from execution logic so surfaces can be added without
touching the workflow system. See [README](./README.md) and the `docs/` folder.

## Security

Never hardcode secrets. Secrets are referenced as `secret://...` and resolved
only at the integration boundary. If you find a vulnerability, please open a
private security advisory rather than a public issue.
