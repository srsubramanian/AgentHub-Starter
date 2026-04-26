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

**Status:** Not started

---

## Phase 2 — LangGraph agent + reducer + canvas layout + first widget

**Status:** Not started

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
