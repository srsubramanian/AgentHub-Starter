/** Mirror of agent/agent/tasks/models.py — keep in sync. */

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  created_at: string;
  last_run_at: string | null;
  last_run_status: "success" | "failed" | null;
  last_run_id: string | null;
  next_run_at: string | null;
}

export interface TaskRun {
  id: string;
  task_id: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "success" | "failed";
  response: string | null;
  error: string | null;
  trigger: "scheduled" | "manual";
}

export interface SchedulePreset {
  label: string;
  cron: string;
}
