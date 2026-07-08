Styling and tokens:

- Do not assume Tailwind for target output just because the local sandbox app uses it.
- Styling is a co-located `styles.scss` file, the same way real Patchwork components do it (see `packages/components/src/atoms/Box/styles.scss` for a live example). This is compiled by the separate `@immediate_media/styles` build, which globs every `.scss` file under `packages/components/src/**` — a new component's `styles.scss` is picked up automatically the moment it exists. Do not `import './styles.scss'` from `index.tsx`; there is no CSS/SCSS loader wired into the component's own webpack bundle. The only link between the JS and the SCSS is a shared class name.
- The prompt gives you the exact root class name to use for the component's outermost element (`generated-<kebab-case-name>`). Use that class verbatim as the top-level selector in `styles.scss`, and nest any child-element classes underneath it BEM-style (e.g. `&__label`, `&--variant`), mirroring how `Box/styles.scss` nests `.box--with-border` etc. under `.box`.
- The design-token SCSS API (`$color--*` variables and the `spacing-unit()` function) is globally available in every component's compiled SCSS without an `@import` — the styles build prepends Patchwork's foundations settings/tools to the whole bundle before compiling each component file. Use them directly, for example:

  ```scss
  .generated-token-check-card {
    background-color: $color--background--light;
    padding: spacing-unit(md);

    &__label {
      color: $color--highlight--regular;
    }
  }
  ```

- `spacing-unit($key)` accepts: `xxs` (5px), `xs` (10px), `sm` (15px), `md` (20px), `lg` (30px), `xl` (40px), `xxl` (60px). Map a Figma spacing/padding/gap value to the closest one of these rather than emitting a raw pixel value.
- `$color--<category>--<variant>` is the full set of valid color variables — treat this as the complete list, do not invent names outside it: `$color--highlight--light`, `$color--highlight--regular`, `$color--highlight--dark`, `$color--clickable--light`, `$color--clickable--regular`, `$color--clickable--dark`, `$color--interactive--light`, `$color--interactive--regular`, `$color--interactive--dark`, `$color--commercial--light`, `$color--commercial--regular`, `$color--commercial--dark`, `$color--base--white`, `$color--base--grey`, `$color--base--black`, `$color--background--extra-light`, `$color--background--light`, `$color--background--regular`, `$color--background--dark`, `$color--background--extra-dark`, `$color--form--focus`, `$color--form--warning--regular`, `$color--form--warning--light`, `$color--form--warning--reversed`, `$color--form--success--regular`, `$color--form--success--light`, `$color--form--info--regular`, `$color--form--info--light`, `$color--form--reactions--dark`, `$color--swatch--black`, `$color--swatch--blue`, `$color--swatch--green`, `$color--swatch--orange`, `$color--swatch--peach`, `$color--swatch--pink`, `$color--swatch--purple`, `$color--swatch--red`, `$color--swatch--white`, `$color--swatch--yellow`, `$color--swatch--blue-green`, `$color--swatch--bronze`, `$color--swatch--golden`, `$color--swatch--silver`, `$color--swatch--variegation`, `$color--star--light`, `$color--star--regular`, `$color--star--dark`, plus `$color--social--*` for known platform brand colors (e.g. `$color--social--facebook`, `$color--social--twitter`).
- If a value from the Figma node's `boundVariables` is provided (see the Figma variables fact), that is the strongest available signal for which token to use — prefer matching the bound Figma variable's semantic name to the closest token over guessing from a resolved RGB/pixel value alone.
- To map a Figma fill to a token when no bound variable is available, convert the Figma color to RGB and pick the closest color in the list above by perceptual distance; prefer `background`/`base` keys for surfaces and `swatch`/`highlight`/`interactive`/`clickable` for accents. Only fall back to a raw literal color value (not a token) when nothing in the list is a reasonable match, and keep that fallback local and obvious (e.g. a short inline SCSS comment noting it isn't a token) rather than presenting it as one.
- No direct evidence was found in Patchwork that tokens are automatically synced from Figma via Code Connect. Bound Figma variable names are the closest available signal; beyond that, assume manual mapping unless the user provides a stronger source of truth for the current session.
