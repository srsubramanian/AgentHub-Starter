# AgentHub Starter

A starter agentic application demonstrating the [AG-UI protocol](https://docs.ag-ui.com/introduction), declarative canvas widgets, and a multi-tenant LangGraph backend running on AWS Bedrock.

**Reference use case:** CloudWatch Logs Insights query agent with human-in-the-loop approval.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  ┌──────────────┐  ┌────────────────────────────────┐   │
│  │  Chat (~30%) │  │  Canvas (~70%)                 │   │
│  │  Messages    │  │  Declarative widgets           │   │
│  │  Composer    │  │  (query plan, results table,   │   │
│  │              │  │   charts, log tail, etc.)      │   │
│  └──────┬───────┘  └────────────────┬───────────────┘   │
└─────────┼───────────────────────────┼───────────────────┘
          │ SSE (AG-UI events)        │ POST (widget actions)
          ▼                           ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js Route Handlers (JWT verify, tenant scope)      │
└─────────────────────┬───────────────────────────────────┘
                      │ SSE proxy
                      ▼
┌─────────────────────────────────────────────────────────┐
│  FastAPI + LangGraph                                    │
│  ┌──────────┐  ┌────────────┐  ┌─────────────────────┐ │
│  │ Bedrock  │  │ Widget     │  │ CloudWatch Logs     │ │
│  │ (Claude) │  │ Tools      │  │ Insights            │ │
│  └──────────┘  └────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js** >= 22
- **Python** >= 3.12
- **uv** (Python package manager) — [install](https://docs.astral.sh/uv/getting-started/installation/)
- **AWS credentials** with access to Bedrock and CloudWatch Logs Insights

## Setup

1. **Clone the repo:**

   ```bash
   git clone <repo-url>
   cd agui-starter
   ```

2. **Install frontend dependencies:**

   ```bash
   npm install
   ```

3. **Install agent dependencies:**

   ```bash
   cd agent && uv sync --dev && cd ..
   ```

4. **Configure environment variables:**

   ```bash
   cp .env.example .env.local        # Next.js reads .env.local
   cp .env.example agent/.env        # FastAPI reads agent/.env
   ```

   Edit both files and fill in your AWS credentials and secrets. See `.env.example` for documentation on each variable.

## Run

Start both the frontend and agent together:

```bash
npm run dev
```

Or run them separately in two terminals:

```bash
# Terminal 1 — Frontend
npm run dev:web           # http://localhost:3000

# Terminal 2 — Agent
npm run dev:agent         # http://localhost:8000
```

## Project structure

```
agui-starter/
  app/                    # Next.js App Router (pages, API routes)
  components/             # Shared React components
    ui/                   # shadcn/ui components
    app/                  # Custom non-chat components
  lib/                    # Hooks, reducers, types, utilities
  agent/                  # Python FastAPI + LangGraph agent
    agent/                # Python package
      tools/              # LangGraph tool implementations
  .github/workflows/      # CI
```

See `PLAN.md` for the full build plan and `CLAUDE.md` for development conventions.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind v4, shadcn/ui |
| Protocol | AG-UI (SSE events + custom widget events) |
| Backend | Python 3.12, FastAPI, LangGraph, MemorySaver |
| LLM | AWS Bedrock (Claude Sonnet + Haiku via cross-region inference) |
| Auth | NextAuth (stub credentials provider) + JWT |

## Development

```bash
# Lint and typecheck
npm run lint && npm run typecheck
cd agent && uv run ruff check && uv run mypy agent/

# Add a shadcn component
npx shadcn@latest add <component>

# Add a Python dependency
cd agent && uv add <package>
```

## License

Private — not for redistribution.
