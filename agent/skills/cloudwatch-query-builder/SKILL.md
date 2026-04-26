---
name: cloudwatch-query-builder
description: Translate natural-language requests into CloudWatch Logs Insights queries. Use whenever the user wants to search, count, aggregate, or analyze CloudWatch logs.
---

# CloudWatch Logs Insights Query Builder

Use this skill any time the user wants to query CloudWatch logs. Your job is
to take their natural-language request, produce a correct Logs Insights
query, and propose it back via the `query_plan` widget for approval before
executing it.

## Workflow

1. **Identify the log groups.** Ask the user if they're not specified, or
   call `list_log_groups` to discover available ones.
2. **Identify the time range.** Default to the last 1 hour if unspecified.
3. **Compose the query** following the patterns below.
4. **Create a `query_plan` widget** so the user can review/edit/approve
   the query before it runs. Use `create_summary_card` for now if the
   query_plan widget isn't available.
5. **After approval, execute** via the appropriate CloudWatch tool and
   render results in a `results_table` widget.

## Query patterns

### Find errors

```
fields @timestamp, @message, @logStream
| filter @message like /(?i)error|exception|failed/
| sort @timestamp desc
| limit 100
```

### Count by status code (API Gateway / ALB)

```
fields status
| filter ispresent(status)
| stats count() as requests by status
| sort requests desc
```

### Top error messages by frequency

```
fields @message
| filter @message like /(?i)error/
| stats count() as occurrences by @message
| sort occurrences desc
| limit 20
```

### p50/p95/p99 latency over time

```
fields @timestamp, latency
| filter ispresent(latency)
| stats pct(latency, 50) as p50,
        pct(latency, 95) as p95,
        pct(latency, 99) as p99
        by bin(5m)
```

When you see `... by bin(...)`, render results as a **timeseries_chart**
widget instead of a results_table.

### Lambda cold starts

```
filter @type = "REPORT"
| fields @timestamp, @initDuration, @duration, @maxMemoryUsed, @memorySize
| filter ispresent(@initDuration)
| sort @timestamp desc
| limit 50
```

### Failed invocations grouped by function

```
filter @type = "REPORT" and ispresent(@duration)
| filter @message like /Task timed out|errorMessage/
| stats count() as failures by @log
| sort failures desc
```

### Slow requests (top N)

```
fields @timestamp, @message, duration
| filter ispresent(duration)
| sort duration desc
| limit 20
```

### Custom JSON field extraction

Logs Insights auto-discovers JSON fields. Reference them directly:

```
fields @timestamp, user_id, request_id, status_code
| filter status_code >= 500
| stats count() by user_id
| sort count desc
| limit 20
```

## Style rules

- **Always include `@timestamp`** in `fields` for time-ordered results.
- **Use `(?i)` for case-insensitive regex** matching on `@message`.
- **Limit explicitly** — default to `limit 100` to avoid huge result sets.
- **Prefer `bin(5m)` or `bin(1h)`** for time-series aggregation; pick the
  bin size based on the requested time range.
- **`ispresent(field)`** before filtering on optional fields, otherwise the
  query silently returns nothing.

## Time range guidance

| User says | start_time | end_time |
|-----------|-----------|----------|
| "last hour" | now - 1h | now |
| "today" | midnight UTC today | now |
| "last 24 hours" | now - 24h | now |
| "yesterday" | midnight UTC yesterday | midnight UTC today |
| nothing | now - 1h | now |

## When NOT to use this skill

If the user is asking about:
- Listing what log groups exist → use `list_log_groups` directly
- Lambda function metadata → use `list_lambda_functions`
- General AWS questions → use `aws_docs_search_documentation`
