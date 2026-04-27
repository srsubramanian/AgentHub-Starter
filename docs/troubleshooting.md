# Troubleshooting

Common issues and how to fix them.

## Agent won't start

### `ModuleNotFoundError: No module named 'agent'`

You're running uvicorn from the wrong directory. The agent must run
from `agent/`:

```bash
cd agent && uv run uvicorn agent.main:app --port 8000
```

Or use `npm run dev:agent` which `cd`s for you.

### `Address already in use`

Port 3000, 8000, or 8765 already taken. Find and kill:

```bash
lsof -ti:3000 | xargs kill -9
lsof -ti:8000 | xargs kill -9
lsof -ti:8765 | xargs kill -9
```

### `uv: command not found`

Install uv:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Then restart your shell.

## Bedrock errors

### `An error occurred (AccessDeniedException) when calling the InvokeModel...`

Your IAM user/role doesn't have access to the Bedrock model. Required
permission:

```
bedrock:InvokeModelWithResponseStream
```

on the model ARN (use `*` for all Claude models). Also: in the Bedrock
console, **request access to Claude models** if you haven't — it's a
one-click approval but required.

### `An error occurred (ValidationException) ... model identifier is invalid`

The `BEDROCK_AGENT_MODEL` env var points at a model not available in
your region or not enabled. List available models:

```bash
aws bedrock list-foundation-models --region us-east-1 \
  --query "modelSummaries[?contains(modelId,'claude')].modelId"
```

For inference profiles (the `us.` prefix):

```bash
aws bedrock list-inference-profiles \
  --query "inferenceProfileSummaries[].inferenceProfileId"
```

## AWS tool errors

### `An error occurred (AccessDeniedException) when calling ListFunctions`

The IAM user lacks `lambda:ListFunctions`. Attach
`AWSLambda_ReadOnlyAccess` (or the equivalent for log groups, EC2,
etc.). The agent surfaces this gracefully — the user sees the error in
the results widget along with an explanation of which permission is
needed.

### IAM policies attached but still denied

Wait 30-60 seconds for IAM propagation. If it still doesn't work,
verify the policies are actually attached:

```bash
aws iam list-attached-user-policies --user-name <username>
```

Note: the user themselves might not have permission to list their own
attached policies. Run this with admin credentials.

## Markdown / chat rendering

### Code blocks have unreadable colors

Should be fixed in the latest commits — `rehype-highlight` with the
`github-dark` theme + explicit Tailwind color overrides give
guaranteed contrast. If you're seeing washed-out code:

1. Hard-refresh the browser (Cmd+Shift+R)
2. Check that `app/globals.css` has the highlight.js import
3. Restart the Next.js dev server

### Tables / strikethrough don't render

