Output shape:

- Start with exactly one classification header, `### ATOMIC_LEVEL: <atom|molecule|organism>`, then exactly four file sections in this order, and nothing else — no prose before, between, or after them. Each file section is a `### FILE: <name>` header immediately followed by one fenced code block containing only that file's code:
  - `### FILE: index.tsx` header, then a ```tsx fenced block with the component code.
  - `### FILE: styles.scss` header, then a ```scss fenced block with the styles code.
  - `### FILE: stories.tsx` header, then a ```tsx fenced block with the Storybook story code.
  - `### FILE: index.test.tsx` header, then a ```tsx fenced block with the test code.
- `ATOMIC_LEVEL` decides which folder the relay writes this component into, per the component-structure facts. It must be exactly one of the three words, matching whatever classification you reached by the atomic-design step earlier in this prompt — don't leave it inconsistent with your own reasoning.
- `index.tsx`: export a single default function component, named exactly as given in the prompt. Do not invent props or external dependencies. Only import React plus clearly justified existing Patchwork child components when the provided context is strong enough to support those imports; otherwise keep the component self-contained.
- `styles.scss`: styling for the component, following the styling-and-tokens facts. Do not import this file from `index.tsx` — it is compiled separately and linked purely through the shared root class name given in the prompt.
- `stories.tsx`: a real Storybook CSF3 story with Controls, following the storybook-controls facts — not the placeholder shape used elsewhere in this codebase for stories the relay writes itself.
- `index.test.tsx`: tests for the component, following the testing facts.
