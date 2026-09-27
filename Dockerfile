# syntax=docker/dockerfile:1
# Enveloppe production image: Next.js standalone server, non-root, no secrets baked in
# (they come from .env.production at runtime via docker compose). See docs/DEPLOY.md.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime: only the standalone server and the files it reads at runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 enveloppe && useradd --system --uid 1001 --gid enveloppe enveloppe
COPY --from=build --chown=enveloppe:enveloppe /app/.next/standalone ./
COPY --from=build --chown=enveloppe:enveloppe /app/.next/static ./.next/static
COPY --from=build --chown=enveloppe:enveloppe /app/public ./public
# Read at runtime: database migrations (applied on first connection) and the synthetic demo data.
COPY --from=build --chown=enveloppe:enveloppe /app/db/migrations ./db/migrations
COPY --from=build --chown=enveloppe:enveloppe /app/demo/cache ./demo/cache
USER enveloppe
EXPOSE 3000
CMD ["node", "server.js"]

# ---- tools: full repo for maintenance scripts (demo:reset, demo:rehearse) ----
FROM build AS tools
CMD ["npm", "run", "demo:reset"]
