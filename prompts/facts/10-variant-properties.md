Figma variant properties:

- When the current top-level node (not a nested `GENERATED_COMPONENT_REF`) is a Figma component or an instance of one, its serialized tree includes a `variantContext` object: `{ currentValues, availableProperties }`.
- `currentValues` is this specific node's own property values right now, e.g. `{ "State": "Hover", "Has Icon": true }`.
- `availableProperties` describes every property defined on the component (or its component set, if it's part of one), independent of which value this particular node happens to have: `{ "State": { type: "VARIANT", options: ["Default","Hover","Pressed","Disabled"] }, "Has Icon": { type: "BOOLEAN", defaultValue: false } }`. `type` is one of `VARIANT`, `BOOLEAN`, `TEXT`, `INSTANCE_SWAP`, `SLOT`.
- This tells you the full shape of the component's variant surface from a single selection — you don't need every sibling variant sent separately to know, for example, that "State" has four possible values even though this instance is only showing one of them.
- Absence of `variantContext` is normal — it only appears on components/instances, not on plain frames, groups, or leaf content.
