"""Widget tools for LangGraph — create, update, remove widgets.

The LLM calls these as tools. Each tool emits an AG-UI custom event
via the LangGraph StreamWriter so the frontend can render the widget.
"""

from __future__ import annotations

from langchain_core.tools import tool
from langgraph.config import get_stream_writer
from ulid import ULID

from agent.events import widget_create_event
from agent.widgets import SummaryCardWidget, SummaryItem


@tool
def create_summary_card(
    title: str,
    items: list[dict[str, str]],
    run_id: str = "",
) -> str:
    """Create a summary card widget in the canvas.

    Args:
        title: Title for the summary card.
        items: List of dicts with 'label' and 'value' keys.
        run_id: The current run ID for tracking.

    Returns:
        Confirmation message with the widget ID.
    """
    writer = get_stream_writer()

    widget = SummaryCardWidget(
        id=str(ULID()),
        title=title,
        status="complete",
        placement="canvas",
        created_by_run=run_id,
        items=[
            SummaryItem(
                label=item.get("label", ""),
                value=item.get("value", ""),
                trend=item.get("trend", "none"),  # type: ignore[arg-type]
            )
            for item in items
        ],
    )

    writer(widget_create_event(widget))

    return f"Created summary card widget '{title}' (id={widget.id})"


# Collect all widget tools for binding to the model
WIDGET_TOOLS = [create_summary_card]
