"""LangGraph state graph for the AgentHub agent.

Phase 2: Simple respond flow with widget tools.
The agent receives user messages, responds with text, and can create
summary_card widgets in the canvas.
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
from agent.tools.widget_tools import WIDGET_TOOLS

# ---------------------------------------------------------------------------
# Graph state
# ---------------------------------------------------------------------------


class AgentState(TypedDict):
    """State flowing through the graph."""

    messages: Annotated[list[AnyMessage], add_messages]


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are a helpful cloud operations assistant. "
    "When a user asks a question, respond with a concise answer. "
    "After answering, ALWAYS use the create_summary_card tool to create "
    "a summary card widget that highlights the key points of your response. "
    "The summary card should have a descriptive title and 2-4 items with "
    "label/value pairs summarizing the main points."
)


async def respond(state: AgentState) -> AgentState:
    """Call the LLM with tools bound."""
    model = get_chat_model().bind_tools(WIDGET_TOOLS)

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

tool_node = ToolNode(WIDGET_TOOLS)

builder = StateGraph(AgentState)
builder.add_node("respond", respond)
builder.add_node("tools", tool_node)

builder.add_edge(START, "respond")
builder.add_conditional_edges("respond", should_continue, {"tools": "tools", END: END})
builder.add_edge("tools", "respond")

# Compile with in-memory checkpointer
checkpointer = InMemorySaver()
graph = builder.compile(checkpointer=checkpointer)
