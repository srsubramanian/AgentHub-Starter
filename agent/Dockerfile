FROM python:3.12-slim

WORKDIR /app

# Install uv and uvx
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies (no dev deps in the container)
RUN uv sync --frozen --no-dev --no-install-project

# Copy application code
COPY agent/ agent/
COPY mcp_demo_server.py mcp_http_server.py ./

# Install the project itself
RUN uv sync --frozen --no-dev

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "8000"]
