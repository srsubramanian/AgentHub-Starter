"""LangGraph state graph for the AgentHub agent.

The agent can query AWS resources, render canvas widgets, and call any
MCP server tools configured at startup. Native tools (widget + AWS) are
bound at module load. MCP tools are loaded async in the FastAPI lifespan
and merged in via `set_mcp_tools()` before requests are served.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from langchain_core.messages import AnyMessage  # noqa: TCH002
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from typing_extensions import TypedDict

from agent.bedrock import get_chat_model
from agent.skills_loader import skills_summary
from agent.tools.aws_tools import AWS_TOOLS
from agent.tools.skills_tools import SKILLS_TOOLS
from agent.tools.widget_tools import WIDGET_TOOLS

if TYPE_CHECKING:
    from langchain_core.tools import BaseTool

# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

NATIVE_TOOLS: list[BaseTool] = [*WIDGET_TOOLS, *AWS_TOOLS, *SKILLS_TOOLS]
_mcp_tools: list[BaseTool] = []


def set_mcp_tools(tools: list[BaseTool]) -> None:
    """Register MCP tools loaded at startup."""
    global _mcp_tools
    _mcp_tools = tools


def _all_tools() -> list[BaseTool]:
    return [*NATIVE_TOOLS, *_mcp_tools]


# ---------------------------------------------------------------------------
# Graph state
# ---------------------------------------------------------------------------


class AgentState(TypedDict):
    """State flowing through the graph."""

    messages: Annotated[list[AnyMessage], add_messages]


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a helpful cloud operations assistant with access to AWS tools \
and any MCP-server tools configured at startup.

You can:
- List Lambda functions, CloudWatch Log Groups, and EC2 instances
- Get AWS account information
- Create summary cards, charts, log tails, and confirmation widgets
- Call any additional tools provided by configured MCP servers

When the user asks about AWS resources, use the appropriate tool to fetch \
real data. After getting results, provide a brief text summary of what was found.

If a tool returns an error (e.g. access denied), explain the error clearly \
and suggest what permissions might be needed.

For general questions not about AWS, respond normally and optionally create \
a summary card with key points."""


async def respond(state: AgentState) -> AgentState:
    """Call the LLM with tools bound (native + MCP)."""
    model = get_chat_model().bind_tools(_all_tools())

    messages = state["messages"]
    if not messages or messages[0].type != "system":
        from langchain_core.messages import SystemMessage

        prompt = SYSTEM_PROMPT + skills_summary()
        messages = [SystemMessage(content=prompt), *messages]

    response = await model.ainvoke(messages)
    return {"messages": [response]}


def should_continue(state: AgentState) -> str:
    """Route: if the last message has tool calls, go to tools; else end."""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END


# ---------------------------------------------------------------------------
# Tool node — uses a callable so the tool list can grow at runtime
# ---------------------------------------------------------------------------


async def call_tools(state: AgentState) -> AgentState:
    """Dispatch tool calls against the current (native + MCP) tool list."""
    node = ToolNode(_all_tools())
    result = await node.ainvoke(state)
    return result  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

builder = StateGraph(AgentState)
builder.add_node("respond", respond)
builder.add_node("tools", call_tools)

builder.add_edge(START, "respond")
builder.add_conditional_edges("respond", should_continue, {"tools": "tools", END: END})
builder.add_edge("tools", "respond")

checkpointer = InMemorySaver()
graph = builder.compile(checkpointer=checkpointer)
