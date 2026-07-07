FROM node:24-alpine AS deps

WORKDIR /workspace/storybook-app

COPY storybook-app/package.json package.json
COPY storybook-app/package-lock.json package-lock.json

RUN npm ci

FROM deps AS workspace

COPY storybook-app ./

RUN touch .env.local

FROM workspace AS app_dev

EXPOSE 9000

CMD ["npm", "run", "start:dev"]

FROM workspace AS build

RUN npm run build-storybook

FROM node:24-alpine AS app

WORKDIR /workspace/storybook-app

ARG APP_VERSION=dev
ARG LAST_COMMIT_DATE="Thu Jan 1 00:00:00 1970 +0000"
ARG BUILD_START_TIME=0

COPY storybook-app/package.json package.json
COPY --from=deps /workspace/storybook-app/node_modules ./node_modules
COPY --from=workspace /workspace/storybook-app/server.mjs ./server.mjs
COPY --from=build /workspace/storybook-app/storybook-static ./storybook-static

ENV APP_VERSION="${APP_VERSION}"
ENV LAST_COMMIT_DATE="${LAST_COMMIT_DATE}"
ENV BUILD_START_TIME="${BUILD_START_TIME}"
ENV PORT=9000

EXPOSE 9000

CMD ["npm", "run", "start:prod"]
