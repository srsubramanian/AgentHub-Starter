# Tools

Tools are functions the LLM can call. The agent has four tool categories:

| Category | File | What |
|----------|------|------|
| Widget tools | `agent/agent/tools/widget_tools.py` | Render UI on the canvas |
| AWS tools | `agent/agent/tools/aws_tools.py` | Make boto3 calls |
| Skills tools | `agent/agent/tools/skills_tools.py` | Load SKILL.md content |
| MCP tools | loaded async at startup | Anything from configured MCP servers |

All tools are merged at request time and bound to the model:

```python
model = get_chat_model().bind_tools(NATIVE_TOOLS + _mcp_tools)
```

## How tools are defined

Native tools use the `@tool` decorator from `langchain-core`:

```python
from langchain_core.tools import tool

@tool
def my_tool(param1: str, param2: int = 42) -> str:
    """One-line description the LLM uses to decide when to call this.

    Args:
        param1: What this is.
        param2: What this is.

    Returns:
        A string the LLM will see.
    """
    # ... do the work ...
    return "result the LLM sees"
```

Key points:

- **The docstring is a prompt** — the LLM uses it to decide when and
  how to call the tool. Be explicit.
- **Type annotations matter** — they generate the JSON Schema the LLM
  sees for parameters.
- **Return a string** — even structured data should be a JSON string.
  Tools that affect the canvas return a confirmation message and
  emit widgets via `stream_writer` separately.

## Tool calling flow

1. LLM in the `respond` node decides to call a tool, returns an
   `AIMessage` with `tool_calls`
2. `should_continue` routes to the `tools` node
3. `ToolNode` invokes each tool function, gets back a `ToolMessage`
4. Loop back to `respond` with the tool result in context
5. LLM either calls more tools or produces a final text answer

## Widget tools

In `agent/agent/tools/widget_tools.py`:

| Tool | Creates |
|------|---------|
| `create_summary_card(title, items)` | `summary_card` widget |
| `create_timeseries_chart(title, series, x_label, y_label)` | `timeseries_chart` widget |
| `create_log_tail(title, lines, max_lines)` | `log_tail` widget |
| `create_confirmation(title, message)` | `confirmation` widget |

Each one:
1. Builds a Pydantic widget object (auto-generates a ULID for `id`)
2. Calls `writer(widget_create_event(widget))` to emit a `CustomEvent`
3. Returns a confirmation string the LLM can reference

## AWS tools

In `agent/agent/tools/aws_tools.py`:

| Tool | Calls | Renders |
|------|-------|---------|
| `list_lambda_functions()` | `lambda:ListFunctions` | `results_table` |
| `list_log_groups()` | `logs:DescribeLogGroups` | `results_table` |
| `list_ec2_instances()` | `ec2:DescribeInstances` | `results_table` |
| `get_aws_account_summary()` | `sts:GetCallerIdentity` | `summary_card` |

Pattern (from `list_lambda_functions`):

```python
@tool
def list_lambda_functions() -> str:
    writer = get_stream_writer()
    widget_id = str(ULID())

    # 1. Emit the table in "running" state with column headers
    writer(widget_create_event(ResultsTableWidget(
        id=widget_id, title="Lambda Functions", status="running",
        columns=[...], rows=[],
    )))

    try:
        # 2. Make the AWS call
        client = boto3.client("lambda", region_name=AWS_REGION)
        response = client.list_functions()
        rows = [...]  # transform to table rows

        # 3. Update with results
        writer(widget_update_event(widget_id, [
            {"op": "replace", "path": "/status", "value": "complete"},
            {"op": "replace", "path": "/rows", "value": rows},
        ]))
        return f"Found {len(rows)} Lambda function(s)."

    except Exception as e:
        # 4. Update with the error message in the widget
        writer(widget_update_event(widget_id, [
            {"op": "replace", "path": "/status", "value": "error"},
            {"op": "replace", "path": "/error_message", "value": str(e)},
        ]))
        return f"Error listing Lambda functions: {e}"
```

This pattern (create-running → update-complete-or-error) gives users
visible feedback even on slow or failing API calls.

## Skills tools

`invoke_skill(name)` — loads the full body of a `SKILL.md` file by name.
The system prompt advertises available skills; the LLM calls
`invoke_skill` to pull a skill's runbook into context when relevant.

See [skills.md](./skills.md).

## MCP tools

Anything provided by configured MCP servers. They're loaded at startup
in `main.py`'s lifespan and merged into the tool registry. Tool names
are prefixed with the server name (e.g. `aws_docs_search_documentation`,
`github_list_repositories`) to avoid collisions.

See [mcp-servers.md](./mcp-servers.md).

## Adding a new native tool

1. Pick a category (or start a new file under `agent/agent/tools/`)
2. Define with `@tool` decorator
3. Add to the export list (`WIDGET_TOOLS`, `AWS_TOOLS`, etc.)
4. Update `NATIVE_TOOLS` in `graph.py` if you added a new category
5. Restart the agent

The LLM picks up new tools immediately because docstrings become tool
descriptions.

## Tool naming conventions

- **Verb-first** — `create_summary_card`, `list_lambda_functions`
- **Snake_case** — matches Python; the LLM sees these as-is
- **Disambiguate when needed** — `aws_docs_search_documentation` over
  `search_documentation`

## Pitfalls

- **`get_stream_writer()` only works inside a graph node.** Calling it
  outside a LangGraph context raises an error.
- **Tools must return strings.** Returning a `dict` works in some cases
  but is fragile across providers; stick to `str` (or JSON-stringified).
- **Tool errors don't stop the graph.** `ToolNode` catches exceptions
  and returns the error as a `ToolMessage` so the LLM can recover or
  explain. This is why `aws_tools` use try/except — to add user-visible
  context to errors.
