# Homework Bot — AGENTS.md

## Quick start

```bash
npm install
cp .env.example .env   # fill in TELEGRAM_TOKEN, NOTION_TOKEN, DATABASE_ID
npm test               # 1306 tests, 17 suites
node index.js          # long-polling only (no webhook)
```

## Non-obvious commands

- `npm test` uses `--experimental-vm-modules` (already in `package.json`)
- `.mjs` files in `__tests__/` are standalone, **not** part of Jest suite
- No linter, typecheck, or formatter configured
- `process.env.TZ` must be `Asia/Bangkok` for cron + date math (set in `index.js`)

## Deploy

```bash
git push -u https://Km4n7:Wf6w9DQz8@justrunmy.app/git/r_z8NWy HEAD:deploy
```

Push to `origin/main` for GitHub:
```bash
git push origin main
```

CI / Registry deploy

This repo includes a GitHub Actions workflow `.github/workflows/justrunmy-deploy.yml` that builds and pushes a Docker image to the JustRunMy registry. To use it:

1. Add repository secrets in GitHub: `JRM_USERNAME` and `JRM_PASSWORD` (these are the registry credentials)
2. Push to branch `deploy` or trigger the workflow manually in Actions
3. The workflow will build and push an image tagged with the commit SHA and `latest` to `jdr-q93on76yt8.justrunmy.app/q93on76yt8`

This is recommended when the platform's Git-based builder is returning "No matching nodes" or otherwise unstable.

## Architecture

```
index.js                     ← entry (bot.launch, 4 crons, state cleanup, graceful shutdown, version banner, Notion schema check)
src/
  handlers/
    commandHandlers.js       ← /menu, /help, /stats, /ask, /panic, /tomorrow, /week, /deadline, /progress, /search, /quote, /export, /noted, /hint, /undo, /focus, /badges, /review, /collab, /smartbook, /pomodoro, /suggest, text router, confirm/preview, errorWithRetry
    actionHandlers.js        ← inline keyboard callbacks (ADD, EDIT, DELETE, LIST, DASHBOARD, FOCUS, BADGES, REVIEW, COLLAB, SMARTBOOK, POMODORO, SUGGEST, retry-with-backoff)
    viewBuilders.js          ← buildPanic / buildTomorrow / buildWeek / buildDeadline / buildProgress (shared text renderers, statusEmoji, priorityWeight)
  services/
    aiService.js             ← Typhoon AI via OpenAI SDK, 2-model chain + regex fallback
    aiCache.js               ← .corrections.json persistence + in-memory AI cache (1h TTL)
    qaService.js             ← AI Q&A with homework context (Typhoon models)
    notionService.js         ← Notion SDK, TTL-cached, auto-invalidate on write, validateNotionSchema() on boot, getHomeworkStats()
    cache.js                 ← generic in-memory TTL Map with pattern-based invalidation
    hintService.js           ← getStudyTip() (primary) / askHint() (deprecated alias) / FALLBACK_TIPS per subject
    shareTokenService.js     ← collab share-link tokens via createJsonStore, .share_tokens.json, 24h TTL
    badgeService.js          ← task/usage/pomodoro badges (checkTaskBadges / awardBadges / buildBadgeGrid / getBadgeCount / getRarestBadge), persisted via createJsonStore
    pomodoroService.js       ← focus timer (25/5 min) + getStreak, persisted via createJsonStore
  web/
    server.js                ← Express (REST API + static files, rate-limited, ticket-based auth, security headers, SW versioning)
    public/
      index.html             ← Dashboard (Chart.js, calendar, dark mode, PWA, bulk actions, CSV export)
      manifest.json          ← PWA manifest
      sw.js                  ← Service worker (CACHE_NAME injected at boot from package.json)
  utils/
    jsonStore.js             ← atomic JSON-file persistence (tmp + rename, per-file generation sidecar, setImmediate-deferred writes, round-trip flush)
    dateParser.js            ← Thai date regex: parseThaiDate, formatDueDisplay, parseYMDToLocalDate, THAI_DAYS, THAI_MONTHS
    subjectDetector.js       ← 50+ keywords → 10 subjects, misspelling support, subjectEmoji
    tagDetector.js           ← Tag inference + #hashtag parsing
    telegramFormat.js        ← Markdown escape helpers (safeBold, safeItalic, safeCode, escapeMarkdown)
    constants.js             ← STATUS, PRIORITY, PRIORITY_ORDER, PRIORITY_DEFAULT, URGENT_DAYS, dashboard limits
    priority.js              ← recalcPriority(due): ≤3d HIGH, ≤14d MEDIUM, >14d LOW
    quotes.js                ← 36 motivational Thai quotes
    logger.js                ← console wrapper with Thai timestamps + emoji levels
    validateEnv.js           ← required env validation (TELEGRAM_TOKEN, NOTION_TOKEN, DATABASE_ID, DASHBOARD_TOKEN); exits(1) if missing
scripts/
  backup.js                  ← Notion + corrections export to backups/
```

