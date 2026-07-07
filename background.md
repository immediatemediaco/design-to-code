Stage 0 — Setup (once per project)

Establish where tokens live in code before generating any component, so every later prompt has a target to map onto.

The Step 0 assumptions for this project are now checked in separately rather than living inline here.

Use the current prompt config as the source of truth:

- `prompts/facts/`

Those files should answer the setup questions directly where we already know the repo/package assumptions, with the local `./patchwork` checkout as the target codebase, and explicitly flag anything that is still unknown or session-specific.

Why first: without this, the component gets generated with either raw hex/px values or invented token names that don't match your real theme file — and in a multi-brand system, without step 4 it also risks getting one brand's colors hardcoded in as if they were universal. Without step 5, generation tends to reimplement things you already have.

Stage 1 — Decompose

This stage is deliberately generic — it works on any Figma node, not a specific component. Run it first, before extracting anything, so you know what the actual build units are.

Analyze this Figma node's structure to identify natural component boundaries following atomic design principles: {{figma URL with node-id}}



For every layer/instance in this node:

1. Classify each one as an atom (a single indivisible visual element — an icon, a label, a color swatch, one text style), a molecule (a small group of atoms serving one purpose — e.g. icon + text, a star rating built from repeated icons, a button with icon + label), or an organism (a larger section assembled from atoms/molecules — e.g. a content block, header, footer)

2. Flag any visual pattern that repeats 2+ times with the same structure (e.g. "icon + text" appearing twice) but is NOT already a reusable Figma component/instance — these should become a named molecule, in both Figma and code, rather than staying duplicated inline

3. Treat every existing Figma component/instance as its own boundary regardless of size — even a single icon that's a Figma component gets its own file/function, never inlined

4. Note the real nesting depth: which atoms sit inside which molecules, and which molecules sit inside which organisms



Output two things:

1. A component tree — for each node: name, atomic-design classification (atom/molecule/organism), Figma node-id, parent in the tree

2. A flat "build order" list, atoms first up through the top-level organism, since each level depends on the ones below it

Why this order: everything downstream — Extract, Map, Generate — needs to run per component in the build order, not once for the whole node. Deciding the boundaries after generation means retrofitting reuse onto code that's already duplicated; deciding them first means each piece gets built once and composed everywhere else.

Stage 2 — Extract design context

Pull the actual node data — structure, variants, and the variables bound to each property — rather than working from a screenshot alone. Run this once per item in the Stage 1 build order, starting from the atoms. In a multi-brand system, each run has to cover every brand, not just one, so the mapping stage can see which role/shade combinations are shared and which resolved values actually differ.

Get the design context and variable definitions for this Figma node: {{figma node-id for this specific atom/molecule/organism, from the Stage 1 build order}}



This design system covers {{N}} brands: {{list brand names}}. Each brand has its own theme block with the same internal structure.



Specifically:

1. For every brand, return the full variable map for every fill, stroke, spacing, radius, and text style used in this node — I need variable names, not just resolved values

2. Build a matrix of role x shade x brand (e.g. Clickable/regular for Olive vs Clickable/regular for GoodFood) so I can see which token names are shared across brands and which resolved values differ per brand

3. Identify which properties use variables vs hardcoded values (flag anything hardcoded as a design inconsistency to review)

4. List all variants/states if this is a component set (e.g. default, hover, disabled, error)

5. Note the auto-layout structure (direction, gap, padding, resizing behavior) since that determines the code's layout approach

6. Flag any role/shade combination that's missing or inconsistent for a specific brand — these are candidates for either fixing in Figma or handling as brand-specific exceptions in code

Output to capture: a variable-name → resolved-value table per brand, plus a note of anything NOT tokenized in the design, and a call-out of any role/shade gaps between brands.

Stage 3 — Map Figma variables to code tokens

Translate Figma's variable names into your codebase's naming convention. This is the step that prevents drift — skipping it is the most common reason generated components look right today but break the next time someone edits the Figma variable. In a multi-brand system, this stage also has to separate the semantic role name (shared) from the resolved value (brand-specific), so the component ends up referencing the role, never a value.

Here is the brand x role x shade variable matrix extracted from Figma:

{{paste variable matrix from Stage 2}}



Here is our existing token file(s):

