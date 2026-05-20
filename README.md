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
| **AI Parse Homework** | พิมพ์ "คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้" → AI (Typhoon) ดึง ชื่อวิชา, วันที่ส่ง, ความสำคัญ, แท็ก อัตโนมัติ |
| **AI Q&A** | `/ask` ถามเกี่ยวกับการบ้านเป็นภาษาไทย — AI ตอบจากข้อมูลใน Notion |
| **Priority System** | 🔴สูง / 🟡กลาง / 🟢ต่ำ — auto-detect, manual override, auto-recalc ทุกวัน 06:00 |
| **Tag Inference** | auto-tag จาก keywords (สอบ, โครงการ, กลุ่ม, ด่วน, อ่าน, ใบงาน) + `#hashtag` |
| **Edit Before Save** | preview + edit (ชื่อ, วิชา, วันที่, ความสำคัญ, แท็ก) ก่อนบันทึก |
| **Pagination** | รายการงานค้าง/งานเสร็จ 10 รายการ/หน้า พร้อมปุ่ม previous/next |
| **Delete Recovery** | ลบแล้วกู้คืนได้ภายใน 10 วินาที |
| **Undo** | `/undo` ยกเลิกการเปลี่ยนสถานะล่าสุด (ภายใน 30 วินาที) |
| **Reminders** | auto แจ้งเตือนงานที่ต้องส่ง 7 วันข้างหน้า ทุกวัน 08:00 น. |
| **Weekly Summary** | สรุปผลงานประจำสัปดาห์ทุกวันจันทร์ 07:00 น. |
| **Auto-Archive** | Archived งานที่เสร็จแล้วเกิน 7 วัน ทุกวัน 02:00 น. |
| **Hint System** | เคล็ดลับการใช้งานแบบ one-time (หลังบันทึก, เปลี่ยนสถานะ, priority legend) |
| **AI Confident Skip** | ถ้า AI แน่ใจ + ตรงกับ regex → ข้าม preview ไป confirm เลย |

### 🌐 Web Dashboard

| Feature | Description |
|---------|-------------|
| **Stats Cards** | 6 ตัวเลขสรุป (todo, in progress, done, urgent, overdue, completion %) |
| **Donut Charts** | สถานะ + ความสำคัญ (custom HTML legend) |
| **30-Day Trend** | กราฟเส้นจำนวนงานที่ทำเสร็จย้อนหลัง 30 วัน |
| **Weekly Progress** | Bar chart รายวัน (จ-อา) |
| **Calendar View** | ปฏิทินรายเดือนแสดงสถานะ (แดง/ส้ม/เขียว), คลิกดูรายละเอียด |
| **Subject Pills** | แสดงตามรายวิชาพร้อม urgency bar |
| **Search & Filter** | ค้นหา title/subject/note, filter ตามสถานะ + ช่วงวันที่ |
| **Sortable Columns** | คลิกหัวตารางเรียงลำดับ |
| **Bulk Actions** | checkbox + select all + bulk status update |
| **CSV Export** | Export ไฟล์ CSV รองรับ Excel (BOM) |
| **Dark Mode** | Auto-detect + toggle, เก็บใน localStorage |
| **PWA** | ติดตั้งบนมือถือได้ (manifest.json + service worker) |
| **Responsive** | sidebar → bottom nav บนมือถือ |

### 🔒 Security

- Bearer token authentication (SHA256 ของ NOTION_TOKEN)
- Rate limiting 60 req/min
- ไม่ expose TELEGRAM_TOKEN ใน URL
- Notion API retry with exponential backoff
- Input validation ทุก endpoint

---

## 📥 How to Install

### Prerequisites

