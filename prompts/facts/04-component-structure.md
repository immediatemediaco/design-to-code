Component structure:

- Shared components live in:
  `packages/components/src/atoms`
  `packages/components/src/molecules`
  `packages/components/src/organisms`
  `packages/components/src/templates`
- Before proposing a new component or inlining a repeated pattern, check those directories first.
- Generated components currently land in:
  `packages/components/src/generated/<ComponentName>/index.tsx`
  `packages/components/src/generated/<ComponentName>/styles.scss`
  `packages/components/src/generated/<ComponentName>/index.test.tsx`
  `packages/components/src/generated/<ComponentName>/stories.tsx` (written by the relay itself from a fixed template, not part of your output)
- The relay writes `index.tsx`, `styles.scss`, and `index.test.tsx` from your response every request. If richer decomposition is needed than a single generated component can represent, keep the output focused on the best top-level unit for the request and avoid pretending a full multi-file refactor already happened.
