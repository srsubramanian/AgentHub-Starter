# AG-UI in AgentHub-Starter — Technical Slide Notes

Audience: engineers familiar with web apps and LLMs but new to agent UI protocols.
Goal: explain *what AG-UI is*, *how it is wired up in this repo*, and *what we lose without it*.
Style: dense technical bullets, code-pointers as `path:line`, ready for the Claude PowerPoint add-in.

---

## Slide 1 — Title

**AG-UI in AgentHub-Starter**
A streaming protocol for chat-plus-canvas agent UIs.

Subtitle: Next.js 15 + React 19 frontend ⇄ FastAPI + LangGraph + Bedrock backend, joined by the AG-UI SSE event protocol.

Speaker notes:
- One-line definition: AG-UI = a typed event protocol over SSE that standardises how an agent backend streams *text tokens*, *tool calls*, and *custom UI events* to a browser.
- This deck shows how the repo uses it end-to-end and why the alternatives are worse.

---

## Slide 2 — The problem AG-UI solves

Modern agents emit several kinds of output simultaneously:

- Streaming **LLM tokens** (the text bubble).
- **Tool calls** the model decided to make.
- **Tool results** that may produce structured artifacts (tables, charts, log tails, approval prompts).
- **Lifecycle markers** (run started, run finished, errors).

Without a protocol you end up either:

- Inventing a one-off SSE/JSON schema (every team reinvents `{type: "delta", text: "..."}`), or
- Forcing the LLM to render UI in chat (markdown tables, fenced JSON), which is brittle, slow, and uneditable, or
- Using request/response only — no streaming, terrible UX for long agent runs.

**AG-UI** is the standard event vocabulary for this exact problem: text streaming + tool calls + custom events + run lifecycle, defined as Pydantic/TS types and emitted as SSE.

---

## Slide 3 — What AG-UI gives you (concretely)

Typed event vocabulary used by this repo:

| Event | When it fires |
|---|---|
| `RUN_STARTED` | First event of every run |
| `TEXT_MESSAGE_START` | Before the first token of an assistant message |
| `TEXT_MESSAGE_CONTENT` | Each LLM token chunk (`delta` field) |
| `TEXT_MESSAGE_END` | After the last token |
| `CUSTOM` | Anything app-specific — here, `widget_create` / `widget_update` / `widget_remove` |
| `RUN_FINISHED` | Last event of every run |

Wire format: plain SSE — `data: <json>\n\n` per event. No bespoke framing.

Two officially-supported pieces in this repo:
- **Python**: `ag_ui.core` Pydantic models (`RunAgentInput`, `CustomEvent`, etc.) — used in `agent/agent/main.py:10`.
- **TypeScript**: `@ag-ui/client` `HttpAgent` — used in `lib/use-agent.ts:4`.

---

## Slide 4 — Architecture in one picture

```
Browser (Next.js)                          Agent (FastAPI + LangGraph)
─────────────────                          ─────────────────────────────
chat composer
   │ POST /api/agent/run (RunAgentInput)
   ▼
useAgent hook ──► Next.js Route Handler ──► /agent/run (SSE proxy)
(lib/use-agent.ts)   (app/api/agent/run/route.ts)        │
   ▲                                                     ▼
   │ SSE: TEXT_*, CUSTOM, RUN_*       graph.astream(stream_mode=["messages","custom"])
   │                                                     │
HttpAgent parses SSE                          ┌──────────┴───────────┐
   │                                          ▼                      ▼
agentReducer dispatches              messages mode             custom mode
   │                                 (LLM token chunks)        (writer(CustomEvent))
   ▼                                          │                      │
React re-renders chat + canvas        TextMessageContentEvent   widget_create / update / remove
```

Speaker notes:
- The Route Handler (`app/api/agent/run/route.ts:1`) is a thin reverse proxy — same-origin for the browser, future hook for JWT verification.
- The agent uses LangGraph’s `astream` with **two stream modes** (`messages`, `custom`) and translates each into AG-UI events.

---

## Slide 5 — Backend: emitting AG-UI events

`agent/agent/main.py::stream_agent_response` (lines 109–210) is the SSE generator.

Pseudocode skeleton:

```python
yield _sse(RunStartedEvent(...))                                # lifecycle

async for mode, event in graph.astream(
    {"messages": [HumanMessage(content=content)]},
    config={"configurable": {"thread_id": thread_id}},
    stream_mode=["messages", "custom"],
):
    if mode == "messages":
        chunk, metadata = event
        # filter: only the "respond" node, only text deltas
        text = _extract_text_delta(chunk.content)
        if first_token: yield _sse(TextMessageStartEvent(...))
        yield _sse(TextMessageContentEvent(delta=text, ...))

    elif mode == "custom":
        if isinstance(event, CustomEvent):
            yield _sse(event)                                   # pass through

yield _sse(TextMessageEndEvent(...))
yield _sse(RunFinishedEvent(...))
```

Encoder is one line:

```python
def _sse(event: BaseEvent) -> str:
    return f"data: {event.model_dump_json(by_alias=True, exclude_none=True)}\n\n"
```

