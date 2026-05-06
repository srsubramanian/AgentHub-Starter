# Migrating a raw LangGraph `StateGraph` agent to `create_agent` + middleware

A plan for moving an agent built with `langgraph.graph.StateGraph` (manually
wired `respond → tools → respond` loop) over to `langchain.agents.create_agent`
so you can use LangChain v1 middleware (`PIIMiddleware`,
`SummarizationMiddleware`, `HumanInTheLoopMiddleware`, custom hooks).

This is written so a fresh agent (Claude Code instance, teammate, etc.) can
apply it to a similar codebase without prior context.

---

## When this plan applies

Apply this plan if **all** of the following are true in the target codebase:

1. The agent is a compiled `StateGraph` with two nodes that look roughly like:
   - a `respond` (or `model`/`agent`) node that calls `model.bind_tools(...)` and `ainvoke`s the LLM
   - a `tools` (or `call_tools`) node wrapping `langgraph.prebuilt.ToolNode`
   - a conditional edge that routes `respond → tools` when the last message has tool calls, else ends
2. The agent uses LangChain message types (`AnyMessage`, `SystemMessage`, etc.)
3. The agent's state is a `TypedDict` with at minimum `messages: Annotated[list[AnyMessage], add_messages]`
4. Streaming uses `graph.astream(stream_mode=[...])` — typically `["messages", "custom"]`
5. The project does **not** depend on a non-standard graph topology (parallel
   tool fan-out, multiple distinct model nodes the agent routes between, planner
   nodes that write to state before the model, etc.)

If any of those don't match, stop and re-evaluate — `create_agent` opinionates
the loop shape, and the standard fit is what makes this migration cheap.

---

## What you gain

- Composable cross-cutting concerns via middleware hooks: `before_agent`,
  `before_model`, `wrap_model_call`, `wrap_tool_call`, `after_model`,
  `after_agent`
- Prebuilt middleware: `PIIMiddleware`, `SummarizationMiddleware`,
  `HumanInTheLoopMiddleware`
- Smaller graph file (typically 100+ lines collapse to ~20 + middleware)
- Alignment with the LangChain v1 standard — new features land here first

## What you give up

- Ability to change the loop's **shape** (you're locked into model ↔ tools)
- Custom state shapes beyond extending `messages`
- The loop source being visible in your repo (it lives in `langchain`)

If you later need a non-ReAct topology, you can drop back to a raw `StateGraph`
in a few hours — this is not a one-way door.

---

## Prerequisites

1. Python 3.11+ (LangChain v1 requirement)
2. The codebase already uses `uv` or `pip` for Python deps
3. You have a working end-to-end test path you can run after the migration
   (chat → tool call → response). If not, build one first.

---

## Step 1 — Add the dependency

Edit `pyproject.toml` (or `requirements.txt`):

```toml
dependencies = [
    "langchain>=1.0",
    # keep existing langgraph, langchain-aws / langchain-openai / etc.
]
```

Then:

```bash
uv sync   # or: pip install -U langchain
```

Verify:

```bash
uv run python -c "from langchain.agents import create_agent; from langchain.agents.middleware import wrap_model_call, ModelRequest, ModelResponse; print('ok')"
```

---

## Step 2 — Identify what your current `respond` node actually does

Read the existing graph file end to end. Catalog every behavior in `respond`
into one of these buckets — the bucket determines how you migrate it.

| Behavior in current `respond` | Migrates to |
|---|---|
| Build / append a system prompt | `system_prompt=` arg on `create_agent`, or `before_model` hook for dynamic prompts |
| `model.bind_tools(static_list)` | `tools=` arg on `create_agent` |
| `model.bind_tools(dynamic_list)` (e.g. native + MCP merged at request time) | `wrap_model_call` middleware that calls `request.override(tools=...)` |
| Trim / window messages before LLM | `before_model` hook |
| Swap model based on state/context | `wrap_model_call` middleware with `request.override(model=...)` |
| Validate / edit LLM response | `after_model` hook |
| Emit custom stream events from inside tools | **No change** — `get_stream_writer()` still works inside tool functions |

