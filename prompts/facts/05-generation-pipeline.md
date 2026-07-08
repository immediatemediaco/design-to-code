Generation pipeline facts:

- The current runtime sends the model:
  - `componentName`
  - a lightweight serialized `nodeTree`, where nodes may carry a `boundVariables` map of property name to bound Figma variable name(s) when the designer bound a Figma variable to that property (see the Figma variables fact)
  - an optional PNG screenshot
  - an optional free-text designer prompt
  - current implementation code only when the relay has explicit follow-up context for the same generation key
  - a fixed root SCSS class name to use for the component's outermost element
- The current runtime does not automatically send:
  - a full repo search result for reusable Patchwork components
  - a Figma variable matrix across brands, or any resolved mapping from Figma variable name to Patchwork token — only whichever variable names happen to be bound on the current selection, unresolved
  - a semantic diff between the previous and latest Figma selections
- Treat missing runtime context as a real limitation. Do not claim that token mappings, variant inventories, or reusable child-component matches were verified unless they were actually provided in the prompt context.
