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

## Phase 3 — AWS discovery tools + results_table widget

**Status:** Complete (adapted from original CloudWatch plan)

**Deliverables:**

- [x] AWS discovery tools: list_lambda_functions, list_log_groups, list_ec2_instances, get_aws_account_summary
- [x] Tools emit widget_create (results_table in "running") then widget_update (JSON Patch with results)
- [x] Graceful error handling: AccessDenied shows in widget + agent explains permissions needed
- [x] ResultsTableWidget with columns, rows, loading skeleton, error state
- [x] Agent reducer applies JSON Patch via fast-json-patch

---

## Phase 4 — Remaining widgets + generative UI dispatching

**Status:** Complete

**Deliverables:**

- [x] TimeseriesChartWidget — recharts LineChart, multi-series, themed colors, responsive
- [x] LogTailWidget — monospace, severity badges (debug/info/warn/error), auto-scroll
- [x] ConfirmationWidget — confirm/reject buttons, status-driven UI
- [x] Backend tools: create_timeseries_chart, create_log_tail, create_confirmation
- [x] Widget registry updated for all 6 types (5 implemented, query_plan placeholder)

---

## Phase 5 — Auth, tenant scoping

**Status:** Not started

---

## Phase 6 — Observability + polish

**Status:** Complete

**Deliverables:**

- [x] Markdown rendering in chat bubbles (react-markdown + remark-gfm + @tailwindcss/typography)
- [x] Error boundaries around every widget
- [x] Health status page at /admin/health
- [x] Header nav with Chat and Health links
- [x] Structured logging with structlog
- [x] Anti-aliased text, smooth scrolling

---

## Phase 7 — Postgres checkpointer

**Status:** Not started (deferred)

---

## Beyond the original plan

Capabilities added on top of Phase 6 (these aren't in the original PLAN.md
but ship in the repo today):

### MCP (Model Context Protocol) integration

**Status:** Complete

- [x] `langchain-mcp-adapters` wired into `agent/agent/mcp_client.py`
- [x] `mcp_servers.json` config (gitignored; `.example` in repo) supports
      stdio, `streamable_http`, `sse`, and `websocket` transports
- [x] Env var substitution (`${VAR}`) in config — secrets stay in `.env`
- [x] Independent server loading — one bad server doesn't break others
- [x] Tool name prefixing (`<server>_<tool>`) avoids collisions
- [x] Servers shipped:
    - `aws_docs` — Real AWS Labs documentation MCP server (stdio via `uvx`)
    - `remote` — In-repo FastMCP HTTP demo at `mcp_http_server.py` running
      as a separate `mcp-http` Docker service
    - `github` — GitHub MCP server with `${GITHUB_TOKEN}` placeholder
    - `demo` (in `.example`) — In-repo `mcp_demo_server.py` for testing
- [x] Docker copies `mcp_demo_server.py` + `mcp_http_server.py` into the
      container; `uv` AND `uvx` binaries copied (was previously just `uv`)
- [x] `agent/Dockerfile` and `docker-compose.yml` mount `mcp_servers.json`
      as a volume so config edits don't require a rebuild

### Anthropic-style Skills

**Status:** Complete

- [x] `agent/agent/skills_loader.py` — loads `agent/skills/<name>/SKILL.md`
      files at startup, parses YAML frontmatter
- [x] `agent/agent/tools/skills_tools.py::invoke_skill(name)` — LLM tool
      to load full skill body into context
- [x] `skills_summary()` injected into the system prompt at request time
      (so newly-loaded skills appear without a restart of the system
      prompt template)
- [x] Three skills shipped:
    - `cloudwatch-query-builder` — CloudWatch Logs Insights query patterns
    - `aws-cost-analysis` — cost driver / savings recommendations
    - `incident-response` — production triage runbook

### Markdown rendering with syntax highlighting

**Status:** Complete

- [x] Replaced raw `react-markdown` rendering with `rehype-highlight` +
      `highlight.js` (theme: `github-dark`)
- [x] Custom `prose-code` / `prose-pre` Tailwind overrides give
      guaranteed contrast in both bubble colors

### Documentation

**Status:** Complete

- [x] `docs/` folder with 13 markdown files covering everything:
      getting-started, architecture, backend, frontend, widgets,
      tools, mcp-servers, skills, configuration, development,
      deployment, troubleshooting (~2,400 lines total)
- [x] 11 Mermaid diagrams (request flow, state graph, lifecycle,
      tool merging, MCP loading, etc.) — render natively on GitHub
- [x] Sequential nav footer on every doc (← Back · ← Previous · Next →)
- [x] Inline cross-references with relative file links
- [x] Root `README.md` and `CLAUDE.md` point at `docs/` as the canonical
      reference

### Operational fixes (from real testing)

- [x] Bedrock content blocks: `_extract_text_delta` handles both string
      and list-of-blocks shapes (Claude 4.5 returns list)
- [x] structlog: removed `add_logger_name` (incompatible with
      `PrintLogger`, was crashing on every log call in Docker)
- [x] AWS access denied → graceful widget error with explanation
