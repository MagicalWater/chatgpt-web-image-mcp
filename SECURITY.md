# Security

This tool controls a signed-in browser and therefore has the same practical access as the operator at that browser window.

- Use a dedicated Chrome profile. Never point it at your normal browsing profile.
- Never commit or share the profile directory. It contains session credentials.
- Keep the MCP transport local (`stdio`). Do not expose it as an unauthenticated remote service.
- Local source-image upload is disabled until `CHATGPT_IMAGE_ALLOWED_INPUT_DIRS` is configured. Use the narrowest possible roots.
- CDP is limited to loopback by default. Remote CDP exposes browser control and should be used only on a trusted private network with independent access controls.
- The tool accepts only credential-free HTTPS `chatgpt.com` navigation targets.
- The local settings file contains only a project URL/name and optional character/style text. It is written with user-only permissions and never contains browser credentials.
- Project creation is idempotent by default. Creating another project requires an explicit `force_new` request.
- Generated files are created with user-only permissions where the platform supports them.
- User-facing generation diagnostics may include only the visible assistant reply that is directly relevant to the failure (or a bounded excerpt when long), after sanitization. This is intentionally richer than a generic timeout code so an external AI can understand why generation did not start, but it is not permission to forward the whole conversation or page. Never use a generation error path to dump the full page, unrelated conversation history, browser/session state, cookies, tokens, profile contents, environment values, stack traces, or other local secrets.

Report security issues privately to the repository owner instead of opening a public issue with session details, screenshots, local paths, or credentials.
