Storybook controls:

- `stories.tsx` is a real CSF3 story, not a placeholder — every prop the component takes should be reachable and adjustable from Storybook's Controls panel, the same way real Patchwork components do it (see `packages/components/src/atoms/Box/stories.tsx` for a live example).
- Shape:

  ```tsx
  import React from 'react';
  import type { Meta, StoryObj } from '@storybook/react';
  import ComponentName from './index.jsx';

  const meta = {
    title: 'Generated/<AtomicLevel>/ComponentName',
    component: ComponentName,
    argTypes: {
      // one entry per non-trivial prop
    },
  } satisfies Meta<typeof ComponentName>;

  export default meta;
  type Story = StoryObj<typeof meta>;

  export const Default: Story = {};
  ```

  `<AtomicLevel>` in the title is the same classification as the `ATOMIC_LEVEL` header, capitalized (`Atom`/`Molecule`/`Organism`), so the Storybook sidebar groups generated components the same way they're grouped on disk.
- A plain boolean prop generally doesn't need an explicit `argTypes` entry — Storybook infers a boolean control from the TypeScript type automatically. Give one anyway when a short `description` would help (Storybook shows it in the Controls panel).
- An enum/string-union prop (most commonly the collapsed variant prop from the variant-collapsing guard) needs an explicit entry so Storybook renders a select instead of a free-text box: `propName: { control: { type: 'select' }, options: ['Default', 'Hover', 'Pressed', 'Disabled'] }`, with the options list matching `variantContext.availableProperties` exactly.
- Add one named story per meaningfully distinct state beyond `Default` when the component has variant/boolean props worth showing side by side — e.g. `export const Disabled: Story = { args: { isDisabled: true } };` — the same way Box's story exports `Default`, `WithBorder`, and `WithoutPadding` as separate named stories rather than relying on Controls alone to discover them.
- Do not add controls for props that don't exist on the component, and do not exclude a real prop from `argTypes` just to keep the file short — an omitted prop simply won't be adjustable, which defeats the purpose of this file.
