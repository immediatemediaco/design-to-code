Component structure:

- Shared components live in:
  `packages/components/src/atoms`
  `packages/components/src/molecules`
  `packages/components/src/organisms`
  `packages/components/src/templates`
- Before proposing a new component or inlining a repeated pattern, check those directories first.
- Generated components land in a subfolder matching the `ATOMIC_LEVEL` you declare, mirroring the real structure above but kept separate from it:
  `packages/components/src/generated/atoms/<ComponentName>/`
  `packages/components/src/generated/molecules/<ComponentName>/`
  `packages/components/src/generated/organisms/<ComponentName>/`
  Each containing `index.tsx`, `styles.scss`, `stories.tsx`, `index.test.tsx` — all four from your response, every request.
- On a follow-up for a component that already exists, the relay keeps it in whichever of those folders it's already in regardless of what `ATOMIC_LEVEL` you output this time, to avoid the same component silently splitting across two locations. Classification only actually takes effect the first time a component is generated.
- If richer decomposition is needed than a single generated component can represent, keep the output focused on the best top-level unit for the request and avoid pretending a full multi-file refactor already happened.
