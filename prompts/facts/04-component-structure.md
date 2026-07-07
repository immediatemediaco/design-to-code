Component structure:

- Shared components live in:
  `packages/components/src/atoms`
  `packages/components/src/molecules`
  `packages/components/src/organisms`
  `packages/components/src/templates`
- Before proposing a new component or inlining a repeated pattern, check those directories first.
- Generated components currently land in:
  `packages/components/src/generated/<ComponentName>/index.tsx`
  `packages/components/src/generated/<ComponentName>/stories.tsx`
- The relay currently writes one component file per request. If richer decomposition is needed than a single generated file can represent, keep the output focused on the best top-level unit for the request and avoid pretending a full multi-file refactor already happened.
