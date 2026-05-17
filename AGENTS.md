# Homework Bot

## Quick start
```bash
npm install
cp .env.example .env   # fill in TELEGRAM_TOKEN, NOTION_TOKEN, DATABASE_ID
npm test
node index.js
```

## Git push shortcuts
```bash
git push origin main                                                     # GitHub
git push https://a8F4Kq:d7HQj63KtLz5e8F4@justrunmy.app/git/r_Lf94S HEAD:deploy    # JustRunMy (auto-build + restart)
```

## Architecture
```
index.js                     ← entry (bot.launch, 4 crons, state cleanup, cache cleanup)
src/handlers/
  commandHandlers.js         ← /start, /menu, /help, /ask, text router, confirm menu, photo OCR handler, media group debounce
  actionHandlers.js          ← all inline keyboard callbacks, priority, edit, status change
src/services/
  aiService.js               ← Typhoon via OpenAI SDK, 2-model chain, TTL cache + .corrections.json
  aiCache.js                 ← correction persistence, in-memory cache, debounced atomic write
  ocrService.js              ← Typhoon OCR (typhoon-ocr model), image → text extraction
  qaService.js               ← AI Q&A (ask about homework, Typhoon chat model)
  notionService.js           ← Notion SDK, TTL-cached, auto-invalidate on write, createHomework, updateStatus, updatePriority, archivePage
  cache.js                   ← generic in-memory TTL Map, cacheCleanup()
src/web/
  server.js                  ← Express server: GET /api/all, /api/stats, /api/homework; POST /api/homework, /api/status, /api/bulk-status
  public/
    index.html               ← Web dashboard (Chart.js, calendar, detail panel, CSV, dark mode, PWA, quick add, bulk actions)
    manifest.json            ← PWA manifest (name, theme color, icons)
    sw.js                    ← Service worker (cache-first strategy)
src/utils/
  dateParser.js              ← Thai date regex: parseThaiDate, formatDueDisplay, parseYMDToLocalDate
  subjectDetector.js         ← Thai keyword matching + misspelling support, cleanTitle, subjectEmoji
  telegramFormat.js          ← Markdown escape: _ * ` [ ~ ( ) |
  constants.js               ← STATUS, PRIORITY, priorityWeight, dashboard limits, NOTION_PAGE_SIZE
  logger.js                  ← console wrapper with Thai timestamps
  validateEnv.js             ← validates TELEGRAM_TOKEN, NOTION_TOKEN, DATABASE_ID
  priority.js                ← recalcPriority(dueStr) → shared priority calculation
```

## Features implemented
| Feature | Description |
|---------|-------------|
| ✅ AI parse homework | Typhoon 2 models → title/subject/date/priority, regex fallback |
| ✅ Priority | AI auto-detect (🔴สูง/🟡กลาง/🟢ต่ำ), default `🟢 ต่ำ` when no due date, edit button, sort by priority, auto-recalc on date edit |
| ✅ Priority auto-update | cron 06:00 — recalc all active homework priorities based on remaining days |
| ✅ AI Q&A | /ask command — ask about homework in natural language |
| ✅ Web Dashboard | Express + Chart.js: donuts, trend line, calendar, detail panel, CSV export, dark mode, PWA |
| ✅ Quick Add from Web | Modal form with subject dropdown, auto-priority preview, POST `/api/homework` |
| ✅ Status Change from Web | Clickable status buttons (To Do / In Progress / Done) in list rows |
| ✅ Bulk Actions | Checkboxes + select all + bulk status update via POST `/api/bulk-status` |
| ✅ Auto-archive | cron 02:00 — archive Done homework older than 7 days |
| ✅ Reminder | cron 08:00 — upcoming homework for next 7 days |
| ✅ Weekly Summary | cron 07:00 Monday — completed this week, remaining count, completion %, overdue |
| ✅ Dark Mode | Toggle button in sidebar, `prefers-color-scheme` auto-detect, `localStorage` persistence |
| ✅ PWA Support | `manifest.json` + `sw.js` service worker — installable on mobile |
| ✅ Health check | HTTP server on PORT 8080 for container hosting |
| ✅ 409 retry | bot.launch retries on 409 Conflict (exponential backoff) |

## AI chain
1. `.corrections.json` — user-edited values, zero API calls
2. In-memory cache (1h TTL)
3. Typhoon models in order: `typhoon-v2.5-30b-a3b-instruct` → `typhoon-v2.1-12b-instruct`
4. On 429 → auto-switch to next model; on bad JSON → retry once with minimal prompt
5. If all fail → regex fallback (`parseThaiDate` + `detectSubject`)

## Priority
- Notion field: `Priority` (Select): `🔴 สูง`, `🟡 กลาง`, `🟢 ต่ำ`
- AI detects from text: urgent words → สูง, far due → ต่ำ, no due → ต่ำ, else → กลาง
- Edit button `🎯 ความสำคัญ` in confirm menu → choose from inline keyboard
- EDIT_DATE → `recalcPriority(due)` auto-updates priority
- `recalcPriority()` in `src/utils/priority.js`: ≤3 days → สูง, ≤14 days → กลาง, >14 days → ต่ำ, no due → ต่ำ
- `autoUpdatePriority()` cron at 06:00 daily (runs before reminder 08:00)
- LIST_ACTIVE sorts by priority (สูง→กลาง→ต่ำ) then by due
- Web dashboard auto-priority preview updates live when due date changes

## Web Dashboard
- URL: `https://homework.k.jrnm.app/?token=<DASHBOARD_TOKEN>`
- Auth: `Authorization: Bearer <token>` header (fallback: `?token=` query param for backward compat)
- Pages: Home | Dashboard (แดชบอร์ด) | Calendar (ปฏิทิน) | List (รายการ)
- **Home**: stats cards (6 items), today+tomorrow schedule, overdue alert, quick links, "+ Add" button
- **Dashboard**: 6 stats cards, status+priority donuts (custom HTML legends), weekly progress bar chart, subject pills with urgency bar, 30-day trend line, 7-day mini grid
- **Calendar**: monthly grid with status dots (red/amber/green for todo/prog/done), click day → show items with priority tags, Buddhist year display, legend for colors
- **List**: checkbox column + select all, sortable columns (click header), subject emoji, search in title+subject+note, subject filter + date range, status filter tabs with counts, grouped by (overdue/this week/next week/later/no date/done), colored rows (done dimmed), clickable status buttons per row, click row for detail panel
- **Detail panel**: priority badge, time remaining with color, status, subject, note, Notion link
- **Quick Add modal**: center overlay, title (required), subject dropdown (from SUBJ_EMOJI), due date picker, auto-priority preview (overrideable), note textarea
- **Bulk actions**: bar appears when items selected, buttons for To Do / In Progress / Done, clear button, filter counts refresh after update
- **Export**: CSV with BOM for Excel
- **Dark mode**: toggle in sidebar bottom, auto-detects `prefers-color-scheme: dark`, persists in `localStorage`
- **PWA**: installable on iOS (Safari → Share → Add to Home Screen) and Android
- **Keyboard shortcuts**: removed (was h/d/c/l/r/escape)
- **Responsive**: sidebar → bottom nav on ≤768px, full-width detail panel, adaptive grid columns

## Cron jobs (Asia/Bangkok timezone)
| Time | Cron | Function | Description |
|------|------|----------|-------------|
| 02:00 | `0 2 * * *` | `autoArchive()` | Archive Done homework older than 7 days |
| 06:00 | `0 6 * * *` | `autoUpdatePriority()` | Recalc priority for all active homework |
| 07:00 Mon | `0 7 * * 1` | `sendWeeklySummary()` | Send weekly summary to REMINDER_CHAT_ID |
| 08:00 | `0 8 * * *` | `sendReminders()` | Send upcoming homework reminders (next 7 days) |

All crons have overlap guards (`cronRunning` object) to prevent concurrent execution.

## Auto-archive
- cron `0 2 * * *` — runs daily at 02:00 Bangkok time
- Fetches Done homework where Due < today - 7 days
- Archives (sends to Notion Trash)

## Hosting (JustRunMy.app)
- Git Push deployment
- Dockerfile builds `node:20-alpine`, `CMD ["node", "index.js"]`
- Port 8080, env vars set in Settings
- $1 credit ≈ 166 days uptime
- Update: `git push https://a8F4Kq:d7HQj63KtLz5e8F4@justrunmy.app/git/r_Lf94S HEAD:deploy`
- App ID: `r_Lf94S`, URL: `https://homework.k.jrnm.app/`

## Web API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/all` | Bearer token | Returns stats + homework + trend + weeklyDone |
| GET | `/api/stats` | Bearer token | Returns stats only (backward compat) |
| GET | `/api/homework` | Bearer token | Returns homework list only (backward compat) |
| POST | `/api/homework` | Bearer token | Create homework (body: title, subject, due, note) — auto-calculates priority |
| POST | `/api/status` | Bearer token | Update single item status (body: id, status) |
| POST | `/api/bulk-status` | Bearer token | Update multiple items status (body: ids[], status) |

## Corrections
- Users edit title/subject/date/priority via confirm screen → `setCorrection(rawText, {...})` → `.corrections.json`
- Same raw text in future → uses correction directly, skips AI
- Max 500 entries, atomic write (tmp + rename), gitignored
- Debounced async I/O in `aiCache.js`

## Notion caching
| Query | TTL | Invalidation trigger |
|-------|-----|---------------------|
| fetchActive | 15s | create / status update / archive |
| fetchDone | 30s | same (prefix `notion:`) |
| fetchUpcoming | 60s | same |

## User state
- `userState` Map in `index.js`, keyed by Telegram user ID
- 1h TTL (`_timestamp` on every set), stale cleanup every 30 min
- `originalText` stored on ADD → CONFIRM flow, used to save corrections on save
- Priority stored in pending and passed to createHomework

## Environment variables
| Var | Required | Description |
|-----|----------|-------------|
| TELEGRAM_TOKEN | ✅ | Telegram bot token |
| NOTION_TOKEN | ✅ | Notion integration secret |
| DATABASE_ID | ✅ | Notion database ID |
| TYPHOON_API_KEY | ❌ | AI parsing (free tier: 5 req/s, 200 req/min) |
| REMINDER_CHAT_ID | ❌ | Chat ID for 08:00 reminders + weekly summary |
| WEB_URL | ❌ | Web dashboard URL → shows 🌐 button in menu |
| DASHBOARD_TOKEN | ❌ | Web dashboard auth token (auto-generated if not set) |
| TZ | ❌ | Set to `Asia/Bangkok` |

## Security
- `DASHBOARD_TOKEN` separate from `TELEGRAM_TOKEN` — never expose bot token in URLs
- Token auto-generated on startup if not set via env var
- Auth via `Authorization: Bearer <token>` header (query param fallback for backward compat)
- `.env` gitignored

## Testing quirks
- Jest config in `package.json` (`testEnvironment: node`)
- `.mjs` test files are standalone (`node __tests__/dateParser.test.mjs`)
- Cache tests call `beforeEach(() => cacheInvalidate())` for isolation
- TTL tests use real `setTimeout` (timing-sensitive)
- 509 tests total across 4 test suites

## Thai-specific
- `parseThaiDate()`: วันนี้, พรุ่งนี้, มะรืน, อีก X วัน/สัปดาห์/อาทิตย์, วันNAME(หน้า), dd/mm/yy(yy), วันที่ X
- `detectSubject()`: 50+ keywords including misspellings (คนิด→คณิต, อิ๊ง→อังกฤษ, ฟิสิก→ฟิสิกส์, etc.) for ม.1-6 subjects
- Order: ไทย → อังกฤษ → ฟิสิกส์ → เคมี → ชีวะ → คณิต → สังคม → ประวัติ → คอม → สุขศึกษา
- `cleanTitle()` strips only the first-word subject prefix, preserves content words like กลอน in แต่งกลอน
- Confirm menus and bot messages are in Thai
- Cron timezone: `Asia/Bangkok`

## Known quirks
- JustRunMy occasionally returns "No matching nodes" during deployment — retry after a few minutes
- PWA service worker registration may fail silently on localhost (expected, only works on HTTPS)
- Demo mode (`?token=demo`) uses fake data — trend chart shows random data, status changes are local-only
