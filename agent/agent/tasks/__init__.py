"""Scheduled tasks subsystem.

User-configurable prompts that run on a cron schedule. Each execution
runs the LangGraph agent in a fresh thread and captures the final
response in a run history.
"""