Key point: **the LLM never writes AG-UI JSON itself**. Token text is emitted by LangGraph’s `messages` mode; structured UI is emitted by **tools** that call `get_stream_writer()` (LangGraph’s `custom` mode).

---

## Slide 6 — Custom events = widgets

We layer three app-level event names on top of `CUSTOM`:

| name | value shape |
|---|---|
| `widget_create` | full widget object |
| `widget_update` | `{widget_id, patch: <RFC 6902 JSON Patch>}` |
| `widget_remove` | `{widget_id}` |

Helpers in `agent/agent/events.py`:

```python
def widget_create_event(widget) -> CustomEvent:
    return CustomEvent(
        type=EventType.CUSTOM,
        name="widget_create",
        value=widget.model_dump(by_alias=True, exclude_none=True),
    )
```

A widget tool emits one (`agent/agent/tools/widget_tools.py:41`):

```python
@tool
def create_summary_card(title, items):
    writer = get_stream_writer()                # LangGraph stream writer
    widget = SummaryCardWidget(id=str(ULID()), title=title, items=[...], status="complete")
    writer(widget_create_event(widget))         # → arrives as CUSTOM event in browser
    return f"Created summary card '{title}' (id={widget.id})"
```

Why JSON Patch for updates? It lets a streaming tool push *small* deltas (a new row, a single field change) without resending the whole widget — mirrors how token deltas work for text.

---

## Slide 7 — Widget schema is the contract

Source of truth: `agent/agent/widgets.py` (Pydantic). Mirror: `lib/widgets.ts` (hand-maintained).

Widget types shipped (6):

- `summary_card` — key/value KPIs with trend arrows.
- `timeseries_chart` — recharts line chart with named series.
- `log_tail` — ring-buffered log lines with severity coloring.
- `results_table` — streaming columns/rows (good fit for JSON Patch updates).
- `confirmation` — yes/no with optional rejection reason (HITL).
- `query_plan` — editable Logs Insights query (placeholder UI).

Common base fields: `id` (ULID), `type`, `placement` (`canvas | inline`), `status`, `title`, `created_at`, `created_by_run`, `error_message`.

Convention from `CLAUDE.md`: change Pydantic and the TS types in the **same commit**.

---

## Slide 8 — Frontend: consuming AG-UI

`lib/use-agent.ts` wraps `@ag-ui/client`’s `HttpAgent`.

```ts
const agent = new HttpAgent({
  url: "/api/agent/run",
  threadId: crypto.randomUUID(),
  initialMessages: [],
});
agent.setMessages(agMessages);

await agent.runAgent({}, {
  onTextMessageStartEvent:   ({ event }) => dispatch({ type: "START_ASSISTANT_MESSAGE", messageId: event.messageId }),
  onTextMessageContentEvent: ({ event }) => dispatch({ type: "APPEND_TEXT", messageId: ..., delta: event.delta }),
  onCustomEvent:             ({ event }) => {
    if (event.name === "widget_create") dispatch({ type: "WIDGET_CREATE", widget: event.value });
    if (event.name === "widget_update") dispatch({ type: "WIDGET_UPDATE", widgetId, patch });
    if (event.name === "widget_remove") dispatch({ type: "WIDGET_REMOVE", widgetId });
  },
});
```

`HttpAgent` handles SSE parsing, reconnects, callback typing — we don’t hand-parse `event-stream` bytes.

State is a single `useReducer` (`lib/agent-reducer.ts`) with three concerns: `messages`, `widgets`, `isStreaming`.

---

## Slide 9 — Reducer and JSON Patch

The reducer is the only place AG-UI semantics turn into React state.

```ts
case "APPEND_TEXT":      // TextMessageContentEvent
  // mutate the message with matching id, append delta

case "WIDGET_CREATE":    // custom event widget_create
  return { ...state, widgets: [...state.widgets, widget] };

case "WIDGET_UPDATE":    // custom event widget_update
  // apply RFC 6902 JSON Patch via fast-json-patch
  const patched = applyPatch(structuredClone(w), patch, true, false);
  return patched.newDocument as Widget;

case "WIDGET_REMOVE":    // custom event widget_remove
  return widgets.filter(w => w.id !== id);
```

JSON Patch on both sides: `jsonpatch` (Python) and `fast-json-patch` (TS). Same wire format ⇒ no impedance mismatch.

---

## Slide 10 — Why two LangGraph stream modes

`graph.astream(stream_mode=["messages", "custom"])` returns `(mode, event)` tuples.

| Mode | What it yields | Mapped to AG-UI |
|---|---|---|
| `messages` | `(AIMessageChunk, metadata)` per token | `TEXT_MESSAGE_START / CONTENT / END` |
| `custom` | whatever the tool wrote via `get_stream_writer()` | `CUSTOM` (passed through unchanged) |

Filtering rules in `main.py`:
- Only emit text from the `respond` node — skip tool-call argument streaming.
- Skip chunks whose content is a `tool_call_chunks` list (no user-visible text there).
- Bedrock returns content as a list of typed blocks; we flatten with `_extract_text_delta` (see `CLAUDE.md` pitfall).

