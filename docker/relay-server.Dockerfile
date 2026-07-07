FROM node:24-alpine AS deps

WORKDIR /workspace/relay-server

COPY relay-server/package.json package.json
COPY relay-server/package-lock.json package-lock.json

RUN npm ci

FROM deps AS workspace

COPY relay-server ./
COPY prompts /workspace/prompts

FROM workspace AS relay_dev

EXPOSE 4000

CMD ["npm", "run", "dev"]

FROM workspace AS relay

EXPOSE 4000

CMD ["npm", "run", "start"]
