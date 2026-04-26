# AgentHub Starter — Build Plan

## Project goal

Build a starter agentic application that demonstrates the AG-UI protocol, AgentHub's eventual UI patterns (chat + canvas with declarative widgets), and a multi-tenant LangGraph backend running on AWS Bedrock. The deliverable is a runnable single-project repo that becomes the foundation for AgentHub's production UI.

The reference use case is a CloudWatch Logs Insights query agent with human-in-the-loop approval. The user asks a natural-language question; the agent proposes a Logs Insights query in a canvas widget; the user reviews/edits/approves; the agent executes the query via async polling; results stream into a table widget. Six widget types prove out the canvas pattern.

## Architecture overview

Layout B: chat column (left, ~30%) + canvas (right, ~70%). Widgets are first-class entities with their own lifecycle, declaratively emitted by the agent.

### Stack

- **Frontend:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui, @ag-ui/client
- **Backend:** Python 3.12, FastAPI, LangGraph with in-memory MemorySaver checkpointer (Postgres deferred), AG-UI Python SDK, AWS Bedrock for models (Claude Sonnet for the agent, Claude Haiku for cheap classification)
- **Package management:** npm for frontend, uv for Python
- **Tooling:** Ruff + mypy (Python), ESLint + Prettier (TS)

### Project layout

A single repo with the Next.js app at the root and the Python agent in an `agent/` subdirectory. No workspaces, no Turborepo, no shared package — TypeScript types for widgets are duplicated by hand from the Pydantic source of truth.

### Data flow

```
User → Next.js Client Component → Route Handler (JWT verify, tenant scope)
     → FastAPI agent endpoint → LangGraph run
     → AG-UI events on SSE → Route Handler proxy → @ag-ui/client → useAgent hook
     → Reducer → React rendering (chat transcript + canvas widgets)
```

User actions on widgets POST to a separate Route Handler that resumes the LangGraph thread via `interrupt()` response.

## Bedrock configuration

Use cross-region inference profiles, not raw model IDs:

- **Agent reasoning:** `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
- **Cheap classification:** `us.anthropic.claude-haiku-4-5-20251001-v1:0`

Auth via environment variables only — no SDK config files, no credential helpers.

LLM client uses `langchain-aws` (`ChatBedrockConverse`) for streaming, tool calling, and Converse API uniformity.

## Checkpointing — start in-memory

Use `langgraph.checkpoint.memory.MemorySaver` for the starter. Threads live in the agent process's memory only. Restarting the agent loses all in-flight conversations. HITL interrupts work, but only within a single agent process lifetime.

Phase 7 swaps to `PostgresSaver` — it's a ~30-line change because LangGraph's checkpointer interface is uniform.

## Multi-tenancy model (starter scope)

Stub two tenants, hardcoded:

- **tenant-a:** AssumeRole into `arn:aws:iam::<dev-account>:role/agui-starter-tenant-a-role`
- **tenant-b:** similar for tenant-b

JWT carries `tenant_id`. Agent's CloudWatch boto3 client is constructed per-thread by assuming the tenant's role, with a 15-minute session cached in memory by `(tenant_id, thread_id)`.

## Widget schema (the contract)

Six declarative widget types, all sharing a common base. Pydantic in `agent/agent/widgets.py` is the source of truth. TypeScript types in `lib/widgets.ts` mirror it by hand.

### Widget types

| Type | Description | Actions |
|------|-------------|---------|
| `query_plan` | Editable Logs Insights query + log groups + time range | approve / reject |
| `results_table` | Columns + streaming rows | display-only |
| `timeseries_chart` | Series of timestamped values | display-only |
| `log_tail` | Ring-buffered log lines with severity coloring | display-only |
| `summary_card` | Key/value items with optional trend indicators | display-only |
| `confirmation` | Yes/no prompt with optional rejection reason | confirm / reject |

### Common base

`id` (ULID), `type`, `placement` ("canvas" or "inline"), `status` (draft | submitted | running | complete | error | cancelled), `title`, `created_at`, `created_by_run`.

### Widget event protocol

Three custom AG-UI events on the standard event stream:

- `widget_create` — full widget payload
- `widget_update` — JSON Patch (RFC 6902) against the widget
- `widget_remove` — by widget id

User actions flow back via `/api/agent/widget-action` POSTing `{ thread_id, widget_id, action, payload }`.

## Repo layout

```
agui-starter/
  app/                              # Next.js App Router
    layout.tsx
    globals.css
    page.tsx                        # redirect to /chat
    api/
      agent/
        run/route.ts                # SSE proxy
        widget-action/route.ts      # HITL resume
    (app)/
      layout.tsx                    # sidebar, tenant switcher
      chat/
        page.tsx                    # Server Component shell
        _components/
          chat-surface.tsx
          message-list.tsx
          message-bubble.tsx
          composer.tsx
          canvas.tsx
          widget-registry.tsx
          widgets/
            query-plan-widget.tsx
            results-table-widget.tsx
            timeseries-chart-widget.tsx
            log-tail-widget.tsx
            summary-card-widget.tsx
            confirmation-widget.tsx
      runs/
        page.tsx
        [threadId]/page.tsx
  components/
    ui/                             # shadcn-generated
    app/                            # custom non-chat components
  lib/
    use-agent.ts                    # AG-UI hook
    agent-reducer.ts
    widgets.ts                      # TS widget types (mirror of Python)
    auth.ts
    types.ts
    utils.ts
  middleware.ts                     # JWT verification
  agent/                            # Python FastAPI + LangGraph
    pyproject.toml
    uv.lock
    agent/
      __init__.py
      main.py                       # FastAPI app
      graph.py                      # LangGraph state graph
      bedrock.py                    # Bedrock client setup
      widgets.py                    # Pydantic widget schemas (source of truth)
      events.py                     # AG-UI event emission helpers
      tools/
        __init__.py
        widget_tools.py             # create_widget / update_widget / remove_widget
        cloudwatch_tools.py         # StartQuery, GetQueryResults
      tenants.py                    # tenant role mapping + AssumeRole
      auth.py                       # JWT verification
  package.json
  package-lock.json
  tsconfig.json
  next.config.ts
  .env.example
  .gitignore
  README.md
  PLAN.md
  CLAUDE.md
  PROGRESS.md
