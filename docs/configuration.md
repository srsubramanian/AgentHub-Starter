# Configuration

All configuration lives in two files:

| File | Read by | Purpose |
|------|---------|---------|
| `.env` | Both web and agent | Environment variables (secrets, URLs) |
| `agent/mcp_servers.json` | Agent | MCP server definitions |

## Environment variables

Copy `.env.example` to `.env` and fill in what you need. Both Docker
Compose and `npm run dev` read this file.

### AWS / Bedrock

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=                 # leave blank to use ~/.aws/credentials
AWS_SECRET_ACCESS_KEY=             # leave blank to use ~/.aws/credentials
# AWS_SESSION_TOKEN=               # only if using temporary creds (SSO/AssumeRole)

BEDROCK_AGENT_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
BEDROCK_CLASSIFIER_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

The agent reads via `boto3`'s default credential chain. **Recommended:
leave the access key vars blank and use `~/.aws/credentials` instead.**
Docker mounts that file read-only into the agent container.

### Tenant role mapping (Phase 5+ stub)

```
TENANT_A_ROLE_ARN=arn:aws:iam::123456789012:role/agui-starter-tenant-a-role
TENANT_B_ROLE_ARN=arn:aws:iam::123456789012:role/agui-starter-tenant-b-role
```

Not yet wired into the agent (Phase 5). The plan is to AssumeRole
per-thread for tenant scoping.

### Auth (Phase 5 stub)

```
NEXTAUTH_SECRET=         # generate with: openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
JWT_SECRET=              # shared between Next.js and the agent for JWT verify
```

Not yet wired. The Route Handler proxy will validate JWTs in Phase 5.

### Agent

```
AGENT_PORT=8000
AGENT_URL=http://localhost:8000     # Docker compose overrides this to http://agent:8000
```

The Next.js Route Handler at `/api/agent/run` reads `AGENT_URL` to know
where to proxy SSE. Docker Compose injects `AGENT_URL=http://agent:8000`
to use the internal service name.

### MCP servers

```
MCP_SERVERS_CONFIG=mcp_servers.json
```

Path to the MCP config (relative to `agent/` or absolute). If unset or
the file is missing, no MCP servers are loaded — the agent runs without
them.

```
GITHUB_TOKEN=                       # if you enable the github MCP server
```

The MCP loader supports `${VAR_NAME}` substitution. Anything the config
references via that syntax must be set in the env (or `.env`).

### Phase 7+ (deferred)

```
DATABASE_URL=                       # PostgresSaver checkpointer
```

### Observability (optional)

```
PHOENIX_ENDPOINT=
PHOENIX_API_KEY=
```

Hooks for Arize Phoenix tracing — not yet wired.

## MCP server config

`agent/mcp_servers.json` (gitignored, copy from `.example`).

See [mcp-servers.md](./mcp-servers.md) for the full format and adding
new servers.

## Docker Compose overrides

`docker-compose.yml` injects:

| Service | Override | Why |
|---------|----------|-----|
| `web` | `AGENT_URL=http://agent:8000` | Internal Docker DNS |
| `agent` | `MCP_HTTP_PORT` (none, defaults) | Demo HTTP server config |
| `agent` | `~/.aws:/root/.aws:ro` mount | AWS credentials |
| `agent` | `./agent/mcp_servers.json:/app/mcp_servers.json:ro` mount | MCP config without rebuild |

The `web` service depends on `agent` being healthy. The `agent` service
depends on `mcp-http` having started (so the HTTP MCP server is
reachable when the agent loads its tool list).

## Where each value gets used

| Variable | Used by |
|----------|---------|
| `AWS_REGION` | `agent/agent/bedrock.py`, `aws_tools.py` |
| `AWS_ACCESS_KEY_ID` / etc. | boto3 credential chain |
| `BEDROCK_AGENT_MODEL` | `agent/agent/bedrock.py::get_chat_model` |
| `AGENT_URL` | `app/api/agent/run/route.ts` |
| `MCP_SERVERS_CONFIG` | `agent/agent/mcp_client.py::_load_config` |
| `${GITHUB_TOKEN}` etc. in MCP config | substituted at MCP load time |

## Reload behavior

| Change | What needs to restart |
|--------|----------------------|
| `.env` value | Whole stack (`docker compose down && up`) |
| `mcp_servers.json` | Agent only (mounted as a volume — restart picks it up) |
| Skills file | Agent only (skills loaded at startup) |
| Frontend code | Hot-reloaded by Next.js dev server |
| Agent Python code | Hot-reloaded by `uvicorn --reload` (when running locally) |
| Docker `agent/Dockerfile` | Rebuild (`docker compose up --build`) |

---

[← Back to docs index](./README.md) · [← Previous: Scheduled Tasks](./scheduled-tasks.md) · [Next: Development →](./development.md)
