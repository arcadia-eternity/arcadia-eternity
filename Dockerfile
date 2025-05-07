FROM node:23-alpine

ENV NODE_ENV=production
ENV PATH=/app/node_modules/.bin:$PATH
ENV NODE_PATH=/app/node_modules:/app/packages

WORKDIR /app

RUN apk add --no-cache git && \
    npm install -g pnpm

COPY pnpm-lock.yaml* package.json pnpm-workspace.yaml .npmrc ./

COPY . .

RUN pnpm install --frozen-lockfile --force

RUN pnpm build

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -qO- http://localhost:8102/health | grep -q '"status":"OK"'

EXPOSE 8102
CMD ["node", "dist/cli.js", "server", "--port", "8102"]
