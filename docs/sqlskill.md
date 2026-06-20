# How to Build a Snowflake SQL Skill for a LangChain Deep Agent

> **Audience:** a Claude Code (or similar) agent tasked with constructing a Snowflake
> data-querying *skill* for a LangChain **deep agent**, optimized for **token efficiency**
> and **accuracy**, **without using Snowflake Cortex** (the agent's own LLM writes the SQL).
>
> Read this top to bottom before creating files. It encodes deliberate trade-offs; don't
> "improve" it by inlining data into the prompt — that defeats the whole design.

---

## 0. The one principle that drives everything

**The agent should pay tokens for a capability in proportion to how much it actually uses
it.** A flat schema/catalog loaded on every turn is the failure mode you are avoiding: 50
tables × ~500–1000 tokens = 25k–50k tokens riding in context whether the question touches 2
tables or 50 — which is both expensive *and* less accurate (the model drowns in irrelevant
tables).

You achieve proportional cost through **progressive disclosure** (3 levels) and **context
isolation** (a dedicated subagent). Everything below is in service of that.

---

## 1. Final folder layout (build exactly this)

```
skills/snowflake-sql/
  SKILL.md                     # Level 1 frontmatter + Level 2 body (runbook only, no data)
  references/
    index.md                   # Level 3: ONE line per table (name + purpose). ~50 tok/table.
    tables/
      <table_a>.md             # Level 3: full detail for ONE table, loaded on demand
      <table_b>.md
      ...
    examples.jsonl             # Level 3: verified {question, sql} pairs for few-shot retrieval
    sql_style.md               # Level 3: dialect notes, date idioms, LIMIT/timeout rules
  scripts/
    validate_sql.py            # Level 3: deterministic sqlglot parse + EXPLAIN dry-run
```

Keep `references/` **one level deep** of nesting (the `tables/` subfolder is fine; don't go
deeper). Put **deterministic operations in `scripts/`**, not in prose.

---

## 2. The three levels of progressive disclosure (what loads when)

| Level | What | When it loads | Token discipline |
|---|---|---|---|
| **1 — Metadata** | YAML frontmatter `name` + `description` | Always, at startup, for every skill | A few hundred tokens total. This is the *trigger*. |
| **2 — Instructions** | The `SKILL.md` body | Only when the model invokes the skill | **< ~5,000 tokens / 500 lines.** A runbook, not a manual. |
| **3 — Resources** | `references/`, `scripts/` | Only when the body points the agent to them | Unbounded (lazy). Bulk data lives here. |

The middleware handles Level 1→2 automatically; **the LLM drives Level 3** by following the
body's instructions and calling `read_file` / `grep` / a retrieval tool.

**Rule of thumb:** the body contains the *procedure and pointers*; it never contains data.
The catalog, examples, and style rules are Level-3 resources the body knows how to navigate.

---

## 3. Write the frontmatter `description` carefully — it's the highest-leverage text

It's the only always-on content **and** the sole trigger signal. Be specific about *when to
use* the skill. Vague descriptions cause both misfires and misses.

- Bad: `description: Query Snowflake.`
- Good: `description: Answer questions about sales, orders, and customer data by writing
  read-only SQL against the Snowflake ANALYTICS database. Use for any metric, count,
  aggregation, or "how many/how much" question over warehouse data.`

---

## 4. Write the body as a runbook (template)

Create `SKILL.md` with this shape. Note it is almost entirely procedure + pointers, ~300
tokens. **Do not paste schema, examples, or rules into it.**

````markdown
---
name: snowflake-sql
description: Answer questions about <DOMAIN> data by writing read-only SQL against the
  Snowflake <DB> database. Use for any metric, count, aggregation, or "how many/how much"
  question over warehouse data.
---

# Snowflake SQL workflow

Follow these steps for every data question. DO NOT load the full catalog.

1. **Find relevant tables.** Call `find_tables(question)` (or read `references/index.md`)
   and pick only the 2–4 tables you actually need.
2. **Load detail for those tables only.** Read `references/tables/<name>.md` for each chosen
   table — columns, synonyms, metric definitions, join paths. Never read tables you didn't
   select in step 1.
3. **Pull similar examples.** Call `find_examples(question)` to retrieve the ~5 most similar
   verified {question → SQL} pairs. Mirror their patterns.
4. **Check style rules.** If the question involves dates, money, or ranking, consult
   `references/sql_style.md` for the correct idioms.
5. **Execute read-only with a LIMIT.** Use `run_sql`. It validates the SQL internally
   (sqlglot parse + EXPLAIN) BEFORE executing and refuses anything that fails validation —
   you do not call a separate validate step.
6. **On failure, decide whether to retry.** `run_sql` returns an error labeled
   `retryable` or `fatal`:
   - `retryable` (syntax, unknown table/column, type mismatch, bad join): read the error,
     fix the query, try again — **maximum 3 attempts total**.
   - `fatal` (permission denied, warehouse error, connection): STOP immediately. Do not
     rewrite SQL — return the error upward. (A timeout allows ONE retry with a tighter
     filter/LIMIT, then becomes fatal.)
   After 3 retryable failures, stop and return the latest error.
7. **Return a compact answer** (< ~200 words). Write large result sets to a file and return
   the path — never paste full result sets back into context.

## Hard rules
- Read-only only. Never INSERT / UPDATE / DELETE / DROP / any DDL.
- Always include a LIMIT unless the user explicitly asks for a full export.
- If the question is ambiguous, ask ONE clarifying question instead of guessing.
- When retrying, keep only the latest error in mind; do not re-reason over every past attempt.
- Never retry a `fatal` error — rewriting SQL won't fix it; it only burns tokens.
````

---

## 5. Build the Level-3 resources

**`references/index.md`** — one line per table, ~50 tokens each. This is the only catalog
content the agent ever scans wholesale (and it caches well). Example:
```markdown
- orders — one row per order; revenue, discount, status, order_date. FK customer_id.
- customers — one row per customer; region, segment, signup_date.
- products — product catalog; category, list_price.
```

**`references/tables/<name>.md`** — full detail for ONE table: columns with descriptions +
**synonyms**, **metric definitions** (define each metric once, e.g.
`net_revenue = SUM(gross_revenue * (1 - discount))`), and **join paths**. ~500–1000 tokens.
These exist so the agent loads ~3 of them per question instead of all 50.

**`references/examples.jsonl`** — verified `{question, sql}` pairs. Curate aggressively; bad
examples actively hurt accuracy. Use half-open date windows
(`>= start AND < next_period`) in the SQL so the agent learns the correct date idiom.

**`references/sql_style.md`** — Snowflake dialect notes, date/money/ranking idioms, the
mandatory `LIMIT`, and the read-only rule.

**`scripts/validate_sql.py`** — deterministic, no LLM: `sqlglot.parse_one(sql,
dialect="snowflake")` to catch syntax errors locally, then `EXPLAIN <sql>` against Snowflake
to catch unknown tables/columns *before* a full execution. This is a **helper that `run_sql`
calls internally** (see §6), not a tool the model invokes. Return a clear, **actionable**
error string — e.g. `column "revenu" not found, did you mean "revenue"?` rather than a raw
traceback. Actionable errors are a bigger token lever than validation itself: they let the
model fix the query in one shot instead of flailing across multiple full-context retries.

---

## 6. Tools the agent/subagent needs (keep the set small)

Tool definitions cost tokens on every turn, so expose only:

- `find_tables(question)` — vector/keyword search over `index.md` descriptions; returns the
  matching table cards. (Preferred over dumping `index.md` once you exceed ~15–20 tables.)
- `get_schema(tables)` / `read_file` — load specific `tables/<name>.md`.
- `find_examples(question)` — semantic-similarity retrieval over `examples.jsonl`
  (e.g. `SemanticSimilarityExampleSelector`); return ~5.
- `run_sql(sql)` — the single execution tool. Internally it (1) **validates** via
  `scripts/validate_sql.py` (sqlglot parse + EXPLAIN) and refuses to execute SQL that fails,
  then (2) executes **read-only** with a `LIMIT`, then (3) **classifies any error** as
  `retryable` or `fatal` and returns that label with an actionable message.

**Do NOT expose a separate `validate_sql` tool.** Validation belongs *inside* `run_sql`. A
standalone validate tool forces an extra model turn per attempt — and because every model
turn re-bills the full accumulated context, that extra turn *adds* tokens on the common
success path. Folding validation into `run_sql` gives the same cheap "catch bad SQL before it
executes" benefit for ~zero extra tokens (it's Python in the tool, not an LLM round-trip).

### Error classification inside `run_sql`

Not every failure should become a retry — retrying an unfixable error just burns full-context
turns. `run_sql` should label errors:

| Error type | Examples | Label | Agent action |
|---|---|---|---|
| SQL-correctable | syntax error, unknown table/column, type mismatch, ambiguous column, bad join | `retryable` | fix & retry (counts toward the 3-cap) |
| Not SQL-correctable | permission denied, warehouse suspended, connection error | `fatal` | stop, return upward — **no retry** |
| Resource | statement timeout / query too heavy | `retryable` **once** | retry once with a tighter filter/LIMIT, then treat as `fatal` |

Both the internal validation stage and the execution stage feed this same classifier, so a
validation failure and an execution failure are handled identically: labeled, and retried
only if `retryable`.

---

## 7. Wire it into a dedicated subagent (context isolation)

Run the Snowflake work inside its own subagent so its many intermediate tool calls never
pollute the main thread — the main agent receives only a compact final answer.

```python
snowflake_subagent = {
    "name": "snowflake-sql",
    "description": "Answers data questions by writing and running read-only SQL against "
                   "Snowflake. Use for any metric, count, or aggregation.",
    "system_prompt": (
        "You write Snowflake SQL using ONLY the catalog and verified examples provided. "
        "Follow the snowflake-sql skill workflow. Use run_sql to execute (it validates "
        "internally and labels errors retryable/fatal); retry retryable errors at most 3 "
        "times, never retry fatal errors, and RETURN ONLY the essential answer (<~200 words). "
        "Write large result sets to a file and reference the path."
    ),
    "tools": [find_tables, get_schema, find_examples, run_sql],
}
agent = create_deep_agent(model=<your_model>, subagents=[snowflake_subagent],
                          skills=["./skills/"])
```

Notes: `name`, `description`, `system_prompt` are required; `system_prompt` does NOT inherit
from the main agent; specifying `tools` REPLACES inherited tools. Do **not** decompose the
Cortex-style pipeline (classify → literal-retrieve → generate → correct → synthesize) into
five chained agents — that multiplies LLM calls over the same context. Collapse it into this
one subagent: classification = a prompt instruction, literal retrieval = an on-demand tool,
correction = the validate/retry loop, synthesizer = skip unless evals prove you need it. If
context still bloats, split by **data domain** (a subagent per subject area with its own
scoped catalog), never by pipeline stage.

---

## 8. Cap retries and prune failure history (this dominates token cost)

Every model call re-bills the entire accumulated conversation, so retries grow cost roughly
**quadratically**. Illustrative budget for one question through this subagent (~3 tables, ~5
examples, ~4k prefix):

| Retries | Approx total tokens |
|---|---|
| 0 (first try works) | ~60k |
| 3 | ~127k |
| 10 | ~331k |

Therefore:

- **Hard-cap retries at 3.** If 3 corrected attempts fail, more won't help — return the
  error and let the main agent re-plan or ask the user. (3 vs 10 retries ≈ 127k vs 331k.)
- **Count both failure kinds against the cap.** A validation failure and an execution failure
  are *both* a model turn that re-bills context, so both increment the same counter. Don't
  give validation its own uncapped budget, or you've just moved the blow-up into the
  validation loop.
- **Only retry `retryable` errors; fail fast on `fatal` ones.** Rewriting SQL can't fix a
  permission or connection error — looping on it wastes the whole budget for nothing. (See
  the classification table in §6.)
- **Prune the failure history between retries.** Keep only the *latest* error, or a one-line
  summary of prior attempts — don't carry 10 broken-SQL + full-traceback pairs in context.
  Use `ClearToolUsesEdit` / tool-result clearing (cheapest, safest compaction).
- **Validation lowers cost-per-failure, not the number of failures** — the cap bounds the
  count; validation (inside `run_sql`) makes each failed attempt cheap (local parse vs full
  execute round-trip); **actionable error messages reduce the count** by helping the model
  fix in one shot. You need all three.

---

## 9. Governance (do regardless — no Cortex needed)

- **Dedicated read-only role** with minimal grants; scope connection permissions as narrowly
  as possible.
- **Low `STATEMENT_TIMEOUT_IN_SECONDS`** (e.g. 30–120s) on the agent's role/warehouse — the
  Snowflake default is two days, which lets a runaway query burn compute.
- **`QUERY_TAG = 'deepagent'`** so all agent SQL is auditable in `QUERY_HISTORY`.
- **No DML/DDL** — enforce in the prompt AND via the role's grants and/or a statement-type
  allowlist.
- **Human-in-the-loop** — set `interrupt_on` to pause before `run_sql` in production.
- Connect via `snowflake-sqlalchemy` → LangChain `SQLDatabase`/`SQLDatabaseToolkit` (set
  `include_tables=[...]` and `lazy_table_reflection=True` so it doesn't reflect all 50
  schemas at startup), or via thin custom tools. Avoid `ChatSnowflake` — it runs on Cortex
  Complete; bring your own model as the deep agent's LLM.

---

## 10. Let caching and the default middleware work

- Order content **stable → volatile** (tool defs → system/skill body → catalog → conversation)
  and keep the stable prefix **byte-identical** so prompt caching applies (cache reads ≈ 0.1×;
  deep agents apply Anthropic prompt caching automatically on Anthropic models). Caching
  discounts the repeated prefix only — it does NOT help the growing failure history, which is
  why §8 matters more.
- The default `SummarizationMiddleware` (triggers ~85% of the context window) and context
  editing are already on; rely on them rather than hand-rolling compaction.

---

## 11. Definition of done — checklist

- [ ] `SKILL.md` body is < ~500 lines and contains **no** schema/examples/rules — only
      procedure + pointers.
- [ ] Frontmatter `description` is specific about *when to use* the skill.
- [ ] `index.md` has one ~50-token line per table; full detail lives in `tables/<name>.md`.
- [ ] Each metric is defined exactly once in a table file.
- [ ] `examples.jsonl` is curated and uses correct (half-open) date idioms.
- [ ] `validate_sql.py` does a real sqlglot parse (+ EXPLAIN) and returns actionable errors;
      it runs **inside** `run_sql` (no separate validate tool exposed to the model).
- [ ] `run_sql` labels every error `retryable` or `fatal`.
- [ ] Retries are hard-capped at 3 (counting both validation and execution failures); `fatal`
      errors are not retried; failure history is pruned between attempts.
- [ ] Read-only role, statement timeout, and query tag are configured.
- [ ] The skill runs inside an isolated `snowflake-sql` subagent that returns a compact answer.

---

## 12. Anti-patterns (do NOT do these)

- ❌ One big `catalog.md` (or full schema) inlined in the prompt or the SKILL.md body.
- ❌ Reflecting all tables at startup.
- ❌ Loading every `tables/*.md` "just in case."
- ❌ Inlining the entire examples library instead of retrieving ~5.
- ❌ Unbounded retries, or keeping every failed SQL + traceback in context.
- ❌ Retrying `fatal` errors (permission/connection) — rewriting SQL can't fix them.
- ❌ Exposing a separate `validate_sql` tool — it adds a model turn (extra context re-send)
      per attempt; fold validation inside `run_sql` instead.
- ❌ Giving validation its own uncapped retry budget separate from execution.
- ❌ Splitting the pipeline into 5 stage-agents (multiplies calls over the same context).
- ❌ Using `ChatSnowflake`/any Cortex feature when the requirement is no-Cortex.
- ❌ Treating "validate before execute" as a prompt suggestion instead of enforcing it in
      `run_sql`.

---

### Why these choices (one-line justifications)

Progressive disclosure keeps per-question tokens proportional to the tables actually used;
subagent isolation keeps heavy intermediate work out of the main thread; a self-maintained
catalog + dynamic few-shot replaces the accuracy that Cortex's semantic view would have
provided; validate-before-execute + a 3-retry cap + history pruning prevent the quadratic
token blow-up that retries otherwise cause; prompt caching makes the unavoidable stable
prefix ~10× cheaper after the first turn.
