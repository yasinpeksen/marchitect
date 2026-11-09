# syntax=docker/dockerfile:1
# One image serves the API and the worker (different CMD), and carries the migration runner.

FROM node:22-alpine AS base
WORKDIR /app

# ---- deps: full install (dev deps needed to build)
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: hot reload target (source is bind-mounted by docker-compose.dev.yml)
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
CMD ["npm", "run", "start:dev"]

# ---- build
FROM deps AS build
COPY . .
RUN npm run build

# ---- prod deps only
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime
FROM base AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache tini
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY --from=migrations / ./migrations
ENV MIGRATIONS_DIR=/app/migrations
USER node
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
