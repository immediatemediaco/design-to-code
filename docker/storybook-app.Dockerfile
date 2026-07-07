FROM node:24-alpine AS app_dev

RUN apk add --no-cache bash g++ git make python3
RUN corepack enable

WORKDIR /workspace

COPY scripts/patchwork-app-dev-server.mjs /workspace/scripts/patchwork-app-dev-server.mjs
COPY scripts/patchwork-app-server.mjs /workspace/scripts/patchwork-app-server.mjs

ENV PATCHWORK_ROOT=/workspace/patchwork
ENV STORYBOOK_PORT=9001

EXPOSE 9000

CMD ["node", "/workspace/scripts/patchwork-app-dev-server.mjs"]

FROM node:24-alpine AS app

RUN apk add --no-cache bash g++ git make python3
RUN corepack enable

WORKDIR /workspace

COPY patchwork /workspace/patchwork
COPY scripts/patchwork-app-server.mjs /workspace/scripts/patchwork-app-server.mjs

ENV PATCHWORK_ROOT=/workspace/patchwork
ENV STORYBOOK_PORT=9001

ARG APP_VERSION=dev
ARG LAST_COMMIT_DATE="Thu Jan 1 00:00:00 1970 +0000"
ARG BUILD_START_TIME=0

ENV APP_VERSION="${APP_VERSION}"
ENV LAST_COMMIT_DATE="${LAST_COMMIT_DATE}"
ENV BUILD_START_TIME="${BUILD_START_TIME}"
ENV PORT=9000

EXPOSE 9000

CMD ["node", "/workspace/scripts/patchwork-app-server.mjs"]
