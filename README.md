<div align="center">
  <h1>🤖 Homework Bot</h1>
  <p><strong>AI-powered Telegram bot + web dashboard for managing homework</strong></p>
  <p>
    <img src="https://img.shields.io/badge/node.js-20%2B-339933?logo=node.js" alt="Node.js 20+">
    <img src="https://img.shields.io/badge/telegraf-4.x-009B77?logo=telegram" alt="Telegraf">
    <img src="https://img.shields.io/badge/express-5.x-000000?logo=express" alt="Express">
    <img src="https://img.shields.io/badge/notion_api-2.x-000000?logo=notion" alt="Notion API">
    <img src="https://img.shields.io/badge/tests-1306%20passing-brightgreen" alt="Tests">
    <img src="https://img.shields.io/badge/license-ISC-blue" alt="License">
  </p>
  <p>
    <a href="#features">Features</a> •
    <a href="#how-to-install">Install</a> •
    <a href="#usage">Usage</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#api-endpoints">API</a> •
    <a href="#tech-stack">Tech Stack</a> •
    <a href="#deployment">Deploy</a>
  </p>
</div>

---

## ✨ Features

### 🤖 Telegram Bot

| Feature | Description |
|---------|-------------|
| **AI Parse Homework** | Type "คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้" → AI (Typhoon) extracts subject, due date, priority, tags automatically |
| **AI Q&A** | `/ask` — ask about homework in natural language, AI answers from Notion |
| **AI Suggest** | `/suggest` — AI analyzes all active homework + overdue → suggests what to do first |
| **AI Smartbook** | `/smartbook` — AI generates a 7-day study plan from active homework, export as iCal |
| **Pomodoro Timer** | `/pomodoro` — 🍅 25-min work + 5-min break timer, links with /focus, badges, persistent stats |
| **Focus Mode** | `/focus` — pick one task, block distractions, change status without leaving focus |
| **Emergency Mode** | `/panic` — shows top 3 most urgent tasks with action buttons |
| **Deadline Countdown** | `/deadline` — visual countdown bar for the closest deadline |
| **Weekly Timeline** | `/week` — 7-day timeline view of homework due dates |
| **Tomorrow** | `/tomorrow` — see everything due tomorrow |
| **Progress by Subject** | `/progress` — % complete per subject with progress bars |
| **Search** | `/search` — search homework by keyword |
| **Export** | `/export` — shareable plain-text summary of all homework |
| **Stats** | `/stats` — quick stats overview |
| **Badges** | `/badges` — 🏅 achievement badges (tasks, pomodoro, usage) |
| **Review** | `/review` — completed homework summary with period picker + sentiment |
| **Collab** | `/collab` — share a homework item with a friend via token (24h TTL) |
| **Noted** | `/noted` — attach a short note to any homework |
| **Hint** | `/hint` — Thai tips for how to start each subject |
| **Quote** | `/quote` — random motivational quote (36 Thai quotes) |
| **Priority System** | 🔴 High / 🟡 Medium / 🟢 Low — auto-detect based on due date, auto-recalc daily at 06:00 |
| **Tag Inference** | Auto-tagged from keywords (สอบ=exam, ด่วน=urgent, ใบงาน=worksheet) + `#hashtag` support |
| **Edit Before Save** | Preview + edit (title, subject, date, priority, tags) before saving |
| **Pagination** | Active/completed lists: 10 items/page with previous/next navigation |
| **Delete Recovery** | 10-second window to restore accidentally deleted items |
| **Undo** | `/undo` reverts last status change within 30 seconds |
| **Reminders** | Auto-notification for homework due in the next 7 days, daily at 08:00 |
| **Weekly Summary** | Weekly completion stats every Monday at 07:00 |
| **Auto-Archive** | Archives Done homework older than 7 days, daily at 02:00 |
| **Auto-Priority** | Recalculates priority daily at 06:00 based on remaining days |
| **Hint System** | One-time contextual tips (post-save, status change, priority legend) |
| **AI Confident Skip** | Skips preview when AI is confident and matches regex → straight to confirm |
| **Dashboard Link** | `🌐 เปิด Dashboard` button in menu → ticket-based login to web UI |
| **Notion Schema Check** | On boot, validates your Notion DB has all required properties |
| **Deploy-Safe Launch** | `launchBot` retries 409 conflicts with 3s backoff (5 attempts, 15s cap) and exits cleanly on final conflict; `/health` always 200 once web server is up (dashboard works during bot startup) |

