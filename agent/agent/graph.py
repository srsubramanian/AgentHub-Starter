"""LangGraph state graph for the AgentHub agent.

Phase 3: AWS discovery agent with widget tools.
The agent can query AWS resources (Lambda, Logs, EC2) and create
summary cards. All tools emit results into canvas widgets.
"""

from __future__ import annotations

from typing import Annotated

from langchain_core.messages import AnyMessage  # noqa: TCH002
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from typing_extensions import TypedDict

from agent.bedrock import get_chat_model
from agent.tools.aws_tools import AWS_TOOLS
from agent.tools.widget_tools import WIDGET_TOOLS

# ---------------------------------------------------------------------------
# Graph state
# ---------------------------------------------------------------------------

ALL_TOOLS = [*WIDGET_TOOLS, *AWS_TOOLS]


class AgentState(TypedDict):
    """State flowing through the graph."""

    messages: Annotated[list[AnyMessage], add_messages]


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a helpful cloud operations assistant with access to AWS tools.

You can:
- List Lambda functions, CloudWatch Log Groups, and EC2 instances
- Get AWS account information
- Create summary cards to highlight key findings

When the user asks about AWS resources, use the appropriate tool to fetch \
real data. After getting results, provide a brief text summary of what was found.

If a tool returns an error (e.g. access denied), explain the error clearly \
and suggest what permissions might be needed.

For general questions not about AWS, respond normally and optionally create \
a summary card with key points."""


async def respond(state: AgentState) -> AgentState:
    """Call the LLM with tools bound."""
    model = get_chat_model().bind_tools(ALL_TOOLS)

    # Prepend system prompt if not already present
    messages = state["messages"]
    if not messages or messages[0].type != "system":
        from langchain_core.messages import SystemMessage

        messages = [SystemMessage(content=SYSTEM_PROMPT), *messages]

    response = await model.ainvoke(messages)
    return {"messages": [response]}


def should_continue(state: AgentState) -> str:
    """Route: if the last message has tool calls, go to tools; else end."""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

tool_node = ToolNode(ALL_TOOLS)

builder = StateGraph(AgentState)
builder.add_node("respond", respond)
builder.add_node("tools", tool_node)

builder.add_edge(START, "respond")
builder.add_conditional_edges("respond", should_continue, {"tools": "tools", END: END})
builder.add_edge("tools", "respond")

# Compile with in-memory checkpointer
checkpointer = InMemorySaver()
graph = builder.compile(checkpointer=checkpointer)
