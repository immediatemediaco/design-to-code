Output shape:

- Output exactly three file sections, in this order, and nothing else — no prose before, between, or after them. Each section is a `### FILE: <name>` header immediately followed by one fenced code block containing only that file's code:
  - `### FILE: index.tsx` header, then a ```tsx fenced block with the component code.
  - `### FILE: styles.scss` header, then a ```scss fenced block with the styles code.
  - `### FILE: index.test.tsx` header, then a ```tsx fenced block with the test code.
- `index.tsx`: export a single default function component, named exactly as given in the prompt. Do not invent props or external dependencies. Only import React plus clearly justified existing Patchwork child components when the provided context is strong enough to support those imports; otherwise keep the component self-contained.
- `styles.scss`: styling for the component, following the styling-and-tokens facts. Do not import this file from `index.tsx` — it is compiled separately and linked purely through the shared root class name given in the prompt.
- `index.test.tsx`: tests for the component, following the testing facts.