## AI pipeline

1. `.corrections.json` — user-edited values, zero API calls
2. In-memory AI cache (1h TTL)
3. Typhoon models in order: `typhoon-v2.5-30b-a3b-instruct` → `typhoon-v2.1-12b-instruct`
4. On 429/5xx → auto-switch to next model; on bad JSON → retry once with minimal prompt
5. If all fail → regex fallback (`parseThaiDate` + `detectSubject` + `inferAndParseTags`)

## Q&A pipeline (separate from parsing)

- Uses same Typhoon model chain
- Fetches active homework from Notion, builds context string, sends to AI
- Falls back to null on failure (returns error message to user)

## Corrections

- Users edit title/subject/date via confirm screen → `setCorrection(rawText, { title, subject, due, priority })` → `.corrections.json`
- Same raw text in future → uses correction directly, skips AI
- Max 500 entries, atomic write (tmp + rename), gitignored

## jsonStore (atomic JSON persistence)

- `createJsonStore(filename, initial)` returns `{ data, scheduleWrite, flush }`
- Writes are deferred to `setImmediate` (Check phase) so they run AFTER any concurrent dynamic import's module evaluation
- Per-file generation sidecar (`<filename>.owner`) prevents stale writes from a previous instance from corrupting a fresh fixture (e.g., across `jest.resetModules()`)
- `flush()` returns a promise that resolves only after the pending write has hit disk
- Used by: badges, pomodoros, corrections, share tokens
- Race-safety tested by `__tests__/badgeService.test.js` (loop with `jest.resetModules`)

## Notion caching

| Query         | TTL  | Invalidation trigger                |
|---------------|------|--------------------------------------|
| fetchActive   | 15s  | create / status update / archive     |
| fetchDone     | 30s  | same (prefix `notion:`)              |
| fetchUpcoming | 60s  | same                                 |
| pageCache     | 5s   | per-page (getPageStatus/getPageTitle) |
| schemaCheck   | once | per-call cache in notionService     |

## Notion schema validation

- `validateNotionSchema()` called once on boot from `index.js` (async, non-blocking)
- Checks required properties: `Name` (title), `Status` (select), `Subject` (rich_text), `Due` (date), `Priority` (select), `Completed` (date), `Tags` (multi_select), `EventId` (rich_text)
- Warns (does not exit) on missing/wrong-type properties
- Cached per-call to avoid repeated Notion API hits

## User state

- `userState` Map in `index.js`, keyed by Telegram user ID
- Two-tier TTL: `STALE_TTL=1h` for idle, `ACTIVE_TTL=12h` for `mode==="POMODORO"`, `mode==="CONFIRM"`, `_pomodoro`, `_confirming`
- Cleanup interval is idempotent (guarded flag)
- `originalText` stored on ADD → CONFIRM flow, used to save corrections on save
- `_lastAction` stored for `/undo` (status changes, 30s window)
- `_saving` flag prevents duplicate CONFIRM_SAVE clicks

## Telegram bot commands

Registered via `bot.telegram.setMyCommands` in `index.js`:

| Command | Thai description |
|---------|------------------|
| `/menu` | 📋 เปิดเมนูหลัก |
| `/stats` | 📊 สถิติการบ้าน |
| `/panic` | 🚨 โหมดฉุกเฉิน — 3 งานด่วนที่สุด |
| `/tomorrow` | 📅 งานที่ต้องส่งพรุ่งนี้ |
| `/week` | 📅 ตารางการบ้านประจำสัปดาห์ |
| `/deadline` | ⏰ นับถอยหลังงานด่วนที่สุด |
| `/progress` | 📊 ความคืบหน้าแยกตามวิชา |
| `/hint` | 🧠 คำแนะนำการเริ่มทำการบ้าน |
| `/search` | 🔍 ค้นหาการบ้าน |
| `/quote` | 💬 คำคมกำลังใจ |
| `/export` | 📋 ส่งออกรายการการบ้าน |
| `/noted` | 📝 แนบโน๊ตให้การบ้าน |
| `/focus` | 🎯 โฟกัสงานทีละชิ้น |
| `/badges` | 🏅 เหรียญตราความสำเร็จ |
| `/review` | 📋 สรุปการบ้านที่ทำเสร็จแล้ว |
| `/collab` | 👥 แชร์การบ้านกับเพื่อน |
| `/smartbook` | 📚 AI จัดตารางอ่านหนังสือ |
| `/pomodoro` | 🍅 ตัวจับเวลา Pomodoro |
| `/suggest` | 💡 AI แนะนำว่าควรทำอะไรก่อน |
| `/ask` | 🤖 ถามเกี่ยวกับการบ้าน |
| `/undo` | ↩️ ยกเลิกการกระทำล่าสุด |
| `/help` | 🆘 วิธีใช้งาน |