`remark-gfm` is required for GFM features. Check that
`app/(app)/chat/_components/message-bubble.tsx` includes:

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]} ...>
```

## MCP servers

### `Loaded MCP config  servers=[]` — no servers loaded

Either:

- `agent/mcp_servers.json` doesn't exist (it's gitignored — copy from
  `.example` and edit)
- The file exists but the path env var (`MCP_SERVERS_CONFIG`) points
  elsewhere
- All your servers have keys starting with `_` (those are skipped)

Logs show the resolved path:

```
No MCP config found  path=/app/mcp_servers.json
```

### `Failed to load MCP server  server=<name>`

Check the traceback that follows. Common causes:

- **`FileNotFoundError`** — the `command` (e.g. `uvx`, `npx`, `node`)
  isn't in PATH in the agent container. The default container has
  `uv` and `uvx` but not Node.js.
- **HTTP timeout** — the server URL isn't reachable. For internal
  Docker services, make sure the service name matches and the agent
  `depends_on` it.
- **Auth failure** — `${VAR_NAME}` substitution returned an empty
  string because the env var wasn't set. Check `.env`.

### MCP server tools don't show up in the LLM's tool list

After config changes, **restart the agent container** (the config is
loaded once at startup):

```bash
docker compose restart agent
```

Volume mounts mean you don't need to rebuild — just restart.

## Skills

### Skill not appearing in system prompt

Check the agent startup logs for:

```
Loaded skills  count=N names=[...]
```

If your skill isn't listed:

- The directory is `agent/skills/<name>/SKILL.md` (note the case)
- The frontmatter is valid YAML between two `---` lines
- `name` and `description` are both present in the frontmatter

### Skill has wrong content after edit

Skills are loaded once at startup. Restart the agent.

## Docker issues

### `Cannot connect to the Docker daemon`

Docker Desktop isn't running. Start it:

```bash
open -a Docker
```

Wait ~30 seconds, then verify:

```bash
docker ps
```

### Docker Desktop crashes during build

Usually a memory/CPU pressure issue. **Settings → Resources → Memory**;
bump to at least 4 GB. The first build of this project pulls several
hundred MB of Python packages.

### `unexpected EOF` during `docker compose up`

Same as above — Docker Desktop crashed. Restart it and try again.

### Builds are slow every time

Docker layer caching should make repeat builds fast. If they're not:

```bash
docker compose build --no-cache=false
```

Or check that you haven't broken the layer order in the Dockerfile —
`COPY pyproject.toml uv.lock` should come before `COPY agent/`.

## Streaming issues

### Browser shows assistant bubble but no text appears

The agent ran successfully (you'd see `RUN_FINISHED` in agent logs)
but no tokens streamed. Usually means:

- Bedrock returned content as a list of typed blocks but the agent
  didn't extract `text` from them (this was a bug in early phases —
  check `_extract_text_delta` in `main.py` is being used)
- AWS credentials missing/invalid — `RUN_STARTED` and `TEXT_MESSAGE_END`
  fire but no content events between them

### `data: data: ...` doubled prefix in SSE

You're using `sse_starlette.EventSourceResponse` with the AG-UI
`EventEncoder`, which both add `data:`. The agent uses
`StreamingResponse` + a custom `_sse()` helper to avoid this.

### SSE stream times out / disconnects

Check that no proxy in front is buffering responses. Add headers to
the SSE response:

```python
StreamingResponse(..., headers={
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",   # for nginx
})
```

The first two are already set; `X-Accel-Buffering` is needed only if
you put nginx in front.

## CORS / proxy

### `Access-Control-Allow-Origin` errors in browser

You're hitting the agent (`:8000`) directly from the browser instead
of going through the Next.js proxy (`:3000/api/agent/run`). The agent
has CORS configured for localhost:3000/3001 but you should use the
proxy to test the real path.

### `502 Bad Gateway` from Next.js proxy

`AGENT_URL` is wrong, the agent is down, or the network between them
is broken. Check:

- `docker compose ps` — both `web` and `agent` are running
- `docker compose logs agent` — agent didn't crash on startup
- `curl http://localhost:8000/health` — agent reachable from host

## Lint / typecheck

### `Cannot find module '@/...'` in TypeScript

The path alias is configured in `tsconfig.json` (`"paths": {"@/*": ["./*"]}`).
If you see it intermittently, restart the TS server in your editor
(VS Code: Cmd+Shift+P → "TypeScript: Restart TS server").

### mypy `error: Library stubs not installed for "X"`

Add it as a dev dep:

```bash
cd agent && uv add --dev types-X
```

Or add to the `[[tool.mypy.overrides]]` block in `pyproject.toml` if
no stub package exists:

```toml
[[tool.mypy.overrides]]
module = ["X.*"]
ignore_missing_imports = true
```

## Logs / debugging

### Agent logs are too noisy

The structlog renderer is verbose by design. To suppress info logs:

```python
# In agent/agent/logging_config.py
wrapper_class=structlog.make_filtering_bound_logger(logging.WARNING),
```

### LangGraph internal logs

Enable LangChain debug:

```bash
export LANGCHAIN_DEBUG=true
```

Or for full tracing:

```bash
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=ls__...
export LANGCHAIN_PROJECT=agui-starter
```

Traces appear in LangSmith.

## Got an issue not listed here?

Check `docker compose logs -f agent` first — the structured logs
usually point at the cause. Most issues are environment-related (env
vars, AWS perms, Docker resources) rather than code bugs.

---

[← Back to docs index](./README.md) · [← Previous: Deployment](./deployment.md)