If a behavior doesn't fit any row above, flag it before continuing — it may be
a sign the loop shape itself is custom and this migration isn't the right call.

---

## Step 3 — Rewrite the graph file

Replace the `StateGraph` construction with a `create_agent` call. Below is a
template — adapt names to your project. The key idea: keep the public surface
(`graph`, helper functions called from FastAPI lifespan / tests) identical so
nothing downstream changes.

```python
"""Agent graph built with create_agent + middleware."""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable

from langchain.agents import create_agent
from langchain.agents.middleware import (
    ModelRequest,
    ModelResponse,
    wrap_model_call,
)
from langgraph.checkpoint.memory import InMemorySaver

# project-specific imports — keep whatever you had
from myapp.model import get_chat_model
from myapp.tools.native_tools import NATIVE_TOOLS  # whatever your static tool list is

if TYPE_CHECKING:
    from langchain_core.tools import BaseTool


# ---------------------------------------------------------------------------
# Dynamic tool registry (only needed if your agent merges tools at request time,
# e.g. native + MCP). Keep the same public functions as before so callers
# don't change.
# ---------------------------------------------------------------------------

_runtime_tools: list[BaseTool] = []


def set_runtime_tools(tools: list[BaseTool]) -> None:
    """Called from FastAPI lifespan / startup once async tools are loaded."""
    global _runtime_tools
    _runtime_tools = tools


def _all_tools() -> list[BaseTool]:
    return [*NATIVE_TOOLS, *_runtime_tools]


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
... copy your existing system prompt here ...
"""


# ---------------------------------------------------------------------------
# Middleware: inject the live tool list on every model call.
# Replaces the per-request `model.bind_tools(_all_tools())` pattern.
# Drop this middleware if your tool list is fully static at startup.
# ---------------------------------------------------------------------------


@wrap_model_call
def inject_live_tools(
    request: ModelRequest,
    handler: Callable[[ModelRequest], ModelResponse],
) -> ModelResponse:
    return handler(request.override(tools=_all_tools()))


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

graph = create_agent(
    model=get_chat_model(),
    tools=NATIVE_TOOLS,           # initial set; middleware overrides per call
    system_prompt=SYSTEM_PROMPT,  # append dynamic content via before_model if needed
    middleware=[inject_live_tools],
    checkpointer=InMemorySaver(),
)
```

Notes:

- `create_agent` returns a compiled LangGraph. `graph.astream(...)`,
  `graph.ainvoke(...)`, etc. all work identically.
- If your system prompt is dynamic (e.g. concatenated from a registry loaded
  at startup), build it once at import time and pass the final string. If it
  must vary per request, use a `before_model` hook instead.
- If your tools are 100% static at startup, drop the `inject_live_tools`
  middleware and just pass the full list to `tools=`.

---

## Step 4 — Update callers (usually none needed)

The point of keeping `graph` and `set_runtime_tools` (or whatever your
project calls them) at module scope is that callers don't change. Verify by
greping for the old graph imports:

```bash
grep -r "from .* import graph" --include="*.py"
grep -r "set_mcp_tools\|set_runtime_tools" --include="*.py"
```

If the FastAPI app does something like:

```python
@asynccontextmanager
async def lifespan(app):
    tools = await load_mcp_tools()
    set_runtime_tools(tools)
    yield
```

That continues to work without change.

---

## Step 5 — Smoke test (do not skip)

Run these in order. Each one isolates a different layer.

1. **Module import**: `uv run python -c "from myapp.graph import graph; print(graph)"`
   - Catches dep / import errors before runtime.
2. **Single non-tool turn**: send a chat message that should not invoke a tool
   ("hi"). Verify the response streams back token by token.
3. **Single tool turn**: send a message that triggers exactly one tool call.
   Verify:
   - The tool runs
   - Any custom stream events the tool emits via `get_stream_writer()`
     reach the client in the right order
   - The follow-up LLM response streams back
4. **Multi-step tool turn**: a message that requires 2+ tool calls. Verify
   message ordering matches what the previous implementation produced.
