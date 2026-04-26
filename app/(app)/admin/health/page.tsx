import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface HealthStatus {
  status: string;
}

async function checkAgentHealth(): Promise<{
  ok: boolean;
  data?: HealthStatus;
  error?: string;
}> {
  const agentUrl = process.env.AGENT_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${agentUrl}/health`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as HealthStatus;
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

export default async function HealthPage() {
  const agent = await checkAgentHealth();

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">System Health</h1>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              Frontend (Next.js)
            </CardTitle>
            <Badge variant="default" className="text-xs">
              healthy
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This page rendered successfully.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              Agent (FastAPI + LangGraph)
            </CardTitle>
            <Badge
              variant={agent.ok ? "default" : "destructive"}
              className="text-xs"
            >
              {agent.ok ? "healthy" : "unhealthy"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {agent.ok ? (
            <p className="text-sm text-muted-foreground">
              Agent responded with status: {agent.data?.status}
            </p>
          ) : (
            <p className="text-sm text-destructive">
              Agent unreachable: {agent.error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
