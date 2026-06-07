# Development Guide

## Setup

```bash
npm install
cp .env.example .env
```

Required env vars (fill in `.env`):
- `TELEGRAM_TOKEN` — from BotFather
- `NOTION_TOKEN` — from Notion Integrations
- `DATABASE_ID` — your Notion database ID

Optional env vars with defaults:
- `DASHBOARD_TOKEN` — auto-generated if missing (persisted to `.dashboard_token`)
- `BOT_LANG` — `en` (default) or `th`
- `LOG_LEVEL` — `debug` (default), `info`, `warn`, `error`
- `NOTION_MAX_RETRIES` — `3` (default)
- `WEB_URL` — public URL for web dashboard links

## Running

```bash
node index.js         # starts bot + web dashboard
```

The bot uses long-polling (no webhook). The web dashboard starts on port 8080 (configurable via `PORT` env var).

## Web Dashboard

```bash
npm run build:web     # build frontend with Vite
npm run dev:web       # Vite dev server with HMR
```

The dashboard is an Express + vanilla JS SPA with:
- Chart.js for donut/bar/line charts
- Calendar heatmap view
- Dark mode
- PWA support (manifest + service worker)
- CSV export
- Bulk actions

## Testing

```bash
npm test              # Jest (1319+ tests)
node __tests__/dateParser.test.mjs   # standalone test
```

Key test files:
- `__tests__/dateParser.test.js` (300+ tests) — Thai date parsing
- `__tests__/subjectDetector.test.js` (180+ tests) — subject detection
- `__tests__/tagDetector.test.js` (120+ tests) — tag inference
- `__tests__/cache.test.js` — TTL cache behavior
- `__tests__/badgeService.test.js` — race condition testing
- `__tests__/commandHandlers.test.js` — command handler helpers
- `__tests__/viewBuilders.test.js` — message builder functions
- `__tests__/api.e2e.test.js` — API endpoint integration tests

## Debugging

- Set `LOG_LEVEL=info` to reduce noise (only info/warn/error)
- Set `LOG_LEVEL=debug` for full logging (default)
- AI pipeline logs model switches, cache hits, and fallbacks
- Notion cache logs invalidation events
- User state logs mode transitions

## Common Issues

**Notion schema mismatch**: Run the bot and check console for schema warnings. Required properties: `Name` (title), `Status` (select), `Subject` (rich_text), `Due` (date), `Priority` (select), `Completed` (date), `Tags` (multi_select), `EventId` (rich_text).

**AI not parsing**: Check `TYPHOON_API_KEY` is set. The bot falls back to regex parsing if AI is unavailable.

**Dashboard not loading**: Ensure `DASHBOARD_TOKEN` is set or auto-generated. Open the dashboard link from the bot's web menu.

## Architecture

```
Telegram ──→ Telegraf Bot ──→ Handlers ──→ Notion API
                  │                         │
                  │                    [Cache Layer]
                  │                         │
                  ├── AI Pipeline ──────────┤
                  │    (Typhoon → regex)    │
                  │                         │
                  ├── JSON Stores ──────────┤
                  │    (badges, pomodoros)  │
                  │                         │
Web Dashboard ───→ Express API ─────────────┘
```

For detailed architecture decisions, see `docs/adr/`.
