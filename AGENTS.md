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
git push https://m6R5Wb:n8C9TzNo23X@justrunmy.app/git/r_Je3z9NQ HEAD:deploy    # JustRunMy (auto-build + restart)
```

## Architecture
```
index.js                     ← entry (bot.launch, cron, state cleanup, auto-archive, auto-update-priority)
src/handlers/
  commandHandlers.js         ← /start, /menu, /help, /ask, text router, confirm menu, photo OCR handler, media group debounce
  actionHandlers.js          ← all inline keyboard callbacks, priority, edit
src/services/
  aiService.js               ← Typhoon via OpenAI SDK, 2-model chain, TTL cache + .corrections.json
  aiCache.js                 ← correction persistence, in-memory cache
  ocrService.js              ← Typhoon OCR (typhoon-ocr model), image → text extraction
  qaService.js               ← AI Q&A (ask about homework, Typhoon chat model)
  notionService.js           ← Notion SDK, TTL-cached, auto-invalidate on write
  cache.js                   ← generic in-memory TTL Map
src/web/
  server.js                  ← Express server: /api/all (stats+homework+trend)
  public/index.html          ← Web dashboard (Chart.js, calendar, detail panel, CSV)
src/utils/
  dateParser.js              ← Thai date regex: parseThaiDate, formatDueDisplay
  subjectDetector.js         ← Thai keyword matching + misspelling support, cleanTitle
  telegramFormat.js          ← Markdown escape: _ * ` [ ~ ( ) |
  constants.js               ← STATUS, PRIORITY, dashboard limits, NOTION_PAGE_SIZE
  logger.js                  ← console wrapper with Thai timestamps
  validateEnv.js             ← validates TELEGRAM_TOKEN, NOTION_TOKEN, DATABASE_ID
```

## Features implemented
| Feature | Description |
|---------|-------------|
| ✅ AI parse homework | Typhoon 2 models → title/subject/date/priority, regex fallback |
| ✅ Priority | AI auto-detect (🔴สูง/🟡กลาง/🟢ต่ำ), default `🟢 ต่ำ` when no due date, edit button, sort by priority, auto-recalc on date edit |
| ✅ Priority auto-update | cron 06:00 — recalc all active homework priorities based on remaining days |
| ✅ AI Q&A | /ask command — ask about homework in natural language |
| ✅ Web Dashboard | Express + Chart.js: donuts, trend line, calendar, detail panel, CSV export |
| ✅ Auto-archive | cron 02:00 — archive Done homework older than 7 days |
| ✅ Reminder | cron 08:00 — upcoming homework for next 7 days |
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
- `autoUpdatePriority()` cron at 06:00 daily (runs before reminder 08:00)
- LIST_ACTIVE sorts by priority (สูง→กลาง→ต่ำ) then by due

## Web Dashboard
- URL: `https://gitr_je3z9-ec1.j.jrnm.app/?token=<TELEGRAM_TOKEN>`
- Pages: Home | Dashboard | Calendar | List
- Dashboard: status donut, priority donut, trend line (30d), subject bars, week grid
- Calendar: monthly grid, click day → show items
- List: search, subject filter, date range, colored rows, click for detail panel, CSV export

## Auto-archive
- cron `0 2 * * *` — runs daily at 02:00 Bangkok time
- Fetches Done homework where Due < today - 7 days
- Archives (sends to Notion Trash)

## Hosting (JustRunMy.app)
- Git Push deployment
- Dockerfile builds `node:20-alpine`, `CMD ["node", "index.js"]`
- Port 8080, env vars set in Settings
- $1 credit ≈ 166 days uptime
- Update: `git push https://...@justrunmy.app/git/r_Je3z9NQ HEAD:deploy`

## Corrections
- Users edit title/subject/date/priority via confirm screen → `setCorrection(rawText, {...})` → `.corrections.json`
- Same raw text in future → uses correction directly, skips AI
- Max 500 entries, atomic write (tmp + rename), gitignored

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
| REMINDER_CHAT_ID | ❌ | Chat ID for 08:00 reminders |
| WEB_URL | ❌ | Web dashboard URL → shows 🌐 button in menu |
| TZ | ❌ | Set to `Asia/Bangkok` |

## Testing quirks
- Jest config in `package.json` (`testEnvironment: node`)
- `.mjs` test files are standalone (`node __tests__/dateParser.test.mjs`)
- Cache tests call `beforeEach(() => cacheInvalidate())` for isolation
- TTL tests use real `setTimeout` (timing-sensitive)

## Thai-specific
- `parseThaiDate()`: วันนี้, พรุ่งนี้, มะรืน, อีก X วัน/สัปดาห์/อาทิตย์, วันNAME(หน้า), dd/mm/yy(yy), วันที่ X
- `detectSubject()`: 50+ keywords including misspellings (คนิด→คณิต, อิ๊ง→อังกฤษ, ฟิสิก→ฟิสิกส์, etc.) for ม.1-6 subjects
- Order: ไทย → อังกฤษ → ฟิสิกส์ → เคมี → ชีวะ → คณิต → สังคม → ประวัติ → คอม → สุขศึกษา
- `cleanTitle()` strips only the first-word subject prefix, preserves content words like กลอน in แต่งกลอน
- Confirm menus and bot messages are in Thai
- Cron timezone: `Asia/Bangkok`
