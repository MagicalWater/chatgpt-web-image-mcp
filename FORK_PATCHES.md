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
- Functional corrective commit: `008878cc3e8c3e2b53d35e2dec13041f0c632dd4`
- Patch-ledger commit after the functional corrective: `985b98b440ac25eef39d2b25bd52ec1044b26958`
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
- macOS: PASS on `corrective/rate-limit-dialog-handling` after syncing the checkout to `985b98b`. `npm run check` PASS; full `npm test` PASS with 65 passed, 0 failed, 1 Windows-only skipped out of 66 tests; `npm pack --dry-run` PASS. Live readiness returned `ready: true` for the dedicated profile on the Images surface. Native generation/image-return acceptance also PASS: the production Executor route returned four native image contents captured through `authenticated_image_fetch`. The first native generation attempt hit a transient connector-layer HTTP 502 while readiness remained true; one retry of the same production path succeeded.
- macOS popup reproduction note: the live tool result does not expose telemetry proving whether the request-frequency dialog appeared during that successful generation, so macOS does not independently claim a live popup-observed/dismiss-observed event. The corrective behavior itself is covered by the passing regression tests, while Windows remains the live popup-dismiss acceptance authority.
- Promotion: completed on macOS acceptance. `corrective/cross-platform-admission` was fast-forwarded from `287a8ad9bd7c3721d2cc957782abe76fbb7a4aa3` to the accepted corrective lineage at `8f83744a7292028432f3caa6c47959342bca511f`; no merge commit or behavior redesign was required.

### Image-generation quota exhaustion classification

- Functional corrective commits: `33f6f0b`, `87d504c`.
- Scope: classify an explicit ChatGPT image-generation quota exhaustion message as a terminal generation failure during result polling.
- Machine-readable error: `IMAGE_GENERATION_QUOTA_EXHAUSTED`.
- Supported wording: current zh-TW `已用完圖片生成次數` wording plus narrow English image-generation exhaustion equivalents.
- Diagnostic behavior: preserve only the nearby visible quota/cooldown text in the sanitized user-facing message when available.
- Semantic boundary: this does not change request-frequency dialog handling. `太多要求 / Too many requests` remains dismiss-and-continue unless its acknowledgement control cannot be dismissed safely.
- Non-goals: no login/profile, source allowlist, result selector, Executor, DevSpace, or browser-ownership changes.
- Verification: RED/GREEN regression coverage includes fail-fast quota classification, zh-TW and English wording, and explicit non-confusion with the request-frequency dialog contract.
- macOS verification: focused `chatgpt-page` tests 18/18 PASS; full suite 70 PASS, 0 fail, 1 Windows-only skip; `npm run check` PASS; `npm pack --dry-run` PASS.
- Windows verification after fast-forward to `87d504c`: full suite 71/71 PASS; `npm run check` PASS; `npm pack --dry-run` PASS.
- Fresh macOS production acceptance: the production Executor route returned terminal `IMAGE_GENERATION_QUOTA_EXHAUSTED` with no image content instead of timing out. The diagnostic-hygiene follow-up retained the visible cooldown detail while trimming unrelated surrounding page text, and the repeated production probe returned the same terminal code.
- Windows live UI evidence (2026-08-14): ChatGPT introduced a new zh-TW quota card headed `你的圖像額度已用完`, with upgrade / scheduled-generation controls and reset-time guidance. The quota classifier now recognizes that wording (plus the simplified-Chinese equivalent) as `IMAGE_GENERATION_QUOTA_EXHAUSTED`; the request-frequency `太多要求` dialog contract is unchanged.
- macOS production acceptance for the new quota card (2026-08-14): after syncing `4b9c468`, focused `chatgpt-page` tests were 20/20 PASS and the full suite was 81 PASS, 0 fail, 2 platform skips. On the production **chat surface** matching the Windows live UI, the new `你的圖像額度已用完` card returned terminal `IMAGE_GENERATION_QUOTA_EXHAUSTED` with no image content. Account-switcher dry-run advanced from account 2 as next to account 3 as next across that single production call, proving the new wording triggered exactly one macOS account switch and one retry; the retry also exhausted quota and did not rotate again.

### Optional account-switch retry after quota exhaustion

- Scope: optional orchestration only; no selector/classifier changes.
- Configuration: local ignored root `config.json` field `accountSwitchCommand`; `config.example.json` is the committed template. Missing/blank disables account switching and preserves the original quota error behavior.
- Dedicated-profile configuration: local `config.json` field `chromeUserDataDir` (or explicit `CHATGPT_CHROME_USER_DATA_DIR`) is required when CDP is not used. There is no implicit home-directory profile fallback; missing configuration fails with `INVALID_CONFIG`. When both are present, the repo-local `config.json` value wins so stale enrollment environment cannot override the machine-local project profile authority.
- If unset/empty: preserve the existing `IMAGE_GENERATION_QUOTA_EXHAUSTED` terminal failure behavior with no account switch.
- If configured on Windows or macOS: after the first explicit quota-exhaustion failure, release the MCP-owned browser session, invoke the configured local switch wrapper (`.cmd` on Windows, `.command` on macOS), then retry the same generation once.
- Retry boundary: never switch or retry more than once for the same generation call; any second failure follows the existing error contract.
- Timeout boundary: the first generation attempt and the post-switch retry each receive a fresh full `CHATGPT_IMAGE_TIMEOUT_MS` result-polling window; elapsed time from the first attempt is not deducted from the retry.
- Windows production acceptance (2026-08-14): fresh Executor discovery resolved `chatgpt-web-image.org.default.generate_chatgpt_web_image`. Before the call, account-switcher dry-run reported account 2 as next; the single production generation call returned one native image successfully; after the call, dry-run reported account 3 as next. This proves the first quota-exhausted attempt invoked the switcher exactly once, advanced to account 2, and the post-switch retry succeeded without a second switch.
- macOS production acceptance (2026-08-14): the production Executor registration was confirmed to execute this admission checkout's `src/mcp-server.js`. A stale enrolled `CHATGPT_CHROME_USER_DATA_DIR` initially overrode the relocated repo-local profile, so `config.json` was made authoritative when both explicit sources exist. Production readiness then returned `ready: true` on the repo-local `chrome-profile-cdp`. Before generation, account-switcher dry-run reported account 2 as next; the production call ended with `IMAGE_GENERATION_QUOTA_EXHAUSTED`; after the call, dry-run reported account 3 as next. This proves account 1 quota triggered exactly one macOS `.command` switch to account 2, the retry ran once, account 2 also exhausted quota, and no second switch to account 3 occurred.
- Non-goals: no changes to quota detection wording/selectors, request-frequency dialog handling, or source-image rules.

## Patch-governance rule

Do not introduce the owning projects' full Task/governance framework into this fork. Keep changes minimal and upstream-friendly. The patch ledger is the authority for what this fork intentionally carries; upstream source remains the baseline authority for everything else.
