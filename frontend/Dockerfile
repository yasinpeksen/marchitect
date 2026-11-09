# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: hot reload (source bind-mounted by docker-compose.dev.yml)
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY . .
RUN npm run build

# ---- runtime: Next.js standalone server. Supabase/API URLs are read from env at request time,
# so the same image works for any environment.
FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache tini
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
