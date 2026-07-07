# design-to-code

A proof-of-concept pipeline that turns a Figma design into a live React component, instantly visible in Storybook without a page reload.

## How it works

1. A **Figma plugin** or any other client sends a `POST /generate` request containing a component name, Figma node tree, optional screenshot, and optional free-text prompt.
2. The **relay server** sends the design data to the first available LLM provider and generates or updates a Tailwind-styled React component.
3. The component and story are written into `storybook-app/src/components/Generated/`.
4. Storybook reloads through the shared Docker stack, served behind the local localhost proxy.

## Project structure

```text
design-to-code/
├── figma-plugin/            # Figma plugin for capture + follow-up prompts
├── docker/                 # Container build definitions
├── relay-server/           # Express relay that calls Claude/OpenAI and writes generated files
├── scripts/                # Local orchestration helpers
└── storybook-app/          # Storybook host app for live component preview
```

## Prerequisites

- Docker Desktop
- Yarn
- Anthropic API key, OpenAI API key, or a local Codex auth file
- The local reverse proxy used by the pipeline dashboard repos

## Running locally

Set credentials in `.env.local` if you want to provide them explicitly:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Credential precedence is:

1. `ANTHROPIC_API_KEY`
2. `OPENAI_API_KEY`
3. `~/.codex/auth.json` mounted into the relay container at `/root/.codex/auth.json` when that file exists locally

If none are available, `/generate` returns an `LLM credentials required` error.

Then use the root orchestration commands:

```bash
yarn setup
```

For day-to-day use after the first install:

```bash
yarn start
```

That will:

1. Ensure the local reverse proxy is running.
2. Generate `docker-compose.yaml` from the same template-driven pattern as the pipeline dashboard repos.
3. Build and start the Storybook app, nginx frontend, cache layer, and relay server in Docker.
4. Wait for the app container to report ready before returning control.

Primary URLs:

- Storybook: `https://design-to-code.localhost`
- Cached route: `https://design-to-code.cached.localhost`
- Direct forwarded nginx port: `http://localhost:8516`

To stop the stack:

```bash
yarn stop
```

## Generating a component

Send the request through the proxied app host so the Storybook container and relay stay under one local hostname:

```bash
curl -k -X POST https://design-to-code.localhost/generate \
  -H "Content-Type: application/json" \
  -d '{
    "componentName": "PrimaryButton",
    "nodeTree": { "type": "FRAME", "name": "PrimaryButton" }
  }'
```

The response includes `{ status, componentName, code }`.

Generated components appear under the **Generated** section in Storybook. Stories are only created on first generation; later requests update the component file without overwriting the story.

If you send another request for the same `componentName`, the relay treats it as a follow-up and includes the last generated component code in the prompt so the model can refine the existing result instead of starting from scratch.

## Figma plugin

1. In Figma, open **Menu → Plugins → Development → Import plugin from manifest…**
2. Select `figma-plugin/manifest.json` from this repo.
3. Run the plugin from **Menu → Plugins → Development → Design to Code**.

The plugin:

- Reads the currently selected frame on the canvas.
- Serialises its node tree, layout metadata, fills, typography, and children.
- Exports a 2x PNG screenshot of the frame.
- Sends the request to `http://localhost:8516/generate`, which flows through the local Docker/proxy stack.
- Lets you add an optional prompt for the first generation or follow-up refinements.

To rebuild the plugin controller after editing [figma-plugin/code.ts](/private/tmp/design-to-code-pr5-fix/figma-plugin/code.ts):

```bash
yarn plugin:build
```

## Notes

- `relay-server` now runs in Docker and writes into the bind-mounted `storybook-app` source tree.
- `relay-server` uses application-defined model defaults: Claude first when `ANTHROPIC_API_KEY` exists, then OpenAI/Codex via `OPENAI_API_KEY`, then an optional mounted Codex auth file when `~/.codex/auth.json` exists locally.
- Storybook proxies `/generate` and `/healthz` to the internal relay container in dev, so browser traffic can stay on the same proxied hostname.
- `docker-compose-generator.sh` mirrors the command shape used in the pipeline dashboard repos.
- The Figma plugin uses the direct forwarded nginx port in development so it does not need to trust the local TLS certificate used by `*.localhost`.
