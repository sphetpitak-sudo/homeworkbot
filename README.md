# Homework Bot 🤖📚

AI-powered Telegram bot + web dashboard for managing homework. Built with Node.js, Notion API, and Typhoon AI.

## Features

- **AI Parse Homework** — Telegram bot parses Thai homework text via Typhoon AI (2-model chain with regex fallback) → extracts title, subject, due date, priority, tags
- **Priority System** — Auto-detect (🔴สูง/🟡กลาง/🟢ต่ำ), manual override, auto-recalc via daily cron
- **Tag Inference** — Auto-tagged from keywords (สอบ, โครงการ, กลุ่ม, ด่วน, อ่าน, ใบงาน) + #hashtag support
- **AI Q&A** — `/ask` command queries homework context in natural language
- **Web Dashboard** — Express + Chart.js with dark mode, calendar, CSV export, PWA support
- **Pagination** — 10 items per page, prev/next navigation
- **Delete Recovery** — 10-second window to restore archived items
- **Undo** — `/undo` reverts last status change within 30 seconds
- **Reminders** — Daily 08:00 upcoming homework notifications
- **Weekly Summary** — Monday 07:00 completion stats
- **Auto-Archive** — Daily 02:00 archives Done homework older than 7 days
- **Bulk Actions** — Multi-select + bulk status update on web dashboard
- **Quick Add** — Modal form with auto-priority preview
- **Dark Mode** — Auto-detect + toggle, persisted in localStorage
- **PWA** — Installable on mobile via manifest.json + service worker
- **Health Check** — Express server on PORT 8080 for container hosting
- **409 Retry** — Bot auto-retries launch on polling conflict
- **Error Retry Buttons** — Consistent inline retry + home buttons on errors
- **Hint System** — One-time contextual tips (post-save, status change, priority legend)
- **AI Confident Skip** — Skips intermediate preview when AI matches regex
- **Edit Saved Items** — Web API supports partial field updates + delete

## Quick Start

```bash
npm install
cp .env.example .env
# fill in TELEGRAM_TOKEN, NOTION_TOKEN, DATABASE_ID
npm test
node index.js
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_TOKEN` | ✅ | Telegram bot token |
| `NOTION_TOKEN` | ✅ | Notion integration secret |
| `DATABASE_ID` | ✅ | Notion database ID |
| `TYPHOON_API_KEY` | ❌ | AI parsing (free tier: 5 req/s, 200 req/min) |
| `REMINDER_CHAT_ID` | ❌ | Chat ID for reminders + weekly summary |
| `WEB_URL` | ❌ | Web dashboard URL → shows 🌐 button in menu |
| `DASHBOARD_TOKEN` | ❌ | Web dashboard auth (auto-derived from NOTION_TOKEN if not set) |

## Architecture

```
index.js                     ← entry (bot.launch, 4 crons, state/cache cleanup, graceful shutdown)
src/
  handlers/
    commandHandlers.js       ← /start, /menu, /help, /ask, /undo, text router, preview, confirm screen
    actionHandlers.js        ← inline keyboard callbacks, paginated lists, dashboard, edit/delete/status
  services/
    aiService.js             ← Typhoon via OpenAI SDK, 2-model chain + fallback, corrections cache
    aiCache.js               ← .corrections.json persistence + in-memory AI cache (debounced atomic write)
    qaService.js             ← AI Q&A with homework context (2-model fallback)
    notionService.js         ← Notion SDK with TTL-cached queries, auto-invalidate on write
    cache.js                 ← Generic in-memory TTL Map, pattern-based bulk invalidation
  web/
    server.js                ← Express server (REST API + static files, rate-limited, Bearer auth)
    public/                  ← Frontend (Chart.js, calendar, PWA, dark mode, bulk actions)
  utils/
    dateParser.js            ← Thai date regex parsing (วันนี้/พรุ่งนี้/มะรืน/etc)
    subjectDetector.js       ← 50+ keyword → 10 subjects (ไทย→สุขศึกษา)
    tagDetector.js           ← Tag inference (สอบ/โครงการ/กลุ่ม/ด่วน/อ่าน/ใบงาน) + hashtag parsing
    telegramFormat.js        ← Markdown escape helpers (_ * ` [)
    constants.js             ← STATUS, PRIORITY (🔴สูง/🟡กลาง/🟢ต่ำ), dashboard limits
    priority.js              ← recalcPriority(due) → priority (≤3d HIGH, ≤14d MEDIUM, >14d LOW)
    logger.js                ← Console wrapper with Thai timestamps [HH:MM:SS]
    validateEnv.js           ← Environment validation
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/all` | Bearer | Stats + homework + trend |
| GET | `/api/stats` | Bearer | Stats only |
| GET | `/api/homework` | Bearer | Homework list |
| POST | `/api/homework` | Bearer | Create homework |
| POST | `/api/status` | Bearer | Update single status |
| POST | `/api/bulk-status` | Bearer | Batch status update |
| GET | `/api/health` | None | Health check |
| POST | `/api/homework/update` | Bearer | Partial update (title, subject, due, priority, note, tags) |
| POST | `/api/homework/delete` | Bearer | Archive homework |

## Tech Stack

- **Runtime:** Node.js 20+
- **Bot:** Telegraf
- **AI:** Typhoon (OpenAI-compatible API)
- **Database:** Notion API
- **Web:** Express, Chart.js
- **Cron:** node-cron
- **Container:** Docker (Alpine)

## Deployment

```bash
docker build -t homework-bot .
docker run -p 8080:8080 --env-file .env homework-bot
```
