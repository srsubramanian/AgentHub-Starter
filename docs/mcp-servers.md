# MCP Servers

MCP (Model Context Protocol) is Anthropic's standard for connecting
LLMs to external tool servers. This project uses
**`langchain-mcp-adapters`** to expose any MCP server as LangChain
tools the agent can call.

## How it's wired

```mermaid
flowchart TD
    A[FastAPI lifespan startup] --> B[load_mcp_tools]
    B --> C[Read mcp_servers.json]
    C --> D[Substitute ${ENV_VARS}]
    D --> E{For each server<br/>name: config}
    E -->|skip if name starts with _| E
    E -->|stdio| F[spawn subprocess<br/>command + args]
    E -->|streamable_http| G[HTTP client<br/>url + headers]
    F --> H[get_tools]
    G --> H
    H -->|success| I[append to all_tools]
    H -->|fail| J[log exception, skip]
    I --> E
    J --> E
    I --> K[set_mcp_tools all_tools]
    K --> L[Tools available to graph]
```

1. **Config**: `agent/mcp_servers.json` — a dict of server name → connection settings (gitignored; copy from `.example`)
2. **Loader**: [`agent/agent/mcp_client.py::load_mcp_tools()`](../agent/agent/mcp_client.py) runs in the FastAPI lifespan, returns `list[BaseTool]`
3. **Registry**: `set_mcp_tools(tools)` writes to a module-level global in [`agent/agent/graph.py`](../agent/agent/graph.py)
4. **Binding**: `_all_tools()` returns native + MCP tools at request time, bound to the model

See [tools.md](./tools.md) for how MCP tools fit alongside native tools.

## Supported transports

| Transport | When | Config |
|-----------|------|--------|
| `stdio` | Server runs as a child process | `command` + `args` |
| `streamable_http` | Server runs over HTTP (any host) | `url` + optional `headers` |
| `sse` | Server uses SSE transport | `url` |
| `websocket` | Server uses WebSocket | `url` |

## Config file format

`agent/mcp_servers.json`:

```jsonc
{
  // stdio: subprocess
  "aws_docs": {
    "command": "uvx",
    "args": ["awslabs.aws-documentation-mcp-server@latest"],
    "transport": "stdio",
    "env": { "FASTMCP_LOG_LEVEL": "ERROR" }
  },

  // HTTP: external server (Docker service, remote endpoint, etc.)
  "remote": {
    "url": "http://mcp-http:8765/mcp",
    "transport": "streamable_http"
  },

  // HTTP with bearer auth using env var substitution
  "github": {
    "url": "https://api.githubcopilot.com/mcp/",
    "transport": "streamable_http",
    "headers": {
      "Authorization": "Bearer ${GITHUB_TOKEN}"
    }
  }
}
```

## Env var substitution

Anywhere in the config, `${VAR_NAME}` is replaced with the value of
the environment variable at load time. This keeps secrets out of the
config file.

```json
"headers": {
  "Authorization": "Bearer ${GITHUB_TOKEN}"
}
```

If `GITHUB_TOKEN` is unset, the placeholder becomes an empty string
and a warning is logged.

## Tool name prefixing

The loader uses `tool_name_prefix=True` so all tools from a server are
prefixed with the server's config key:

```
aws_docs server "search_documentation" tool → aws_docs_search_documentation
github server "list_repos" tool → github_list_repos
```

This avoids collisions when multiple servers expose tools with the
same name.

## Independent loading

Each server is loaded in its own try/except. One bad server (network
error, missing binary, bad config) does NOT block others. Failures are
logged with `logger.exception` and the server is just absent from the
tool list.

## Disabled entries

Keys starting with `_` are ignored by the loader. Useful for keeping
template entries in the config:

```json
{
  "_filesystem_disabled_for_now": {
    "command": "npx",
    "args": ["@modelcontextprotocol/server-filesystem", "/tmp"]
  }
}
```

## Demo servers shipped with the project

### `aws_docs` (stdio)

Real AWS Labs documentation MCP server. Searches and reads from
docs.aws.amazon.com. Tools:

- `aws_docs_search_documentation` — search across all AWS docs
- `aws_docs_read_documentation` — fetch a specific URL
- `aws_docs_read_sections` — read selected sections
- `aws_docs_recommend` — related docs

No auth required. Runs via `uvx` (which is in the agent container).

### `remote` (HTTP)

`agent/mcp_http_server.py` — a tiny FastMCP-based HTTP server that
runs as a separate Docker service on port 8765. Tools:

- `remote_server_info` — returns runtime info, proves you're hitting
  the external service
- `remote_random_quote` — returns a random software-engineering quote
- `remote_add_numbers` — adds two numbers, exercises arg passing

This is the proof-of-concept that the agent can talk to MCP servers
in **separate containers/hosts**. In production, you'd point this at
your real internal MCP server.

### `demo` (stdio, optional)

`agent/mcp_demo_server.py` — runs in-process via `uv run python`.
Tools: `demo_get_current_time`, `demo_echo`. Useful for testing the
stdio transport.

## Adding a new MCP server

### Public/hosted server

```jsonc
{
  "tavily": {
    "url": "https://mcp.tavily.com/...",
    "transport": "streamable_http",
    "headers": { "Authorization": "Bearer ${TAVILY_API_KEY}" }
  }
}
```

Add the env var to `.env`:

```
TAVILY_API_KEY=tvly-...
```

Restart the agent.

### Self-hosted (separate Docker service)

Add a service to `docker-compose.yml`:

```yaml
services:
  my-mcp:
    image: myorg/my-mcp-server:latest
    ports:
      - "9000:9000"
```

Then point the agent at it:

```json
{
  "my_server": {
    "url": "http://my-mcp:9000/mcp",
    "transport": "streamable_http"
  }
}
```

The agent service can reach `my-mcp` via Docker's internal DNS.

### Stdio server requiring extra runtime

Some MCP servers require Node.js (e.g. `@modelcontextprotocol/server-filesystem`).
The default agent container only has Python + `uv`/`uvx`. To enable a
Node-based server, add Node to `agent/Dockerfile`:

```dockerfile
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*
```

Then:

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
    "transport": "stdio"
  }
}
```

## Verifying MCP loaded

Check the agent startup logs:

```
Loaded MCP config  servers=['aws_docs', 'remote', 'github']
Loaded MCP server  server=aws_docs count=4 tool_names=[...]
Loaded MCP server  server=remote count=3 tool_names=[...]
MCP tools loaded   total=7
Agent ready        skill_count=3 mcp_tool_count=7
```

If a server failed, you'll see `Failed to load MCP server  server=<name>`
followed by the traceback.

## Curated public MCP servers

A starting list of well-known servers worth integrating:

| Server | What | Auth |
|--------|------|------|
| AWS Docs (already shipped) | AWS documentation search | None |
| GitHub | Repos, PRs, issues, code search | GitHub PAT |
| Brave Search | Web search | Brave API key |
| Tavily | LLM-tuned search | Tavily API key |
| Notion | Pages, databases | Notion integration token |
| Slack | Messages, channels | Slack bot token |
| Postgres | SQL queries | Connection string |
| Memory | Persistent agent memory | None |

The full list is at <https://github.com/modelcontextprotocol/servers>.

---

[← Back to docs index](./README.md) · [← Previous: Tools](./tools.md) · [Next: Skills →](./skills.md)
