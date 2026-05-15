# Homework Bot

## Quick start
```bash
npm install
cp .env.example .env   # fill in TELEGRAM_TOKEN, NOTION_TOKEN, DATABASE_ID
npm test               # 502 tests, 4 suites
node index.js          # long-polling only (no webhook)
```

## Non-obvious commands
- `npm test` requires `--experimental-vm-modules` (already in `scripts.test`)
- `__tests__/dateParser.test.mjs` is a standalone Node.js check, **not** part of Jest suite
- No linter, typecheck, or formatter configured

## Architecture
```
index.js                     ← entry (bot.launch, cron, state cleanup)
src/handlers/                ← Telegram bot logic
  commandHandlers.js         ← /start, /menu, /help, text router, confirm menu
  actionHandlers.js          ← all inline keyboard callbacks
src/services/
  aiService.js               ← Groq via OpenAI SDK, 3-model chain, TTL cache + .corrections.json
  aiCache.js                 ← correction persistence, in-memory cache
  notionService.js           ← Notion SDK, TTL-cached, auto-invalidate on write
  googleCalendarService.js   ← file, inline JSON, or base64 creds
  cache.js                   ← generic in-memory TTL Map
src/utils/
  dateParser.js              ← Thai date regex: parseThaiDate, formatDueDisplay
  subjectDetector.js         ← Thai keyword matching + misspelling support
  telegramFormat.js          ← MarkdownV2 escape: _ * ` [ ~ ( ) |
  constants.js               ← STATUS, dashboard limits, NOTION_PAGE_SIZE
  logger.js                  ← console wrapper with Thai timestamps
  validateEnv.js             ← required: TELEGRAM_TOKEN, NOTION_TOKEN, DATABASE_ID; exits(1) if missing
```

## AI chain
1. `.corrections.json` — user-edited values, zero API calls
2. In-memory cache (1h TTL)
3. Groq models in order: `llama-3.3-70b-versatile` → `mixtral-8x7b-32768` → `llama-3.1-8b-instant`
4. On 429 → auto-switch to next model; on bad JSON → retry once with minimal prompt
5. If all fail → regex fallback (`parseThaiDate` + `detectSubject`)

## Corrections
- Users edit title/subject/date via confirm screen → `setCorrection(rawText, {title, subject, due})` → `.corrections.json`
- Same raw text in future → uses correction directly, skips AI
- Max 500 entries, atomic write (tmp + rename), gitignored

## Notion caching
| Query | TTL | Invalidation trigger |
|-------|-----|---------------------|
| fetchActive | 15s | create / status update / archive |
| fetchDone | 30s | same (prefix `notion:`) |
| fetchUpcoming | 60s | same |

## Google Calendar auth (priority order)
1. `GOOGLE_SERVICE_ACCOUNT_JSON` (inline JSON)
2. `GOOGLE_SA_B64` (base64-encoded JSON)
3. `GOOGLE_KEY_PATH` (default `./credentials.json`)

## User state
- `userState` Map in `index.js`, keyed by Telegram user ID
- 1h TTL (`_timestamp` on every set), stale cleanup every 30 min
- `originalText` stored on ADD → CONFIRM flow, used to save corrections on save

## Testing quirks
- Jest config in `package.json` (`testEnvironment: node`)
- `.mjs` test files are standalone (`node __tests__/dateParser.test.mjs`)
- Cache tests call `beforeEach(() => cacheInvalidate())` for isolation
- TTL tests use real `setTimeout` (timing-sensitive)

## Thai-specific
- `parseThaiDate()`: วันนี้, พรุ่งนี้, มะรืน, อีก X วัน/สัปดาห์/อาทิตย์, วันNAME(หน้า), dd/mm/yy(yy), วันที่ X
- `detectSubject()`: 50+ keywords including misspellings (คนิด→คณิต, อิ๊ง→อังกฤษ, ฟิสิก→ฟิสิกส์)
- Confirm menus and bot messages are in Thai
- Cron timezone: `Asia/Bangkok`
