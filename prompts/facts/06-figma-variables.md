Figma variables:

- The Figma plugin resolves any Figma Variables bound to a node's properties (fills, strokes, corner radius, layout padding/spacing, etc.) and attaches them to that node in the serialized tree as `boundVariables`, e.g. `"boundVariables": { "fills": "Colors/Highlight Regular", "paddingLeft": "Spacing/md" }`.
- The value is the resolved `<collection name>/<variable name>` string (or an array of them for multi-paint properties like `fills`) — not a raw Figma variable ID, and not yet mapped to a Patchwork token name.
- Not every node will have this. Figma variables are optional and only appear when the designer actually bound one instead of using a static value. Absence of `boundVariables` on a node is normal and does not indicate a problem.
- When present, treat it as real design intent and the strongest available signal for token selection: try to match the variable's semantic name (e.g. "Highlight Regular", "Spacing/md") to the closest Patchwork token of the same shape (a color variable maps to a `$color--*` variable, a spacing variable maps to a `spacing-unit()` key), rather than deriving the token purely from the resolved pixel/RGB value.
- When absent, fall back to matching the resolved value (color, pixel spacing) to the closest token as described in the styling-and-tokens facts.
