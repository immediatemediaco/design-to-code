Component boundaries:

- Infer whether the request is best treated as an atom, molecule, or organism before writing code.
- Preserve obvious component boundaries from the provided design structure instead of flattening everything into one anonymous block by default.
- If the provided context clearly points to an existing reusable Patchwork child component, prefer composition over reimplementing that child inline.
- If the context is not strong enough to identify a real existing child component safely, keep the output self-contained rather than inventing imports that may not exist.
