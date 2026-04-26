# Getting Started

## Prerequisites

- **Node.js 22+** — for the Next.js frontend
- **Python 3.12+** — for the FastAPI agent
- **uv** — Python package manager ([install](https://docs.astral.sh/uv/getting-started/installation/))
- **Docker Desktop** — optional, but the easiest way to run everything
- **AWS account with Bedrock access** — Claude Sonnet 4.5 inference profile

## Set up AWS credentials

The agent reads credentials from **boto3's default chain**, in order:
1. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
2. Shared credentials file (`~/.aws/credentials`)
3. IAM role (when running on EC2/ECS)

For local dev, the easiest path is:

```bash
aws configure
```

This writes to `~/.aws/credentials`. Docker mounts this directory
read-only into the agent container so credentials work in both
local and Docker modes without copying secrets into env files.

### Required AWS permissions

| Permission | Purpose |
|-----------|---------|
| `bedrock:InvokeModelWithResponseStream` on Claude models | Agent reasoning |
| `sts:GetCallerIdentity` | Account summary tool (always works for any IAM user) |
| `lambda:ListFunctions` | List Lambda functions tool |
| `logs:DescribeLogGroups` | List CloudWatch log groups |
| `ec2:DescribeInstances` | List EC2 instances |

The simplest setup is to attach AWS managed policies:
`AWSLambda_ReadOnlyAccess`, `CloudWatchLogsReadOnlyAccess`,
`AmazonEC2ReadOnlyAccess`. Without them, AWS tools still run but
return graceful "AccessDenied" errors that the agent surfaces in the
results widget.

## Install + run

### Option A: Docker (recommended)

```bash
# 1. Copy the env template and fill in any optional values
cp .env.example .env

# 2. Start everything (frontend, agent, demo MCP HTTP server)
docker compose up --build
```

Then open <http://localhost:3000/chat>.

The first build takes ~3 minutes (downloads packages). Subsequent
runs are seconds. Three services start:

- `web` — Next.js dev server on port 3000
- `agent` — FastAPI + LangGraph on port 8000
- `mcp-http` — example external MCP server on port 8765

Verify the agent is healthy at <http://localhost:3000/admin/health>.

### Option B: Local (no Docker)

```bash
# Frontend deps
npm install

# Agent deps
cd agent && uv sync --dev && cd ..

# Run both with one command (uses concurrently)
npm run dev
```

Or in separate terminals:

```bash
# Terminal 1
npm run dev:web         # http://localhost:3000

# Terminal 2
npm run dev:agent       # http://localhost:8000
```

## First conversation

Open <http://localhost:3000/chat> and try:

| Prompt | What you should see |
|--------|---------------------|
| `What is my AWS account info?` | Calls `get_aws_account_summary`, renders a summary card |
| `Search the AWS docs for S3 bucket versioning` | Calls the AWS Documentation MCP server |
| `Show me a sample CPU usage chart over 8 hours` | Renders a `timeseries_chart` widget |
| `Help me find errors in CloudWatch logs from the last hour` | Triggers the `cloudwatch-query-builder` skill |

Watch the agent logs (Docker: `docker compose logs -f agent`) — you'll
see structured logs for every run, every tool call, and MCP/skill
loading at startup.

## Next steps

- [Architecture](./architecture.md) — understand how the pieces fit
- [Configuration](./configuration.md) — all env vars in one place
- [Troubleshooting](./troubleshooting.md) — common issues
