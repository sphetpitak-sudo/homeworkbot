# ADR-001: Use Notion as the Database

**Status**: Accepted  
**Date**: 2026-06-06

## Context

Homework Bot needs persistent storage for homework items. Options include SQLite, PostgreSQL, Notion API, or JSON files.

## Decision

Use Notion as the primary database via `@notionhq/client`.

## Consequences

**Positive**:
- Zero infrastructure — Notion provides hosting, UI, and API
- Users can view/edit data directly in Notion
- Built-in sorting, filtering, and rich-text support
- Automatic backups via Notion's own infrastructure
- Free tier supports the expected workload (<1000 items)

**Negative**:
- Rate-limited (3 req/s on free tier)
- Latency (~200-500ms per request)
- No transactional guarantees across pages
- No server-side filtering for complex queries (must fetch + filter in code)
- Cache layer required to reduce API calls (15-60s TTLs)
- Notion API changes can break the integration

## Trade-offs

- Chose Notion over SQLite for zero-ops and user visibility
- Chose Notion over PostgreSQL for lower complexity (no migrations, no hosting)
- Trade-off: higher latency vs. lower ops overhead
