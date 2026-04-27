# Development

How to work on this project day-to-day.

## Daily workflow

```bash
# Start everything (frontend + agent + mcp-http)
docker compose up
# OR without Docker:
npm run dev
```

Edit code, save, see changes:

- **Frontend changes** — Next.js hot-reloads in the browser
- **Agent Python changes** — `uvicorn --reload` restarts on save (local mode);
  in Docker you'd need to restart the `agent` service or run locally instead
- **Skill or MCP config changes** — restart the agent

## Linting + typechecking

Both must pass before commit. CI enforces them on PRs.

```bash
# Frontend
npm run lint           # ESLint with next/core-web-vitals + next/typescript
npm run typecheck      # tsc --noEmit (strict mode)

# Agent
cd agent
uv run ruff check      # ruff (configured in pyproject.toml)
uv run mypy agent/     # mypy strict
```

Run all four in one go:

```bash
npm run lint && npm run typecheck && \
  cd agent && uv run ruff check && uv run mypy agent/
```

## Commit conventions

The repo uses informal commit messages (no enforced format). Look at
`git log --oneline` for the style. Phase commits look like:

```
Phase N: <one-line summary>

<body explaining what changed in each layer>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Smaller commits are fine — see `git log` for examples.

## Adding a frontend dependency

```bash
npm install <package>
```

Lockfile (`package-lock.json`) is committed.

## Adding a Python dependency

```bash
cd agent
uv add <package>            # runtime dep
uv add --dev <package>      # dev dep (linters, types)
```

`pyproject.toml` and `uv.lock` are both committed.

## Adding a shadcn/ui component

```bash
npx shadcn@latest add <component>
```

Components land in `components/ui/<name>.tsx` and are **owned code** —
you can edit them freely.

## File organization

| Where | What goes there |
|-------|-----------------|
| `app/(app)/chat/_components/` | Chat-specific components |
| `app/(app)/chat/_components/widgets/` | One file per widget type |
| `components/ui/` | shadcn-generated, reusable primitives |
| `components/app/` | (empty for now) custom non-chat components |
| `lib/` | Hooks, reducers, types, utilities |
| `agent/agent/` | Python package |
| `agent/agent/tools/` | LangGraph tool implementations |
| `agent/skills/` | SKILL.md files |
| `docs/` | This documentation |

## Testing

Currently no automated tests beyond lint/typecheck. The `agent/.venv`
has `pytest` installed; tests would go in `agent/tests/`. Frontend
tests aren't configured yet — Phase 6 polish stopped before adding
them.

For now, manual testing flow is:

1. Lint/typecheck both layers
2. `docker compose up` (or `npm run dev`)
3. Hit a few prompts in the browser
4. Watch agent logs for errors

## Type checking the AG-UI bridge

The frontend's `useAgent` hook uses `@ag-ui/client`. The subscriber
callbacks have specific names (note the `Event` suffix):

```ts
await agent.runAgent({}, {
  onTextMessageStartEvent: ({ event }) => ...,
  onTextMessageContentEvent: ({ event }) => ...,
  onTextMessageEndEvent: ({ event }) => ...,
  onCustomEvent: ({ event }) => ...,
  onRunStartedEvent: ({ event }) => ...,
  onRunFinishedEvent: ({ event }) => ...,
});
```

The full subscriber interface is in `node_modules/@ag-ui/client/dist/index.d.ts`.

## Type checking the Pydantic / TS boundary

Widget types are defined in two places:

1. `agent/agent/widgets.py` — Pydantic (source of truth)
2. `lib/widgets.ts` — TypeScript (hand mirror)

If they drift, runtime errors happen on either side. There's no
automated check yet — be careful in PRs that touch widgets.

Future improvement (deferred): use `datamodel-code-generator` or
`pydantic-to-typescript` to generate one from the other.

## Debugging

### Frontend

- Browser DevTools → Network → look at the `/api/agent/run` SSE response
- Console logs from `useAgent` are visible in DevTools
- React DevTools shows the reducer state (`AgentState`)

### Agent

Watch structured logs:

```bash
docker compose logs -f agent
# or local:
# the agent prints colored structlog output to stderr
```

Each log line includes context like `thread_id`, `run_id`, tool calls.
For deeper LangGraph debugging, set `LANGCHAIN_TRACING_V2=true` and
`LANGCHAIN_API_KEY=...` to send traces to LangSmith. (Not configured
by default.)

### MCP

If a server fails to load, check the agent startup logs for
`Failed to load MCP server  server=<name>`. The traceback shows whether
it's a connection error, auth error, or tool registration error.

## CI

`.github/workflows/ci.yml` runs:

```yaml
- npm ci
- npm run lint
- npm run typecheck
- uv sync --dev
- uv run ruff check
- uv run mypy agent/
```

Both Node 22 and Python 3.12 are pinned.

## Updating the docs

This folder. `docs/README.md` is the index — keep it in sync when you
add a new file. The PROGRESS.md at the root tracks phase completion;
update it after each phase.

## Branching / PRs

The repo's main branch is `main`. Open PRs there. There's no enforced
branching strategy yet, but:

- Branch from `main`
- Keep PRs small and focused
- Make sure CI passes
- One commit per logical change is preferred over a single squash

---

[← Back to docs index](./README.md) · [← Previous: Configuration](./configuration.md) · [Next: Deployment →](./deployment.md)
