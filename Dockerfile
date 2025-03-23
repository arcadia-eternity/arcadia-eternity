FROM node:20-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-lock.yaml* package.json pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/data ./data
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/locales ./locales

ENV NODE_ENV=production

EXPOSE 8102

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -qO- http://localhost:8102/health | grep -q '"status":"OK"'

CMD ["node", "bin/cli.js", "server", "--port", "8102"]