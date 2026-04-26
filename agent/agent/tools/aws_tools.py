"""AWS discovery tools for LangGraph.

These tools query AWS resources (Lambda, CloudWatch Logs, EC2) and emit
results into widgets via the StreamWriter. They use the default boto3
credential chain (~/.aws/credentials).
"""

from __future__ import annotations

import json
from typing import Any

import boto3
import structlog
from langchain_core.tools import tool
from langgraph.config import get_stream_writer
from ulid import ULID

from agent.events import widget_create_event, widget_update_event
from agent.widgets import (
    ResultsTableColumn,
    ResultsTableWidget,
    SummaryCardWidget,
    SummaryItem,
)

logger = structlog.get_logger()


def _get_boto3_client(service: str) -> Any:
    """Create a boto3 client using default credential chain."""
    import os

    region = os.environ.get("AWS_REGION", "us-east-1")
    return boto3.client(service, region_name=region)  # type: ignore[call-overload]


@tool
def list_lambda_functions() -> str:
    """List all AWS Lambda functions in the current region.

    Returns a summary and creates a results table widget with function details.
    """
    writer = get_stream_writer()
    widget_id = str(ULID())

    # Create results table widget in "running" state
    table_widget = ResultsTableWidget(
        id=widget_id,
        title="Lambda Functions",
        status="running",
        placement="canvas",
        columns=[
            ResultsTableColumn(key="name", label="Function Name"),
            ResultsTableColumn(key="runtime", label="Runtime"),
            ResultsTableColumn(key="memory", label="Memory (MB)"),
            ResultsTableColumn(key="last_modified", label="Last Modified"),
        ],
        rows=[],
    )
    writer(widget_create_event(table_widget))

    try:
        client = _get_boto3_client("lambda")
        response = client.list_functions()
        functions = response.get("Functions", [])

        rows = [
            {
                "name": f.get("FunctionName", ""),
                "runtime": f.get("Runtime", "N/A"),
                "memory": str(f.get("MemorySize", "")),
                "last_modified": f.get("LastModified", "")[:19],
            }
            for f in functions
        ]

        # Update widget with results
        writer(
            widget_update_event(
                widget_id,
                [
                    {"op": "replace", "path": "/status", "value": "complete"},
                    {"op": "replace", "path": "/rows", "value": rows},
                ],
            )
        )

        if not functions:
            return "No Lambda functions found in this region."
        return f"Found {len(functions)} Lambda function(s)."

    except Exception as e:
        logger.exception("Error listing Lambda functions")
        writer(
            widget_update_event(
                widget_id,
                [
                    {"op": "replace", "path": "/status", "value": "error"},
                    {"op": "replace", "path": "/error_message", "value": str(e)},
                ],
            )
        )
        return f"Error listing Lambda functions: {e}"


@tool
def list_log_groups() -> str:
    """List CloudWatch Log Groups in the current region.

    Returns a summary and creates a results table widget.
    """
    writer = get_stream_writer()
    widget_id = str(ULID())

    table_widget = ResultsTableWidget(
        id=widget_id,
        title="CloudWatch Log Groups",
        status="running",
        placement="canvas",
        columns=[
            ResultsTableColumn(key="name", label="Log Group Name"),
            ResultsTableColumn(key="retention", label="Retention (days)"),
            ResultsTableColumn(key="stored_bytes", label="Stored Bytes"),
        ],
        rows=[],
    )
    writer(widget_create_event(table_widget))

    try:
        client = _get_boto3_client("logs")
        response = client.describe_log_groups()
        groups = response.get("logGroups", [])

        rows = [
            {
                "name": g.get("logGroupName", ""),
                "retention": str(g.get("retentionInDays", "Never expire")),
                "stored_bytes": str(g.get("storedBytes", 0)),
            }
            for g in groups
        ]

        writer(
            widget_update_event(
                widget_id,
                [
                    {"op": "replace", "path": "/status", "value": "complete"},
                    {"op": "replace", "path": "/rows", "value": rows},
                ],
            )
        )

        if not groups:
            return "No CloudWatch Log Groups found in this region."
        return f"Found {len(groups)} log group(s)."

    except Exception as e:
        logger.exception("Error listing log groups")
        writer(
            widget_update_event(
                widget_id,
                [
                    {"op": "replace", "path": "/status", "value": "error"},
                    {"op": "replace", "path": "/error_message", "value": str(e)},
                ],
            )
        )
        return f"Error listing log groups: {e}"


@tool
def list_ec2_instances() -> str:
    """List EC2 instances in the current region.

    Returns a summary and creates a results table widget.
    """
    writer = get_stream_writer()
    widget_id = str(ULID())

    table_widget = ResultsTableWidget(
        id=widget_id,
        title="EC2 Instances",
        status="running",
        placement="canvas",
        columns=[
            ResultsTableColumn(key="instance_id", label="Instance ID"),
            ResultsTableColumn(key="type", label="Type"),
            ResultsTableColumn(key="state", label="State"),
            ResultsTableColumn(key="name", label="Name"),
        ],
        rows=[],
    )
    writer(widget_create_event(table_widget))

    try:
        client = _get_boto3_client("ec2")
        response = client.describe_instances()
        instances = []
        for reservation in response.get("Reservations", []):
            for inst in reservation.get("Instances", []):
                name = ""
                for tag in inst.get("Tags", []):
                    if tag["Key"] == "Name":
                        name = tag["Value"]
                instances.append(
                    {
                        "instance_id": inst.get("InstanceId", ""),
                        "type": inst.get("InstanceType", ""),
                        "state": inst.get("State", {}).get("Name", ""),
                        "name": name,
                    }
                )

        writer(
            widget_update_event(
                widget_id,
                [
                    {"op": "replace", "path": "/status", "value": "complete"},
                    {"op": "replace", "path": "/rows", "value": instances},
                ],
            )
        )

        if not instances:
            return "No EC2 instances found in this region."
        return f"Found {len(instances)} EC2 instance(s)."

    except Exception as e:
        logger.exception("Error listing EC2 instances")
        writer(
            widget_update_event(
                widget_id,
                [
                    {"op": "replace", "path": "/status", "value": "error"},
                    {"op": "replace", "path": "/error_message", "value": str(e)},
                ],
            )
        )
        return f"Error listing EC2 instances: {e}"


@tool
def get_aws_account_summary() -> str:
    """Get a high-level summary of the current AWS account and region.

    Returns account ID, region, and creates a summary card widget.
    """
    writer = get_stream_writer()
    import os

    region = os.environ.get("AWS_REGION", "us-east-1")

    try:
        sts = _get_boto3_client("sts")
        identity = sts.get_caller_identity()

        items = [
            SummaryItem(label="Account ID", value=identity.get("Account", "unknown")),
            SummaryItem(label="Region", value=region),
            SummaryItem(label="User ARN", value=identity.get("Arn", "unknown")),
        ]

        widget = SummaryCardWidget(
            id=str(ULID()),
            title="AWS Account Info",
            status="complete",
            placement="canvas",
            items=items,
        )
        writer(widget_create_event(widget))

        return json.dumps(
            {
                "account": identity.get("Account"),
                "region": region,
                "arn": identity.get("Arn"),
            }
        )

    except Exception as e:
        logger.exception("Error getting account summary")
        return f"Error getting account info: {e}"


# All AWS discovery tools
AWS_TOOLS = [
    list_lambda_functions,
    list_log_groups,
    list_ec2_instances,
    get_aws_account_summary,
]