{{paste relevant excerpt from tokens.css / theme.ts / tailwind.config.js, including how brand-specific overrides are currently structured, if at all}}



Map each Figma role/shade combination to a single semantic code token name (e.g. Figma's "Clickable/regular" → --color-clickable-regular), then map each brand's resolved value under that same token name. For each one:

- If a matching semantic token already exists in our file, use it as-is

- If no match exists, propose a new token name following our existing convention, and tell me explicitly — don't silently invent one

- Flag any Figma variable whose resolved value doesn't match any existing token's value for that brand, even if the name is similar (possible drift between Figma and code)

- Flag any brand missing a value for a role/shade that other brands define



Output two things:

1. A semantic token table: Code token name | Figma role/shade | Status (matched / new / drift)

2. A per-brand resolution table: Code token name | Brand 1 value | Brand 2 value | ... | Brand N value

Why this matters: the component you generate next should reference var(--color-clickable-regular) or theme.colors.clickable.regular — never #F5F5F5, and never a brand name. The brand-specific values live in the per-brand resolution table (this stage's output), which becomes the theming layer — not something the component itself knows about.

Stage 4 — Generate the component

Only now write the actual component, explicitly instructed to consume tokens rather than literal values, stay brand-agnostic internally, and compose child components rather than reimplement them. Run this once per item in the build order, starting from the atoms, so each level can import the pieces built just before it.

Build a {{component name}} component in {{framework}} using {{styling approach}}.

This component's atomic-design level is: {{atom / molecule / organism, from Stage 1}}



Requirements:

1. Every color, spacing, radius, border, shadow, and typography value must reference a semantic token from this mapping — no literal hex codes, px values, or font names in the component code:

{{paste the semantic token table from Stage 3}}



2. The component must be brand-agnostic: it should contain no brand names, no brand-specific conditionals, and no hardcoded value from any single brand's resolution table. It renders correctly for all {{N}} brands purely because the surrounding theme context supplies different values for the same token names.

3. If this component is a molecule or organism, import and compose its already-built children from {{path to shared components}} rather than reimplementing their internals. List which child components you're importing before writing the parent.

4. Implement these variants/states: {{list from Stage 1/2, e.g. default, hover, disabled, error}}

5. Match this layout structure exactly: {{auto-layout notes from Stage 2 — direction, gap, padding, resizing rules}}

6. Props/API: {{describe expected props, or ask the model to infer them from the variant list}}

7. If the design uses a value that has no corresponding token (flagged in Stage 3), leave a // TODO: no token for X, using literal value comment rather than inventing a silent one-off



Do not guess at spacing or color values — if something wasn't in the provided token map, ask rather than approximate. Do not special-case any brand by name inside the component. Do not inline a pattern that Stage 1 identified as its own atom/molecule — import it instead.

Why this matters: this is the actual "adheres to token variables" requirement — the LLM's default instinct is to eyeball the screenshot and output approximate pixel values, bake in whichever brand's colors happened to be visible, or flatten nested components into one file for convenience. This prompt forces it to work from the semantic token table and the Stage 1 component tree instead, so pieces get built once and reused everywhere.

Stage 5 — Verify alignment

Close the loop by checking the generated component against the original design — for token fidelity, brand portability, and atomic reuse, not just visual similarity.

Here is the component you just generated: {{paste code or link to file}}

Here is the original Figma screenshot/node: {{re-attach or reference the node}}



Check for:

1. Any hardcoded value that should be a token reference (search for hex codes, raw px/rem numbers, raw font-family strings)

2. Any hardcoded brand name or brand-specific conditional inside the component

3. Any variant or state from the Figma component set that's missing in code

4. Any spacing/layout mismatch versus the auto-layout structure

5. Whether swapping the active brand context (all {{N}} brands: {{list brand names}}) — with zero changes to the component file — correctly re-skins it to match each brand's Figma reference

6. Whether renaming a token in {{tokens.css / theme.ts}} would correctly update this component with no other code changes needed — if not, identify where it's not wired up

7. Any atom or molecule (per the Stage 1 component tree) that got reimplemented inline here instead of imported from its existing shared component

8. Any repeated 2+ pattern in this component's own markup that should itself be extracted as a new shared molecule



List discrepancies as a checklist, ranked by whether they'd cause a visual mismatch or just a maintainability issue.
