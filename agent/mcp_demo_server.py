"""Tiny demo MCP server — proves the integration works.

Exposes two tools:
- get_current_time: returns the current UTC time
- echo: returns whatever string you send it

Run via stdio when configured in mcp_servers.json:

    {
      "demo": {
        "command": "uv",
        "args": ["run", "python", "mcp_demo_server.py"],
        "transport": "stdio"
      }
    }
"""

from __future__ import annotations

import datetime

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("demo")


@mcp.tool()
def get_current_time() -> str:
    """Return the current UTC time in ISO 8601 format."""
    return datetime.datetime.now(datetime.UTC).isoformat()


@mcp.tool()
def echo(message: str) -> str:
    """Echo a message back. Useful for proving the MCP connection works."""
    return f"Echo: {message}"


if __name__ == "__main__":
    mcp.run(transport="stdio")
