FROM node:24-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY scripts scripts
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --prod=false

COPY packages/shared packages/shared
COPY apps/api apps/api

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/payouts.db

EXPOSE 3000

CMD ["node", "apps/api/src/server.ts"]
