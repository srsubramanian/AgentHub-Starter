# Plan: Human-in-the-Loop approvals in raw LangGraph (no `create_agent`)

A detailed plan for adding `HumanInTheLoopMiddleware`-equivalent behavior to a
LangGraph agent that uses a manually wired `StateGraph` (i.e. `respond → tools
→ respond` shape with `InMemorySaver` and an AG-UI streaming pipeline). Stays
in raw LangGraph — no migration to `create_agent` required.

Written so a fresh agent (Claude Code instance, teammate) can apply it without
prior context.

---

## Goal

Pause the agent before specific tool calls, surface the pending call to the
user via the existing AG-UI streaming pipeline, wait for an approve/reject
decision, then either:

- **Approved** → run the tool as normal and continue the agent loop
- **Rejected** → inject a synthetic `ToolMessage` saying the user rejected
  the call, and route control back to the model so it can respond
  appropriately

This is what `langchain.agents.middleware.HumanInTheLoopMiddleware` does inside
`create_agent`. We're rebuilding the same behavior using LangGraph primitives
(`interrupt()`, conditional edges, the existing checkpointer) so the agent's
graph stays explicit and under our control.

---

## When this plan applies

Apply this plan if **all** of the following match the target codebase:

1. The agent is a compiled `StateGraph` with two nodes:
   - A model-calling node (often called `respond`, `model`, or `agent`) that
     calls `model.bind_tools(...)` then `ainvoke`
   - A tool-dispatch node (often `tools` or `call_tools`) wrapping
     `langgraph.prebuilt.ToolNode`
2. A conditional edge routes `respond → tools` when the last message has tool
   calls, else routes to `END` (typically a `should_continue` function)
3. A checkpointer is configured on the compiled graph. `InMemorySaver` is
   sufficient for development; Postgres or another durable saver is required
   for production HITL because pending interrupts are lost on restart.
4. The agent streams responses back to a client. Either AG-UI protocol with
   custom events, plain `astream` with `stream_mode=["messages","custom"]`, or
   any pipeline that can push a structured payload to the client mid-stream.
5. There is a frontend (or some client) that can render an approval prompt
   and call back into the agent to resume.

If any of these don't match, stop and re-evaluate. In particular: if there's
no checkpointer, `interrupt()` will not work — interrupts persist via the
checkpointer.

---

## Architecture

Insert a new node, `approval_gate`, between the model node and the tool
dispatch node. The current shape:

```
START → respond → [should_continue] → tools → respond → ... → END
                                    ↘ END
```

becomes:

```
START → respond → [should_continue]
                      ↓ has tool calls
                  approval_gate → [after_approval]
                                    ↓ approved        ↓ rejected
                                  tools             respond
                                    ↓
                                  respond → ... → END
```

The `approval_gate` node:

1. Reads `state["messages"][-1]` and inspects its `tool_calls`
2. For each call whose `name` is in a configured `INTERRUPT_TOOLS` set:
   - Emits a structured event to the streaming pipeline so the client can
     render an approval prompt
   - Calls `interrupt(...)` from `langgraph.types`, which suspends execution
     and persists state via the checkpointer
   - When resumed, reads the user's decision from the value passed to
     `Command(resume=...)`
3. If any decision was "reject", returns synthetic `ToolMessage` records for
   those calls so the model is told they didn't run
4. Otherwise returns nothing, allowing routing to proceed to `tools`

**Why a separate node and not wrapping `ToolNode`:** `interrupt()` raises and
unwinds the call stack. Putting it inside a node whose only job is to be
interruptible keeps the tool dispatch node pure and easy to reason about. It
also means you can add other pre-tool concerns (logging, validation,
rate-limiting) to the same gate later.

**Why a conditional edge after the gate and not a single edge to `tools`:**
when the user rejects, we need to route back to the model with the synthetic
rejection messages so it can respond. That's a different destination than
when the user approves.

---

## Backend changes

### File: `agent/agent/graph.py`

