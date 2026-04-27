"""In-memory store for scheduled tasks and their run history.

Mirrors the InMemorySaver checkpointer pattern — restarting the agent
loses all tasks. Phase 7 swaps this for a Postgres-backed store
alongside PostgresSaver.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agent.tasks.models import ScheduledTask, TaskRun

_tasks: dict[str, ScheduledTask] = {}
_runs: dict[str, TaskRun] = {}
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


def list_tasks() -> list[ScheduledTask]:
    with _lock:
        return list(_tasks.values())


def get_task(task_id: str) -> ScheduledTask | None:
    return _tasks.get(task_id)


def upsert_task(task: ScheduledTask) -> None:
    with _lock:
        _tasks[task.id] = task


def delete_task(task_id: str) -> bool:
    with _lock:
        if task_id in _tasks:
            del _tasks[task_id]
            for run_id in [r.id for r in _runs.values() if r.task_id == task_id]:
                _runs.pop(run_id, None)
            return True
        return False


# ---------------------------------------------------------------------------
# Run history
# ---------------------------------------------------------------------------


def list_runs_for_task(task_id: str, limit: int = 50) -> list[TaskRun]:
    runs = [r for r in _runs.values() if r.task_id == task_id]
    runs.sort(key=lambda r: r.started_at, reverse=True)
    return runs[:limit]


def get_run(run_id: str) -> TaskRun | None:
    return _runs.get(run_id)


def upsert_run(run: TaskRun) -> None:
    with _lock:
        _runs[run.id] = run
