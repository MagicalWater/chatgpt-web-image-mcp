# Fork patch ledger

This repository is a fork of `leixyou/chatgpt-web-image-mcp`. Keep fork-specific governance intentionally thin: record only the patches carried by this fork, their verification status, and whether they still apply after the next upstream baseline sync.

## Upstream baseline

- Upstream remote: `origin` → `https://github.com/leixyou/chatgpt-web-image-mcp.git`
- Current upstream `main`: `1e4f010ee7be81928a0a28a5c0d461c2264a1858`
- Current fork patch stack is carried above that baseline.
- When upstream advances: fetch upstream, review the new baseline first, then rebase/merge and re-verify only the fork patches that still remain necessary.

## Carried patches

### Cross-platform admission hardening

- Windows security admission: `21d3cee`
- macOS reliability admission: `a47afe8`
- Cross-platform admission consolidation: `da40f34`, `287a8ad`
- Scope: browser/profile safety, navigation allowlist, platform entrypoint/runtime reliability, session handling, and related regression coverage.

### Source-backed generation / Images-surface capture

- Commit: `5fc4bdc`
- Scope: source-backed generation and generated-image provenance/capture hardening.

### Request-frequency dialog handling

- Branch: `corrective/rate-limit-dialog-handling`
- Current corrective HEAD: `008878cc3e8c3e2b53d35e2dec13041f0c632dd4`
- Supersedes behavior introduced by intermediate commit `7065b41`; do not treat `7065b41` alone as the accepted contract.
- Changed files: `src/chatgpt-page.js`, `test/chatgpt-page.test.js`, `README.md`.
- Live contract observed on ChatGPT web: visible `role="dialog"`, heading `太多要求` / `Too many requests`, single acknowledgement button (`知道了` / equivalent).
- Accepted behavior: safely dismiss the single-action dialog and continue the same readiness/generation flow. The dialog itself is not treated as a generation failure.
- Safety behavior: if the matching dialog cannot be dismissed unambiguously, fail with `CHATGPT_RATE_LIMIT_DISMISS_FAILED` rather than clicking an arbitrary control.

Verification on Windows:

- Targeted tests: 13/13 PASS.
- Full test suite: 66/66 PASS.
- `npm run check`: PASS.
- `npm pack --dry-run`: PASS.
- Live production generation after dialog handling: PASS; one 1254×1254 PNG returned via `authenticated_image_fetch`.

Cross-platform status:

- Windows: PASS.
- macOS sync/acceptance: **OPEN**. The macOS checkout has not yet been updated to `008878c` because both `bridge-mac` and `bridge-mac-backup` failed at `open_workspace` with tool-layer `Resource not found` errors in the current ChatGPT conversation.
- Next action: on a fresh conversation with a healthy mac bridge, sync `/Users/water/Developer/projects/chatgpt-web-image-mcp-admission` to `corrective/rate-limit-dialog-handling` at `008878c`, then run `npm run check`, `npm test`, `npm pack --dry-run`, followed by macOS live readiness/generation acceptance.

## Patch-governance rule

Do not introduce the owning projects' full Task/governance framework into this fork. Keep changes minimal and upstream-friendly. The patch ledger is the authority for what this fork intentionally carries; upstream source remains the baseline authority for everything else.
