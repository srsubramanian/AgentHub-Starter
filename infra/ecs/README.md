# Deploy to ECS Fargate (single task, two containers)

This folder ships a Fargate task definition that runs the Next.js
frontend and the FastAPI agent **in the same task**. They share a
network namespace inside the task — so the web container reaches the
agent at `http://localhost:8000`, exactly like local
`docker-compose.ecs-local.yml`.

`mcp-http` is dropped from the deployment. Stdio MCP servers
(`aws_docs`) keep working because the agent image already bundles
`uvx`.

## Topology

```
ALB :443 ─→ web:3000 ─localhost─→ agent:8000 ─→ Bedrock + AWS APIs
                                                ↑ via task IAM role
```

## Prerequisites (one-time)

Create these manually (or wrap in Terraform/CDK later):

### 1. ECR repositories

```bash
aws ecr create-repository --repository-name agenthub-web
aws ecr create-repository --repository-name agenthub-agent
```

### 2. IAM roles

**Execution role** (`agenthub-starter-execution-role`) — used by ECS to
pull the image, fetch secrets, write logs:
- Trust: `ecs-tasks.amazonaws.com`
- Managed policy: `AmazonECSTaskExecutionRolePolicy`
- Inline policy for Secrets Manager:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:agenthub-starter/*"
    }]
  }
  ```

**Task role** (`agenthub-starter-task-role`) — used by the running
agent process for AWS calls:
- Trust: `ecs-tasks.amazonaws.com`
- Inline policy:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ],
        "Resource": "*"
      },
      {
        "Effect": "Allow",
        "Action": [
          "sts:GetCallerIdentity",
          "lambda:ListFunctions",
          "logs:DescribeLogGroups",
          "ec2:DescribeInstances"
        ],
        "Resource": "*"
      }
    ]
  }
  ```

### 3. Secrets

Put any MCP tokens in Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name agenthub-starter/github-token \
  --secret-string "ghp_xxx"
```

Copy the returned ARN into `task-definition.json` (the
`secrets[].valueFrom` field).

### 4. CloudWatch log group

Auto-created by the task (`awslogs-create-group: true`) on first run,
or pre-create if you prefer:

```bash
aws logs create-log-group --log-group-name /ecs/agenthub-starter
```

### 5. Network + ALB

- VPC with at least two public (for the ALB) and two private (for the
  task ENIs) subnets across two AZs
- Application Load Balancer in the public subnets
- Target group: HTTP, port 3000, target type `ip`, health check path `/`
- ALB listener: HTTPS:443 → target group (HTTP:3000)
- Security groups:
  - ALB SG: allow 443 from the internet
  - Task SG: allow 3000 from the ALB SG only

## Build & push images

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1

aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# Web (uses the runner stage of the multi-stage Dockerfile)
docker build --target runner -t agenthub-web:latest .
docker tag agenthub-web:latest \
  $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/agenthub-web:latest
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/agenthub-web:latest

# Agent
docker build -t agenthub-agent:latest ./agent
docker tag agenthub-agent:latest \
  $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/agenthub-agent:latest
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/agenthub-agent:latest
```

## Register task definition

Edit `task-definition.json` and replace placeholders:
- `ACCOUNT_ID` → your 12-digit account number
- `REGION` → `us-east-1` (or your region)
- `secrets[].valueFrom` → the actual secret ARN from step 3

Then register:

```bash
aws ecs register-task-definition \
  --cli-input-json file://infra/ecs/task-definition.json
```

## Create the cluster + service

```bash
aws ecs create-cluster --cluster-name agenthub-starter

aws ecs create-service \
  --cluster agenthub-starter \
  --service-name agenthub-starter \
  --task-definition agenthub-starter \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-AAA,subnet-BBB],securityGroups=[sg-XXX],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=web,containerPort=3000"
```

## Verify

1. Wait for the service to stabilize:
   ```bash
   aws ecs wait services-stable --cluster agenthub-starter --services agenthub-starter
   ```
2. Hit the ALB DNS in a browser → `/chat` should stream a response and
   render a widget.
3. Tail logs:
   ```bash
   aws logs tail /ecs/agenthub-starter --follow
   ```

## Updating

Push new images, then force a new deployment:

```bash
aws ecs update-service \
  --cluster agenthub-starter \
  --service agenthub-starter \
  --force-new-deployment
```

If the task definition itself changes (env vars, resource sizing,
secrets), re-register and pass `--task-definition agenthub-starter`
again — ECS picks the latest revision.

## Cost notes

A single 1 vCPU / 2 GB Fargate task costs roughly **$30/month** in
us-east-1 plus ~$20/month for the ALB. Bedrock charges per token and
will dominate the bill once traffic shows up.

## Production gaps

This is the simplest viable deploy. Things you'll want before real
traffic:
- HTTPS cert in ACM, attached to the ALB listener
- A custom domain in Route 53 pointing at the ALB
- Auth (Phase 5 in the main `PLAN.md`)
- Postgres checkpointer (Phase 7) — `InMemorySaver` loses state on
  task replacement
- Bedrock spend alerts in Budgets
- Tighter task IAM policy (scope by resource ARN, not `*`)
- An autoscaling policy on the service if traffic grows
