Generation pipeline facts:

- The current runtime sends the model:
  - `componentName`
  - a lightweight serialized `nodeTree`, where nodes may carry:
    - a `boundVariables` map of property name to bound Figma variable name(s) when the designer bound a Figma variable to that property (see the Figma variables fact)
    - a `variantContext` object on component/instance nodes describing that component's variant/boolean/text axes and this node's current values (see the variant-properties fact)
    - raw geometry/paint/text properties per the Figma-to-CSS property mapping fact
  - an optional PNG screenshot
  - an optional free-text designer prompt
  - current implementation code only when the relay has explicit follow-up context for the same generation key (the previous `index.tsx` only — never previous styles/tests, see the updating-existing-components guard)
  - a fixed root SCSS class name to use for the component's outermost element
- The current runtime does not automatically send:
  - a full repo search result for reusable Patchwork components
  - a Figma variable matrix across brands, or any resolved per-brand value for a bound variable — only the variable's own name, unresolved. Brand-specific resolution happens entirely outside this pipeline, in Patchwork's existing per-theme token values; nothing here re-derives or audits those values from Figma
  - a semantic diff between the previous and latest Figma selections
  - every sibling in a Figma variant set — `variantContext` is derived from the single selected node's own component/component-set metadata, not from a separate sweep across all variants
- Treat missing runtime context as a real limitation. Do not claim that token mappings, variant inventories, or reusable child-component matches were verified unless they were actually provided in the prompt context.
