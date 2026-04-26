"""External HTTP-mode MCP server demo.

Exposes the same tools as mcp_demo_server.py (get_current_time, echo)
plus a few extras, served over Streamable HTTP at /mcp on port 8765.
This proves the agent can connect to an MCP server running in a
different process / container / host, with optional bearer-token auth.

Configure in mcp_servers.json:
    {
      "remote": {
        "url": "http://mcp-http:8765/mcp",
        "transport": "streamable_http",
        "headers": {"Authorization": "Bearer ${MCP_HTTP_TOKEN}"}
      }
    }

Set MCP_HTTP_TOKEN to require auth (otherwise the server is open).
"""

from __future__ import annotations

import datetime
import os

from fastmcp import FastMCP

EXPECTED_TOKEN = os.environ.get("MCP_HTTP_TOKEN", "")

mcp: FastMCP = FastMCP("remote-demo")


@mcp.tool()
def server_info() -> dict[str, str]:
    """Return information about this remote MCP server.

    Useful for proving you're talking to the external server, not a
    local stdio server.
    """
    return {
        "server": "mcp_http_server.py",
        "transport": "streamable_http",
        "host": os.environ.get("HOSTNAME", "unknown"),
        "started": datetime.datetime.now(datetime.UTC).isoformat(),
    }


@mcp.tool()
def random_quote() -> str:
    """Return a randomly-chosen software engineering quote."""
    import random

    quotes = [
        "Premature optimization is the root of all evil. — Donald Knuth",
        "Code is read more often than it is written. — Guido van Rossum",
        (
            "There are only two hard things in computer science: "
            "cache invalidation and naming things. — Phil Karlton"
        ),
        "Make it work, make it right, make it fast. — Kent Beck",
        "Talk is cheap. Show me the code. — Linus Torvalds",
    ]
    return random.choice(quotes)


@mcp.tool()
def add_numbers(a: float, b: float) -> float:
    """Add two numbers together. Useful for confirming the tool call protocol works."""
    return a + b


if __name__ == "__main__":
    port = int(os.environ.get("MCP_HTTP_PORT", "8765"))
    mcp.run(transport="http", host="0.0.0.0", port=port)
