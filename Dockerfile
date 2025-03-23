FROM node:20-alpine

ENV NODE_ENV=production
ENV PATH=/app/node_modules/.bin:$PATH
ENV NODE_PATH=/app/node_modules:/app/packages

WORKDIR /app

RUN pnpm install --frozen-lockfile

RUN pnpm build

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -qO- http://localhost:8102/health | grep -q '"status":"OK"'

EXPOSE 8102
CMD ["node", "bin/cli.js", "server", "--port", "8102"]