# Contributing

## Quick Start

```bash
git clone <repo>
npm install
cp .env.example .env   # fill in TELEGRAM_TOKEN, NOTION_TOKEN, DATABASE_ID
npm test
node index.js
```

## Development Workflow

1. **Branch**: `git checkout -b feat/your-feature-name`
2. **Code**: Make your changes following existing conventions
3. **Test**: Run `npm test` — all tests must pass
4. **Lint**: Check syntax with `node --check <file>`
5. **Build**: Run `npm run build:web` for frontend changes
6. **Commit**: Use clear commit messages
7. **Push**: `git push origin feat/your-feature-name`
8. **PR**: Open a pull request to `main`

## Code Conventions

- JavaScript (ESM modules) — no TypeScript
- 4-space indentation
- No semicolons
- `async/await` over raw promises
- `import` over `require()`
- All user-facing strings must use `t()` from i18n
- All new features should include tests

## Project Structure

```
src/
  handlers/       — Telegram bot command and action handlers
  services/       — Business logic (Notion, AI, caching, etc.)
  web/            — Express dashboard + SPA frontend
  utils/          — Shared utilities (date parsing, i18n, etc.)
  i18n/           — Translation files (en.js, th.js)
__tests__/        — Jest test files
docs/             — ADRs and documentation
```

## Testing

- `npm test` runs Jest with `--experimental-vm-modules`
- Test files are `__tests__/*.test.js`
- `.mjs` files in `__tests__/` are standalone (run via `node`)
- Cache-sensitive tests call `cacheInvalidate()` in `beforeEach()`
- TTL tests use real `setTimeout` (timing-sensitive)

## Environment Variables

| Variable         | Required | Description |
|-----------------|----------|-------------|
| TELEGRAM_TOKEN  | Yes      | Telegram Bot API token |
| NOTION_TOKEN    | Yes      | Notion integration token |
| DATABASE_ID     | Yes      | Notion database ID |
| DASHBOARD_TOKEN | No       | Web dashboard auth token (auto-generated if missing) |
| BOT_LANG        | No       | `en` or `th` (default: `en`) |
| LOG_LEVEL       | No       | `debug`, `info`, `warn`, `error` (default: `debug`) |
| WEB_URL         | No       | Public URL for dashboard link |
| NOTION_MAX_RETRIES | No    | Max Notion API retries (default: 3) |

## Architecture Decisions

See `docs/adr/` for Architecture Decision Records covering:
- ADR-001: Why Notion as the database
- ADR-002: Why Typhoon AI with two-model chain
- ADR-003: Why JSON file persistence
- ADR-004: Why in-memory TTL cache (no Redis)
- ADR-005: Why Telegraf for Telegram bot
