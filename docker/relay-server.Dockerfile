# Playwright's bundled browser binaries need glibc — they don't run on
# Alpine/musl — so this image is Debian-based rather than the alpine image
# the rest of this repo's services use.
FROM node:24-bookworm-slim AS deps

# git + openssh-client so the relay can auto-commit and push generated
# Patchwork changes to a feature branch (see docker-compose.dev.yaml for the
# ~/.ssh and ~/.gitconfig mounts this relies on).
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/relay-server

COPY relay-server/package.json package.json
COPY relay-server/package-lock.json package-lock.json

RUN npm ci
# Installs chromium plus whatever system packages it needs on this distro —
# Playwright knows Debian's package names, so let it drive apt itself rather
# than hand-maintaining a system dependency list here.
RUN npx playwright install --with-deps chromium

FROM deps AS workspace

COPY relay-server ./
COPY prompts /workspace/prompts

FROM workspace AS relay_dev

EXPOSE 4000

CMD ["npm", "run", "dev"]

FROM workspace AS relay

EXPOSE 4000

CMD ["npm", "run", "start"]
