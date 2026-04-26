"""AG-UI event emission helpers.

Translates widget operations into AG-UI CustomEvent objects that are
streamed to the frontend via LangGraph's StreamWriter.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ag_ui.core import CustomEvent, EventType

if TYPE_CHECKING:
    from agent.widgets import Widget


def widget_create_event(widget: Widget) -> CustomEvent:
    """Build an AG-UI custom event for widget creation."""
    return CustomEvent(
        type=EventType.CUSTOM,
        name="widget_create",
        value=widget.model_dump(by_alias=True, exclude_none=True),
    )


def widget_update_event(widget_id: str, patch: list[dict[str, object]]) -> CustomEvent:
    """Build an AG-UI custom event for widget update (JSON Patch)."""
    return CustomEvent(
        type=EventType.CUSTOM,
        name="widget_update",
        value={"widget_id": widget_id, "patch": patch},
    )


def widget_remove_event(widget_id: str) -> CustomEvent:
    """Build an AG-UI custom event for widget removal."""
    return CustomEvent(
        type=EventType.CUSTOM,
        name="widget_remove",
        value={"widget_id": widget_id},
    )
