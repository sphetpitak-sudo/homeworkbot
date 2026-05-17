const store = new Map();

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
