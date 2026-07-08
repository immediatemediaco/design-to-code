Updating existing components:

- When current implementation code is provided, treat the task as an update to that implementation rather than a full rewrite.
- Preserve the existing component's stable shape unless the new design evidence clearly requires a structural change.
- Prefer targeted edits over discarding useful existing code.
- If no current implementation code was actually provided, do not imply that the component was updated from source-of-truth disk state.
- "Current implementation code" only ever contains the previous `index.tsx`. There is no previous `styles.scss` or `index.test.tsx` in context, even on a follow-up — the relay overwrites all three files every request. Regenerate styles and tests consistent with the updated component rather than assuming unseen previous versions of those two files still apply.