| สิ่งที่ต้องมี | รายละเอียด |
|--------------|------------|
| **Node.js 20+** | [Download](https://nodejs.org/) หรือใช้ nvm: `nvm install 20` |
| **Telegram Bot Token** | สร้างได้ที่ [@BotFather](https://t.me/BotFather) — พิมพ์ `/newbot` แล้วทำตาม |
| **Notion Token + Database** | สร้าง Integration ได้ที่ [my integrations](https://www.notion.so/my-integrations) |
| **Typhoon API Key** (optional) | [Get free key](https://playground.opentyphoon.ai/settings/api-key) — ฟรี 5 req/s, 200 req/min |

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

#### 3️⃣ ตั้งค่า Environment

```bash
cp .env.example .env
```

แก้ไขไฟล์ `.env`:

```env
# ── Required ──
TELEGRAM_TOKEN=123456:ABC-DEF1234        # จาก @BotFather
NOTION_TOKEN=secret_abc123def456...      # จาก https://www.notion.so/my-integrations
DATABASE_ID=abc123def456789abc123def456  # ID ของ Notion Database (ดูวิธีด้านล่าง)

# ── Required for AI parsing + Q&A ──
TYPHOON_API_KEY=typhoon-abc123...        # จาก https://playground.opentyphoon.ai

# ── Optional ──
REMINDER_CHAT_ID=123456789               # Chat ID สำหรับรับ reminder (หาโดยส่งข้อความหา @userinfobot)
WEB_URL=https://homework.k.jrnm.app      # URL web dashboard (แสดงปุ่ม 🌐 ในเมนู)
```

#### 4️⃣ สร้าง Notion Database

สร้าง Database ใหม่ใน Notion (หรือใช้ template) แล้วเพิ่ม **connection** ให้ Integration ของคุณ

**Properties ที่ต้องมี:**

| Property | Type | Options | หมายเหตุ |
|----------|------|---------|----------|
| `Name` | **Title** | — | ชื่อการบ้าน (required) |
| `Subject` | **Rich text** | — | ชื่อวิชา |
| `Status` | **Select** | `Todo`, `In Progress`, `Done` | สถานะ |
| `Due` | **Date** | — | กำหนดส่ง |
| `Priority` | **Select** | `🔴 สูง`, `🟡 กลาง`, `🟢 ต่ำ` | ความสำคัญ |
| `Tags` | **Multi-select** | — | แท็ก (สอบ, โครงการ, กลุ่ม, ด่วน, อ่าน, ใบงาน) |
| `Note` | **Rich text** | — | หมายเหตุ |
| `Completed` | **Date** | — | วันที่ทำเสร็จ (set อัตโนมัติ) |

> **💡 วิธีหา DATABASE_ID:**
> เปิด Database ของคุณใน Notion → copy URL
> ```
> https://www.notion.so/workspace/abc123def456789abc123def456?v=xxx
>                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^
>                                        นี่คือ DATABASE_ID
> ```
> ส่วนระหว่าง `/` สุดท้าย กับ `?` (หรือท้าย URL ถ้าไม่มี `?`)

> **⚠️ อย่าลืม!**
> ไปที่ [Notion Integrations](https://www.notion.so/my-integrations) → เลือก integration ของคุณ → **"Add connections"** → เลือก Database ที่สร้างไว้ → กด Confirm

#### 5️⃣ ทดสอบ

```bash
npm test
```

```
Test Suites: 7 passed, 7 total
Tests:       1025 passed, 1025 total
```

#### 6️⃣ รัน

```bash
node index.js
```

เปิด Telegram → หาบอทของคุณ → พิมพ์ `/start` หรือพิมพ์การบ้านเลย เช่น:
- `คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้`
- `รายงานอังกฤษส่งวันศุกร์`
- `สอบชีวะ บทที่ 5 อีก 3 วัน #สอบ`

---

## 🎮 Usage

### Telegram Commands

| Command | คำอธิบาย |
|---------|----------|
| `/start` | เริ่มต้น + ข้อความต้อนรับ |
| `/menu` | เปิดเมนูหลัก |
| `/help` | วิธีใช้งานเบื้องต้น |
| `/ask` | ถาม AI เกี่ยวกับการบ้านของคุณ |
| `/undo` | ยกเลิกการเปลี่ยนสถานะล่าสุด (ภายใน 30 วินาที) |

### Quick Start Examples

พิมพ์ข้อความตรงๆ ลงในแชท:

| Input | ผลลัพธ์ |
|-------|---------|
| `คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้` | ✅ วิชาคณิต, วันที่: [พรุ่งนี้], 🔴 สูง |
| `รายงานอังกฤษส่งวันศุกร์` | ✅ วิชาอังกฤษ, วันที่: [ศุกร์นี้], 🟡 กลาง |
| `สอบชีวะ บทที่ 5 อีก 3 วัน #สอบ` | ✅ วิชาชีวะ, วันที่: +3 วัน, แท็ก: สอบ |
| `ท่องอาขยานบทที่ 5` | ✅ วิชาไทย, ไม่มีกำหนดส่ง, 🟢 ต่ำ |

### Web Dashboard

เข้าใช้งานที่ URL (เช่น `https://homework.k.jrnm.app`) โดยใส่ token ใน header:
```
Authorization: Bearer <DASHBOARD_TOKEN>
```

> Dashboard token: SHA256 ของ `NOTION_TOKEN` หรือ set `DASHBOARD_TOKEN` env var

---

## 🧠 How It Works

### AI Pipeline (Thai Homework Parsing)

```
User Input → .corrections.json → in-memory cache (1h) → Typhoon v2.5 → Typhoon v2.1 → regex fallback
```

1. **Correction check** — ถ้าเคยแก้ไขข้อความนี้มาก่อน → ใช้ค่าที่แก้ไขเลย (zero API call)
2. **Cache check** — ถ้าเคย parse ข้อความนี้ใน 1 ชม. → ใช้ cached result
3. **Typhoon v2.5** — Model แรก (30B) ถ้า 429/5xx → ข้ามไป model ถัดไป
4. **Typhoon v2.1** — Model ที่สอง (12B) ถ้าล้มเหลว → fallback
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
 ┃    ┣ 📄 dateParser.js              ← Thai date regex (วันนี้, พรุ่งนี้, มะรืน, อีก X วัน, dd/mm/yy)
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
| `GET` | `/api/homework` | รายการการบ้านทั้งหมด | — |
| `POST` | `/api/homework` | เพิ่มการบ้านใหม่ | `{ title, subject?, due?, priority?, note?, tags? }` |
| `POST` | `/api/homework/update` | แก้ไขบางฟิลด์ | `{ id, title?, subject?, due?, priority?, note?, tags? }` |
| `POST` | `/api/homework/delete` | ลบ (archive) | `{ id }` |

### Status

| Method | Path | Description | Request Body |
|--------|------|-------------|--------------|
| `POST` | `/api/status` | เปลี่ยนสถานะ 1 รายการ | `{ id, status }` |
| `POST` | `/api/bulk-status` | เปลี่ยนสถานะหลายรายการ | `{ ids[], status }` |

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/all` | stats + homework + trend + weeklyDone |
| `GET` | `/api/stats` | สถิติสรุปเท่านั้น |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | `{ status: "ok" }` — สำหรับ container health check |

### Status Values

| Value | ความหมาย |
|-------|----------|
| `Todo` | ยังไม่ทำ |
| `In Progress` | กำลังทำ |
| `Done` | เสร็จแล้ว |

---

## 🔧 Tech Stack

| Category | Tech | หมายเหตุ |
|----------|------|----------|
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

### Docker (通用)

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

- Dockerfile-based, auto-build + restart
- Port 8080
- Set env vars in dashboard settings

### Environment Variables (Production)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_TOKEN` | ✅ | — | Telegram bot token |
| `NOTION_TOKEN` | ✅ | — | Notion integration secret |
| `DATABASE_ID` | ✅ | — | Notion database ID |
| `TYPHOON_API_KEY` | ❌ | — | AI parsing (ฟรี 5 req/s, 200 req/min) |
| `REMINDER_CHAT_ID` | ❌ | — | Chat ID สำหรับรับ reminder + weekly summary |
| `WEB_URL` | ❌ | — | URL web dashboard (แสดงปุ่ม 🌐) |
| `DASHBOARD_TOKEN` | ❌ | SHA256(NOTION_TOKEN) | Custom dashboard auth token |
| `PORT` | ❌ | `8080` | Web server port |
| `TZ` | ❌ | `Asia/Bangkok` | Timezone (in index.js) |

---

## 📊 Cron Schedule (Asia/Bangkok)

| Time | Cron | Function | Description |
|------|------|----------|-------------|
| 02:00 | `0 2 * * *` | `autoArchive()` | Archive Done เก่า >7 วัน |
| 06:00 | `0 6 * * *` | `autoUpdatePriority()` | Recalc priority ตามวันที่เหลือ |
| 07:00 Mon | `0 7 * * 1` | `sendWeeklySummary()` | สรุปผลงานประจำสัปดาห์ |
| 08:00 | `0 8 * * *` | `sendReminders()` | แจ้งเตือนงาน 7 วันข้างหน้า |

> ทุก cron มี overlap guard ป้องกัน concurrent execution

---

## 🧪 Testing

```bash
npm test                 # รันทั้งหมด (Jest)
npm run test:watch       # watch mode
```

| Test Suite | จำนวน Test | สิ่งที่ทดสอบ |
|------------|-----------|-------------|
| `dateParser` | ~300 | parseThaiDate(), formatDueDisplay(), formatDateLabel(), isPossiblyLastMonth() |
| `subjectDetector` | ~180 | detectSubject(), cleanTitle(), subjectEmoji() |
| `tagDetector` | ~120 | inferTags(), parseTags(), inferAndParseTags() |
| `priority` | ~100 | recalcPriority(), boundary conditions, edge cases |
| `telegramFormat` | ~50 | safeBold(), safeItalic(), safeCode(), escapeMarkdown() |
| `cache` | ~75 | cacheGet/Set/Invalidate/Cleanup, TTL, pattern-based |
| `api.e2e` | ~200 | Express API endpoints, auth, error handling |

**รวม: 1025+ tests, 7 suites, 0 failures**

---

## 🤝 Contributing

1. Fork repo
2. Create branch: `git checkout -b feature/awesome-feature`
3. Commit: `git commit -m "Add awesome feature"`
4. Push: `git push origin feature/awesome-feature`
5. Open Pull Request

### Code Style

- ESM modules (`import`/`export`)
- No semicolons
- 4-space indentation
- JavaScript (no TypeScript)

---

## 📝 License

ISC License — ดูไฟล์ [LICENSE](LICENSE)

---

<div align="center">
  <sub>Built with ❤️ for Thai students</sub>
</div>
