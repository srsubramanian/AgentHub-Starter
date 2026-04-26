# Deployment

This is a **starter / dev project**. Production deployment is a
non-goal of the current build (see `PLAN.md`'s "Non-goals"). Below is
how the local Docker setup works and what you'd need to add to deploy
it for real.

## Current Docker setup

`docker-compose.yml` defines three services that boot together:

```
┌─────────────────────────────────────────────┐
│ web        :3000  (Next.js dev mode)        │
│ depends_on: agent (healthy)                 │
└─────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│ agent      :8000  (FastAPI + LangGraph)     │
│ mounts:    ~/.aws:/root/.aws:ro             │
│            agent/mcp_servers.json:/app/...  │
│ depends_on: mcp-http (started)              │
│ healthcheck: GET /health                    │
└─────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│ mcp-http   :8765  (demo external MCP server)│
└─────────────────────────────────────────────┘
```

### Service: `web`

- **Image**: built from `Dockerfile` (Node 22 slim)
- **Command**: `npm run dev:web` (Next.js dev mode)
- **Port**: 3000
- **Env**: `AGENT_URL=http://agent:8000` (overrides .env)

### Service: `agent`

- **Image**: built from `agent/Dockerfile` (Python 3.12 slim + uv)
- **Command**: `uv run uvicorn agent.main:app --host 0.0.0.0 --port 8000`
- **Port**: 8000
- **Env**: from `.env` file
- **Volumes**:
  - `~/.aws:/root/.aws:ro` (AWS credentials)
  - `./agent/mcp_servers.json:/app/mcp_servers.json:ro` (MCP config)
- **Health check**: `GET /health` every 5s

### Service: `mcp-http`

- **Image**: same as agent (reused base image)
- **Command**: `uv run python mcp_http_server.py`
- **Port**: 8765
- Demonstrates external HTTP MCP servers

## Dockerfile details

### `Dockerfile` (frontend)

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY app/ app/ components/ components/ lib/ lib/ \
     next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs \
     components.json ./
EXPOSE 3000
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["npm", "run", "dev:web"]
```

**Note**: this is a **dev-mode** image. It runs `next dev` (with
hot-reload). For production you'd use `next build` and run `next start`
instead — and add a multi-stage build to keep the runtime image small.

### `agent/Dockerfile`

```dockerfile
FROM python:3.12-slim
WORKDIR /app

# uv + uvx for stdio MCP servers like uvx awslabs.aws-documentation-mcp-server
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Layered for caching: deps first, then app code
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY agent/ agent/
COPY skills/ skills/
COPY mcp_demo_server.py mcp_http_server.py ./
RUN uv sync --frozen --no-dev

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

The container does NOT include Node.js — Node-based MCP servers like
`@modelcontextprotocol/server-filesystem` won't work without
modification. See [mcp-servers.md](./mcp-servers.md) for how to add
Node if you need it.

## What's missing for production

The `PLAN.md` non-goals list explicitly excludes production deployment.
Things you'd need to add:

### Frontend

- [ ] Multi-stage Dockerfile: `next build` → minimal runtime image
- [ ] CDN/static asset hosting
- [ ] Real auth (NextAuth backed by your IdP)
- [ ] Rate limiting on the SSE proxy
- [ ] HTTPS / TLS termination (typically at ALB / ingress / CDN)
- [ ] Monitoring (request metrics, error tracking)
- [ ] CSP / security headers

### Agent

- [ ] Production logging (structured JSON output already supported via
      `setup_logging(json_output=True)`)
- [ ] OpenTelemetry / Phoenix tracing
- [ ] Postgres checkpointer (`PostgresSaver` instead of `InMemorySaver`)
- [ ] Per-tenant scoping via JWT + AssumeRole
- [ ] Bedrock model selection per-request (cost vs quality)
- [ ] Worker scaling (run uvicorn with multiple workers + a shared
      Postgres checkpointer)
- [ ] Health checks beyond `/health` (probe Bedrock, MCP, AWS)

### Infrastructure

- [ ] CI/CD pipeline beyond lint/typecheck
- [ ] Secrets management (AWS Secrets Manager or similar — don't bake
      `GITHUB_TOKEN` etc. into images)
- [ ] DB migrations for the Postgres checkpointer
- [ ] Observability (Datadog, CloudWatch, Grafana, Sentry)

## Running on a single VM

If you really want to deploy this as-is to a single EC2 instance:

```bash
# On the VM
git clone <repo>
cd AgentHub-Starter
cp .env.example .env
# edit .env with real values (or use IAM role on the VM)
docker compose up -d --build
```

Behind a reverse proxy (Caddy, nginx) for TLS:

```caddyfile
your-domain.com {
  reverse_proxy localhost:3000
}
```

Caveats:
- Single-process Next.js in dev mode (no SSR caching, no compression)
- In-memory checkpointer — restarts lose all conversations
- No auth — wide open to anyone who hits the URL

Acceptable for an internal demo. Don't expose to the public internet
without auth.

## Single-host alternatives

For a slightly more "production-shaped" single-host setup:

1. Switch the frontend to `next build && next start`
2. Add nginx in front (caching, gzip, TLS)
3. Add Postgres for the agent checkpointer (Phase 7)
4. Add NextAuth with credentials/SSO

Phase 5 + Phase 7 in `PLAN.md` are designed to bring you to that
state. Both are deferred in the current build.

## Don't deploy to public cloud without:

1. **Real auth** — currently anyone who can reach `/api/agent/run` can
   spend your Bedrock budget
2. **Rate limiting** — at minimum on `/api/agent/run`
3. **Bedrock budget alerts** — Bedrock can be expensive; set spend
   alerts in AWS
4. **Tenant isolation** — currently all conversations share the same
   AWS credentials and same Bedrock client
