# Build Spec: SQL Firewall for LLM-Generated Queries

**Purpose:** This document specifies how to build a Python module that validates LLM-generated SQL before it reaches Snowflake. The module parses the SQL with sqlglot, applies a set of structural rules, and either returns normalized SQL safe to execute or raises a validation error that the agent runtime treats as a refusal.

**Audience:** Claude Code or a developer implementing the module. Assumes familiarity with Python and basic SQL parsing concepts. Does not assume prior context about this specific project.

**Scope:** The pre-execution SQL validation layer only. Out of scope: the Snowflake connection module (separate spec), the agent runtime, the LLM integration, the auth service. Those are separate components that consume or produce around this module.

**Related artifacts:** This module pairs with the Snowflake connection module (`snowflake_session`). The flow is:

```
LLM produces SQL
    ↓
SQL firewall (THIS MODULE) validates and normalizes
    ↓
snowflake_session opens connection with bound identity
    ↓
Validated SQL executes against curated views
    ↓
Row access policies in Snowflake filter rows by entity
```

The firewall is the first wall. The connection's identity binding and Snowflake's RLS are the second and third walls. Each catches what the others miss; together they make a breach require multiple simultaneous failures.

---

## Part 1 — Background and rationale

### What the module does

The module exposes a single function — `validate_sql(sql: str) -> str` — that takes an LLM-generated SQL string, parses it with sqlglot, applies validation rules, and returns either:

- A normalized SQL string that is structurally safe to execute, OR
- An exception describing why the SQL was rejected

The agent runtime is expected to call this function on every SQL string the LLM produces, before passing the result to `snowflake_session`'s connection cursor.

### Why a firewall is necessary

The threat model is straightforward: the LLM produces SQL strings, and we don't trust those strings. Possible problems:

1. **Multi-statement payloads** that change session state. Example: `SET app_allowed_entities = '99'; SELECT * FROM curated.my_revenue`. Even though the connection module hardens against this, the firewall's job is to catch it before the connection ever sees it.

2. **Statements that aren't SELECTs.** `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `CALL`, `USE`, `SET`. The agent role lacks privileges to execute most of these, but rejecting at the firewall is faster, clearer, and doesn't depend on Snowflake's grant configuration being correct.

3. **References to tables outside the agent's surface.** The agent should only query `curated.*`. Queries like `SELECT * FROM raw.revenue` or `SELECT * FROM information_schema.tables` are rejected.

