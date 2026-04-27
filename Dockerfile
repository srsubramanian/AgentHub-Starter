###############################################################################
# Stage: base — shared dependency install
###############################################################################
FROM node:22-slim AS base
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

###############################################################################
# Stage: dev — used by docker-compose.yml for local development (next dev)
###############################################################################
FROM base AS dev

COPY app/ app/
COPY components/ components/
COPY lib/ lib/
COPY next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs components.json ./

EXPOSE 3000
ENV NEXT_TELEMETRY_DISABLED=1

CMD ["npm", "run", "dev:web"]

###############################################################################
# Stage: builder — produces the standalone production output
###############################################################################
FROM base AS builder

COPY app/ app/
COPY components/ components/
COPY lib/ lib/
COPY next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs components.json ./

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

###############################################################################
# Stage: runner — minimal production runtime (default target)
###############################################################################
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
