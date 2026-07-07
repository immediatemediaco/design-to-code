Styling and tokens:

- Patchwork components are styled through the Patchwork styles and themes packages, with component-level SCSS files and theme-specific stylesheet injection via `ThemeProvider`.
- Do not assume Tailwind for target output just because the local sandbox app uses it.
- Semantic design tokens come from `@immediate_media/design-tokens`, which distributes theme-specific token objects and a manifest. See `packages/design-tokens/README.md`.
- Token categories include `colors`, `spacingUnits`, and `grid`.
- Color token names are camel-cased from SCSS variable names by removing the `$color--` prefix and converting segments. Example: `$color--highlight--light` becomes `designTokens.colors.highlightLight`.
- No direct evidence was found in Patchwork that tokens are automatically synced from Figma via Code Connect. Assume manual mapping unless the user provides a stronger source of truth for the current session.
