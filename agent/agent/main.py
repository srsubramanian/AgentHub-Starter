"""FastAPI application — AG-UI streaming agent endpoint."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import structlog
from ag_ui.core import (
    BaseEvent,
    EventType,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessageChunk, HumanMessage
from starlette.responses import StreamingResponse

from agent.bedrock import get_chat_model

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = structlog.get_logger()

app = FastAPI(title="AgentHub Starter Agent")

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


async def stream_agent_response(
    agent_input: RunAgentInput,
) -> AsyncGenerator[str, None]:
    """Stream AG-UI events from a Bedrock model call."""
    thread_id = agent_input.thread_id
    run_id = agent_input.run_id
    message_id = str(uuid.uuid4())

    # Extract the last user message from the conversation
    user_messages = [
        m for m in agent_input.messages if m.role == "user"
    ]
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

    # 1. Emit RUN_STARTED
    yield _sse(
        RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=thread_id,
            run_id=run_id,
        )
    )

    # 2. Emit TEXT_MESSAGE_START
    yield _sse(
        TextMessageStartEvent(
            type=EventType.TEXT_MESSAGE_START,
            message_id=message_id,
            role="assistant",
        )
    )

    # 3. Stream from Bedrock via langchain-aws
    model = get_chat_model()
    lc_messages = [HumanMessage(content=content)]

    try:
        async for chunk in model.astream(lc_messages):
            if not isinstance(chunk, AIMessageChunk) or not chunk.content:
                continue
            # Bedrock Converse returns content as str or list of content blocks
            if isinstance(chunk.content, str):
                text = chunk.content
            elif isinstance(chunk.content, list):
                text = "".join(
                    block.get("text", "")
                    for block in chunk.content
                    if isinstance(block, dict)
                )
            else:
                continue
            if text:
                yield _sse(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=message_id,
                        delta=text,
                    )
                )
    except Exception:
        logger.exception("Error streaming from Bedrock")
        raise

    # 4. Emit TEXT_MESSAGE_END
    yield _sse(
        TextMessageEndEvent(
            type=EventType.TEXT_MESSAGE_END,
            message_id=message_id,
        )
    )

    # 5. Emit RUN_FINISHED
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
