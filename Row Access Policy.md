# Worked Example: Curated View with Row Access Policy in Snowflake

**Purpose:** A complete, reproducible walk-through of taking one raw tenant table and exposing it to a chat-with-data agent as an isolated curated view, using Pattern A-multi (cross-entity, list-based session variable). Use this as a template when adding new tables to the agent's surface.

**Pattern recap:** The policy is on the *view*, not on the raw table. Existing consumers of the raw table (ETL, dbt, BI tools, data engineers) are unaffected. Only the agent goes through the curated view, and only the curated view filters by the user's allowed entities.

**Worked table:** `prod_db.raw.revenue` — chosen because it has enough columns to show realistic shaping decisions and is the running example throughout the design docs.

---

## Starting point — the raw table

This table already exists in production. It is fed by your existing ETL and consumed by dashboards, dbt models, and data engineers. **You will not modify it.**

```sql
CREATE TABLE prod_db.raw.revenue (
    revenue_id      NUMBER          NOT NULL,
    entity_id       NUMBER          NOT NULL,        -- the tenant key
    date            DATE            NOT NULL,
    amount          NUMBER(18, 2)   NOT NULL,
    currency        VARCHAR(3)      NOT NULL,
    product_id      NUMBER          NOT NULL,
    region          VARCHAR(50),
    customer_id     NUMBER,
    internal_notes  VARCHAR(1000),                   -- internal-only field
    created_at      TIMESTAMP_NTZ   NOT NULL,
    updated_at      TIMESTAMP_NTZ   NOT NULL,
    PRIMARY KEY (revenue_id)
);

-- Clustering on entity_id is important for partition pruning under RLS.
-- If your raw tables aren't already clustered this way, add it.
ALTER TABLE prod_db.raw.revenue CLUSTER BY (entity_id, date);
```

---

## Step 1 — Governance schema

The policy lives in its own schema, owned by data engineering or security. This separates governance objects from data objects.

```sql
CREATE SCHEMA IF NOT EXISTS prod_db.governance;

-- Optional but recommended: explicit ownership and grants
GRANT USAGE ON SCHEMA prod_db.governance TO ROLE data_engineering;

-- The agent_runtime role does NOT need usage on this schema —
-- it only sees the policy's effects, not the policy itself.
```

---

## Step 2 — The row access policy

This is Pattern A-multi: the policy reads `$app_allowed_entities` (a comma-separated list set by your connection code from the verified JWT) and returns TRUE when the row's `entity_id` is in the list.

```sql
CREATE OR REPLACE ROW ACCESS POLICY prod_db.governance.agent_entity_isolation
  AS (entity_id NUMBER) RETURNS BOOLEAN ->
    CASE
      -- Fail-closed: if no identity is bound, no rows visible
      WHEN $app_allowed_entities IS NULL THEN FALSE

      -- Filter: row visible iff its entity_id is in the user's allowed list
      ELSE entity_id IN (
        SELECT TO_NUMBER(TRIM(value))
        FROM TABLE(SPLIT_TO_TABLE($app_allowed_entities, ','))
      )
    END;
```

### Notes on the policy DDL

- **The policy takes `entity_id NUMBER` as a parameter.** When attached to a view, Snowflake passes the row's `entity_id` column value into this parameter for evaluation. The parameter name is positional via the `ON (column)` clause used at attachment — it does not have to match the column name.
- **`CASE WHEN ... IS NULL THEN FALSE`** is the fail-closed default. If the connection code doesn't set the variable, no rows are visible. Better than relying on three-valued logic for a security boundary.
- **`SPLIT_TO_TABLE`** is a table function that turns `'42,99,113'` into a one-column table with three rows. The `IN` predicate then checks membership.
- **One policy, many tables.** This same policy will be attached to every tenant-scoped view. You write it once.

---

## Step 3 — Curated schema

```sql
CREATE SCHEMA IF NOT EXISTS prod_db.curated;

GRANT USAGE ON SCHEMA prod_db.curated TO ROLE agent_runtime;
```

