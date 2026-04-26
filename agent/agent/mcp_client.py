"""MCP client integration.

Loads MCP server configurations and exposes their tools to the LangGraph
agent. Configuration is read from a JSON file pointed to by the
MCP_SERVERS_CONFIG env var (defaults to "mcp_servers.json" in the agent
directory). If no config exists or no servers are listed, returns an
empty tool list — the agent works without MCP servers.

Example mcp_servers.json:
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    "transport": "stdio"
  },
  "weather": {
    "url": "http://localhost:8765/mcp",
    "transport": "streamable_http"
  }
}
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog
from langchain_mcp_adapters.client import MultiServerMCPClient

if TYPE_CHECKING:
    from langchain_core.tools import BaseTool

logger = structlog.get_logger()


def _load_config() -> dict[str, dict[str, Any]]:
    """Load MCP server config from the path in MCP_SERVERS_CONFIG."""
    config_path = os.environ.get("MCP_SERVERS_CONFIG", "mcp_servers.json")
    path = Path(config_path)
    if not path.is_absolute():
        path = Path(__file__).parent.parent / config_path

    if not path.exists():
        logger.info("No MCP config found", path=str(path))
        return {}

    try:
        with path.open() as f:
            data: dict[str, dict[str, Any]] = json.load(f)
        logger.info("Loaded MCP config", path=str(path), servers=list(data.keys()))
        return data
    except Exception:
        logger.exception("Failed to load MCP config", path=str(path))
        return {}


async def load_mcp_tools() -> list[BaseTool]:
    """Connect to all configured MCP servers and return their tools.

    Each server is loaded independently — one bad server does not block
    others. Returns an empty list if no servers are configured.
    """
    config = _load_config()
    if not config:
        return []

    all_tools: list[BaseTool] = []
    for name, server_config in config.items():
        if name.startswith("_"):
            continue
        try:
            client = MultiServerMCPClient(
                {name: server_config},  # type: ignore[dict-item]
                tool_name_prefix=True,
            )
            server_tools: list[BaseTool] = await client.get_tools()
            logger.info(
                "Loaded MCP server",
                server=name,
                count=len(server_tools),
                tool_names=[t.name for t in server_tools],
            )
            all_tools.extend(server_tools)
        except Exception:
            logger.exception("Failed to load MCP server", server=name)

    logger.info("MCP tools loaded", total=len(all_tools))
    return all_tools
