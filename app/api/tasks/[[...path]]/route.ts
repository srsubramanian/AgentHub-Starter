import { NextRequest } from "next/server";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

async function proxy(request: NextRequest, pathSegments: string[] | undefined) {
  const subPath = pathSegments?.length ? `/${pathSegments.join("/")}` : "";
  const url = `${AGENT_URL}/tasks${subPath}${request.nextUrl.search}`;

  const init: RequestInit = {
    method: request.method,
    headers: { "Content-Type": "application/json" },
  };

  if (request.method !== "GET" && request.method !== "DELETE" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  const res = await fetch(url, init);
  const text = await res.text();
  return new Response(text || null, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function POST(request: NextRequest, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function DELETE(request: NextRequest, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