---

## Step 4 — Design the curated view

Three decisions shape the view definition. Walk through each before writing the DDL.

### Decision A — Which columns to expose

The raw table has 11 columns. The agent doesn't need all of them.

**Drop:**

| Column | Reason |
|---|---|
| `revenue_id` | Internal surrogate key; not useful to the agent. |
| `internal_notes` | Internal-only field, potentially sensitive. |
| `updated_at` | Implementation detail (last modified time), not business data. |

**Keep:**

| Column | Reason |
|---|---|
| `entity_id` | Required for `GROUP BY entity_id`, joins, cross-entity rollups. |
| `date` | The primary time dimension. |
| `amount` | The metric. |
| `currency` | Required to interpret `amount` correctly. |
| `product_id` | Common analytical dimension. |
| `region` | Common analytical dimension. |
| `customer_id` | Common analytical dimension. |
| `created_at` | When the revenue was recorded; useful for "show me recent revenue." |

### Decision B — Rename or transform anything?

For a thin view: **no.** Keep column names matching raw so schema changes stay easy to track. If you want the agent to see friendlier names (e.g., `txn_date` instead of `date`), do that in a *shaped view* layered on top of this thin view, not in this view itself.

### Decision C — Mask any columns at the view level?

You could, but separate concerns: column masking belongs in a **masking policy** (a separate Snowflake construct), not in the view definition. Keep this view about row shape and column projection. Column masking is its own design and is out of scope for this example.

---

## Step 5 — Create the view

```sql
CREATE OR REPLACE SECURE VIEW prod_db.curated.my_revenue AS
SELECT
    entity_id,
    date,
    amount,
    currency,
    product_id,
    region,
    customer_id,
    created_at
FROM prod_db.raw.revenue;
```

### Notes on the view DDL

- **`SECURE` matters.** Without it, Snowflake's optimizer can leak information about filtered-out rows through query plans, error messages, or selectivity estimates. For tenant isolation, always use `SECURE`. The performance cost is usually small (a few percent on heavy aggregations); the leakage risk it removes is real.
- **`OR REPLACE` lets you redeploy without dropping.** Convenient, but be aware: a `CREATE OR REPLACE VIEW` drops any policy attachment from the previous version. You must re-run `ALTER VIEW ... ADD ROW ACCESS POLICY` after every replace. The deployment script in Step 8 handles this by always running both together.
- **No `WHERE` clause in the view.** The filtering comes from the policy. The view is just column shaping.

---

## Step 6 — Attach the policy to the view

```sql
ALTER VIEW prod_db.curated.my_revenue
  ADD ROW ACCESS POLICY prod_db.governance.agent_entity_isolation ON (entity_id);
```

The `ON (entity_id)` clause tells Snowflake which column from the view to pass into the policy's parameter. When a query reads from this view, Snowflake calls `agent_entity_isolation(<row's entity_id value>)` for each row, and only includes rows where the policy returns TRUE.

---

## Step 7 — Grant access to the agent role

```sql
GRANT SELECT ON VIEW prod_db.curated.my_revenue TO ROLE agent_runtime;
```

That's it for grants. The agent role does *not* have `SELECT` on `prod_db.raw.revenue`. The view encapsulates both the column shape and (via the policy) the row filter. Snowflake's view-execution model uses the view owner's privileges to read the underlying table; the agent role only needs `SELECT` on the view itself.

---

## Step 8 — Complete deployable script

Single file, idempotent, safe to re-run:

```sql
-- ============================================================
-- File: deploy_curated_my_revenue.sql
-- Purpose: Expose raw.revenue to the agent as an isolated view.
-- Idempotent: safe to re-run.
-- ============================================================

-- Schemas
CREATE SCHEMA IF NOT EXISTS prod_db.governance;
CREATE SCHEMA IF NOT EXISTS prod_db.curated;

