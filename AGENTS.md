# Project Instructions

## Scope

This repository contains only a local ChatGPT web image automation adapter. Keep browser control, ChatGPT page interaction, image capture, CLI, and stdio MCP concerns in separate modules.

## Non-negotiable constraints

- Do not add model API calls, workflow engines, video generation, tunnels, or public HTTP listeners.
- Never serialize, copy, print, package, or commit browser cookies or profile contents.
- Restrict navigation to HTTPS `chatgpt.com` URLs.
- Restrict CDP to loopback unless the operator explicitly enables remote CDP.
- Source-image uploads must stay inside explicitly configured allowlisted directories.
- Keep MCP stdout protocol-only; write diagnostics to stderr.
- Return sanitized user-facing errors, never stack traces, environment dumps, or browser session data.
- Keep browser operations serial because one profile has one shared composer state.
- Keep `/images`-specific selectors in `src/images-page.js`; shared generation and capture behavior belongs in the base page adapter.
- Keep ChatGPT Projects creation/settings selectors in `src/project-page.js`; persist only non-secret project/profile settings in the local settings file.

## Verification

```bash
npm run check
npm test
npm pack --dry-run
```

Run live browser generation only with a dedicated test profile and an account whose operator has accepted the applicable service terms.
