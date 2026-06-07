# ADR-003: JSON File Persistence with Atomic Writes

**Status**: Accepted  
**Date**: 2026-06-06

## Context

Badges, pomodoro sessions, share tokens, and user corrections need persistence across restarts. Data volume is small (<10,000 entries, <5MB total).

## Decision

Use a custom `jsonStore` utility with atomic file writes:
- Write to temp file → `fs.rename()` (atomic on same filesystem)
- Writes deferred to `setImmediate` (Check phase of event loop)
- Per-file generation sidecar to prevent stale writes across jest resets
- `flush()` returns a promise resolving after disk write

## Consequences

**Positive**:
- Zero infrastructure — no database daemon needed
- Atomic writes prevent corruption on crash (tmp + rename)
- Deferred writes batch concurrent mutations into a single disk write
- Flushable for graceful shutdown (data loss only within the defer window)
- Human-readable for debugging

**Negative**:
- Not suitable for >10MB datasets
- No concurrent read/write safety across processes
- File size grows linearly with entries (no compaction)
- No query capability — must load entire file into memory

## Trade-offs

- Chose JSON over SQLite to avoid native module dependencies and build complexity
- Chose custom `jsonStore` over `better-json-file` or `lowdb` for control over atomicity guarantees
- 500-entry cap on corrections prevents unbounded file growth