-- Policy (CREATE OR REPLACE; idempotent)
CREATE OR REPLACE ROW ACCESS POLICY prod_db.governance.agent_entity_isolation
  AS (entity_id NUMBER) RETURNS BOOLEAN ->
    CASE
      WHEN $app_allowed_entities IS NULL THEN FALSE
      ELSE entity_id IN (
        SELECT TO_NUMBER(TRIM(value))
        FROM TABLE(SPLIT_TO_TABLE($app_allowed_entities, ','))
      )
    END;

-- View
CREATE OR REPLACE SECURE VIEW prod_db.curated.my_revenue AS
SELECT
    entity_id,
    date,
    amount,
    currency,
    product_id,
    region,
    customer_id,
    created_at
FROM prod_db.raw.revenue;

-- Attach policy (must come AFTER view creation)
-- Note: CREATE OR REPLACE VIEW above drops any prior policy attachment,
-- so the ALTER VIEW must always run alongside the CREATE OR REPLACE.
ALTER VIEW prod_db.curated.my_revenue
  ADD ROW ACCESS POLICY prod_db.governance.agent_entity_isolation ON (entity_id);

-- Grants (idempotent)
GRANT USAGE ON DATABASE prod_db TO ROLE agent_runtime;
GRANT USAGE ON SCHEMA prod_db.curated TO ROLE agent_runtime;
GRANT SELECT ON VIEW prod_db.curated.my_revenue TO ROLE agent_runtime;
```

---

## Step 9 — Verify it works

Run this verification after deployment, in a session with `agent_runtime` active.

```sql
USE ROLE agent_runtime;
USE DATABASE prod_db;
USE SCHEMA curated;

-- ============================================================
-- Test 1: initial state, no variable set, agent sees nothing
-- ============================================================
SELECT COUNT(*) FROM my_revenue;
-- Expected: 0

-- ============================================================
-- Test 2: bind identity for a user with access to entities 42 and 99
-- ============================================================
SET app_user_id = 'alice@yourcompany.com';
SET app_allowed_entities = '42,99';

SELECT entity_id, COUNT(*) AS row_count, SUM(amount) AS total_amount
FROM my_revenue
GROUP BY entity_id
ORDER BY entity_id;
-- Expected: rows for entity_id 42 and 99 only, with their counts and sums.
-- Rows for entity 100, 200, etc. are filtered out by the policy.

-- ============================================================
-- Test 3: explicit query for an unauthorized entity returns empty
-- ============================================================
SELECT * FROM my_revenue WHERE entity_id = 200 LIMIT 10;
-- Expected: zero rows. The user's WHERE clause asks for entity 200,
-- but the policy filters those rows out before the WHERE clause sees them.

-- ============================================================
-- Test 4: aggregations work naturally across allowed entities
-- ============================================================
SELECT region, SUM(amount) AS regional_total
FROM my_revenue
WHERE date >= '2025-01-01'
GROUP BY region
ORDER BY regional_total DESC;
-- Expected: aggregates rows from entities 42 and 99 only.

-- ============================================================
-- Test 5: raw schema is inaccessible
-- ============================================================
SELECT * FROM prod_db.raw.revenue LIMIT 1;
-- Expected: SQL compilation error such as
--   "Schema 'PROD_DB.RAW' does not exist or not authorized."

-- ============================================================
-- Cleanup: unset variables
-- ============================================================
UNSET app_allowed_entities;
UNSET app_user_id;

SELECT COUNT(*) FROM my_revenue;
-- Expected: 0 (after unset, fail-closed default applies)
```

If all five tests match expectations — zero when unset, correct rows when set, zero for unauthorized entity, raw inaccessible — the isolation is working for this view.

---

## Adding the next table

When you do this for `prod_db.raw.transactions`, only Steps 4–7 change. Steps 1–3 (governance schema, policy, curated schema) are reused.

```sql
-- Curated view for transactions
CREATE OR REPLACE SECURE VIEW prod_db.curated.my_transactions AS
SELECT
    entity_id,
    txn_date,
    amount,
    currency,
    counterparty_id,
    txn_type,
    settlement_date,
    created_at
FROM prod_db.raw.transactions;