Add the gate node, the rejection router, and rewire the edges. The full
diff-shaped change:

```python
# new imports
from langgraph.types import interrupt
from langchain_core.messages import ToolMessage

# Tools that require user approval before execution.
# Keep this conservative — start with destructive / external-side-effect
# operations only. Read-only AWS list operations should NOT be in this set.
INTERRUPT_TOOLS: set[str] = {
    # Add destructive tool names here as they're built.
    # Examples (none of these exist in the project today):
    # "delete_lambda_function",
    # "stop_ec2_instance",
    # "terminate_ec2_instance",
}


async def approval_gate(state: AgentState) -> AgentState:
    """Pause for user approval before any tool call in INTERRUPT_TOOLS.

    On suspend: state is checkpointed by the configured checkpointer.
    On resume: the value passed to Command(resume=...) is returned by interrupt().

    The resume contract this node expects is:
        {"approvals": {"<tool_call_id>": True | False, ...}}

    Tool calls whose IDs are missing from `approvals` default to rejected
    (fail-closed). Tool calls whose names are not in INTERRUPT_TOOLS pass
    through unchanged.
    """
    last = state["messages"][-1]
    tool_calls = getattr(last, "tool_calls", []) or []

    # Identify which calls actually need gating
    gated = [c for c in tool_calls if c["name"] in INTERRUPT_TOOLS]
    if not gated:
        return {"messages": []}

    # Emit a streaming event per gated call so the client can render approval UI.
    # Reuses the project's existing custom-event helper. The `confirmation` widget
    # is already implemented and is a natural fit.
    from agent.events import emit_widget_create  # adjust import to match project

    for call in gated:
        emit_widget_create(
            widget_type="confirmation",
            data={
                "kind": "tool_approval",
                "tool_call_id": call["id"],
                "tool_name": call["name"],
                "tool_args": call["args"],
                "message": f"Approve call to {call['name']}?",
            },
        )

    # Suspend. The graph checkpoints state here. The client must POST back
    # with { "approvals": { "<id>": true | false, ... } } via Command(resume=...).
    decision = interrupt({
        "kind": "tool_approval",
        "calls": [
            {"tool_call_id": c["id"], "tool_name": c["name"], "tool_args": c["args"]}
            for c in gated
        ],
    })

    approvals: dict[str, bool] = (decision or {}).get("approvals", {})

    rejected_messages: list[ToolMessage] = []
    for call in gated:
        approved = approvals.get(call["id"], False)  # default reject
        if not approved:
            rejected_messages.append(
                ToolMessage(
                    content=(
                        f"User rejected the call to `{call['name']}`. "
                        "Do not retry this exact call. Either ask the user "
                        "for clarification or proceed without this tool."
                    ),
                    tool_call_id=call["id"],
                )
            )

    if rejected_messages:
        return {"messages": rejected_messages}
    return {"messages": []}


def after_approval(state: AgentState) -> str:
    """Route after the gate.

    If any of the most recent messages are synthetic rejection ToolMessages
    (one per rejected call), go back to `respond` so the model can react.
    Otherwise dispatch the (now-approved) tool calls.
    """
    # Walk backwards through ToolMessages added by approval_gate.
    # If we find at least one rejection sentinel, route to respond.
    for msg in reversed(state["messages"]):
        if not isinstance(msg, ToolMessage):
            break
        if "User rejected" in (msg.content or ""):
            return "respond"
    return "tools"
```

Wire it into the graph:

```python
builder = StateGraph(AgentState)
builder.add_node("respond", respond)
builder.add_node("approval", approval_gate)   # new
builder.add_node("tools", call_tools)

builder.add_edge(START, "respond")
# CHANGED: route to approval, not directly to tools
builder.add_conditional_edges(
    "respond", should_continue, {"tools": "approval", END: END}
)
# NEW: after approval, either dispatch tools or go back to respond
builder.add_conditional_edges(
    "approval", after_approval, {"tools": "tools", "respond": "respond"}
)
builder.add_edge("tools", "respond")

graph = builder.compile(checkpointer=checkpointer)
```

