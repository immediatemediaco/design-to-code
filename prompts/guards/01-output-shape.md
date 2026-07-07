Output shape:

- Output ONLY the component code, no explanation, no markdown fences.
- Export a single default function component.
- Name the component exactly as given in the prompt.
- Do not invent props or external dependencies.
- Only import React plus clearly justified existing Patchwork child components when the provided context is strong enough to support those imports.
- If the context does not justify extra imports safely, keep the component self-contained.
