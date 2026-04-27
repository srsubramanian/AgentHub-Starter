"""FastAPI application — AG-UI streaming agent endpoint."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

import structlog
from ag_ui.core import (
    BaseEvent,
    CustomEvent,
    EventType,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import HumanMessage
from starlette.responses import StreamingResponse
from ulid import ULID

from agent.graph import graph, set_mcp_tools
from agent.logging_config import setup_logging
from agent.mcp_client import load_mcp_tools
from agent.skills_loader import load_skills
from agent.tasks import store as tasks_store
from agent.tasks.models import (
    SCHEDULE_PRESETS,
    CreateTaskRequest,
    ScheduledTask,
    TaskRun,
    UpdateTaskRequest,
)
from agent.tasks.runner import (
    execute_task,
    next_run_for,
    schedule_task,
    shutdown_scheduler,
    start_scheduler,
    unschedule_task,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, AsyncIterator

setup_logging()
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Load skills + MCP tools at startup, register them with the graph."""
    skills = load_skills()
    mcp_tools = await load_mcp_tools()
    set_mcp_tools(mcp_tools)
    start_scheduler()
    # Re-register any tasks that exist (will be empty in-memory, but keeps the
    # API consistent for when we swap to a persistent store).
    for task in tasks_store.list_tasks():
        try:
            schedule_task(task)
        except Exception:
            logger.exception("Failed to re-schedule task", task_id=task.id)
    logger.info(
        "Agent ready",
        skill_count=len(skills),
        mcp_tool_count=len(mcp_tools),
    )
    try:
        yield
    finally:
        shutdown_scheduler()


app = FastAPI(title="AgentHub Starter Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _sse(event: BaseEvent) -> str:
    """Encode an AG-UI event as an SSE data line."""
    return f"data: {event.model_dump_json(by_alias=True, exclude_none=True)}\n\n"


def _extract_text_delta(content: Any) -> str:
    """Extract text from a LangChain message content (str or list of blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict)
        )
    return ""


async def stream_agent_response(
    agent_input: RunAgentInput,
) -> AsyncGenerator[str, None]:
    """Stream AG-UI events from a LangGraph run."""
    thread_id = agent_input.thread_id
    run_id = agent_input.run_id

    # Extract the last user message
    user_messages = [m for m in agent_input.messages if m.role == "user"]
    if not user_messages:
        return

    last_user_msg = user_messages[-1]
    content = last_user_msg.content if isinstance(last_user_msg.content, str) else ""

    logger.info(
        "Starting agent run",
        thread_id=thread_id,
        run_id=run_id,
        user_message=content[:100],
    )

    # Emit RUN_STARTED
    yield _sse(
        RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=thread_id,
            run_id=run_id,
        )
    )

    # LangGraph config with thread_id for checkpointing
    config = {"configurable": {"thread_id": thread_id}}

    # Track message state for AG-UI text events
    current_message_id: str | None = None

    try:
        async for mode, event in graph.astream(  # type: ignore[call-overload]
            {"messages": [HumanMessage(content=content)]},
            config=config,
            stream_mode=["messages", "custom"],
        ):
            if mode == "messages":
                # LLM token streaming — event is (AIMessageChunk, metadata)
                chunk, metadata = event
                # Only emit for the "respond" node's LLM calls
                if metadata.get("langgraph_node") != "respond":
                    continue
                # Skip tool call chunks (they have no text content)
                if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
                    continue

                text = _extract_text_delta(chunk.content)
                if not text:
                    continue

                # Start a new message if needed
                if current_message_id is None:
                    current_message_id = str(uuid.uuid4())
                    yield _sse(
                        TextMessageStartEvent(
                            type=EventType.TEXT_MESSAGE_START,
                            message_id=current_message_id,
                            role="assistant",
                        )
                    )

                yield _sse(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=current_message_id,
                        delta=text,
                    )
                )

            elif mode == "custom":
                # Custom events from widget tools
                if isinstance(event, CustomEvent):
                    yield _sse(event)

    except Exception:
        logger.exception("Error during LangGraph run")
        raise
    finally:
        # Close any open text message
        if current_message_id is not None:
            yield _sse(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=current_message_id,
                )
            )

        # Emit RUN_FINISHED
        yield _sse(
            RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id,
            )
        )


@app.post("/agent/run")
async def agent_run(agent_input: RunAgentInput) -> StreamingResponse:
    """AG-UI streaming endpoint — receives RunAgentInput, streams SSE events."""
    return StreamingResponse(
        stream_agent_response(agent_input),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Scheduled tasks API
# ---------------------------------------------------------------------------


def _decorate(task: ScheduledTask) -> dict[str, Any]:
    """Return the task with computed next_run_at attached."""
    return {**task.model_dump(), "next_run_at": next_run_for(task)}


@app.get("/tasks/presets")
async def list_schedule_presets() -> list[dict[str, str]]:
    """Return human-friendly cron presets for the create form."""
    return SCHEDULE_PRESETS


@app.get("/tasks")
async def list_tasks() -> list[dict[str, Any]]:
    """List all scheduled tasks with computed next-run times."""
    return [_decorate(t) for t in tasks_store.list_tasks()]


@app.post("/tasks", status_code=201)
async def create_task(body: CreateTaskRequest) -> dict[str, Any]:
    task = ScheduledTask(
        id=str(ULID()),
        name=body.name,
        prompt=body.prompt,
        cron=body.cron,
        timezone=body.timezone,
        enabled=body.enabled,
    )
    tasks_store.upsert_task(task)
    try:
        schedule_task(task)
    except Exception as e:
        # Roll back if the cron is invalid
        tasks_store.delete_task(task.id)
        raise HTTPException(status_code=400, detail=f"Invalid cron expression: {e}") from e
    return _decorate(task)


@app.get("/tasks/{task_id}")
async def get_task(task_id: str) -> dict[str, Any]:
    task = tasks_store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return _decorate(task)


@app.patch("/tasks/{task_id}")
async def update_task(task_id: str, body: UpdateTaskRequest) -> dict[str, Any]:
    task = tasks_store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if body.name is not None:
        task.name = body.name
    if body.prompt is not None:
        task.prompt = body.prompt
    if body.cron is not None:
        task.cron = body.cron
    if body.enabled is not None:
        task.enabled = body.enabled

    tasks_store.upsert_task(task)
    try:
        schedule_task(task)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid cron expression: {e}") from e
    return _decorate(task)


@app.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: str) -> None:
    if not tasks_store.get_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    unschedule_task(task_id)
    tasks_store.delete_task(task_id)


@app.post("/tasks/{task_id}/run")
async def run_task_now(task_id: str) -> TaskRun:
    """Manually trigger a task. Runs synchronously and returns the TaskRun."""
    if not tasks_store.get_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return await execute_task(task_id, trigger="manual")


@app.get("/tasks/{task_id}/runs")
async def list_task_runs(task_id: str, limit: int = 50) -> list[TaskRun]:
    if not tasks_store.get_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks_store.list_runs_for_task(task_id, limit=limit)
