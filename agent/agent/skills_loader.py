"""Anthropic-style Skills loader.

Skills live in agent/skills/<skill-name>/SKILL.md with the format:

    ---
    name: skill-name
    description: One-line description of when to use this skill
    ---

    # Body content here
    Markdown instructions, examples, runbooks the agent should follow
    when this skill is invoked.

The agent's system prompt advertises available skills (name +
description). When the user query matches, the LLM calls invoke_skill
to load full content into context.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import structlog
import yaml

logger = structlog.get_logger()


@dataclass
class Skill:
    """A loaded SKILL.md file."""

    name: str
    description: str
    body: str
    path: Path


_skills: dict[str, Skill] = {}


def _parse_skill_md(path: Path) -> Skill | None:
    """Parse a SKILL.md file with YAML frontmatter."""
    content = path.read_text()

    if not content.startswith("---"):
        logger.warning("Skill missing frontmatter", path=str(path))
        return None

    parts = content.split("---", 2)
    if len(parts) < 3:
        logger.warning("Skill frontmatter not closed", path=str(path))
        return None

    try:
        metadata: dict[str, Any] = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        logger.exception("Skill frontmatter parse error", path=str(path))
        return None

    name = metadata.get("name")
    description = metadata.get("description")
    if not name or not description:
        logger.warning(
            "Skill missing name or description",
            path=str(path),
            name=name,
            description=description,
        )
        return None

    return Skill(
        name=str(name),
        description=str(description),
        body=parts[2].strip(),
        path=path,
    )


def load_skills(skills_dir: Path | None = None) -> dict[str, Skill]:
    """Discover and load all SKILL.md files under skills_dir.

    Defaults to <repo>/agent/skills/. Idempotent — safe to call multiple times.
    """
    global _skills
    if skills_dir is None:
        skills_dir = Path(__file__).parent.parent / "skills"

    if not skills_dir.exists():
        logger.info("No skills directory", path=str(skills_dir))
        _skills = {}
        return _skills

    found: dict[str, Skill] = {}
    for skill_md in skills_dir.glob("*/SKILL.md"):
        skill = _parse_skill_md(skill_md)
        if skill is None:
            continue
        if skill.name in found:
            logger.warning("Duplicate skill name", name=skill.name, path=str(skill_md))
            continue
        found[skill.name] = skill

    _skills = found
    logger.info("Loaded skills", count=len(found), names=list(found.keys()))
    return _skills


def list_skills() -> list[Skill]:
    """Return all loaded skills (name + description summary)."""
    return list(_skills.values())


def get_skill(name: str) -> Skill | None:
    """Return the full skill (including body) by name."""
    return _skills.get(name)


def skills_summary() -> str:
    """Return a markdown bullet list of available skills, for the system prompt."""
    if not _skills:
        return ""

    lines = ["", "## Available Skills", ""]
    for skill in sorted(_skills.values(), key=lambda s: s.name):
        lines.append(f"- **{skill.name}** — {skill.description}")
    lines.append("")
    lines.append(
        "Call the `invoke_skill` tool with the skill name to load full instructions "
        "before answering questions that match a skill's description."
    )
    return "\n".join(lines)
