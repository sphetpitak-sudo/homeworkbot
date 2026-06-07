const store = new Map();
const MAX_ENTRIES = 10_000;

export function cacheGet(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
        store.delete(key);
        return undefined;
    }
    return entry.value;
}

export function cacheSet(key, value, ttlMs = 30000) {
    if (store.size >= MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { value, expires: Date.now() + ttlMs });
}

export function cacheInvalidate(pattern) {
    if (!pattern) {
        store.clear();
        return;
    }
    for (const key of store.keys()) {
        if (key.startsWith(pattern)) store.delete(key);
    }
}

export function cacheCleanup() {
    const now = Date.now();
    for (const [key, entry] of store) {
        if (now > entry.expires) store.delete(key);
    }
}

/* Auto-cleanup every 5 minutes */
if (!globalThis.__hbCacheCleanupStarted) {
    globalThis.__hbCacheCleanupStarted = true;
    setInterval(() => cacheCleanup(), 5 * 60_000).unref();
}
