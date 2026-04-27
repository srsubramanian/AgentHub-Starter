"""APScheduler integration + task execution.

The scheduler is started in the FastAPI lifespan and uses
AsyncIOScheduler so jobs run on the same event loop as the HTTP
server. Each scheduled fire calls execute_task, which runs the agent
graph against the task's stored prompt and writes a TaskRun record.
"""

from __future__ import annotations

import datetime
from typing import Any

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from langchain_core.messages import HumanMessage
from ulid import ULID

from agent.graph import graph
from agent.tasks import store
from agent.tasks.models import ScheduledTask, TaskRun

logger = structlog.get_logger()

_scheduler: AsyncIOScheduler | None = None


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


def start_scheduler() -> AsyncIOScheduler:
    """Start the scheduler. Idempotent."""
    global _scheduler
    if _scheduler is None or not _scheduler.running:
        _scheduler = AsyncIOScheduler()
        _scheduler.start()
        logger.info("Scheduler started")
    return _scheduler


def shutdown_scheduler() -> None:
    """Stop the scheduler cleanly."""
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler shutdown")
    _scheduler = None


def _get_scheduler() -> AsyncIOScheduler:
    if _scheduler is None or not _scheduler.running:
        raise RuntimeError("Scheduler is not running")
    return _scheduler


# ---------------------------------------------------------------------------
# Cron parsing helpers
# ---------------------------------------------------------------------------


def _trigger_for(task: ScheduledTask) -> CronTrigger:
    """Build an APScheduler CronTrigger from a 5-field cron expression."""
    parts = task.cron.split()
    if len(parts) != 5:
        raise ValueError(
            f"Cron expression must have 5 fields (minute hour day month dow); got: {task.cron!r}"
        )
    minute, hour, day, month, day_of_week = parts
    return CronTrigger(
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=day_of_week,
        timezone=task.timezone,
    )


def next_run_for(task: ScheduledTask) -> str | None:
    """Compute the next fire time for a task, in ISO 8601 (UTC)."""
    if not task.enabled:
        return None
    try:
        trigger = _trigger_for(task)
        now = datetime.datetime.now(datetime.UTC)
        next_fire = trigger.get_next_fire_time(None, now)
        return next_fire.isoformat() if next_fire else None
    except Exception:
        logger.exception("Failed to compute next run", task_id=task.id)
        return None


# ---------------------------------------------------------------------------
# Schedule / unschedule
# ---------------------------------------------------------------------------


def schedule_task(task: ScheduledTask) -> None:
    """Register or replace a task's job in the scheduler."""
    scheduler = _get_scheduler()
    job_id = f"task:{task.id}"

    # Remove any existing job
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)

    if not task.enabled:
        logger.info("Task is disabled, not scheduling", task_id=task.id)
        return

    trigger = _trigger_for(task)
    scheduler.add_job(
        execute_task,
        trigger=trigger,
        id=job_id,
        args=[task.id, "scheduled"],
        replace_existing=True,
        misfire_grace_time=60,
        coalesce=True,
    )
    logger.info("Task scheduled", task_id=task.id, cron=task.cron)


def unschedule_task(task_id: str) -> None:
    """Remove a task's job from the scheduler."""
    scheduler = _get_scheduler()
    job_id = f"task:{task_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        logger.info("Task unscheduled", task_id=task_id)


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------


def _extract_text(content: Any) -> str:
    """Pull plain text out of a LangChain message content (str or block list)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict)
        )
    return ""


async def execute_task(task_id: str, trigger: str = "scheduled") -> TaskRun:
    """Run the agent against a task's prompt and record the outcome."""
    task = store.get_task(task_id)
    if task is None:
        logger.warning("execute_task: task not found", task_id=task_id)
        raise KeyError(f"Task {task_id} not found")

    run = TaskRun(
        id=str(ULID()),
        task_id=task_id,
        trigger=trigger,  # type: ignore[arg-type]
    )
    store.upsert_run(run)

    logger.info(
        "Task run started",
        task_id=task_id,
        run_id=run.id,
        trigger=trigger,
        cron=task.cron,
    )

    try:
        thread_id = f"task-{task_id}-{run.id}"
        config = {"configurable": {"thread_id": thread_id}}
        result = await graph.ainvoke(  # type: ignore[call-overload]
            {"messages": [HumanMessage(content=task.prompt)]},
            config=config,
        )

        # Find the final assistant text
        response_text = ""
        for msg in reversed(result.get("messages", [])):
            if getattr(msg, "type", None) == "ai":
                response_text = _extract_text(getattr(msg, "content", "")).strip()
                if response_text:
                    break

        run.status = "success"
        run.response = response_text or "(no text response)"

    except Exception as e:
        logger.exception("Task run failed", task_id=task_id, run_id=run.id)
        run.status = "failed"
        run.error = str(e)

    run.completed_at = datetime.datetime.now(datetime.UTC).isoformat()
    store.upsert_run(run)

    # Update the task's last-run summary
    task.last_run_at = run.completed_at
    task.last_run_status = run.status
    task.last_run_id = run.id
    store.upsert_task(task)

    logger.info(
        "Task run finished",
        task_id=task_id,
        run_id=run.id,
        status=run.status,
    )
    return run
