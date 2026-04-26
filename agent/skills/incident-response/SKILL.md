---
name: incident-response
description: Step-by-step runbook for triaging and responding to a production incident. Use when the user reports an outage, alert, page, or production issue.
---

# Incident Response Runbook

Use this skill the moment a user mentions a production issue, page, alert,
or outage. Keep responses calm, structured, and action-oriented.

## Priority order

1. **Stop the bleeding** — limit blast radius before debugging.
2. **Communicate** — make sure the right people know.
3. **Diagnose** — root-cause analysis comes after stability is restored.

## Triage checklist

Walk the user through these in order. Use the `confirmation` widget for
risky actions before executing.

### 1. Scope

- What's broken? (specific service / endpoint / user-visible symptom)
- When did it start? (look for deploy events, traffic spikes)
- What % of traffic is affected?
- Severity: SEV1 (full outage) / SEV2 (degraded) / SEV3 (minor)

### 2. Stop the bleeding

- **Recent deploy?** Roll back. Use the `confirmation` widget.
- **Spike in traffic?** Enable rate limiting, scale up auto-scaling group.
- **Bad data?** Pause the consumer, isolate the corruption.
- **Downstream dependency?** Failover or circuit-break.

### 3. Communicate

Recommend the user post in this format to their incident channel:

> 🚨 **SEV{N}** — {one-line summary}
> Detected: {timestamp}
> Impact: {scope, affected users/regions}
> Status: investigating
> Owner: {name}
> Updates every 15 min

### 4. Diagnose

Use the `cloudwatch-query-builder` skill to find errors. Useful queries:

- Errors in the last 30 min, top 10 by frequency
- Latency p99 over the last hour by 5-minute bins
- Failed Lambda invocations by function

Use `list_lambda_functions` and `list_log_groups` to discover what to query.

### 5. Document

After resolution, recommend creating a postmortem with:
- Timeline (detect → mitigate → resolve)
- Root cause
- Why monitoring didn't catch it sooner (if applicable)
- Action items

## Tone

Be direct. Skip pleasantries during an active incident. After the user
indicates the incident is mitigated, switch back to normal tone.

## Things to NEVER suggest during an active incident

- Code refactoring
- Adding features
- Long-form analysis without a clear next action
- Deploying anything new "as a fix" without rollback ready
