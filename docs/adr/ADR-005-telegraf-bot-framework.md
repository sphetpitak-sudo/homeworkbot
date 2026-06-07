# ADR-005: Telegraf for Telegram Bot

**Status**: Accepted  
**Date**: 2026-06-06

## Context

Need a Telegram Bot framework that supports inline keyboards, callback queries, media, and graceful shutdown.

## Decision

Use Telegraf v4 (`telegraf@^4.16.3`).

## Consequences

**Positive**:
- Mature, well-maintained framework
- First-class support for inline keyboards and callback queries
- Built-in `bot.launch()` with graceful shutdown (`bot.stop()`)
- Middleware system for cross-cutting concerns
- TypeScript definitions available

**Negative**:
- v5 is in development with breaking changes — stuck on v4
- Long-polling only (no webhook support configured — simplifies deployment)
- No built-in rate limiting for user interactions (custom solution)
- Session/scene system not used (custom userState Map instead)

## Trade-offs

- Chose Telegraf over `node-telegram-bot-api` for better callback query and inline keyboard support
- Chose long-polling over webhook to avoid HTTPS certificate management
- Chose custom userState over Telegraf sessions for simpler TTL-based expiry
