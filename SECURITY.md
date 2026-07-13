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

Report security issues privately to the repository owner instead of opening a public issue with session details, screenshots, local paths, or credentials.
