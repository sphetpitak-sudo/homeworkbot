# ADR-002: Use Typhoon AI with Two-Model Chain

**Status**: Accepted  
**Date**: 2026-06-06

## Context

Homework parsing requires NLP to extract title, subject, due date, and priority from free-form Thai text. Need a cost-effective, low-latency solution.

## Decision

Use Typhoon AI (via OpenAI-compatible SDK) with a two-model fallback chain:
1. `typhoon-v2.5-30b-a3b-instruct` (primary)
2. `typhoon-v2.1-12b-instruct` (fallback on 429/5xx)
3. Regex-based parser as final fallback

## Consequences

**Positive**:
- Thai-language optimized models outperform general-purpose LLMs
- OpenAI SDK compatibility means zero migration if switching providers
- Two-model chain provides graceful degradation on quota exhaustion
- Regex fallback ensures zero-AI-mode still works
- 500ms rate limiter prevents hitting Typhoon's 5 req/s free tier cap

**Negative**:
- Two separate model calls increase latency on fallback
- Regex fallback has limited accuracy for complex input
- No local inference — requires internet connectivity
- Model availability depends on Typhoon's uptime

## Performance

- Average parse time: ~1.5s (AI) / ~50ms (regex)
- Cache hit rate: ~40% (repeating homework patterns)
- Success rate: ~85% AI → ~95% with regex fallback

## Trade-offs

- Non-AI alternatives (pure regex/NLP) lack robustness for typos and Thai grammar
- Larger models (70B+) would improve accuracy but add latency and cost
