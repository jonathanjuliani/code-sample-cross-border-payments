FROM node:24-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY scripts scripts
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --prod=false

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN mkdir -p apps/web/public/fonts \
  && cp "$(find node_modules -path '*/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2' | head -n 1)" \
    apps/web/public/fonts/figtree-latin-wght-normal.woff2

RUN pnpm --filter @payout/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
