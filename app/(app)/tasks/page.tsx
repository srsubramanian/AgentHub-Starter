"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Play, Trash2, Plus } from "lucide-react";
import type { ScheduledTask, SchedulePreset } from "@/lib/tasks-types";

const CUSTOM_VALUE = "__custom__";
const TZ_DISPLAY = "America/New_York";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: TZ_DISPLAY,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [presets, setPresets] = useState<SchedulePreset[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [presetCron, setPresetCron] = useState<string>("");
  const [customCron, setCustomCron] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tasks");
    if (res.ok) setTasks(await res.json());
  }, []);

  useEffect(() => {
    refresh();
    fetch("/api/tasks/presets").then(async (r) => {
      if (r.ok) {
        const data: SchedulePreset[] = await r.json();
        setPresets(data);
        if (data.length > 0) setPresetCron(data[2]?.cron || data[0].cron);
      }
    });
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const cron = presetCron === CUSTOM_VALUE ? customCron.trim() : presetCron;
      if (!name.trim() || !prompt.trim() || !cron) {
        setError("Name, prompt, and schedule are all required.");
        return;
      }
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), prompt: prompt.trim(), cron }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      setName("");
      setPrompt("");
      setCustomCron("");
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }, [name, prompt, presetCron, customCron, refresh]);

  const handleRunNow = useCallback(
    async (id: string) => {
      await fetch(`/api/tasks/${id}/run`, { method: "POST" });
      await refresh();
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this task and its run history?")) return;
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Scheduled Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Run prompts on a recurring schedule. Times shown in {TZ_DISPLAY}.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New task
              </Button>
            }
          />
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create scheduled task</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="task-name">Name</Label>
                <Input
                  id="task-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Daily AWS account check"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="task-prompt">Prompt</Label>
                <Textarea
                  id="task-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What is my AWS account info?"
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="task-schedule">Schedule</Label>
                <Select
                  value={presetCron}
                  onValueChange={(v) => setPresetCron(v ?? "")}
                >
                  <SelectTrigger id="task-schedule">
                    <SelectValue placeholder="Pick a schedule" />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((p) => (
                      <SelectItem key={p.cron} value={p.cron}>
                        {p.label}{" "}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {p.cron}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_VALUE}>
                      Custom cron expression…
                    </SelectItem>
                  </SelectContent>
                </Select>
                {presetCron === CUSTOM_VALUE && (
                  <Input
                    placeholder="0 9 * * 1-5"
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                    className="font-mono"
                  />
                )}
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? "Creating…" : "Create task"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">All tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks === null ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No scheduled tasks yet. Click <strong>New task</strong> to create one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/tasks/${t.id}`}
                        className="font-medium hover:underline"
                      >
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.cron}</TableCell>
                    <TableCell className="text-xs">
                      {t.last_run_at ? (
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              t.last_run_status === "success"
                                ? "default"
                                : "destructive"
                            }
                            className="text-[10px]"
                          >
                            {t.last_run_status}
                          </Badge>
                          {formatTime(t.last_run_at)}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatTime(t.next_run_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleRunNow(t.id)}
                          title="Run now"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(t.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
