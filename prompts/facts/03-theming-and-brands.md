Theming and brands:

- Target applications are expected to set a theme high in the React tree via `ThemeProvider` from `@immediate_media/components`.
- `ThemeProvider` is expected to receive `theme`, `iconsPublicPath`, and theme-specific `tokens`.
- Components should stay brand-agnostic internally. Theme-specific values are supplied by the active theme's design-token object and stylesheets through `ThemeProvider`, not by hardcoding brand names or per-brand conditionals inside components.
- Theme packages currently exist under `packages/themes/src/` for:
  `bb-platosricos-theme`, `bb-saveurs-theme`, `bb-varimerychle-theme`, `bmp-elle-theme`, `bmp-glamour-theme`, `bmp-kobieta-theme`, `bmp-mamotoja-theme`, `bmp-mojegotowanie-theme`, `bmp-nationalgeographic-theme`, `bmp-party-theme`, `bmp-polki-theme`, `bmp-story-theme`, `bmp-viva-theme`, `bmp-wizaz-theme`, `im-bbcgoodfood-theme`, `im-easycook-theme`, `im-giggly-theme`, `im-gw-theme`, `im-historyextra-theme`, `im-imlogging-theme`, `im-immediate-theme`, `im-junior-theme`, `im-madeformums-theme`, `im-matchoftheday-theme`, `im-olive-theme`, `im-rt-theme`, `im-rtmoney-theme`, `im-slate-theme`, `im-techblog-theme`, `im-therecommended-theme`, `im-topgear-theme`.
