"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";
import type { ScheduledTask, TaskRun } from "@/lib/tasks-types";

const TZ_DISPLAY = "America/New_York";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: TZ_DISPLAY,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [task, setTask] = useState<ScheduledTask | null>(null);
  const [runs, setRuns] = useState<TaskRun[] | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    const [taskRes, runsRes] = await Promise.all([
      fetch(`/api/tasks/${id}`),
      fetch(`/api/tasks/${id}/runs`),
    ]);
    if (taskRes.ok) setTask(await taskRes.json());
    if (runsRes.ok) setRuns(await runsRes.json());
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRunNow = useCallback(async () => {
    setRunning(true);
    try {
      await fetch(`/api/tasks/${id}/run`, { method: "POST" });
      await refresh();
    } finally {
      setRunning(false);
    }
  }, [id, refresh]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <Link
        href="/tasks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to tasks
      </Link>

      {task === null ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">{task.name}</CardTitle>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {task.cron} · {task.timezone}
                </p>
              </div>
              <Button onClick={handleRunNow} disabled={running} size="sm">
                <Play className="mr-1 h-4 w-4" />
                {running ? "Running…" : "Run now"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Prompt
              </p>
              <p className="rounded-md bg-muted p-3 text-sm">{task.prompt}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Next run</p>
                <p>{formatTime(task.next_run_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p>{formatTime(task.created_at)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Run history</CardTitle>
        </CardHeader>
        <CardContent>
          {runs === null ? (
            <Skeleton className="h-16 w-full" />
          ) : runs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No runs yet. Click <strong>Run now</strong> to trigger one.
            </p>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunCard({ run }: { run: TaskRun }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border p-3">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Badge
            variant={
              run.status === "success"
                ? "default"
                : run.status === "failed"
                  ? "destructive"
                  : "secondary"
            }
            className="text-[10px]"
          >
            {run.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {run.trigger}
          </span>
          <span className="text-xs">{formatTime(run.started_at)}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>
      {expanded && (
        <div className="mt-3">
          {run.error && (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {run.error}
            </p>
          )}
          {run.response && (
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                "prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5",
                "prose-code:rounded prose-code:bg-zinc-900 prose-code:px-1 prose-code:py-0.5",
                "prose-code:text-xs prose-code:font-medium prose-code:text-zinc-100",
                "prose-code:before:content-none prose-code:after:content-none",
                "prose-pre:my-2 prose-pre:bg-zinc-950 prose-pre:text-zinc-100",
                "prose-pre:rounded-md prose-pre:p-3 prose-pre:text-xs",
                "prose-pre:border prose-pre:border-zinc-800"
              )}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
              >
                {run.response}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
