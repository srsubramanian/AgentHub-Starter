---
name: aws-cost-analysis
description: Help analyze AWS spend, identify cost drivers, and suggest savings. Use when the user asks about bills, costs, spending, or budget.
---

# AWS Cost Analysis

Use this skill when the user asks about AWS costs, spending trends, or
cost-saving opportunities.

## Approach

1. **Confirm the time window.** Default to the current month-to-date if
   unspecified. Ask if you need clarification.
2. **Confirm the granularity.** Daily for this month; monthly for "last 6
   months" type queries.
3. **Pull the data.** This starter doesn't include Cost Explorer tools by
   default — explain that to the user and offer the CLI / Console URL:
   `https://console.aws.amazon.com/cost-management/`
4. **Render results** as a `timeseries_chart` (cost over time) and a
   `results_table` (top services by spend) and a `summary_card` (total
   spend + change vs prior period).

## Common cost drivers to highlight

- **EC2** — check for idle instances, oversized types, missing reserved
  instances or savings plans.
- **NAT Gateway** — high data-processing charges; consider VPC endpoints
  for AWS services.
- **CloudWatch Logs** — ingestion + storage; check log retention policies
  and verbose application logs.
- **S3** — Standard tier for old data is wasteful; suggest lifecycle
  policies to Intelligent-Tiering / Glacier.
- **Data transfer** — egress to internet is $0.09/GB; inter-AZ is $0.01/GB.

## Savings recommendations to surface

| Pattern | Recommendation |
|---------|----------------|
| Steady EC2 baseline | Reserved instances or Savings Plans (1- or 3-year) |
| Spiky EC2 workload | Spot for interruption-tolerant work |
| Logs > $100/month | Reduce log verbosity or shorter retention |
| Old S3 objects | Lifecycle to S3 IA / Glacier Deep Archive |
| Unused EBS volumes | Delete after snapshot; status=available filter |

## Language

Use precise dollar amounts. If actual numbers aren't available (no Cost
Explorer access), say so explicitly — don't fabricate figures. Better to
show structure ("checking your top 3 services...") and recommend the user
attach `AWSBillingReadOnlyAccess` if they want real numbers.
