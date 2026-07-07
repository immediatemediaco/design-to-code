# design-to-code

A proof-of-concept pipeline that turns a Figma design into a live React component, instantly visible in Storybook without a page reload.

## How it works

1. The **relay server** receives a `POST /generate` request containing a Figma node tree, component name, and optional screenshot.
2. It sends the design data to the first available LLM provider and generates a Tailwind-styled React component.
3. The component and story are written into `storybook-app/src/components/Generated/`.
4. Storybook reloads through the shared Docker stack, served behind the local localhost proxy.

## Project structure

```text
design-to-code/
├── docker/                 # Container build definitions
├── relay-server/           # Express relay that calls Claude and writes generated files
├── scripts/                # Local orchestration helpers
└── storybook-app/          # Storybook host app for live component preview
```

## Prerequisites

- Docker Desktop
- npm
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
npm run setup
```

For day-to-day use after the first install:

```bash
npm run start
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
npm run stop
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

## Notes

- `relay-server` now runs in Docker and writes into the bind-mounted `storybook-app` source tree.
- `relay-server` uses application-defined model defaults: Claude first when `ANTHROPIC_API_KEY` exists, then OpenAI/Codex via `OPENAI_API_KEY`, then an optional mounted Codex auth file when `~/.codex/auth.json` exists locally.
- Storybook proxies `/generate` to the internal relay container in dev, so browser traffic can stay on the same proxied hostname.
- `docker-compose-generator.sh` mirrors the command shape used in the pipeline dashboard repos.

## Getting the Figma node tree

The `nodeTree` field in the `/generate` request is the raw Figma node JSON for a component. Here's how to obtain it.

### 1. Copy the component link from Figma

1. Open your file in Figma.
2. Right-click the component layer in the canvas or layers panel.
3. Select **Copy/Paste as → Copy link to selection**.

This copies a URL like:

```
https://www.figma.com/design/MSz1zYzubDs5ZHAP7jTylp/Design-to-Code-Example?node-id=2-2&t=3x89TOGdjgPzjUzb-4
```

From this URL extract two values:

| Value     | Where                                                   | Example                  |
| --------- | ------------------------------------------------------- | ------------------------ |
| `fileKey` | The path segment after `/design/`                       | `MSz1zYzubDs5ZHAP7jTylp` |
| `nodeId`  | The `node-id` query parameter, with `-` replaced by `:` | `2:2`                    |

### 2. Create a Figma personal access token

Go to **Figma → Settings → Security** and generate a personal access token.

### 3. Fetch the node from the Figma API

```bash
curl -H "X-Figma-Token: <YOUR_TOKEN>" \
  "https://api.figma.com/v1/files/<fileKey>/nodes?ids=<nodeId>"
```

Using the example values above:

```bash
curl -H "X-Figma-Token: <YOUR_TOKEN>" \
  "https://api.figma.com/v1/files/MSz1zYzubDs5ZHAP7jTylp/nodes?ids=2:2"
```

### 4. Extract the document object

The response has the shape:

```json
{
  "nodes": {
    "2:2": {
      "document": {
        // ← this is the nodeTree you pass to /generate
      }
    }
  }
}
```

Pass the value of `document` as `nodeTree` in your `/generate` request.
