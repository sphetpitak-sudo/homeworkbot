# ADR-004: In-Memory TTL Cache (No Redis)

**Status**: Accepted  
**Date**: 2026-06-06

## Context

Notion API calls are slow (200-500ms) and rate-limited. Need a cache layer to reduce latency and API consumption.

## Decision

Use a simple in-memory `Map`-based cache with TTL expiry:
- `cacheGet(key)` — returns value or undefined (auto-expire)
- `cacheSet(key, value, ttlMs)` — stores with TTL
- `cacheInvalidate(pattern)` — clears by prefix
- `cacheCleanup()` — periodic stale entry removal
- 10,000-entry LRU cap prevents memory leak

## Consequences

**Positive**:
- Zero dependencies — pure JS, works everywhere
- Sub-microsecond reads (vs 200-500ms Notion API calls)
- Pattern-based invalidation is simple and correct
- TTLs are configurable per query type (active:30s, done:30s, upcoming:60s)

**Negative**:
- Cache is lost on restart (acceptable — TTLs are short)
- Not shared across processes (single-instance only)
- No redundancy — cache miss = Notion API call
- LRU eviction is simplistic (Map insertion order, not true LRU)

## Cache Configuration

| Query       | TTL  | Invalidation Trigger |
|-------------|------|----------------------|
| fetchActive | 30s  | Any write operation  |
| fetchDone   | 30s  | Any write operation  |
| fetchUpcoming| 60s | Any write operation  |
| pageCache   | 5s   | Per-page write       |
| AI cache    | 1h   | None (time-based)    |

## Trade-offs

- Chose in-memory over Redis to avoid infrastructure dependency
- Chose Map over `lru-cache` npm package to avoid dependency (Map inserts O(1) at cost of non-LRU eviction)
- 10K cap is generous: real workload is <500 entries