Important: the `should_continue` mapping changes from `{"tools": "tools"}` to
`{"tools": "approval"}`. The approval node fans out to either `tools` or
`respond`.

### File: `agent/agent/main.py` — handle resume

The current run endpoint builds an AG-UI `RunAgentInput` and calls
`graph.astream(input, config)`. For HITL we need a second path that resumes
an interrupted thread.

```python
from langgraph.types import Command

class ResumeRequest(BaseModel):
    thread_id: str
    approvals: dict[str, bool]   # tool_call_id -> approved


@app.post("/agent/resume")
async def resume(req: ResumeRequest) -> StreamingResponse:
    config = {"configurable": {"thread_id": req.thread_id}}
    cmd = Command(resume={"approvals": req.approvals})
    return StreamingResponse(
        stream_agent_response_command(graph, cmd, config),
        media_type="text/event-stream",
    )
```

`stream_agent_response_command` is a thin variant of `stream_agent_response`
that accepts a `Command` instead of a `RunAgentInput`. The streaming logic
is otherwise identical — the same `astream(stream_mode=["messages","custom"])`
pipeline emits events, and `messages` deltas + `custom` widget events flow
back to the client exactly as for a fresh run.

If `stream_agent_response` already accepts `Any` for input, you can reuse it.
Verify by reading the current function signature.

### Optional: surface the `__interrupt__` event explicitly

`graph.astream(stream_mode=["updates"])` emits `__interrupt__` payloads when
a node calls `interrupt()`. With this plan you don't need to subscribe to
that mode because the `confirmation` widget event (emitted *before*
`interrupt()`) carries everything the client needs. But if you want the
client to also receive a redundant "the agent is paused" signal, add
`"updates"` to the existing `stream_mode` list and forward the
`__interrupt__` records.

---

## Frontend changes

### File: `app/api/agent/resume/route.ts` (Next.js)

Mirror the existing `app/api/agent/run/route.ts` but proxy to
`POST {AGENT_URL}/agent/resume`. ~10 lines. The body is just
`{ thread_id, approvals }`.

### File: `lib/agent-reducer.ts`

Recognize approval-pending widgets. The reducer already handles
`widget_create` events, so the only change is to track whether the current
thread has any unresolved approvals.

```ts
// add to state
type AgentState = {
  // ...existing
  pendingApprovals: Record<string, ApprovalRequest>;  // keyed by tool_call_id
};

// in the reducer's widget_create case, when data.kind === "tool_approval":
state.pendingApprovals[data.tool_call_id] = {
  toolCallId: data.tool_call_id,
  toolName: data.tool_name,
  toolArgs: data.tool_args,
  widgetId: event.widget_id,
};
```

When the user resolves an approval, clear the entry from
`pendingApprovals`. The widget itself can stay on the canvas (or you can
emit a `widget_remove` from the backend when resuming — your call).

### File: confirmation widget component

The component already exists. Update it so that when
`data.kind === "tool_approval"`:

- Render Approve / Reject buttons
- Show the tool name and a JSON view of args
- On click, call:

```ts
async function decide(approved: boolean) {
  setSubmitting(true);
  await fetch("/api/agent/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      thread_id: threadId,
      approvals: { [data.tool_call_id]: approved },
    }),
  });
  // The same useAgent stream continues in the background — events from the
  // resumed run flow into the existing reducer. No remount needed.
}
```

### File: `lib/use-agent.ts`

Important behavior to verify: when the user clicks Approve/Reject, the
existing `useAgent` hook must accept new SSE events on the same thread
without tearing down its state. Two options:

- **Option A (recommended):** the resume endpoint streams events into a
  *new* SSE connection that `useAgent` opens when `decide()` is called.
  `useAgent` already has reducer-driven state, so a second stream just
  appends events to the same reducer.
- **Option B:** keep the original SSE connection alive and have the backend
  push resumed events down it. This is more complex and not the AG-UI
  default; skip it.

