# Quota Module Documentation

## Purpose
This module fetches quota and usage signals for supported providers in the web server runtime.

## Entrypoints and structure
- `packages/web/server/lib/quota/index.js`: public entrypoint imported by `packages/web/server/index.js`.
- `packages/web/server/lib/quota/routes.js`: Express route registration for quota endpoints.
- `packages/web/server/lib/quota/providers/index.js`: provider registry, configured-provider list, and provider dispatcher.
- `packages/web/server/lib/quota/providers/interface.js`: JSDoc provider contract used as implementation reference.
- `packages/web/server/lib/quota/providers/google/`: Google-specific auth, API, and transform modules.
- `packages/web/server/lib/quota/utils/`: shared auth, transform, and formatting helpers.

## Supported provider IDs (dispatcher)

These provider IDs are currently dispatchable via `fetchQuotaForProvider(providerId)` in `packages/web/server/lib/quota/providers/index.js`.

| Provider ID | Display name | Module | Auth aliases/keys |
| --- | --- | --- | --- |
| `claude` | Claude | `providers/claude/` | Claude Code Keychain / credentials file, then `anthropic` / `claude` OpenCode auth, then `CLAUDE_CODE_OAUTH_TOKEN` |
| `cline-pass` | ClinePass | `providers/cline-pass.js` | `cline-pass` (API key under `key` or `token`) |
| `codex` | Codex | `providers/codex.js` | `openai`, `codex`, `chatgpt` |
| `command-code` | Command Code | `providers/command-code.js` | `command-code` auth entry or `COMMAND_CODE_API_KEY` |
| `crof` | CrofAI | `providers/crof.js` | `crof` |
| `cursor` | Cursor | `providers/cursor.js` | `CURSOR_TOKEN` / `CURSOR_ACCESS_TOKEN`, `CURSOR_REFRESH_TOKEN`, optional token files, or Cursor desktop SQLite DB |
| `deepseek` | DeepSeek | `providers/deepseek.js` | `deepseek` |
| `google` | Google | `providers/google/index.js` | `google`, `google.oauth`, Antigravity accounts file |
| `hyper` | Charm Hyper | `providers/hyper.js` | `hyper` (API key under `key` or `token`) |
| `github-copilot` | GitHub Copilot | `providers/copilot.js` | `github-copilot`, `copilot` |
| `github-copilot-addon` | GitHub Copilot Add-on | `providers/copilot.js` | `github-copilot`, `copilot` |
| `kimi-for-coding` | Kimi for Coding | `providers/kimi.js` | `kimi-for-coding`, `kimi` |
| `nano-gpt` | NanoGPT | `providers/nanogpt.js` | `nano-gpt`, `nanogpt`, `nano_gpt` |
| `openrouter` | OpenRouter | `providers/openrouter.js` | `openrouter` |
| `zai-coding-plan` | z.ai | `providers/zai.js` | `zai-coding-plan`, `zai`, `z.ai` |
| `zhipuai-coding-plan` | Zhipu AI Coding Plan | `providers/zhipuai-coding-plan.js` | `zhipuai-coding-plan`, `zhipuai`, `zhipu` |
| `minimax-coding-plan` | MiniMax Coding Plan (minimax.io) | `providers/minimax-coding-plan.js` / `providers/minimax-shared.js` | `minimax-coding-plan` |
| `minimax-cn-coding-plan` | MiniMax Coding Plan (minimaxi.com) | `providers/minimax-cn-coding-plan.js` / `providers/minimax-shared.js` | `minimax-cn-coding-plan` |
| `neuralwatt` | NeuralWatt | `providers/neuralwatt.js` | `neuralwatt` |
| `ollama-cloud` | Ollama Cloud | `providers/ollama-cloud.js` | Cookie file at `~/.config/ollama-quota/cookie` (raw session cookie string) |
| `opencode-go` | OpenCode Go | `providers/opencode-go.js` | `opencode-go` API key in OpenCode `auth.json` |
| `wafer` | Wafer.ai | `providers/wafer.js` | `wafer`, `wafer-ai`, `wafer_ai`, `wafer.ai` |
| `xai` | xAI | `providers/xai.js` | `xai` OAuth (`access`/`refresh` tokens) stored in OpenCode auth file; SuperGrok billing-period usage |

## Internal-only provider module
- `providers/openai.js` exists for logic parity/reuse but is intentionally not registered for dispatcher ID routing.

## ClinePass quota semantics

ClinePass reads `data.limits` from its usage-limits endpoint. Web/Electron and
VS Code accept only known window types with finite numeric or non-empty numeric
string percentages. Invalid windows are skipped independently; no usable windows
is a failed refresh, not zero usage. Both implementations choose a non-empty
`key`, then `token`, and expose auth/fetch dependencies for focused tests.
Saved UI provider-visibility lists remain authoritative; installations without a
saved list include ClinePass through the provider registry.

## Charm Hyper balance semantics

