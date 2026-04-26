"""LangGraph tools for invoking Anthropic-style skills."""

from __future__ import annotations

from langchain_core.tools import tool

from agent.skills_loader import get_skill, list_skills


@tool
def invoke_skill(name: str) -> str:
    """Load the full instructions for a named skill.

    Call this when the user's request matches a skill's description (see
    the "Available Skills" section in your system prompt). The returned
    text is a runbook you should follow for the rest of the response.

    Args:
        name: The skill name (e.g. "cloudwatch-query-builder").

    Returns:
        The full markdown body of the skill, or an error message if the
        skill is not found.
    """
    skill = get_skill(name)
    if skill is None:
        available = ", ".join(s.name for s in list_skills()) or "(none loaded)"
        return f"Skill '{name}' not found. Available skills: {available}"
    return skill.body


SKILLS_TOOLS = [invoke_skill]
