Generation pipeline facts:

- The current runtime sends the model:
  - `componentName`
  - a lightweight serialized `nodeTree`
  - an optional PNG screenshot
  - an optional free-text designer prompt
  - current implementation code only when the relay has explicit follow-up context for the same generation key
- The current runtime does not automatically send:
  - a full repo search result for reusable Patchwork components
  - a Figma variable matrix across brands
  - a resolved token mapping table
  - a semantic diff between the previous and latest Figma selections
- Treat missing runtime context as a real limitation. Do not claim that token mappings, variant inventories, or reusable child-component matches were verified unless they were actually provided in the prompt context.
