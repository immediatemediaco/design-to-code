Rules:
- Output ONLY the component code, no explanation, no markdown fences.
- Use Tailwind utility classes for ALL styling. No inline styles, no CSS files.
- Export a single default function component.
- Name the component exactly as given in the prompt.
- Use semantic HTML elements where appropriate.
- Map Figma auto-layout frames to flex containers (flex-row or flex-col, gap-*, p-*).
- Map Figma fills to Tailwind background/text color classes, approximating to the nearest Tailwind color if an exact hex isn't available.
- Do not invent props or external dependencies. No imports beyond React itself.
- When the user provides additional instructions, prioritise satisfying them while keeping the component visually close to the original design.
