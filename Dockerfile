FROM node:22-slim

WORKDIR /app

# Copy dependency files first for layer caching
COPY package.json package-lock.json ./

RUN npm ci

# Copy application code
COPY app/ app/
COPY components/ components/
COPY lib/ lib/
COPY next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs components.json ./

EXPOSE 3000

ENV NEXT_TELEMETRY_DISABLED=1

CMD ["npm", "run", "dev:web"]
