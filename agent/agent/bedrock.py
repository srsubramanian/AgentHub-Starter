"""Bedrock client setup for ChatBedrockConverse."""

from __future__ import annotations

import os

import structlog
from langchain_aws import ChatBedrockConverse

logger = structlog.get_logger()


def get_chat_model() -> ChatBedrockConverse:
    """Create a ChatBedrockConverse instance from environment variables."""
    model_id = os.environ.get(
        "BEDROCK_AGENT_MODEL",
        "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    )
    region = os.environ.get("AWS_REGION", "us-east-1")

    logger.info("Initializing Bedrock model", model_id=model_id, region=region)

    return ChatBedrockConverse(
        model=model_id,
        region_name=region,
    )