Implement Option A by exposing a `resume(approvals)` method from
`useAgent` that opens a fresh `EventSource` against `/api/agent/resume`
with the same `thread_id`.

### Approving multiple calls at once

If the model emits two gated tool calls in one assistant turn, the gate
fires `interrupt()` once but the resume payload carries both IDs. Render
two confirmation widgets (one per call), but consolidate the resume into
one POST that includes the full `approvals` map. This avoids race
conditions where the user approves one and the graph resumes before the
second decision is made.

Implementation: the frontend collects pending approvals tied to the same
`thread_id`. The Approve/Reject buttons disable until all pending
approvals for that thread have a decision, then the consolidated
`approvals` map is sent in a single `/agent/resume` call.

---

## API contract summary

**`POST /agent/run`** (unchanged) — start or continue a thread with a new
user message. Streams SSE events.

**`POST /agent/resume`** (new) — resume a paused thread.

Request body:

```json
{
  "thread_id": "string",
  "approvals": { "<tool_call_id>": true | false, ... }
}
```

Response: SSE stream with the same event types as `/agent/run`.

Frontend convention: tool calls whose IDs are not in the `approvals` map
default to rejected on the backend (fail-closed). The frontend should
always send a complete map.

---

## Test plan

Run these in order. Each isolates a different layer.

1. **Tool not in `INTERRUPT_TOOLS`** — send a message that triggers an
   ungated tool. Confirm:
   - No confirmation widget appears
   - Behavior is identical to pre-change

2. **Tool in `INTERRUPT_TOOLS`, approve** — send a message that triggers
   a gated tool. Confirm:
   - Confirmation widget renders with correct tool name and args
   - Stream pauses (no further `messages` events arrive)
   - Click Approve → `/agent/resume` POST goes out
   - Tool runs, follow-up assistant message streams back

3. **Tool in `INTERRUPT_TOOLS`, reject** — same setup, click Reject:
   - Tool does **not** run
   - Synthetic `ToolMessage` is added to state (verify via checkpointer
     inspection or by examining the next assistant message)
   - Assistant produces a follow-up message acknowledging the rejection

4. **Mixed gated + ungated tool calls in one turn** — engineer a prompt
   where the model emits both. Confirm:
   - The whole turn pauses (the gate halts before any tool runs)
   - Both tool calls are surfaced for approval
   - Approving the gated one runs both; rejecting it runs only the
     ungated one and synthesizes a rejection for the gated one

5. **Two gated calls in one turn** — confirm both confirmation widgets
   render and the resume payload carries both decisions.

6. **Resume with stale `thread_id`** — POST to `/agent/resume` with a
   `thread_id` that has no pending interrupt. Confirm:
   - Backend returns a clear error (4xx)
   - Frontend handles it gracefully

7. **Resume after agent restart** — pause an interrupt, restart the
   agent container, then try to resume. With `InMemorySaver` this
   **must fail** because state is lost. Document the failure mode in
   `docs/` and the UI. With a durable checkpointer (Postgres), this
   should succeed.

8. **Concurrent threads** — open two browser tabs with different
   `thread_id`s. Pause both. Resume one. Confirm the other stays paused
   and is unaffected.

9. **Multi-turn after rejection** — after a rejection, send another user
   message on the same thread. Confirm the conversation continues
   normally and the rejection is preserved in history.

---

## Caveats and gotchas

1. **`interrupt()` requires a checkpointer.** This project already has
   `InMemorySaver` configured, so the mechanism works. However, in-memory
   means pending approvals are lost on agent restart. For production HITL
   you must move to a durable saver (Postgres is on the project's roadmap
   as Phase 7). Document this clearly in the UI.

