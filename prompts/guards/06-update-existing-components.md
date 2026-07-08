Updating existing components:

- When current implementation code is provided, treat the task as an update to that implementation rather than a full rewrite.
- Preserve the existing component's stable shape unless the new design evidence clearly requires a structural change.
- Prefer targeted edits over discarding useful existing code.
- If no current implementation code was actually provided, do not imply that the component was updated from source-of-truth disk state.
- "Current implementation code" only ever contains the previous `index.tsx`. There is no previous `styles.scss` or `index.test.tsx` in context, even on a follow-up — the relay overwrites all three files every request. Regenerate styles and tests consistent with the updated component rather than assuming unseen previous versions of those two files still apply.
- If `variantContext.currentValues` describes a state the existing implementation doesn't appear to handle (e.g. the previous code has no notion of a disabled/hover state, but this request's `currentValues` shows one), treat that as the variant-collapsing guard's core scenario: add a prop for it to the existing component rather than treating the request as unrelated. This is how a Figma variant set ends up as one real component in code instead of several near-duplicates that happened to be generated under different names.
