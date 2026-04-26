# AgentHub Starter — Progress

## Phase 0 — Repo skeleton

**Status:** Complete

**Deliverables:**

- [x] Root `package.json` with npm scripts (`dev`, `dev:web`, `dev:agent`, `lint`, `typecheck`, `build`)
- [x] `agent/pyproject.toml` with all Python dependencies, uv lockfile committed
- [x] `.env.example` documenting all required variables
- [x] `tsconfig.json` (strict, Next.js 15 compatible)
- [x] `next.config.ts`
- [x] `.gitignore`
- [x] CI scaffold (`.github/workflows/ci.yml`)
- [x] `README.md` — prerequisites, setup, run, architecture overview
- [x] `PLAN.md` — full build plan
- [x] `CLAUDE.md` — Claude Code context
- [x] `PROGRESS.md` — this file

**Decisions / notes:**

- Using `hatchling` as the Python build backend (standard, minimal config)
- mypy overrides for missing stubs on third-party packages (langgraph, langchain_aws, ag_ui_protocol, etc.)
- `concurrently` used for the `npm run dev` script to run frontend + agent together

---

## Phase 1 — Frontend skeleton + Bedrock hello-world agent

**Status:** Complete

**Deliverables:**

- [x] Tailwind v4 + shadcn/ui initialized (New York style, Slate base, Geist font)
- [x] 21 shadcn components seeded (button, card, textarea, scroll-area, avatar, separator, dialog, tabs, badge, dropdown-menu, tooltip, alert, skeleton, sheet, resizable, select, popover, calendar, collapsible, table, input, label)
- [x] Runtime deps installed (@ag-ui/client, react-markdown, lucide-react, recharts, etc.)
- [x] FastAPI agent with `POST /agent/run` endpoint streaming AG-UI events via SSE
- [x] `ChatBedrockConverse` client in `agent/agent/bedrock.py`
- [x] SSE proxy route handler at `app/api/agent/run/route.ts`
- [x] Chat page at `/chat` with message list, composer, auto-scroll
- [x] `useAgent` hook in `lib/use-agent.ts` wrapping `@ag-ui/client` HttpAgent
- [x] App layout with header at `app/(app)/layout.tsx`
- [x] ESLint flat config with ignores for `.next/`, `agent/`, `next-env.d.ts`

**Decisions / notes:**

- Used `starlette.responses.StreamingResponse` instead of `sse-starlette`'s `EventSourceResponse` to avoid double SSE framing (the AG-UI `EventEncoder` already adds `data:` prefix)
- Wrote our own `_sse()` helper that matches AG-UI's format: `data: {camelCase JSON}\n\n`
- Bedrock streaming requires AWS credentials in env — without them, the run completes but no content events are emitted
- `@ag-ui/client` subscriber callback is `onTextMessageContentEvent` (not `onTextMessageContent`)

---

## Phase 2 — LangGraph agent + reducer + canvas layout + first widget

**Status:** Complete

**Deliverables:**

- [x] Pydantic widget schemas in `agent/agent/widgets.py` — 6 types with common base
- [x] TypeScript mirror in `lib/widgets.ts`
- [x] LangGraph StateGraph (`agent/agent/graph.py`) — respond → tools → respond loop
- [x] `MemorySaver` checkpointer wired in
- [x] `create_summary_card` tool emitting AG-UI `CustomEvent` via `StreamWriter`
- [x] AG-UI event helpers (`agent/agent/events.py`)
- [x] FastAPI streaming both `messages` and `custom` stream modes
- [x] Two-column resizable layout (chat ~30%, canvas ~70%)
- [x] `agentReducer` handling text + widget actions
- [x] `useAgent` hook rewritten with `useReducer`
- [x] Widget registry + `SummaryCardWidget`

**Decisions / notes:**

- LangGraph `astream(stream_mode=["messages", "custom"])` yields `(mode, event)` tuples — messages mode gives LLM token chunks, custom mode gives widget events
- `AnyMessage` import must be at runtime (not `TYPE_CHECKING`) because LangGraph evaluates TypedDict annotations
- System prompt instructs the LLM to always create a summary card after answering
- `react-resizable-panels` uses `orientation` prop, not `direction` (shadcn/ui docs may be outdated)

---

## Phase 3 — HITL via query_plan widget + CloudWatch query execution

**Status:** Not started

---

## Phase 4 — Remaining widgets + generative UI dispatching

**Status:** Not started

---

## Phase 5 — Auth, tenant scoping

**Status:** Not started

---

## Phase 6 — Observability + polish

**Status:** Not started

---

## Phase 7 — Postgres checkpointer

**Status:** Not started (deferred)
