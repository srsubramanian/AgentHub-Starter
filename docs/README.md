# AgentHub Starter — Documentation

Welcome. This folder contains everything you need to understand,
run, and extend the AgentHub Starter.

If this is your first time here, read these in order:

1. [Getting Started](./getting-started.md) — prerequisites, install, first run
2. [Architecture](./architecture.md) — high-level design, data flow, key conventions
3. [Backend](./backend.md) — FastAPI + LangGraph internals
4. [Frontend](./frontend.md) — Next.js + React, the chat/canvas UI

Then dive into the feature docs as needed:

- [Widgets](./widgets.md) — the canvas widget system
- [Tools](./tools.md) — how the LLM calls AWS, widgets, MCP, skills
- [MCP Servers](./mcp-servers.md) — adding stdio and HTTP MCP servers
- [Skills](./skills.md) — Anthropic-style skills (SKILL.md files)

Reference and operations:

- [Configuration](./configuration.md) — environment variables, config files
- [Development](./development.md) — workflow, lint, typecheck, testing
- [Deployment](./deployment.md) — Docker setup, future production
- [Troubleshooting](./troubleshooting.md) — common issues and fixes

---

## TL;DR — what is this?

A working starter for building **agentic web applications** using:

- **Anthropic's AG-UI protocol** — a streaming protocol for agent-driven UIs
- **LangGraph** — the agent's stateful execution graph
- **AWS Bedrock** — Claude Sonnet for reasoning, runs in your AWS account
- **Next.js + shadcn/ui** — the chat-plus-canvas frontend
- **MCP** — connects the agent to external tool servers
- **Skills** — packaged runbooks the agent loads on demand

The reference use case is a **cloud operations assistant**: the user asks
questions in natural language, the agent fetches AWS data and renders it
as live widgets in a side canvas (charts, tables, log tails, etc.).

```
┌────────────────────────────────────────────────────────────┐
│  Browser                                                   │
│  ┌──────────────┐  ┌────────────────────────────────────┐  │
│  │ Chat (~30%)  │  │ Canvas (~70%) — Widgets            │  │
│  │ (markdown +  │  │ (summary cards, charts, log tail,  │  │
│  │  streaming)  │  │  results table, confirmations)     │  │
│  └──────┬───────┘  └────────────────┬───────────────────┘  │
└─────────┼───────────────────────────┼──────────────────────┘
          │ SSE                       │ POST (widget actions)
          ▼                           ▼
┌────────────────────────────────────────────────────────────┐
│  Next.js Route Handlers (proxy + auth)                     │
└─────────────────────────┬──────────────────────────────────┘
                          │ SSE proxy
                          ▼
┌────────────────────────────────────────────────────────────┐
│  FastAPI + LangGraph                                       │
│  ┌──────────┐  ┌────────────┐  ┌─────────┐  ┌──────────┐   │
│  │ Bedrock  │  │ AWS APIs   │  │  MCP    │  │  Skills  │   │
│  │ (Claude) │  │ (boto3)    │  │ Servers │  │ (.md)    │   │
│  └──────────┘  └────────────┘  └─────────┘  └──────────┘   │
└────────────────────────────────────────────────────────────┘
```
