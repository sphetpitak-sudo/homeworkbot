<div align="center">
  <h1>🤖 Homework Bot</h1>
  <p><strong>AI-powered Telegram bot + web dashboard for managing homework</strong></p>
  <p>
    <img src="https://img.shields.io/badge/node.js-20%2B-339933?logo=node.js" alt="Node.js 20+">
    <img src="https://img.shields.io/badge/telegraf-4.x-009B77?logo=telegram" alt="Telegraf">
    <img src="https://img.shields.io/badge/express-5.x-000000?logo=express" alt="Express">
    <img src="https://img.shields.io/badge/notion_api-2.x-000000?logo=notion" alt="Notion API">
    <img src="https://img.shields.io/badge/tests-1025%20passing-brightgreen" alt="Tests">
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
| **AI Q&A** | `/ask` command — ask about your homework in natural language, AI answers from your Notion data |
| **Priority System** | 🔴 High / 🟡 Medium / 🟢 Low — auto-detect, manual override, auto-recalc daily at 06:00 |
| **Tag Inference** | Auto-tagged from keywords (สอบ=exam, โครงการ=project, กลุ่ม=group, ด่วน=urgent, อ่าน=reading, ใบงาน=worksheet) + `#hashtag` support |
| **Edit Before Save** | Preview + edit (title, subject, date, priority, tags) before saving |
| **Pagination** | Active/completed lists: 10 items/page with previous/next navigation |
| **Delete Recovery** | 10-second window to restore accidentally deleted items |
| **Undo** | `/undo` reverts last status change within 30 seconds |
| **Reminders** | Auto-notification for homework due in the next 7 days, daily at 08:00 |
| **Weekly Summary** | Weekly completion stats every Monday at 07:00 |
| **Auto-Archive** | Archives Done homework older than 7 days, daily at 02:00 |
| **Hint System** | One-time contextual tips (post-save, status change, priority legend) |
| **AI Confident Skip** | Skips preview when AI is confident and matches regex → goes straight to confirm |

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
| **PWA** | Installable on mobile (manifest.json + service worker) |
| **Responsive** | Sidebar → bottom nav on mobile (≤768px) |

### 🔒 Security

- Bearer token authentication (SHA256 of `NOTION_TOKEN`)
- Rate limiting: 60 req/min
- `TELEGRAM_TOKEN` never exposed in URLs
- Notion API retry with exponential backoff + jitter
- Input validation on all API endpoints

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
TYPHOON_API_KEY=typhoon-abc123...        # From https://playground.opentyphoon.ai

# ── Optional ──
REMINDER_CHAT_ID=123456789               # Chat ID for reminders (get it from @userinfobot)
WEB_URL=https://homework.k.jrnm.app      # Web dashboard URL (shows 🌐 button in bot menu)
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
Test Suites: 7 passed, 7 total
Tests:       1025 passed, 1025 total
```

#### 6️⃣ Run

```bash
node index.js
```

Open Telegram → find your bot → type `/start` or just type homework directly, e.g.:
- `คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้` (Math worksheet page 20, due tomorrow)
- `รายงานอังกฤษส่งวันศุกร์` (English report due Friday)
- `สอบชีวะ บทที่ 5 อีก 3 วัน #สอบ` (Biology exam chapter 5 in 3 days)

---

## 🎮 Usage

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + main menu |
| `/menu` | Open main menu |
| `/help` | Quick usage guide |
| `/ask` | Ask AI about your homework |
| `/undo` | Undo last status change (within 30 seconds) |

### Quick Start Examples

Just type into the chat:

| Input | Result |
|-------|--------|
| `คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้` | ✅ Subject: Math, Due: tomorrow, 🔴 High priority |
| `รายงานอังกฤษส่งวันศุกร์` | ✅ Subject: English, Due: this Friday, 🟡 Medium priority |
| `สอบชีวะ บทที่ 5 อีก 3 วัน #สอบ` | ✅ Subject: Biology, Due: +3 days, Tags: exam |
| `ท่องอาขยานบทที่ 5` | ✅ Subject: Thai, No due date, 🟢 Low priority |

### Web Dashboard