### 🌐 Web Dashboard

| Feature | Description |
|---------|-------------|
| **Stats Cards** | 6 summary cards (todo, in progress, done, urgent, overdue, completion %) |
| **Donut Charts** | Status + priority breakdowns with custom HTML legend |
| **30-Day Trend** | Line chart of completed homework over the last 30 days |
| **Weekly Progress** | Daily bar chart (Mon-Sun) |
| **Calendar View** | Monthly calendar with status dots (red/amber/green), click to see details |
| **Subject Pills** | Subject distribution with urgency bars |
| **Search & Filter** | Search by title/subject/note, filter by status + date range |
| **Sortable Columns** | Click column headers to sort |
| **Bulk Actions** | Checkboxes + select all + bulk status update |
| **CSV Export** | CSV export with BOM for Excel |
| **Dark Mode** | Auto-detect `prefers-color-scheme` + manual toggle, persisted in localStorage |
| **PWA** | Installable on mobile (manifest.json + service worker with auto-versioning) |
| **Responsive** | Sidebar → bottom nav on mobile (≤768px) |
| **One-tap Login** | Bot menu → `🌐 เปิด Dashboard` → ticket exchange (60s TTL) → `httpOnly` cookie |

### 🔒 Security

- **Ticket-based auth** — bot generates one-time `/api/exchange?ticket=X` URL (60s TTL) → browser sets `httpOnly hb_session` cookie
- Accepts either `Authorization: Bearer` (API clients) OR `Cookie: hb_session=...` (browser dashboard)
- Security headers on every response: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Content-Security-Policy`
- Rate limiting: 60 req/min via `express-rate-limit`
- `TELEGRAM_TOKEN` never exposed in URLs
- Notion API retry with exponential backoff + jitter
- Input validation on all API endpoints
- **Service worker auto-invalidation** — `CACHE_NAME` embedded with `package.json` version, stale caches purged on deploy

---

## 📥 How to Install

### Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js 20+** | [Download](https://nodejs.org/) or use nvm: `nvm install 20` |
| **Telegram Bot Token** | Create via [@BotFather](https://t.me/BotFather) — run `/newbot` and follow instructions |
| **Notion Token + Database** | Create an integration at [my integrations](https://www.notion.so/my-integrations) |
| **Typhoon API Key** (optional) | [Get free key](https://playground.opentyphoon.ai/settings/api-key) — free tier: 5 req/s, 200 req/min |

### Step-by-step

#### 1️⃣ Clone

```bash
git clone https://github.com/sphetpitak-sudo/homeworkbot.git
cd homeworkbot
```

#### 2️⃣ Install dependencies

```bash
npm install
```

#### 3️⃣ Set up environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# ── Required ──
TELEGRAM_TOKEN=123456:ABC-DEF1234        # From @BotFather
NOTION_TOKEN=secret_abc123def456...      # From https://www.notion.so/my-integrations
DATABASE_ID=abc123def456789abc123def456  # Your Notion database ID (see below)

# ── Required for AI parsing + Q&A ──
TYPHOON_API_KEY=typhoon-abc123...            # From https://playground.opentyphoon.ai

# ── Optional ──
REMINDER_CHAT_ID=123456789                   # Chat ID for reminders (get it from @userinfobot)
WEB_URL=https://homework.k.jrnm.app          # Web dashboard URL (shows 🌐 button in bot menu)
```

