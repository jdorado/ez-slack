FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY --chown=node:node package.json pnpm-workspace.yaml ./
COPY docker/pnpm-lock.yaml ./pnpm-lock.yaml
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate && pnpm install --frozen-lockfile --prod
COPY --chown=node:node bin ./bin
COPY --chown=node:node src ./src
COPY --chown=node:node web ./web
FROM base AS test
COPY test ./test
RUN node --test test/*.test.mjs
FROM base AS runtime
RUN mkdir /state && chown node:node /state
USER node
CMD ["node", "/app/src/server.mjs"]