-- Same policy, attached to a different view
ALTER VIEW prod_db.curated.my_transactions
  ADD ROW ACCESS POLICY prod_db.governance.agent_entity_isolation ON (entity_id);

-- Grant
GRANT SELECT ON VIEW prod_db.curated.my_transactions TO ROLE agent_runtime;
```

The same policy is reused. **One policy, many views.** That's the scaling property: adding a tenant table to the agent's surface is a five-line DDL change, not a new authorization model.

---

## Three subtleties that matter

### 1. `CREATE OR REPLACE VIEW` drops the policy attachment

If you redeploy the view with `CREATE OR REPLACE`, Snowflake creates a fresh view object and any policy that was attached to the previous one is gone. You must re-run the `ALTER VIEW ... ADD ROW ACCESS POLICY` after every replace.

This is why the deployment script in Step 8 always runs both statements together. If you split them across files or scripts, you will eventually deploy a view replacement without the reattach step, and isolation silently breaks.

The recommended CI check for this pattern: any view in `curated.*` that references a tenant column must have the policy attached. Run it after every deploy. A non-empty result is a security finding, not a polish item.

### 2. The `entity_id` column must be in the view's SELECT list

The policy attaches via `ON (entity_id)`, which references a column the view actually exposes. If you drop `entity_id` from the SELECT list (because you'd rather hide the column from the agent), the `ALTER VIEW ... ADD ROW ACCESS POLICY ... ON (entity_id)` will fail because there is no `entity_id` column to attach to.

For Pattern A-multi where the agent legitimately needs to filter and group by entity, this is fine — `entity_id` belongs in the view. For single-entity Pattern A where you'd rather hide the column, you would attach the policy to the underlying raw table instead, not to the view. (That's a different deployment model with broader implications; see the main controls document.)

### 3. `SECURE` views have a small but real performance cost

The optimizer is more conservative with secure views — it can't use some plan optimizations that might leak information. In practice the cost is usually small (often unmeasurable in interactive workloads), but for very large fact tables you may see a 5–15% query slowdown compared to a non-secure view.

The mitigation is good clustering on `entity_id` so partition pruning is still effective. If you ever benchmark and decide the cost is too high for a specific high-traffic view, you have an architectural choice: drop `SECURE` and accept the leakage risk, or move the policy from the view to the underlying table. The latter is usually the better call when performance matters more than backwards-compatibility with existing raw-table consumers.

---

## What this looks like to the agent

The agent's prompt now includes one more view in its schema description:

```
Available views:

curated.my_revenue (entity_id, date, amount, currency, product_id, region,
                    customer_id, created_at)
  Description: Revenue rows. Filtered automatically to entities you have
    access to. Use GROUP BY entity_id for cross-entity rollups.
```

The agent generates SQL like:

```sql
SELECT entity_id, SUM(amount) AS total
FROM curated.my_revenue
WHERE date >= '2025-01-01'
GROUP BY entity_id
ORDER BY total DESC;
```

The connection module has set `$app_allowed_entities = '42,99'` from the verified JWT. Snowflake expands the view, applies the policy, prunes partitions, returns rows for entities 42 and 99. The user gets the right answer; the LLM never had to know about the entity filter.

---

## Checklist for adding a new view

- [ ] Identified the raw table and its `entity_id` column
- [ ] Decided which columns to expose vs. drop (data minimization)
- [ ] Confirmed `entity_id` is in the SELECT list
- [ ] Wrote the `CREATE OR REPLACE SECURE VIEW` statement
- [ ] Wrote the matching `ALTER VIEW ... ADD ROW ACCESS POLICY ... ON (entity_id)` statement
- [ ] Combined both into a single idempotent deployment file
- [ ] Wrote the `GRANT SELECT ON VIEW ... TO ROLE agent_runtime` statement
- [ ] Ran the five verification tests in Step 9
- [ ] Updated the agent's schema description to include the new view
- [ ] Verified the CI check (curated views with tenant columns have policy) still passes
- [ ] Updated the inventory of curated views in your design docs

End of worked example.