5. **If you have MCP / runtime-loaded tools**: restart the app, wait for
   the lifespan to finish loading them, then send a message that calls one.
   Confirm the `inject_live_tools` middleware is exposing it.
6. **Checkpointing / multi-turn**: send two messages on the same
   `thread_id`. Confirm the second one sees the first's history.

If any of those fail, **do not proceed**. The most likely failure modes:

- `bind_tools` was called somewhere downstream on the same `model` instance,
  causing tool-call duplication. Search for `.bind_tools(` and remove.
- A tool relied on a state key that `create_agent`'s state doesn't expose.
  Check the tool's signature — it should only need `messages` and tool args.
- Streaming events arrive but in a different order than before. Check
  whether your client cares about exact ordering of `messages` vs `custom`
  stream chunks. Usually not, but verify.

---

## Step 6 — Add the middleware you actually want

Only after Step 5 passes. Suggested order based on real value vs risk:

1. **`SummarizationMiddleware`** — lowest risk, immediate value for any agent
   that has multi-turn conversations.
   ```python
   from langchain.agents.middleware import SummarizationMiddleware

   middleware=[
       inject_live_tools,
       SummarizationMiddleware(
           model=get_chat_model(),
           trigger={"tokens": 8000},
       ),
   ]
   ```

2. **`HumanInTheLoopMiddleware`** — for any tool with side effects (writes,
   deletes, external calls). Requires a client-side flow to render the
   interrupt and send back an approval, so coordinate with the frontend.
   ```python
   from langchain.agents.middleware import HumanInTheLoopMiddleware

   HumanInTheLoopMiddleware(
       interrupt_on={
           "delete_resource": {"allowed_decisions": ["approve", "reject"]},
       },
   )
   ```

3. **`PIIMiddleware`** — if you handle user data that may contain PII.
   ```python
   from langchain.agents.middleware import PIIMiddleware

   PIIMiddleware("email", strategy="redact", apply_to_input=True)
   ```

4. **Custom middleware** — only after you have a concrete cross-cutting need
   that two or more nodes/tools both want.

---

## Rollback

If Step 5 fails and you can't fix it quickly:

```bash
git checkout -- <graph-file>          # restore old graph.py
# leave langchain in deps — it's harmless to have installed
```

The migration is intentionally a single-file change so rollback is
one command.

---

## Things to double-check that often go wrong

- **Pre-bound models**: if `get_chat_model()` already calls `.bind_tools(...)`
  internally, `create_agent` will double-bind. Make `get_chat_model()` return
  a fresh, unbound model and let `create_agent` handle binding.
- **Async vs sync**: if your old `respond` was `async def`, that's fine —
  `create_agent` handles both. But verify your tools are `async def` if your
  app expects async dispatch (some MCP adapters require this).
- **Stream mode names**: `graph.astream(stream_mode=["messages", "custom"])`
  works identically. If your client subscribes to a different mode (`updates`,
  `values`), test that one too.
- **System prompt placement**: `create_agent` injects the system prompt on
  every model call. If your old code only added the prompt when
  `messages[0].type != "system"`, that conditional is no longer needed —
  remove the dead code.
- **`AnyMessage` vs `BaseMessage` imports**: `create_agent`'s state uses
  `BaseMessage`-compatible types. If you had `AnyMessage` in custom state,
  you can drop `AgentState` entirely unless you're extending state with
  custom keys.

---

## Estimated effort

- Reading the existing graph file and cataloging behaviors: 15–30 min
- Writing the new graph file: 10–20 min
- Smoke testing: 30–60 min depending on coverage
- Adding first middleware: 10 min

Total: **1–2 hours** for a typical agent. Add buffer if your tools rely on
custom state keys or your streaming pipeline is non-standard.

---

## Reference

- LangChain v1 release notes: https://docs.langchain.com/oss/python/releases/langchain-v1
- Middleware overview: https://docs.langchain.com/oss/python/langchain/middleware/built-in
- Custom middleware guide: https://docs.langchain.com/oss/python/langchain/middleware/custom
- `create_agent` API: https://docs.langchain.com/oss/python/langchain/agents
