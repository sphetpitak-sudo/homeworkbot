# Changelog

## 1.1.0 (2026-06-07)

### i18n Conversion (Completed)
- `actionHandlers.js`: Converted all remaining inline Thai strings to `t()` calls
- Added 17 new i18n keys to `en.js` / `th.js` (review, smartbook, pomodoro, collab, action namespaces)

### Refactoring
- Removed deprecated `askHint` alias from `hintService.js`
- Removed unused `setLang()` from `i18n.js`
- Removed dead `FOCUS_NEXT` handler comment in `actionHandlers.js`

### Dependencies
- Updated `vite` from `^5.4.0` to `^5.4.14`
- Pinned `jest` to `^29.7.0`

### CI/CD
- Added `npm audit` step to GitHub Actions
- Added `npm run build:web` step to verify Vite builds

### Logging
- Added `LOG_LEVEL` env var filtering (`debug`/`info`/`warn`/`error`)

### Error Handling
- Made `NOTION_MAX_RETRIES` configurable via env var
- Added jitter (100-300ms) between batch operations in `autoArchive` and `autoUpdatePriority`

### Caching
- Increased `fetchActive` TTL from 15s to 30s
- Added 10,000-entry size cap with LRU eviction to shared cache

### Documentation
- Added `CHANGELOG.md`
- Updated `AGENTS.md` i18n progress table

### Security
- Guarded `FAKE_DATA` behind `import.meta.env.PROD` check (production builds skip loading demo data)

## 1.0.0 (2026-06-06)

- Initial release
