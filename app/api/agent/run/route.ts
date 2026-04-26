import { NextRequest } from "next/server";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  const body = await request.json();

  const agentResponse = await fetch(`${AGENT_URL}/agent/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!agentResponse.ok) {
    return new Response(
      JSON.stringify({ error: "Agent request failed" }),
      { status: agentResponse.status, headers: { "Content-Type": "application/json" } }
    );
  }

  // Proxy the SSE stream directly
  return new Response(agentResponse.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
