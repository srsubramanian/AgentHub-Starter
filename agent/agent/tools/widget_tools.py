"""Widget tools for LangGraph — create, update, remove widgets.

The LLM calls these as tools. Each tool emits an AG-UI custom event
via the LangGraph StreamWriter so the frontend can render the widget.
"""

from __future__ import annotations

from langchain_core.tools import tool
from langgraph.config import get_stream_writer
from ulid import ULID

from agent.events import widget_create_event
from agent.widgets import (
    ConfirmationWidget,
    LogLine,
    LogTailWidget,
    SummaryCardWidget,
    SummaryItem,
    TimeseriesChartWidget,
    TimeseriesPoint,
    TimeseriesSeries,
    WidgetAction,
)


@tool
def create_summary_card(
    title: str,
    items: list[dict[str, str]],
) -> str:
    """Create a summary card widget in the canvas with key/value pairs.

    Args:
        title: Title for the summary card.
        items: List of dicts with 'label', 'value', and optional 'trend' (up/down/flat/none) keys.

    Returns:
        Confirmation message with the widget ID.
    """
    writer = get_stream_writer()

    widget = SummaryCardWidget(
        id=str(ULID()),
        title=title,
        status="complete",
        placement="canvas",
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
    return f"Created summary card '{title}' (id={widget.id})"


@tool
def create_timeseries_chart(
    title: str,
    series: list[dict[str, object]],
    x_label: str = "Time",
    y_label: str = "Value",
) -> str:
    """Create a timeseries line chart widget in the canvas.

    Args:
        title: Title for the chart.
        series: List of series, each with 'name' (str) and 'data' (list of
                dicts with 'timestamp' and 'value' keys).
        x_label: Label for the X axis.
        y_label: Label for the Y axis.

    Returns:
        Confirmation message with the widget ID.
    """
    writer = get_stream_writer()

    parsed_series = []
    for s in series:
        points = []
        raw_data = s.get("data", [])
        if isinstance(raw_data, list):
            for pt in raw_data:
                if isinstance(pt, dict):
                    points.append(
                        TimeseriesPoint(
                            timestamp=str(pt.get("timestamp", "")),
                            value=float(pt.get("value", 0)),
                        )
                    )
        parsed_series.append(
            TimeseriesSeries(name=str(s.get("name", "")), data=points)
        )

    widget = TimeseriesChartWidget(
        id=str(ULID()),
        title=title,
        status="complete",
        placement="canvas",
        series=parsed_series,
        x_label=x_label,
        y_label=y_label,
    )

    writer(widget_create_event(widget))
    return f"Created timeseries chart '{title}' (id={widget.id})"


@tool
def create_log_tail(
    title: str,
    lines: list[dict[str, str]],
    max_lines: int = 200,
) -> str:
    """Create a log tail widget in the canvas showing log lines with severity.

    Args:
        title: Title for the log viewer.
        lines: List of dicts with 'timestamp', 'message', and 'severity'
               (debug/info/warn/error) keys.
        max_lines: Maximum number of lines to retain.

    Returns:
        Confirmation message with the widget ID.
    """
    writer = get_stream_writer()

    widget = LogTailWidget(
        id=str(ULID()),
        title=title,
        status="complete",
        placement="canvas",
        max_lines=max_lines,
        lines=[
            LogLine(
                timestamp=line.get("timestamp", ""),
                message=line.get("message", ""),
                severity=line.get("severity", "info"),  # type: ignore[arg-type]
            )
            for line in lines
        ],
    )

    writer(widget_create_event(widget))
    return f"Created log tail '{title}' (id={widget.id})"


@tool
def create_confirmation(
    title: str,
    message: str,
) -> str:
    """Create a confirmation widget in the canvas with confirm/reject buttons.

    Use this when you need the user to approve or reject an action before proceeding.

    Args:
        title: Title for the confirmation prompt.
        message: Detailed description of what needs confirmation.

    Returns:
        Confirmation message with the widget ID.
    """
    writer = get_stream_writer()

    widget = ConfirmationWidget(
        id=str(ULID()),
        title=title,
        status="draft",
        placement="canvas",
        message=message,
        actions={
            "confirm": WidgetAction(label="Confirm"),
            "reject": WidgetAction(label="Reject"),
        },
    )

    writer(widget_create_event(widget))
    return f"Created confirmation prompt '{title}' (id={widget.id})"


# Collect all widget tools for binding to the model
WIDGET_TOOLS = [
    create_summary_card,
    create_timeseries_chart,
    create_log_tail,
    create_confirmation,
]