`GET https://hyper.charm.land/v1/credits` returns a team's current Hypercredit balance, not a percentage or reset timestamp. The [Hyper FAQ](https://hyper.charm.land/faq) defines one Hypercredit as $0.05. Both runtimes expose `credits_balance` in dollars and `credits` as a numeric label under the UI's localized window title. Keep English unit text out of that numeric label.

Web and VS Code accept finite numeric balances and non-empty numeric strings. Missing, blank, or malformed balances remain explicit failures; zero is valid. Credential lookup uses a non-empty string `key`, then `token`, so malformed or blank keys cannot mark the provider configured or hide a valid fallback token. Hyper fetchers accept `readAuth` and `fetchImpl` dependencies for tests without replacing filesystem or auth modules.

## OpenCode Go credentials

OpenCode Go usage reads the standard `opencode-go` API key from the owning
OpenCode runtime and calls `/zen/go/v1/usage`. The obsolete dashboard-cookie
form is no longer shown. On first refresh, Web and VS Code remove the legacy
OpenChamber cookie file without reading or returning its secret.

Codex window labels are derived from each API window's `limit_window_seconds`. Primary and secondary windows are not assumed to mean five-hour and weekly windows.
OpenAI Business/enterprise `spend_control.individual_limit` is exposed through
the Codex `credits` window with its API-provided percentage and a
`used / limit used` value label. Zero is preserved as a real value; absent or
empty spend-control fields do not create a quota window. The VS Code provider
implements the same contract.

NeuralWatt exposes subscription kWh, key allowance, and account credits as
separate quota signals. Subscription windows use the plan name and the API's
reset timestamp without fabricating a duration. Allowance usage uses the lower
of its configured limit and the currently funded amount, and suppresses the
standalone credits window to avoid double-counting. CrofAI exposes its dollar
credits balance as a label-only window because the API does not provide a
meaningful percentage or reset period.

DeepSeek exposes the preferred USD balance, with CNY as a fallback, as a
label-only credits window. Kimi accepts either `used` or `remaining` in both
weekly and rate-limit payloads; when both are present, `used` is authoritative.

Command Code resolves account scope through `/alpha/whoami`, then reads credit
balances plus five-hour/weekly limits from `/alpha/billing/credits`. Credentials
stay in the owning runtime and are never returned to shared UI.

Claude reads the live Claude Code login without copying credentials: macOS
Keychain first, then `~/.claude/.credentials.json`, OpenCode auth, and finally
`CLAUDE_CODE_OAUTH_TOKEN`. The provider reports session, weekly, model-scoped,
and enabled extra-usage limits. Concurrent refreshes are coalesced and the last
good account-scoped payload remains available during Anthropic rate limiting.

## MiniMax M3 / Token Plan migration
In 2025/2026 MiniMax rebranded "Coding Plan" to "Token Plan" alongside the M3 model release. The API underwent breaking changes:

- Endpoint fallback: the provider tries `/v1/token_plan/remains` first, then falls back to legacy `/v1/api/openplatform/coding_plan/remains`.
- Field semantics: on `token_plan/remains`, `current_interval_usage_count` returns remaining quota. The provider computes `used = total - remaining` for this endpoint. The legacy `coding_plan/remains` endpoint keeps the old consumed-count semantics.
- `model_remains` can include multiple model categories. The provider selects `MiniMax-M*`, then `general`/`chat`/`text`, then any entry with remaining-percent data.

## Response contract
All providers should return results via shared helpers to preserve API shape:
- Required fields: `providerId`, `providerName`, `ok`, `configured`, `usage`, `fetchedAt`
- Optional field: `error`
- Unsupported provider requests should return `ok: false`, `configured: false`, `error: Unsupported provider`

## Add a new provider (quick steps)
1. Choose module shape based on complexity:
   - Simple providers: create `packages/web/server/lib/quota/providers/<provider>.js`.
   - Complex providers (multi-source auth, multiple API calls, non-trivial transforms): create `packages/web/server/lib/quota/providers/<provider>/` with split modules like Google (`index.js`, `auth.js`, `api.js`, `transforms.js`).
2. Export `providerId`, `providerName`, `aliases`, `isConfigured`, and `fetchQuota`.
3. Use shared helpers from `packages/web/server/lib/quota/utils/index.js` (`buildResult`, `toUsageWindow`, auth/conversion helpers) to keep payload shape consistent.
4. Register the provider in `packages/web/server/lib/quota/providers/index.js`.
5. If needed for direct use, export a named fetcher from `packages/web/server/lib/quota/providers/index.js` and `packages/web/server/lib/quota/index.js`.
6. Update this file with the new provider ID, module path, and alias/auth details.
7. Validate with `bun run type-check`, `bun run lint`, and `bun run build`.

## Notes for contributors
- Keep provider IDs stable; clients use them directly.
- Avoid adding alias-based dispatch in `fetchQuotaForProvider`; dispatch currently expects exact provider IDs.
- Keep Google behavior changes isolated and review `providers/google/*` together.
- Z.ai Coding Plan exposes separate 5-hour and weekly `TOKENS_LIMIT` entries plus a monthly `TIME_LIMIT` for MCP tools; web and VS Code preserve all three windows.