2. **`interrupt()` re-runs the node from the top on resume.** Specifically,
   when the graph resumes after an `interrupt()`, the node where the
   interrupt was raised is re-executed from the beginning. The
   `interrupt()` call itself returns the resume value instead of suspending
   again. This means **any side effects above `interrupt()` in the node
   will run twice** — the streaming event emission included.

   In this plan, that means `emit_widget_create` is called once on initial
   pass and again on resume. Two safe options:
   - Make the emission idempotent on the client (deduplicate on
     `tool_call_id`)
   - Move the emission below the interrupt in a way that only fires on
     fresh pass (use a state flag)

   Recommended: client-side dedup keyed on `tool_call_id`. Easier and
   matches the LangGraph idiom.

3. **Streaming pipeline must not buffer the interrupt.** The
   `confirmation` widget event must reach the client *before* the stream
   waits for resume. Verify your SSE flush behavior — some proxies (nginx,
   CDNs) buffer SSE by default. If you see the widget appear only after
   resume, that's a buffering problem, not a graph problem.

4. **AG-UI does not have a standard interrupt event.** This plan
   piggy-backs on the existing `confirmation` widget. Document this
   convention in `docs/widgets.md` so future client implementations
   know about it.

5. **Configuring `INTERRUPT_TOOLS` for MCP-loaded tools.** If MCP servers
   contribute destructive tools, decide how they're added to the gated
   set. Options:
   - **Static allowlist** — edit `INTERRUPT_TOOLS` by hand. Simple,
     works for now.
   - **Per-server config** — extend `mcp_servers.json` with a
     `gated_tools` array per server. Cleanest for production.
   - **Auto-include all MCP tools** — overly aggressive; will frustrate
     users with gated read-only operations.

   Start with static, move to per-server config when MCP usage grows.

6. **The fail-closed default matters.** If the resume payload omits a
   tool call ID, the gate treats it as rejected. This is intentional —
   never let a destructive call through because of a partial decision.

7. **`should_continue` change is load-bearing.** The mapping from
   `"tools": "tools"` to `"tools": "approval"` is the single line that
   actually inserts the gate into the loop. Easy to miss in code review.

---

## Rollout sequence

Suggested order to land this safely:

1. **Backend graph wiring with empty `INTERRUPT_TOOLS`.** Ship the new
   node and routing with the gated set empty. Behavior is identical to
   before. Run all existing tests. Merge.
2. **Resume endpoint and frontend resume hook.** Ship `/agent/resume`,
   the Next.js proxy, and `useAgent.resume()`. Still no gated tools —
   the endpoint is unreachable in practice. Merge.
3. **Confirmation widget UI.** Add Approve / Reject buttons gated on
   `data.kind === "tool_approval"`. Merge.
4. **Add the first gated tool.** Pick a real destructive operation
   (or build a fake "delete_test_resource" tool to exercise the path).
   Run the full test plan. Iterate.
5. **Document in `docs/widgets.md` and `CLAUDE.md`.** Include the
   `INTERRUPT_TOOLS` convention and the in-memory-saver caveat.

Each step is independently mergeable.

---

## Estimated effort

- Step 1 (backend graph + node): 1.5 hours including unit tests
- Step 2 (resume endpoint + frontend hook): 1.5 hours
- Step 3 (widget UI): 1 hour
- Step 4 (first gated tool + end-to-end test): 1 hour
- Step 5 (docs): 30 min

Total: **~5 hours** for a careful rollout. The unknown is the
streaming-buffering behavior in step 4 (caveat #3) — if SSE flushing
turns out to be wrong somewhere in the proxy chain, debugging that
could add another 1–2 hours.

---

## Reference

- LangGraph interrupts: https://docs.langchain.com/oss/python/langgraph/interrupts
- `interrupt()` API: https://langchain-ai.github.io/langgraph/reference/types/#langgraph.types.interrupt
- `Command` for resume: https://langchain-ai.github.io/langgraph/reference/types/#langgraph.types.Command
- `HumanInTheLoopMiddleware` (the `create_agent` equivalent, useful for
  comparing semantics): https://docs.langchain.com/oss/python/langchain/middleware/built-in
- LangGraph fault tolerance + interrupt behavior:
  https://docs.langchain.com/oss/python/langgraph/fault-tolerance
