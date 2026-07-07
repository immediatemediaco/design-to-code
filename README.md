# design-to-code

A proof-of-concept pipeline that turns a Figma design into a live React component, instantly visible in Storybook — without a page reload.

## How it works

1. A **Figma plugin** serialises the selected frame — its node tree, a 2× PNG screenshot, and an optional prompt — and POSTs them to the relay server.
2. The **relay server** forwards the data to **Claude** (via the Anthropic SDK), which generates a Tailwind-styled React component.
3. The component and a matching Storybook story are written into `storybook-app/src/components/Generated/`.
4. Vite's HMR picks up the new files and the component appears in Storybook automatically.

## Project structure

```
design-to-code/
├── figma-plugin/       # Figma plugin — serialises the selected frame and sends it to the relay server
├── relay-server/       # Express server — calls Claude and writes generated component files
└── storybook-app/      # React + Vite + Tailwind app with Storybook for live component preview
```

## Running locally

### 1. Relay server

Create a `.env` file inside `relay-server/` with your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then start the server:

```bash
cd relay-server
npm install
npx tsx server.ts
```

The server starts on **http://localhost:4000**.

### 2. Storybook

```bash
cd storybook-app
npm install
npm run storybook
```

Storybook starts on **http://localhost:6006**. Generated components appear under the **Generated** section in the sidebar as soon as the relay server writes them. Stories are only created on first generation — subsequent requests update the component file without overwriting the story.

### 3. Figma plugin

1. In Figma, open **Menu → Plugins → Development → Import plugin from manifest…**
2. Select `figma-plugin/manifest.json` from this repo.
3. Run the plugin from **Menu → Plugins → Development → Design to Code**.

The plugin UI presents an optional free-text prompt field and a **Generate component** button. When you click the button, the plugin:

- Reads the currently selected frame on the canvas.
- Serialises its node tree (layout, fills, corner radius, typography, children).
- Exports a 2× PNG screenshot of the frame.
- POSTs the component name, node tree, screenshot, and any prompt text to `http://localhost:4000/generate`.

A status message confirms success or surfaces any error (e.g. no frame selected, relay server unreachable).

> **Note:** The plugin communicates with `localhost:4000` during development. The manifest restricts network access to that origin only (`devAllowedDomains`). For a production build you would need to update `networkAccess.allowedDomains` accordingly.

## Prerequisites

- Node.js 18+
- npm
- Anthropic API key
- Figma desktop app (for running the plugin in development mode)
