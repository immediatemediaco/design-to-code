Token and theme discipline:

- Prefer semantic token usage and theme-aware structure whenever the provided context supports it.
- Do not hardcode a brand name or add brand-specific conditionals inside the generated component.
- Do not invent token names just because a screenshot suggests a value. If the mapping is missing, preserve the gap explicitly instead of fabricating repo-specific token names.
- If you must fall back to a literal value because no verified token mapping was provided, keep that fallback local and obvious rather than presenting it as an established repo convention.