#### 4️⃣ Create Notion Database

Create a new database in Notion (or use a template), then **add a connection** to your integration.

**Required properties:**

| Property | Type | Options | Notes |
|----------|------|---------|-------|
| `Name` | **Title** | — | Homework title (required) |
| `Subject` | **Rich text** | — | Subject name (e.g. คณิต, ไทย, อังกฤษ) |
| `Status` | **Select** | `Todo`, `In Progress`, `Done` | Current status |
| `Due` | **Date** | — | Due date |
| `Priority` | **Select** | `🔴 สูง`, `🟡 กลาง`, `🟢 ต่ำ` | Priority level |
| `Tags` | **Multi-select** | — | Tags (สอบ, โครงการ, กลุ่ม, ด่วน, อ่าน, ใบงาน) |
| `Note` | **Rich text** | — | Optional notes |
| `Completed` | **Date** | — | Completion date (set automatically) |

> **💡 How to find your DATABASE_ID:**
> Open your database in Notion and copy the URL:
> ```
> https://www.notion.so/workspace/abc123def456789abc123def456?v=xxx
>                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^
>                                        This is your DATABASE_ID
> ```
> It's the part between the last `/` and `?` (or the end of the URL if no `?`).

> **⚠️ Important!**
> Go to [Notion Integrations](https://www.notion.so/my-integrations) → select your integration → **"Add connections"** → select your database → Confirm. Without this step, the API cannot access your database.

#### 5️⃣ Test

```bash
npm test
```

```
Test Suites: 17 passed, 17 total
Tests:       1306 passed, 1306 total
```

#### 6️⃣ Run

```bash
node index.js
```

On boot, the bot will:
- Print a startup banner: `🏠 Homework Bot v1.0.0 starting (node v20.x.x, TZ Asia/Bangkok)`
- Validate your Notion database schema (warns but doesn't exit if properties are missing)
- Start the web dashboard on `PORT` (default `8080`)
- Register all 22 commands with Telegram

Open Telegram → find your bot → type `/start` or just type homework directly, e.g.:
- `คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้` (Math worksheet page 20, due tomorrow)
- `รายงานอังกฤษส่งวันศุกร์` (English report due Friday)
- `สอบชีวะ บทที่ 5 อีก 3 วัน #สอบ` (Biology exam chapter 5 in 3 days)

---

## 🎮 Usage

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/menu` | 📋 Open main menu |
| `/help` | 🆘 Quick usage guide |
| `/stats` | 📊 Homework statistics overview |
| `/ask` | 🤖 Ask AI about your homework |
| `/panic` | 🚨 Show top 3 most urgent tasks |
| `/tomorrow` | 📅 Homework due tomorrow |
| `/week` | 📅 7-day timeline view |
| `/deadline` | ⏰ Visual countdown for closest deadline |
| `/progress` | 📊 % completion per subject |
| `/focus` | 🎯 Focus on one task at a time |
| `/pomodoro` | 🍅 25-min work + 5-min break timer |
| `/suggest` | 💡 AI suggests what to do first |
| `/badges` | 🏅 View achievement badges |
| `/hint` | 🧠 Thai tips to start each subject |
| `/review` | 📋 Completed homework summary |
| `/collab` | 👥 Share homework with friends (24h token) |
| `/smartbook` | 📚 AI generates 7-day study plan |
| `/search` | 🔍 Search homework by keyword |
| `/export` | 📋 Export all homework as text |
| `/quote` | 💬 Random motivational quote (36 Thai quotes) |
| `/noted` | 📝 Attach a note to homework |
| `/undo` | ↩️ Undo last status change (30s) |

### Quick Start Examples

Just type into the chat:

| Input | Result |
|-------|--------|
| `คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้` | ✅ Subject: Math, Due: tomorrow, 🔴 High priority |
| `รายงานอังกฤษส่งวันศุกร์` | ✅ Subject: English, Due: this Friday, 🟡 Medium priority |
| `สอบชีวะ บทที่ 5 อีก 3 วัน #สอบ` | ✅ Subject: Biology, Due: +3 days, Tags: exam |
| `ท่องอาขยานบทที่ 5` | ✅ Subject: Thai, No due date, 🟢 Low priority |

### Web Dashboard

Access at your deployment URL (e.g. `https://homework.k.jrnm.app`) using one of:

**From the Telegram bot** — tap `🌐 เปิด Dashboard` in the main menu. The bot generates a one-time ticket URL, you open it, the browser gets an `httpOnly hb_session` cookie (24h), and the dashboard loads. No token to copy.

**From an API client** (curl, scripts, etc.) — use the Bearer token:

```
Authorization: Bearer <DASHBOARD_TOKEN>
```

> If `DASHBOARD_TOKEN` is not set, the dashboard has **no authentication** — anyone with the URL can access the API and data. Set it in production with `openssl rand -hex 32`.

---

## 🧠 How It Works

### AI Pipeline (Thai Homework Parsing)

```
User Input → .corrections.json → in-memory cache (1h) → Typhoon v2.5 → Typhoon v2.1 → regex fallback
```

1. **Correction check** — if this text was corrected before, use the saved values (zero API calls)
2. **Cache check** — if this text was parsed within 1 hour, use the cached result
3. **Typhoon v2.5** — Primary model (30B). On 429/5xx → skip to next model
4. **Typhoon v2.1** — Secondary model (12B). On failure → fallback to regex
5. **Regex fallback** — `parseThaiDate()` + `detectSubject()` + `inferTags()`

### Data Flow

```
Telegram ←→ Telegraf Bot ←→ userState (Map) ←→ focus/pomo timers
                              ↕
Web Dashboard ←→ Express API ←→ Notion SDK ←→ Notion API
                                   ↕
                              cache.js (TTL Map)
                                   ↕
                              Cron Jobs (node-cron)
                              ├─ 02:00 → autoArchive
                              ├─ 06:00 → autoUpdatePriority
                              ├─ 07:00 Mon → weeklySummary
                              └─ 08:00 → sendReminders
                                   ↕
                               Persistent Stores
                               ├─ .badges.json  (badgeService)
                               ├─ .pomodoros.json (pomodoroService)
                               └─ .corrections.json (aiCache)
```

---

## 📁 Architecture

```
📦 homeworkbot
 ┣ 📄 index.js                        ← Entry point: bot.launch(), 4 crons, state cleanup, version banner, Notion schema check, graceful shutdown
 ┣ 📦 src
 ┃ ┣ 📂 handlers
 ┃ ┃ ┣ 📄 commandHandlers.js          ← 22 commands (/menu /stats /panic /tomorrow /week /deadline /progress /hint /search /quote /export /noted /focus /badges /review /collab /smartbook /pomodoro /suggest /ask /undo /help), text router, confirm/preview, errorWithRetry
 ┃ ┃ ┣ 📄 actionHandlers.js           ← Inline keyboard callbacks (ADD, EDIT, DELETE, LIST, DASHBOARD, FOCUS, BADGES, REVIEW, COLLAB, SMARTBOOK, POMODORO, SUGGEST, retry-with-backoff)
 ┃ ┃ ┗ 📄 viewBuilders.js             ← Shared text renderers (buildPanic / buildTomorrow / buildWeek / buildDeadline / buildProgress)
 ┃ ┣ 📂 services
 ┃ ┃ ┣ 📄 aiService.js                ← Typhoon AI via OpenAI SDK (2-model chain + regex fallback)
 ┃ ┃ ┣ 📄 aiCache.js                  ← .corrections.json persistence + in-memory AI cache
 ┃ ┃ ┣ 📄 qaService.js                ← AI Q&A with homework context
 ┃ ┃ ┣ 📄 notionService.js            ← Notion SDK wrapper (TTL cache, retry, auto-invalidate, validateNotionSchema)
 ┃ ┃ ┣ 📄 cache.js                    ← Generic in-memory TTL Map with pattern-based invalidation
 ┃ ┃ ┣ 📄 badgeService.js             ← 🏅 Badge engine (.badges.json, rarities)
 ┃ ┃ ┣ 📄 pomodoroService.js          ← 🍅 Pomodoro timer (.pomodoros.json, stats, streaks)
 ┃ ┃ ┣ 📄 hintService.js              ← 💡 Thai hint generation per subject (getStudyTip / askHint)
 ┃ ┃ ┗ 📄 shareTokenService.js        ← 🔗 Collab share-link tokens (.share_tokens.json, 24h TTL)
 ┃ ┣ 📂 web
 ┃ ┃ ┣ 📄 server.js                   ← Express (REST API + static, rate-limited, ticket auth, security headers, SW versioning)
 ┃ ┃ ┗ 📂 public
 ┃ ┃    ┣ 📄 index.html               ← Dashboard (Chart.js, calendar, dark mode, PWA, bulk actions)
 ┃ ┃    ┣ 📄 manifest.json            ← PWA manifest
 ┃ ┃    ┗ 📄 sw.js                    ← Service worker (CACHE_NAME auto-versioned from package.json)
 ┃ ┗ 📂 utils
 ┃    ┣ 📄 dateParser.js              ← Thai date regex parsing (วันนี้/พรุ่งนี้/มะรืน/อีก X วัน/dd/mm/yy)
 ┃    ┣ 📄 subjectDetector.js         ← 50+ keywords → 10 subjects (ไทย→สุขศึกษา)
 ┃    ┣ 📄 tagDetector.js             ← Tag inference + #hashtag parsing
 ┃    ┣ 📄 telegramFormat.js          ← Markdown escape helpers (safeBold, safeItalic, safeCode, escapeMarkdown)
 ┃    ┣ 📄 constants.js               ← STATUS, PRIORITY, PRIORITY_ORDER, PRIORITY_DEFAULT, URGENT_DAYS, dashboard limits
 ┃    ┣ 📄 priority.js                ← recalcPriority(due): ≤3d HIGH, ≤14d MEDIUM, >14d LOW
 ┃    ┣ 📄 quotes.js                  ← 36 motivational Thai quotes
 ┃    ┣ 📄 logger.js                  ← Console wrapper with Thai timestamps + emoji levels
 ┃    ┣ 📄 validateEnv.js             ← Environment variable validation
 ┃    ┗ 📄 jsonStore.js               ← Atomic JSON-file persistence (tmp + rename, per-file generation sidecar, setImmediate-deferred writes)
 ┣ 📄 Dockerfile                      ← node:20-alpine, port 8080
 ┣ 📄 .gitignore
 ┣ 📄 package.json
 ┣ 📄 .env.example
 ┗ 📄 AGENTS.md
```

---

## 📡 API Endpoints

```
Base URL: http://localhost:8080
Auth: Authorization: Bearer <DASHBOARD_TOKEN>
       OR  Cookie: hb_session=<DASHBOARD_TOKEN>  (set by /api/exchange)
Rate Limit: 60 req/min
```

### Homework

| Method | Path | Description | Request Body |
|--------|------|-------------|--------------|
| `GET` | `/api/homework` | List all homework | — |
| `POST` | `/api/homework` | Create new homework | `{ title, subject?, due?, priority?, note?, tags? }` |
| `POST` | `/api/homework/update` | Partial update | `{ id, title?, subject?, due?, priority?, note?, tags? }` |
| `POST` | `/api/homework/delete` | Delete (archive) | `{ id }` |

### Status

| Method | Path | Description | Request Body |
|--------|------|-------------|--------------|
| `POST` | `/api/status` | Update single item status | `{ id, status }` |
| `POST` | `/api/bulk-status` | Batch status update | `{ ids[], status }` |

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/all` | stats + homework + trend + weeklyDone |
| `GET` | `/api/stats` | Stats summary only |
| `GET` | `/api/badges` | Badge grid + count + rarest (uses `?userId=` if provided) |
| `GET` | `/api/badges/:userId` | Same as above for specific user |
| `GET` | `/api/exchange?ticket=X` | Exchange one-time ticket (60s TTL) for `hb_session` cookie, then 302 to `/` |

### Health & Service Worker

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | `200 { status: "ok", bot: "ready" \| "starting" }` — always 200 once web server is up; `bot` field reports Telegram polling status |
| `GET` | `/sw.js` | Service worker with `CACHE_NAME = "homework-bot-v${version}"` auto-injected |

### Status Values

| Value | Meaning |
|-------|---------|
| `Todo` | Not started |
| `In Progress` | Working on it |
| `Done` | Completed |

---

## 🔧 Tech Stack

| Category | Tech | Notes |
|----------|------|-------|
| **Runtime** | [Node.js](https://nodejs.org/) 20+ | ESM modules |
| **Bot Framework** | [Telegraf](https://telegraf.js.org/) 4.x | Telegram Bot API wrapper |
| **AI** | [Typhoon](https://opentyphoon.ai/) via OpenAI SDK | 2 models: v2.5-30b → v2.1-12b |
| **Database** | [Notion API](https://developers.notion.com/) | Client SDK v2, REST API |
| **Web Server** | [Express](https://expressjs.com/) 5.x | REST API + static files |
| **Charts** | [Chart.js](https://www.chartjs.org/) 4.x | Donuts, bar, line charts |
| **Rate Limiting** | [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) 8.x | 60 req/min |
| **Cron** | [node-cron](https://github.com/node-cron/node-cron) | 4 cron jobs, overlap guards |
| **Container** | Docker | `node:20-alpine`, ~150 MB |
| **Testing** | [Jest](https://jestjs.io/) 29.x | 1335 tests across 18 suites, ESM `--experimental-vm-modules` |
| **Persistence** | Atomic JSON files | `createJsonStore` (tmp + rename, per-file generation sidecar, setImmediate-deferred writes) |

---

## 🚀 Deployment

### Docker

```bash
docker build -t homework-bot .
docker run -p 8080:8080 --env-file .env homework-bot
```

### Docker Compose

```yaml
version: '3'
services:
  bot:
    build: .
    ports:
      - "8080:8080"
    env_file: .env
    restart: unless-stopped
```

### JustRunMy.app (1-Click Deploy)

```bash
git push https://<token>@justrunmy.app/git/<app-id> HEAD:deploy
```

- Dockerfile-based, auto-build + restart on push
- Port 8080 exposed
- Set environment variables in dashboard settings

### Environment Variables (Production)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_TOKEN` | ✅ | — | Telegram bot token from @BotFather |
| `NOTION_TOKEN` | ✅ | — | Notion integration secret |
| `DATABASE_ID` | ✅ | — | Notion database ID |
| `DASHBOARD_TOKEN` | ❌ | — | Web dashboard auth (generate `openssl rand -hex 32`; unset = no auth) |
| `TYPHOON_API_KEY` | ❌ | — | AI parsing (free: 5 req/s, 200 req/min) |
| `REMINDER_CHAT_ID` | ❌ | — | Chat ID for daily reminders + weekly summary |
| `WEB_URL` | ❌ | — | Web dashboard URL (shows 🌐 button in bot menu) |
| `PORT` | ❌ | `8080` | Web server port |
| `TZ` | ❌ | `Asia/Bangkok` | Timezone (hardcoded in index.js) |

---

## 📊 Cron Schedule (Asia/Bangkok)

| Time | Cron | Function | Description |
|------|------|----------|-------------|
| 02:00 | `0 2 * * *` | `autoArchive()` | Archive Done homework older than 7 days |
| 06:00 | `0 6 * * *` | `autoUpdatePriority()` | Recalculate priority based on remaining days |
| 07:00 Mon | `0 7 * * 1` | `sendWeeklySummary()` | Weekly completion stats summary |
| 08:00 | `0 8 * * *` | `sendReminders()` | Notify about homework due in the next 7 days |

> All cron jobs have overlap guards to prevent concurrent execution.

---

## 🔄 Rollback & Backup

### Rollback a Bad Deploy

If a deploy breaks production:

```bash
# Revert the last commit
git revert HEAD

# Push to trigger a new deploy on JustRunMy.app
git push origin main
git push https://<token>@justrunmy.app/git/<app-id> HEAD:deploy
```

> There is no automated rollback on JustRunMy.app — the only option is to revert the commit and re-deploy.

### Manual Backup

Export all Notion homework items and `.corrections.json` to the `backups/` directory:

```bash
node scripts/backup.js
```

Output is written to `backups/notion_<timestamp>.json` and `backups/corrections_<timestamp>.json`.

### Scheduled Backup (cron)

Add a crontab entry for daily backups:

```bash
0 3 * * * cd /path/to/homeworkbot && node scripts/backup.js >> backups/backup.log 2>&1
```

### Restore

There is no automated restore. The backup files contain the raw Notion API responses and corrections data. To restore:
1. Re-create items via the Notion UI or API using the exported data
2. Copy `corrections_<timestamp>.json` back to `.corrections.json`

---

## 🧪 Testing

```bash
npm test                 # Run all tests (Jest)
npm run test:watch       # Watch mode
```

| Test Suite | Tests | What it covers |
|------------|-------|----------------|
| `dateParser` | ~300 | `parseThaiDate()`, `formatDueDisplay()`, `formatDateLabel()`, `isPossiblyLastMonth()` |
| `subjectDetector` | ~180 | `detectSubject()`, `cleanTitle()`, `subjectEmoji()` |
| `tagDetector` | ~120 | `inferTags()`, `parseTags()`, `inferAndParseTags()` |
| `priority` | ~100 | `recalcPriority()`, boundary conditions, edge cases |
| `telegramFormat` | ~50 | `safeBold()`, `safeItalic()`, `safeCode()`, `escapeMarkdown()` |
| `cache` | ~75 | `cacheGet/Set/Invalidate/Cleanup`, TTL, pattern-based |
| `api.e2e` | ~200 | Express API endpoints, auth (Bearer + cookie), error handling |
| `badgeService` | ~65 | `checkBadges()`, `checkTaskBadges()`, `awardBadges()`, `getAllBadges()`, rarity, grid, usage, persistence |
| `commandHandlers` | 33 | Focus, panic, preview, review, `errorWithRetry` allowlist |
| `hintService` | ~15 | Hint generation, subject matching |
| `collabSmartbook` | ~15 | Collab token flow, smartbook plan rendering |
| `quotes` | ~10 | Quote selection, no duplicates |
| `notionStats` | ~10 | `getHomeworkStats()`, URGENT_DAYS import fix |
| `pomodoroService` | ~30 | Pomodoro session lifecycle, getStreak edge cases |
| `qaService` | ~20 | AI Q&A fallback chain, error handling |
| `notionSchema` | 5 | `validateNotionSchema()`: missing props, type mismatches, unreachable Notion, per-call cache |
| `dashboardSecurity` | 7 | Security headers, CSP, ticket exchange, cookie auth, SW versioning, /health 503 before ready, /health 200 after setBotReady(true) |

**Total: 1306 tests, 17 suites, 0 failures** (run `npm test`)

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/awesome-feature`
3. Commit: `git commit -m "Add awesome feature"`
4. Push: `git push origin feature/awesome-feature`
5. Open a Pull Request

### Code Style

- ESM modules (`import`/`export`)
- No semicolons
- 4-space indentation
- JavaScript (no TypeScript)

---

## 📝 License

ISC License — see [LICENSE](LICENSE)

---

<div align="center">
  <sub>Built with ❤️ for Thai students</sub>
</div>