---

## Slide 11 — End-to-end sequence

```
User: "show lambdas in us-east-1"
 │
 ├─► RUN_STARTED                                                  (lifecycle)
 │
 ├─► TEXT_MESSAGE_START                                           (assistant thinking)
 ├─► TEXT_MESSAGE_CONTENT  delta="Looking up Lambdas..."           ← messages mode
 ├─► TEXT_MESSAGE_END
 │
 │   (LLM emits tool_call: list_lambda_functions)
 │   (tool runs, then emits widget event)
 │
 ├─► CUSTOM  name=widget_create  value={type:"results_table", ...} ← custom mode
 │
 ├─► TEXT_MESSAGE_START
 ├─► TEXT_MESSAGE_CONTENT  delta="Found 12 functions..."
 ├─► TEXT_MESSAGE_END
 │
 └─► RUN_FINISHED
```

Two channels co-streamed: prose on the left, structured artifacts on the right. The user sees the chart appear *before* the assistant finishes its summary.

---

## Slide 12 — What we’d lose without AG-UI

Pretend we ripped it out and only had hand-rolled SSE + markdown.

1. **No structured canvas.** Widgets become markdown blobs the LLM has to *render in prose*. Charts → ASCII art or screenshot links. Tables → markdown that can’t stream-update. Confirmation prompts → hope the user types “yes”.
2. **No streaming JSON Patch.** Either send full widget objects each time (huge over the wire, flicker) or invent a custom delta format.
3. **No typed callbacks on the client.** Hand-write SSE parser, hand-define event shapes, drift between Python and TS over time. Bugs around partial events, reconnect, backpressure.
4. **No protocol-level lifecycle.** No clean `RUN_STARTED / RUN_FINISHED` boundary — UIs that need to grey out the composer or scope error toasts have to reverse-engineer it from token timing.
5. **LLM forced to format UI.** Tokens spent on JSON syntax instead of reasoning. Higher latency, higher cost, fragile parsing on the client.
6. **No interop.** Switching the backend from LangGraph to anything else (Mastra, CrewAI, custom) means rewriting both ends. With AG-UI, only the server-side mapping changes — the browser code is untouched.
7. **Worse HITL.** Confirmation/approval widgets become inline buttons in markdown — no stable id, no patchable status, no clean way to mark `submitted` vs `complete`.

In short: lose AG-UI and you trade a **streaming, structured, typed UI** for a **chat-only, markdown-only, bespoke** UI — and you re-implement 30% of it badly.

---

## Slide 13 — Conventions worth memorising

From `CLAUDE.md`:

- **Widget schema source of truth: `agent/agent/widgets.py`.** TS mirrors it by hand.
- **The LLM never formats AG-UI events directly** — tools emit `CustomEvent` via `get_stream_writer()`.
- **Widget IDs are ULIDs** generated by the agent.
- **Widget updates use JSON Patch (RFC 6902).**
- **Tools merge at request time** (`NATIVE_TOOLS` + `_mcp_tools` in `_all_tools()` in `graph.py`).
- **Checkpointing is `InMemorySaver` for now** (Phase 7 swaps to `PostgresSaver`).
- **MCP loader handles each server independently** — failure is logged and skipped.

Common pitfalls:
- `get_stream_writer()` only works inside a graph node.
- Bedrock content is a list of blocks, not a string.
- `@ag-ui/client` callback names end in `Event` (`onCustomEvent`, `onTextMessageContentEvent`).

---

## Slide 14 — Where to look in the repo

| Concern | File |
|---|---|
| AG-UI event emission | `agent/agent/main.py` (`_sse`, `stream_agent_response`) |
| Custom event helpers | `agent/agent/events.py` |
| Widget schemas (Python) | `agent/agent/widgets.py` |
| Widget tools | `agent/agent/tools/widget_tools.py` |
| LangGraph wiring + stream modes | `agent/agent/graph.py` |
| FastAPI endpoint | `agent/agent/main.py::agent_run` |
| SSE proxy | `app/api/agent/run/route.ts` |
| AG-UI client hook | `lib/use-agent.ts` |
| Reducer + JSON Patch | `lib/agent-reducer.ts` |
| Widget types (TS) | `lib/widgets.ts` |
| Architecture deep-dive | `docs/architecture.md` |
| Frontend deep-dive | `docs/frontend.md` |

---

## Slide 15 — TL;DR

- AG-UI = SSE protocol with **typed events** for `text`, `tool calls`, `custom`, and `run lifecycle`.
- This repo maps **LangGraph’s `messages` stream mode → text events** and **`custom` stream mode → widget events** via a small SSE generator.
- Widgets are first-class: Pydantic schema on the server, TS mirror on the client, JSON-Patch-streamed updates, ULID-keyed.
- Without AG-UI: re-invent the protocol, lose the canvas, force the LLM to format UI in markdown, get worse latency, worse UX, worse interoperability.

End of deck.