Access at your deployment URL (e.g. `https://homework.k.jrnm.app`) with the dashboard token in the header:

```
Authorization: Bearer <DASHBOARD_TOKEN>
```

> The dashboard token is a SHA256 hash of your `NOTION_TOKEN`. You can override it by setting the `DASHBOARD_TOKEN` environment variable.

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
Telegram ←→ Telegraf Bot ←→ userState (Map)
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
```

---

## 📁 Architecture

```
📦 homeworkbot
 ┣ 📄 index.js                        ← Entry point: bot.launch(), 4 crons, state cleanup, shutdown
 ┣ 📦 src
 ┃ ┣ 📂 handlers
 ┃ ┃ ┣ 📄 commandHandlers.js          ← /start, /menu, /help, /ask, /undo, text router, confirm/preview
 ┃ ┃ ┗ 📄 actionHandlers.js           ← Inline keyboard callbacks (ADD, EDIT, DELETE, LIST, DASHBOARD)
 ┃ ┣ 📂 services
 ┃ ┃ ┣ 📄 aiService.js                ← Typhoon AI via OpenAI SDK (2-model chain + regex fallback)
 ┃ ┃ ┣ 📄 aiCache.js                  ← .corrections.json persistence + in-memory AI cache
 ┃ ┃ ┣ 📄 qaService.js                ← AI Q&A with homework context
 ┃ ┃ ┣ 📄 notionService.js            ← Notion SDK wrapper (TTL cache, retry, auto-invalidate)
 ┃ ┃ ┗ 📄 cache.js                    ← Generic in-memory TTL Map with pattern-based invalidation
 ┃ ┣ 📂 web
 ┃ ┃ ┣ 📄 server.js                   ← Express (REST API + static files, rate-limited, Bearer auth)
 ┃ ┃ ┗ 📂 public
 ┃ ┃    ┣ 📄 index.html               ← Dashboard (Chart.js, calendar, dark mode, PWA, bulk actions)
 ┃ ┃    ┣ 📄 manifest.json            ← PWA manifest
 ┃ ┃    ┗ 📄 sw.js                    ← Service worker v2
 ┃ ┗ 📂 utils
 ┃    ┣ 📄 dateParser.js              ← Thai date regex parsing (วันนี้/พรุ่งนี้/มะรืน/อีก X วัน/dd/mm/yy)
 ┃    ┣ 📄 subjectDetector.js         ← 50+ keywords → 10 subjects (ไทย→สุขศึกษา)
 ┃    ┣ 📄 tagDetector.js             ← Tag inference + #hashtag parsing
 ┃    ┣ 📄 telegramFormat.js          ← Markdown escape helpers
 ┃    ┣ 📄 constants.js               ← STATUS, PRIORITY, dashboard limits
 ┃    ┣ 📄 priority.js                ← recalcPriority(due): ≤3d HIGH, ≤14d MEDIUM, >14d LOW
 ┃    ┣ 📄 logger.js                  ← Console wrapper with Thai timestamps + emoji levels
 ┃    ┗ 📄 validateEnv.js             ← Environment variable validation
 ┣ 📄 Dockerfile                      ← node:20-alpine, port 8080
 ┣ 📄 package.json
 ┗ 📄 .env.example
```

---

## 📡 API Endpoints

```
Base URL: http://localhost:8080
Auth: Authorization: Bearer <DASHBOARD_TOKEN>
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

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | `{ status: "ok" }` — container health check |

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
| **Testing** | [Jest](https://jestjs.io/) 29.x | 1025 tests (7 suites) |

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
| `TYPHOON_API_KEY` | ❌ | — | AI parsing (free: 5 req/s, 200 req/min) |
| `REMINDER_CHAT_ID` | ❌ | — | Chat ID for daily reminders + weekly summary |
| `WEB_URL` | ❌ | — | Web dashboard URL (shows 🌐 button in bot menu) |
| `DASHBOARD_TOKEN` | ❌ | SHA256(NOTION_TOKEN) | Custom dashboard auth token |
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
| `api.e2e` | ~200 | Express API endpoints, auth, error handling |

**Total: 1025+ tests, 7 suites, 0 failures**

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