4. **Constructs that bypass intended controls.** `RESULT_SCAN` (reads another query's results), `EXECUTE IMMEDIATE` (dynamic SQL), `SHOW TABLES`, references to internal stages or tasks.

5. **Unparseable SQL.** Garbage from the LLM should fail loudly, not produce a Snowflake error the user sees raw.

The firewall's job is to make these failures fast, deterministic, auditable, and decoupled from Snowflake.

### Why sqlglot

[sqlglot](https://github.com/tobymao/sqlglot) is a pure-Python SQL parser supporting the Snowflake dialect (and 25+ others). It produces an AST you can walk and reason about programmatically.

Alternatives considered and rejected:

- **Regex-based filtering.** Fails on string literals containing keywords, comments, quoted identifiers, whitespace variations, and a long list of edge cases. SQL grammar is too complex for pattern matching.
- **Sending to Snowflake's `EXPLAIN`.** Costs a round-trip per query, doesn't help with allowlisting (Snowflake parses `raw.*` references fine), exposes the database to unvalidated input.
- **Custom parser.** Reinventing what sqlglot already does well.

sqlglot has a small caveat: its parser is not 100% identical to Snowflake's. For common SELECT/JOIN/GROUP BY/window function shapes, parity is excellent. For very recent Snowflake-specific syntax, sqlglot may lag. The tradeoff is acceptable: false positives in a security gate (rejecting safe SQL) are much better than false negatives (accepting unsafe SQL).

### Required Python version and dependencies

- Python 3.11+
- `sqlglot>=25.0` — current stable; check for breaking changes in major versions

No other runtime dependencies. The module is sync, has no I/O, and is a pure function — it makes no network calls and doesn't depend on database availability.

---

## Part 2 — Architecture

### Module layout

```
sql_firewall/
├── __init__.py             # Public API
├── errors.py               # Exception types
├── allowlist.py            # Configurable allowlist of tables and constructs
├── validators.py           # Individual validation rules (composable)
└── firewall.py             # The orchestrator — calls validators in order
```

Public API surface:

- `validate_sql(sql: str) -> str` — main entry point
- `SQLValidationError` — exception class (with subclasses for specific reasons)
- `Allowlist` — configuration object passed to `validate_sql` for table/schema rules

Everything else is implementation detail.

### Design principles

1. **Composable validators.** Each rule is its own function. The orchestrator calls them in a fixed order. New rules can be added without touching existing ones.

2. **Fail-fast and verbose.** Validation errors carry the *reason* for rejection — which rule failed, which AST node was at fault. The agent runtime logs these; the user (or LLM retry path) gets a generic "I couldn't safely run that query."

3. **Pure function, no side effects.** No database calls, no logging, no mutation of inputs. Caller decides what to do with the result.

4. **Configurable allowlist, hard-coded rules.** *What* is allowed (which tables, which schemas) is config. *How* validation works (the rules themselves) is code, security-reviewed.

5. **Re-emit, don't pass through.** The function returns the SQL that sqlglot re-emitted from its own AST, not the LLM's literal text. This normalizes whitespace, comment handling, and quoting — and ensures Snowflake executes what the firewall approved.

### Failure modes the firewall does NOT defend against

To set expectations clearly:

- **Logically wrong queries.** `WHERE entity_id = 42 AND entity_id = 99` parses cleanly and returns zero rows. The firewall doesn't flag this.
- **Performance attacks.** A SELECT that scans a billion rows passes structural validation. Cost guards (query timeouts, EXPLAIN-based row estimates) are a separate concern.
- **Semantic attacks at the data layer.** If a user is allowed entity 42 and queries entity 42, the firewall lets the query through — and so does RLS. Whether the user *should* be able to see entity 42 is the auth service's decision.
- **SQL that sqlglot parses differently than Snowflake.** Rare but real. Mitigated by extensive testing against your actual query corpus; not solvable in general.

These are real concerns, but they belong to other layers. Keep this module focused on structural validation.

---

## Part 3 — Implementation

### File: `errors.py`

```python
"""Exceptions raised by the SQL firewall.

The base class is SQLValidationError. Subclasses indicate the specific
rule that failed, useful for logging and for the agent runtime to decide
how to react (retry the LLM with feedback, refuse the user, etc.).
"""
from __future__ import annotations


class SQLValidationError(Exception):
    """Base class. The SQL did not pass firewall validation."""


class SQLParseError(SQLValidationError):
    """The SQL is not parseable as Snowflake SQL."""


class StatementCountError(SQLValidationError):
    """The SQL contains zero or multiple statements; exactly one expected."""


class StatementTypeError(SQLValidationError):
    """The statement is not a SELECT (or CTE-wrapped SELECT)."""


class TableNotAllowedError(SQLValidationError):
    """A table reference is outside the configured allowlist."""


class ForbiddenConstructError(SQLValidationError):
    """The SQL contains a construct that's structurally rejected
    (SET, USE, ALTER, SHOW, CALL, CREATE, etc.)."""


class ForbiddenFunctionError(SQLValidationError):
    """The SQL calls a function that's on the deny list
    (RESULT_SCAN, GET_DDL, SYSTEM$* functions, etc.)."""
```

### File: `allowlist.py`

```python
"""Configuration for the firewall: which tables and schemas are allowed.

The allowlist is data, not code. It can come from a config file, a
deploy-time environment variable, or be hard-coded. The shape of validation
(rules) is in code; the values (table names) are in this object.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Allowlist:
    """Table and schema allowlist for the firewall.

    Fields:
        schemas: Lowercase schema names the agent may reference.
        tables: Lowercase fully-qualified table names ("schema.table").
            Tables not in this set are rejected even if their schema is.
            This lets you allow a curated schema but only specific views in it.

    Both fields are checked. A table reference passes only if BOTH:
        - its schema is in `schemas`, AND
        - its full name is in `tables` (when `tables` is non-empty).

    Set `tables` to an empty frozenset to allow any table within the
    allowed schemas (less restrictive; useful for dev environments).
    """
    schemas: frozenset[str] = field(default_factory=frozenset)
    tables: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def default(cls) -> "Allowlist":
        """The production default for the agent runtime."""
        return cls(
            schemas=frozenset({"curated"}),
            tables=frozenset({
                "curated.my_revenue",
                "curated.my_transactions",
                "curated.my_positions",
                "curated.my_entity_access",
            }),
        )
```

### File: `validators.py`

This is where the rules live. Each function does one job and either passes silently or raises.

```python
"""Composable validation rules. Each function is a single rule.

Each validator takes a parsed sqlglot expression (and possibly an Allowlist)
and either returns silently (validation passed) or raises a subclass of
SQLValidationError.

Rules are grouped into:
  - Structural (statement count, statement type)
  - Reference (tables, schemas)
  - Construct (forbidden node types)
  - Function (forbidden function calls)

The orchestrator in firewall.py calls them in this order. Stop on first failure.
"""
from __future__ import annotations

from sqlglot import exp

from .allowlist import Allowlist
from .errors import (
    ForbiddenConstructError,
    ForbiddenFunctionError,
    StatementCountError,
    StatementTypeError,
    TableNotAllowedError,
)


# --------------------------------------------------------------------
# Constants — what's forbidden
# --------------------------------------------------------------------

# AST node types that should never appear inside the validated statement.
# These are sqlglot expression classes, not Snowflake keyword strings.
FORBIDDEN_NODE_TYPES: tuple[type[exp.Expression], ...] = (
    exp.Command,        # generic catch-all for parsed-but-unstructured DDL
    exp.Set,            # SET sessionvar = ...
    exp.SetItem,        # nested SET
    exp.Show,           # SHOW TABLES, SHOW VIEWS, etc.
    exp.Use,            # USE DATABASE/SCHEMA/ROLE/WAREHOUSE
    exp.AlterTable,
    exp.AlterColumn,
    exp.AlterSession if hasattr(exp, "AlterSession") else exp.Command,
    exp.Create,
    exp.Drop,
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Merge,
    exp.TruncateTable,
    exp.Transaction,    # BEGIN, COMMIT, ROLLBACK
)

# Function names that should never be called.
# Match case-insensitive against the function's name.
FORBIDDEN_FUNCTIONS: frozenset[str] = frozenset({
    # Reads other queries' results
    "result_scan",
    # Returns DDL of objects (information disclosure)
    "get_ddl",
    # Snowflake system functions — most are admin-only,
    # rejecting all SYSTEM$* keeps the surface tight
    "system$wait",
    "system$abort_session",
    "system$abort_query",
    "system$cancel_all_queries",
    "system$query_log",
    # Stage/file system access
    "system$external_table_files",
    # Dynamic SQL
    "execute_immediate",
})

# Statement types that are valid top-level wrappers.
# A bare SELECT or a CTE-wrapped SELECT (WITH ... SELECT) are both fine.
ALLOWED_STATEMENT_TYPES: tuple[type[exp.Expression], ...] = (
    exp.Select,
    exp.With,           # WITH cte AS (...) SELECT ...
)


# --------------------------------------------------------------------
# Structural validators
# --------------------------------------------------------------------

def assert_single_statement(statements: list[exp.Expression]) -> None:
    """The SQL must contain exactly one statement."""
    if len(statements) == 0:
        raise StatementCountError("empty SQL — no statements found")
    if len(statements) > 1:
        types = [type(s).__name__ for s in statements]
        raise StatementCountError(
            f"expected 1 statement, got {len(statements)}: {types}"
        )


def assert_statement_type(stmt: exp.Expression) -> exp.Expression:
    """The statement must be a SELECT or a CTE-wrapped SELECT.

    Returns the inner SELECT for downstream validators, unwrapping the
    WITH if present.
    """
    if not isinstance(stmt, ALLOWED_STATEMENT_TYPES):
        raise StatementTypeError(
            f"only SELECT permitted, got {type(stmt).__name__}"
        )

    # If it's a WITH ... SELECT, the inner expression must also be a SELECT
    if isinstance(stmt, exp.With):
        inner = stmt.this
        if not isinstance(inner, exp.Select):
            raise StatementTypeError(
                f"CTE wraps non-SELECT: {type(inner).__name__}"
            )

    return stmt


# --------------------------------------------------------------------
# Reference validators
# --------------------------------------------------------------------

def assert_allowed_tables(stmt: exp.Expression, allowlist: Allowlist) -> None:
    """Every table reference must be in the allowlist.

    Tables must be schema-qualified (`schema.table`). Unqualified references
    are rejected because their resolution depends on the session's current
    schema, which is not under the firewall's control.
    """
    for table in stmt.find_all(exp.Table):
        # CTEs introduce names that look like tables but aren't real tables.
        # sqlglot represents them differently; .find_all(exp.Table) returns
        # both real tables and CTE references. We need to distinguish.
        if _is_cte_reference(table, stmt):
            continue

        schema = table.db.lower() if table.db else None
        name = table.name.lower()

        if schema is None:
            raise TableNotAllowedError(
                f"table {name!r} must be schema-qualified (e.g. 'curated.{name}')"
            )

        if schema not in allowlist.schemas:
            raise TableNotAllowedError(
                f"schema {schema!r} not in allowlist"
            )

        if allowlist.tables:
            fqn = f"{schema}.{name}"
            if fqn not in allowlist.tables:
                raise TableNotAllowedError(
                    f"table {fqn!r} not in allowlist"
                )


def _is_cte_reference(table: exp.Table, root: exp.Expression) -> bool:
    """Return True if the given Table node refers to a CTE name in scope.

    CTEs in sqlglot are represented as exp.CTE nodes whose alias is what
    later references look like. A table reference matching a CTE alias is
    not a real table — it's a CTE reference and should be skipped.
    """
    if table.db:
        # Schema-qualified references are never CTE refs (CTEs are unqualified)
        return False

    cte_names = {
        cte.alias.lower()
        for cte in root.find_all(exp.CTE)
        if cte.alias
    }
    return table.name.lower() in cte_names


# --------------------------------------------------------------------
# Construct validators
# --------------------------------------------------------------------

def assert_no_forbidden_constructs(stmt: exp.Expression) -> None:
    """Walk the AST; reject if any node is a forbidden type.

    This catches SET, ALTER SESSION, SHOW, USE, CREATE, DROP, INSERT,
    UPDATE, DELETE, MERGE, BEGIN/COMMIT, etc. — anything that's not
    expressible inside a SELECT.
    """
    for node in stmt.walk():
        # sqlglot's walk yields tuples of (node, parent, key) in some
        # versions and just (node,) in others. Normalize.
        node_obj = node[0] if isinstance(node, tuple) else node
        if isinstance(node_obj, FORBIDDEN_NODE_TYPES):
            raise ForbiddenConstructError(
                f"forbidden construct: {type(node_obj).__name__}"
            )


# --------------------------------------------------------------------
# Function validators
# --------------------------------------------------------------------

def assert_no_forbidden_functions(stmt: exp.Expression) -> None:
    """Walk the AST for function calls; reject if any are denied.

    Catches calls like RESULT_SCAN, SYSTEM$ABORT_SESSION, etc.
    """
    for func in stmt.find_all(exp.Func):
        name = (func.sql_name() or "").lower()
        if name in FORBIDDEN_FUNCTIONS:
            raise ForbiddenFunctionError(
                f"forbidden function: {name}"
            )

    # Anonymous functions (vendor-specific or unknown) — also check
    for anon in stmt.find_all(exp.Anonymous):
        if anon.this:
            name = anon.this.lower()
            if name in FORBIDDEN_FUNCTIONS:
                raise ForbiddenFunctionError(
                    f"forbidden function: {name}"
                )
            # Catch all SYSTEM$* even if not explicitly in the list,
            # since Snowflake adds new ones over time
            if name.startswith("system$"):
                raise ForbiddenFunctionError(
                    f"forbidden system function: {name}"
                )
```

### File: `firewall.py`

The orchestrator. Calls validators in order, returns normalized SQL or raises.

```python
"""The SQL firewall orchestrator.

Public API:
    validate_sql(sql, allowlist=None) -> str

Calls validators in a fixed order. Stops on first failure. Returns the
re-emitted SQL string after parsing — this is what the database should
actually execute, NOT the original LLM output.
"""
from __future__ import annotations

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from .allowlist import Allowlist
from .errors import SQLParseError
from .validators import (
    assert_allowed_tables,
    assert_no_forbidden_constructs,
    assert_no_forbidden_functions,
    assert_single_statement,
    assert_statement_type,
)


def validate_sql(sql: str, allowlist: Allowlist | None = None) -> str:
    """Parse, validate, and re-emit the LLM's SQL.

    Args:
        sql: The SQL string from the LLM.
        allowlist: Optional Allowlist override. Defaults to Allowlist.default().

    Returns:
        Normalized SQL string, safe to pass to a Snowflake cursor.execute().
        This is sqlglot's re-emission, not the original input — formatting,
        whitespace, and quoting may differ. The semantics are preserved.

    Raises:
        SQLParseError: SQL did not parse.
        StatementCountError: Zero or multiple statements.
        StatementTypeError: Statement is not a SELECT.
        TableNotAllowedError: A table reference is not in the allowlist.
        ForbiddenConstructError: SQL contains a forbidden node type.
        ForbiddenFunctionError: SQL calls a forbidden function.
    """
    if allowlist is None:
        allowlist = Allowlist.default()

    if not sql or not sql.strip():
        raise SQLParseError("empty SQL")

    # Parse — sqlglot.parse returns a list (handles multi-statement input
    # by returning multiple ASTs). For Snowflake dialect specifically.
    try:
        statements = sqlglot.parse(sql, dialect="snowflake")
    except ParseError as e:
        raise SQLParseError(f"unparseable SQL: {e}") from e

    # 1. Exactly one statement
    assert_single_statement(statements)
    stmt = statements[0]

    # 2. Statement is a SELECT (possibly CTE-wrapped)
    assert_statement_type(stmt)

    # 3. All tables are in the allowlist
    assert_allowed_tables(stmt, allowlist)

    # 4. No forbidden constructs anywhere in the tree
    assert_no_forbidden_constructs(stmt)

    # 5. No forbidden function calls
    assert_no_forbidden_functions(stmt)

    # All checks passed. Re-emit normalized SQL.
    return stmt.sql(dialect="snowflake")
```

### File: `__init__.py`

```python
"""Public API for the SQL firewall."""

from .allowlist import Allowlist
from .errors import (
    ForbiddenConstructError,
    ForbiddenFunctionError,
    SQLParseError,
    SQLValidationError,
    StatementCountError,
    StatementTypeError,
    TableNotAllowedError,
)
from .firewall import validate_sql

__all__ = [
    "validate_sql",
    "Allowlist",
    "SQLValidationError",
    "SQLParseError",
    "StatementCountError",
    "StatementTypeError",
    "TableNotAllowedError",
    "ForbiddenConstructError",
    "ForbiddenFunctionError",
]
```

---

## Part 4 — Integration with the agent runtime

The firewall is a pure function. The agent runtime calls it once per LLM-generated SQL string, before opening a Snowflake connection.

```python
from snowflake_session import RequestContext, snowflake_session
from sql_firewall import validate_sql, SQLValidationError


def run_llm_sql(ctx: RequestContext, llm_sql: str) -> list[tuple]:
    """Validate, then execute, an LLM-generated SQL query."""
    try:
        safe_sql = validate_sql(llm_sql)
    except SQLValidationError as e:
        # Log for audit. Decide retry policy at call site.
        log.warning(
            "sql_firewall_rejected",
            extra={
                "request_id": ctx.request_id,
                "reason": type(e).__name__,
                "detail": str(e),
                # Do NOT log the rejected SQL at INFO/WARN — it may contain
                # the LLM's attempted attack and we don't want noisy alerts
                # echoing it. Log at DEBUG with separate retention.
            },
        )
        log.debug("rejected_sql", extra={"sql": llm_sql, "request_id": ctx.request_id})
        raise

    with snowflake_session(ctx) as conn:
        with conn.cursor() as cur:
            cur.execute(safe_sql)
            return cur.fetchall()
```

Two points worth highlighting:

1. **The connection module receives the validated SQL, not the LLM's raw output.** This matters because sqlglot's re-emission normalizes the SQL — the firewall has approved exactly what runs.

2. **Validation errors should be logged and turned into a refusal.** The agent runtime might choose to feed the error back to the LLM as a retry hint ("your SQL was rejected because: X — try again"), or it might surface to the user as "I couldn't run that query." Either way, the rejected SQL itself stays out of high-volume logs to avoid amplifying any attack content.

---

## Part 5 — Testing

The firewall's correctness is testable as a pure function. No database, no network, no fixtures beyond the Allowlist.

### Test setup

```python
# conftest.py
import pytest
from sql_firewall import Allowlist


@pytest.fixture
def allowlist():
    return Allowlist(
        schemas=frozenset({"curated"}),
        tables=frozenset({
            "curated.my_revenue",
            "curated.my_transactions",
            "curated.my_entity_access",
        }),
    )
```

### Test 1: valid SELECT passes

```python
def test_simple_select_passes(allowlist):
    from sql_firewall import validate_sql

    sql = "SELECT date, amount FROM curated.my_revenue WHERE date >= '2025-01-01'"
    result = validate_sql(sql, allowlist)
    assert "curated.my_revenue" in result.lower()
    assert "select" in result.lower()
```

### Test 2: CTE-wrapped SELECT passes

```python
def test_cte_select_passes(allowlist):
    from sql_firewall import validate_sql

    sql = """
        WITH monthly AS (
            SELECT entity_id, DATE_TRUNC('month', date) AS m, SUM(amount) AS t
            FROM curated.my_revenue
            GROUP BY entity_id, DATE_TRUNC('month', date)
        )
        SELECT entity_id, m, t FROM monthly ORDER BY m
    """
    result = validate_sql(sql, allowlist)
    assert "monthly" in result.lower()
```

### Test 3: join between allowed views passes

```python
def test_join_between_allowed_views_passes(allowlist):
    from sql_firewall import validate_sql

    sql = """
        SELECT r.entity_id, r.amount, t.txn_type
        FROM curated.my_revenue r
        JOIN curated.my_transactions t
          ON t.entity_id = r.entity_id
         AND t.txn_date = r.date
    """
    result = validate_sql(sql, allowlist)
    assert "curated.my_revenue" in result.lower()
    assert "curated.my_transactions" in result.lower()
```

### Test 4: multi-statement rejected

```python
import pytest
from sql_firewall import validate_sql, StatementCountError


def test_multi_statement_rejected(allowlist):
    sql = "SET app_allowed_entities = '99'; SELECT * FROM curated.my_revenue"
    with pytest.raises(StatementCountError):
        validate_sql(sql, allowlist)
```

### Test 5: non-SELECT statement rejected

```python
import pytest
from sql_firewall import (
    validate_sql, StatementTypeError, ForbiddenConstructError,
)


@pytest.mark.parametrize("sql", [
    "INSERT INTO curated.my_revenue VALUES (42, '2025-01-01', 100, 'USD', 1, 'US', 1, CURRENT_TIMESTAMP())",
    "UPDATE curated.my_revenue SET amount = 0 WHERE entity_id = 99",
    "DELETE FROM curated.my_revenue WHERE entity_id = 99",
    "MERGE INTO curated.my_revenue USING ...",  # malformed but starts as MERGE
    "DROP TABLE curated.my_revenue",
    "CREATE TABLE foo (x INT)",
    "TRUNCATE TABLE curated.my_revenue",
    "ALTER TABLE curated.my_revenue ADD COLUMN x INT",
])
def test_dml_ddl_rejected(allowlist, sql):
    with pytest.raises((StatementTypeError, ForbiddenConstructError)):
        validate_sql(sql, allowlist)
```

### Test 6: SET / USE / SHOW rejected

```python
@pytest.mark.parametrize("sql", [
    "SET app_allowed_entities = '99'",
    "USE ROLE COMPLIANCE_ADMIN",
    "USE WAREHOUSE BIG_WH",
    "USE SCHEMA RAW",
    "SHOW TABLES",
    "SHOW VIEWS IN SCHEMA curated",
    "DESCRIBE TABLE curated.my_revenue",
    "ALTER SESSION SET QUERY_TAG = 'evil'",
])
def test_session_state_changes_rejected(allowlist, sql):
    with pytest.raises((StatementTypeError, ForbiddenConstructError)):
        validate_sql(sql, allowlist)
```

### Test 7: forbidden tables rejected

```python
import pytest
from sql_firewall import validate_sql, TableNotAllowedError


@pytest.mark.parametrize("sql", [
    "SELECT * FROM raw.revenue",
    "SELECT * FROM information_schema.tables",
    "SELECT * FROM snowflake.account_usage.query_history",
    "SELECT * FROM curated.my_secret_view",  # not in allowlist
])
def test_forbidden_tables_rejected(allowlist, sql):
    with pytest.raises(TableNotAllowedError):
        validate_sql(sql, allowlist)


def test_unqualified_table_rejected(allowlist):
    sql = "SELECT * FROM my_revenue"  # no schema qualifier
    with pytest.raises(TableNotAllowedError):
        validate_sql(sql, allowlist)
```

### Test 8: forbidden functions rejected

```python
import pytest
from sql_firewall import validate_sql, ForbiddenFunctionError


@pytest.mark.parametrize("sql", [
    "SELECT * FROM TABLE(RESULT_SCAN('01b1a0f0-0000-...'))",
    "SELECT GET_DDL('TABLE', 'curated.my_revenue')",
    "SELECT SYSTEM$ABORT_SESSION(123456)",
    "SELECT SYSTEM$WAIT(60)",
])
def test_forbidden_functions_rejected(allowlist, sql):
    with pytest.raises(ForbiddenFunctionError):
        validate_sql(sql, allowlist)
```

### Test 9: unparseable SQL rejected cleanly

```python
import pytest
from sql_firewall import validate_sql, SQLParseError


@pytest.mark.parametrize("sql", [
    "this is not SQL at all",
    "SELECT FROM WHERE",
    "(((((",
    "",
    "   ",
])
def test_unparseable_sql_rejected(allowlist, sql):
    with pytest.raises(SQLParseError):
        validate_sql(sql, allowlist)
```

### Test 10: prompt injection patterns

These are the realistic attacks the firewall is built for. Each should fail.

```python
import pytest
from sql_firewall import validate_sql, SQLValidationError


@pytest.mark.parametrize("sql,expected_class", [
    # Multi-statement injection
    (
        "SELECT * FROM curated.my_revenue; SET app_allowed_entities = '99';",
        "StatementCountError",
    ),
    # Multi-statement, reverse order
    (
        "SET app_allowed_entities = '99'; SELECT * FROM curated.my_revenue;",
        "StatementCountError",
    ),
    # Nested SET inside a SELECT (uncommon SQL but worth testing)
    (
        "SELECT (SET app_allowed_entities = '99') FROM curated.my_revenue",
        # May parse as a syntax error OR a forbidden construct, either is fine
        "SQLValidationError",
    ),
    # Comment-based attempt to hide a statement
    (
        "SELECT * FROM curated.my_revenue /* '; DROP TABLE x; -- */",
        # Comment stripped during parse; the SELECT is fine, no second statement
        # This SHOULD pass — the comment is not a real second statement.
        # Test asserts it passes (no expected exception class).
        None,
    ),
    # Querying base tables directly
    (
        "SELECT * FROM raw.revenue WHERE entity_id = 99",
        "TableNotAllowedError",
    ),
    # Reading another query's results
    (
        "SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))",
        "ForbiddenFunctionError",
    ),
    # ALTER SESSION inside what looks like a SELECT
    (
        "SELECT * FROM curated.my_revenue; ALTER SESSION SET QUERY_TAG = 'x'",
        "StatementCountError",
    ),
])
def test_prompt_injection_patterns(allowlist, sql, expected_class):
    if expected_class is None:
        # Should pass cleanly
        validate_sql(sql, allowlist)
    else:
        with pytest.raises(SQLValidationError) as exc_info:
            validate_sql(sql, allowlist)
        assert type(exc_info.value).__name__ == expected_class or expected_class == "SQLValidationError"
```

### Running the tests

```bash
pip install sqlglot pytest
pytest tests/ -v
```

All tests should pass without any database connection.

---

## Part 6 — Operations

### What to log

For every call to `validate_sql`:

- **On success:** nothing at INFO level (this happens often). At DEBUG, log the parsed AST for forensics.
- **On failure:** at WARN, log the request_id and the exception class. The rejected SQL itself goes to DEBUG with separate retention.

Why split? Because validation failures are interesting (you want to alert if the rate spikes), but the rejected SQL may contain prompt-injection content you don't want amplified across your log infrastructure.

```python
def safe_validate(sql: str, request_id: str, allowlist=None) -> str:
    try:
        return validate_sql(sql, allowlist)
    except SQLValidationError as e:
        log.warning("sql_firewall_rejected",
                    extra={"request_id": request_id,
                           "reason": type(e).__name__})
        log.debug("rejected_sql_detail",
                  extra={"request_id": request_id, "sql": sql, "error": str(e)})
        raise
```

### Metrics

Expose at minimum:

- `sql_firewall_validations_total` (counter, labeled by `outcome=success|failure`)
- `sql_firewall_rejections_total` (counter, labeled by `reason=<exception class>`)
- `sql_firewall_validation_duration_seconds` (histogram)

A spike in `sql_firewall_rejections_total{reason="ForbiddenConstructError"}` is a leading indicator of either an LLM regression (model started producing bad SQL) or an active prompt-injection attempt. Alert on both.

### When to update the rules

Three triggers:

1. **A new curated view ships.** Add it to `Allowlist.tables`. This is a config change, not a code change.

2. **A real attack pattern bypasses the firewall.** Add a new validator function in `validators.py`, hook it into the orchestrator, write a regression test. This is a code change with security review.

3. **Snowflake adds a new dangerous function or construct.** Add it to `FORBIDDEN_FUNCTIONS` or `FORBIDDEN_NODE_TYPES`. Worth periodic review of Snowflake release notes.

### Performance characteristics

For typical agent SQL (100-500 character queries with 1-3 joins), validation runs in single-digit milliseconds — small enough to not warrant caching. For very large queries (deep CTE chains, hundreds of columns), it can take longer; the `STATEMENT_TIMEOUT_IN_SECONDS` on Snowflake is a separate cost guard.

The firewall is sync and CPU-bound. From an async server, it's safe to call directly without `asyncio.to_thread`; the durations don't justify the thread-pool overhead.

---

## Part 7 — Acceptance criteria

The implementation is correct when:

1. All ten test categories in Part 5 pass.
2. A corpus of representative agent queries (100+ examples from your domain) passes validation without false positives.
3. A corpus of attack queries (50+ examples from prompt-injection literature) is rejected.
4. Validation completes in under 10ms p95 for typical queries.
5. The module has no runtime dependencies beyond `sqlglot`.
6. Logging follows the split between WARN (rejection summary) and DEBUG (rejected SQL detail).

If all six hold, the module is ready for production.

---

## Part 8 — What this module deliberately does NOT do

To set expectations clearly for the next layer:

- **Does not connect to Snowflake.** It's a pure parser; no I/O.
- **Does not enforce per-user allowlists.** The allowlist is per-deployment; user-specific filtering is the row access policy's job in Snowflake.
- **Does not validate column references.** Whether a column exists is the database's concern. If the LLM references `curated.my_revenue.invented_column`, the firewall passes it; Snowflake errors. That's the right division of labor.
- **Does not detect performance attacks.** A SELECT that scans 10 billion rows passes the firewall. Cost guards (timeouts, row caps) are separate.
- **Does not evaluate query semantics.** `WHERE 1=0` (returns nothing) and `WHERE 1=1` (returns everything in scope) both pass.
- **Does not handle cost or pricing.** Allowlist or not, large queries are large queries. Use Snowflake resource monitors for cost control.

Each of those is real, and worth its own design — but conflating them with structural validation makes the module harder to reason about.

---

## Part 9 — Common pitfalls

Read these before implementing:

1. **Treating sqlglot's parse output as Snowflake's parse output.** They're close but not identical. For high-confidence allowlisting, run a corpus of your real production queries through the firewall during development and confirm none are false-rejected.

2. **Forgetting to handle CTEs.** A CTE name appears as a `Table` node in the AST when referenced. The `_is_cte_reference` helper exists for this; don't drop it.

3. **Allowlisting `INFORMATION_SCHEMA`.** Tempting "for debugging" — but `INFORMATION_SCHEMA.TABLES` lets the agent enumerate every table in the database. Don't.

4. **Allowing unqualified table names.** `SELECT * FROM my_revenue` resolves against the session's current schema. If the connection module ever points at a different schema by mistake, the query reaches a different table than expected. Always require schema qualification.

5. **Logging the rejected SQL at INFO.** Some rejections contain the LLM's attempted attack — sometimes hundreds of bytes of injected payload. Don't broadcast it to your hot log infrastructure.

6. **Catching `SQLValidationError` and continuing.** This exception always means the firewall caught something. Let it propagate to the agent runtime, which decides whether to refuse, retry, or surface to the user.

7. **Using regex anywhere.** If you find yourself reaching for a regex inside a validator, stop. The AST has the structure you want. Walk it.

8. **Not testing CTE shadowing.** A CTE named `revenue` that references `curated.my_revenue` should pass. A CTE named `revenue` that *only* exists as a name is fine. The validator must distinguish the two.

9. **Forgetting that `parse_one` differs from `parse`.** `parse_one` is for one-statement input; `parse` returns a list. Always use `parse` so multi-statement input is detectable.

10. **Hardcoding the allowlist.** Ship it as config. Curated views will be added; you don't want a code deploy for every new view.

End of spec.
