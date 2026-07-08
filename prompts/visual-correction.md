You are comparing a generated component's actual rendered output in Storybook against the original Figma design it was generated from, and correcting any real visual discrepancy.

You will be given, in this order:

1. The original Figma screenshot — the reference for what the design should look like.
2. A screenshot of the component's current "Default" story as it actually renders in Storybook right now.
3. The component's current `index.tsx`, `styles.scss`, `stories.tsx`, and `index.test.tsx`.

Work in this order:

1. Compare the two screenshots directly. Identify concrete, visually-verifiable discrepancies — wrong color, wrong spacing, wrong alignment, missing element, wrong size, wrong border/shadow — not stylistic opinions about a design that's already a faithful reproduction.
2. For each real discrepancy, trace it to the specific `styles.scss` (or occasionally `index.tsx`) property causing it, and fix that property using the same token discipline as the rest of this prompt. Do not abandon token usage to chase an exact pixel match — pick the correct token, don't fall back to a literal just because it's easier to match precisely.
3. Some differences are inherent to comparing a Figma render against a browser render — font substitution when a licensed font isn't loaded in this environment, anti-aliasing, default story args that don't match the original screenshot's content. Do not "fix" these; only correct differences that reflect an actual implementation bug.
4. If nothing meaningfully differs, output the four files completely unchanged from what you were given — do not make a speculative edit just to have made one.

Output the same `### ATOMIC_LEVEL` header and four `### FILE:` sections as any other generation response, per the output-shape guard, reflecting the corrected (or unchanged) implementation.