## Web dashboard

- Express server on configurable `PORT` (default 8080)
- **Auth**: one-time ticket exchange → `httpOnly hb_session` cookie
  - Bot generates `createDashboardUrl(baseUrl)` → `/api/exchange?ticket=X` (5min TTL)
  - Tickets are HMAC-signed (derived from DASHBOARD_TOKEN) so they **survive restarts/deploys**
  - Browser hits exchange endpoint, gets cookie set, server responds 302 to dashboard
  - All `/api/*` and dashboard routes accept either `Authorization: Bearer` OR `Cookie: hb_session=...`
  - Replay prevention via in-memory consumed-ticket Set (resets on restart — acceptable since tickets are short-lived)
  - Ticket prune interval is idempotent (guarded by `globalThis.__hbTicketIntervalStarted`)
- **Security headers** (inline middleware, no helmet):
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy` (camera/mic/geolocation disabled)
  - `Content-Security-Policy` allowing `cdn.jsdelivr.net` for Chart.js
- **Service worker versioning**: `/sw.js` route (registered before static middleware) injects `package.json` version into `CACHE_NAME` so each deploy auto-invalidates stale caches
- Rate-limited: 60 req/min via `express-rate-limit`
- Endpoints:
  - `GET /health` — `{ status: "ok" }` container health check
  - `GET /sw.js` — service worker with auto-versioned `CACHE_NAME`
  - `GET /api/exchange?ticket=X` — exchange one-time ticket for session cookie
  - `GET /api/all` — stats + homework + trend + weeklyDone
  - `GET /api/stats` — stats summary only
  - `GET /api/homework` — list all homework
  - `POST /api/homework` — create new homework
  - `POST /api/homework/update` — partial update
  - `POST /api/homework/delete` — delete (archive)
  - `POST /api/status` — update single item status
  - `POST /api/bulk-status` — batch status update
  - `GET /api/badges` / `GET /api/badges/:userId` — badge grid + count + rarest
- SPA with Chart.js (donut, bar, line), calendar view, search/filter, bulk actions, CSV export, dark mode, PWA

## Cron schedule (Asia/Bangkok)

| Time       | Function              | Description                                      |
|------------|-----------------------|--------------------------------------------------|
| 02:00      | `autoArchive()`       | Archive Done homework older than 7 days           |
| 06:00      | `autoUpdatePriority()`| Recalculate priority based on remaining days      |
| 07:00 Mon  | `sendWeeklySummary()` | Weekly completion stats summary                   |
| 08:00      | `sendReminders()`     | Notify about homework due in the next 7 days      |

All cron jobs have overlap guards (`cronRunning` object with per-job boolean flags).

## Shutdown sequence (`index.js`)

1. `cron.getTasks().forEach(t => t.stop())` — stop scheduled crons
2. `cleanupPomoTimers()` — clear in-memory pomodoro intervals
3. `bot.stop(sig)` — stop accepting new updates
4. `server.close()` — stop Express
5. `Promise.allSettled([flushCorrections, flushBadges, flushPomodoros, flushShareTokens])` — persist all JSON state
6. 10s hard timeout, `process.exit(0)`
7. Shutdown log includes per-store flush status: `Shutdown complete (flushed X/N, F failed)`

## Startup banner

`🏠 Homework Bot v${pkgVersion} starting (node ${process.version}, TZ ${process.env.TZ || "system"})` (from `package.json`)

## Bot launch retry

`launchBot(retries=5, delay=3000)` retries on 409 Conflict with exponential backoff (delay × 2, capped at 15s). The 3s initial delay is short enough that the deploy platform's readiness probe doesn't time out, but long enough for the previous instance to release the Telegram polling endpoint during a rolling deploy. On final 409 (another instance is still polling), the bot exits cleanly with code 0 so the deploy platform doesn't treat it as a crash — the next deploy attempt will succeed. On non-409 errors, exits with code 1.

`setBotReady(true)` is called immediately after `bot.launch()` succeeds, which flips `/health.bot` from `"starting"` → `"ready"`. The HTTP status stays 200 either way — the dashboard is useful even while the bot is launching, so /health doesn't gate traffic on bot readiness.

## Hint system

- One-time tips per user session (1h TTL, 1000-entry cap)
- `getStudyTip(userId, context)` is the primary function; `askHint()` is a deprecated alias kept for back-compat
- **Tips are static (per-subject `FALLBACK_TIPS` in `hintService.js`)** — there is no AI integration. The "AI hint" wording in earlier docs was misleading.
- Tracks shown hints via `hintsShown` + `sessionHints` Maps
- Cleanup every hour via `setInterval(() => pruneHints(...), HINT_TTL).unref()` (idempotent, guarded by `globalThis.__hbActionCleanupStarted`)

## Error handling

- `errorWithRetry(message, retryAction)` — produces Thai-localized error message with inline keyboard
- `ALLOWED_RETRY_PREFIXES` allowlist (rejects bare `RETRY_FETCH` or anything not starting with one of):
  - `RETRY_FETCH_ACTIVE`
  - `RETRY_FETCH_DONE`
  - `RETRY_FETCH_DASHBOARD`
  - `RETRY_STATUS_`
  - `RETRY_ARCHIVE_`
- Invalid retry actions fall back to `HOME` callback
- `bot.catch(err)` — global handler logs Telegraf errors without crashing

## Testing quirks

- Jest config in `package.json` (`testEnvironment: node`, `--experimental-vm-modules`)
- `.mjs` test files are standalone (`node __tests__/dateParser.test.mjs`)
- Cache tests call `beforeEach(() => cacheInvalidate())` for isolation
- TTL tests use real `setTimeout` (timing-sensitive)
- API e2e tests mock Notion calls and run Express on a random port
- `dashboardSecurity.test.js` mocks `notionService` to avoid hanging on real Notion calls
- `errorWithRetry` callback_data allowlist: `RETRY_FETCH_ACTIVE`, `RETRY_FETCH_DONE`, `RETRY_FETCH_DASHBOARD`, `RETRY_STATUS_*`, `RETRY_ARCHIVE_*`; bare `RETRY_FETCH` is rejected

## Thai-specific

- `parseThaiDate()`: วันนี้, พรุ่งนี้, มะรืน, อีก X วัน/สัปดาห์/อาทิตย์, วันNAME(หน้า), dd/mm/yy(yy), วันที่ X
- `detectSubject()`: 50+ keywords including misspellings (คนิด→คณิต, อิ๊ง→อังกฤษ, ฟิสิก→ฟิสิกส์) — 10 subjects
- `cleanTitle()`: Removes date patterns, day keywords, and subject prefixes from raw text
- Confirm menus and bot messages are in Thai
- Cron timezone: `Asia/Bangkok` (set via `process.env.TZ`)
- Date ambiguity hint: detects when parsed date might refer to wrong month
- All `FALLBACK_TIPS` are in Thai (per subject: คณิต, ไทย, อังกฤษ, ฟิสิกส์, เคมี, ชีวะ, สังคม, ประวัติ, คอม, สุขศึกษา, ทั่วไป)
- 36 motivational Thai quotes in `src/utils/quotes.js`

## W2 i18n Conversion Progress (2025)

**Goal**: Bot messages in English (`BOT_LANG=en`), parser internals stay Thai.

| File | Status | Thai Strings |
|------|--------|--------------|
| `commandHandlers.js` | ✅ Done | 0 |
| `viewBuilders.js` | ✅ Done | 0 |
| `actionHandlers.js` | ✅ Done | 0 |
| `i18n/en.js` | ✅ Done | N/A |
| `i18n/th.js` | ✅ Done | Thai fallback |

**Completed conversions**:
- All 22 bot commands (`/menu`, `/ask`, `/help`, `/stats`, `/panic`, `/tomorrow`, `/search`, `/week`, `/deadline`, `/progress`, `/quote`, `/export`, `/noted`, `/hint`, `/undo`, `/focus`, `/badges`, `/review`, `/collab`, `/smartbook`, `/pomodoro`, `/suggest`)
- Text router (`bot.on("text")`)
- RETRY handlers
- Dashboard, list, status messages
- All actionHandlers.js inline callbacks (ADD, EDIT_TITLE, EDIT_SUBJECT, DELETE, LIST, POMODORO, COLLAB_SEL, etc.)

Tests: 1319/2 baseline pass. Deploy via `git push -u https://Km4n7:Wf6w9DQz8@justrunmy.app/git/r_z8NWy HEAD:deploy`