```

## Phased build

### Phase 0 — Repo skeleton (half day)

Initialize the project, the tooling, and the `.env.example` file. No application code yet.

**Deliverables:**

- Root `package.json` with npm scripts: `dev`, `dev:web`, `dev:agent`, `lint`, `typecheck`, `build`
- The `dev` script runs both apps concurrently via `concurrently`
- `agent/pyproject.toml` for the Python side, uv lockfile committed
- `.env.example` documenting all required variables
- README sections: prerequisites, setup, run, architecture overview
- CI scaffold (`.github/workflows/ci.yml` running lint, typecheck, ruff, mypy)
- `.gitignore` covering `.next/`, `node_modules/`, `.venv/`, `__pycache__/`, `.env*` (except `.env.example`)

### Phase 1 — Frontend skeleton + Bedrock hello-world agent (1 day)

Get a streaming text response from Bedrock visible in the browser. No widgets yet, no LangGraph yet.

### Phase 2 — LangGraph agent + reducer + canvas layout + first widget (2 days)

Introduce LangGraph with in-memory checkpointer, chat/canvas layout, reducer, and one trivial widget (`summary_card`).

### Phase 3 — HITL via query_plan widget + CloudWatch query execution (2 days)

The hardest phase — LangGraph interrupt, AG-UI custom events, and frontend optimistic updates all have to agree.

### Phase 4 — Remaining widgets + generative UI dispatching (2 days)

Build the four remaining widget types and let the agent choose between them based on query shape.

### Phase 5 — Auth, tenant scoping (1 day)

Make the multi-tenant story real with NextAuth and JWT verification.

### Phase 6 — Observability + polish (1 day)

Tracing, structured logging, error boundaries, health checks, README polish.

### Phase 7 — Postgres checkpointer (when ready, ~half day)

Swap MemorySaver for PostgresSaver, add run history UI.

## Non-goals (explicit)

- Real production auth
- Persistent widget state across page refreshes (until Phase 7)
- Multi-region CloudWatch
- Mobile-optimized layout
- A second agent type
- Voice or file upload modalities
- Production deployment configs

## Environment variables

See `.env.example` for the full list with documentation.
