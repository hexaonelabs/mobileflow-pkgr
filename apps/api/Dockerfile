# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
# python3/make/g++ requis pour compiler bcrypt (module natif) lors du npm ci
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/marketing/package.json apps/marketing/package.json
RUN npm ci --workspace=api

FROM deps AS build
COPY apps/api apps/api
RUN npm run build --workspace=api

FROM build AS prod-deps
RUN npm prune --omit=dev --workspace=api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/api
# node_modules hoisté à la racine du monorepo : Node le résout via la remontée
# de dossiers parents, pas besoin de le placer dans apps/api.
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist

EXPOSE 4000
CMD ["node", "dist/main"]
