import { createJsonStore } from "../utils/jsonStore.js"

const SHARE_TOKENS_FILE = ".share_tokens.json"
export const COLLAB_TOKEN_TTL = 24 * 3600_000 // 24h

const jsonStore = createJsonStore(SHARE_TOKENS_FILE, {})

function pruneExpired() {
    const now = Date.now()
    const data = jsonStore.data
    let changed = false
    for (const [k, v] of Object.entries(data)) {
        if (now - (v._timestamp || 0) > COLLAB_TOKEN_TTL) {
            delete data[k]
            changed = true
        }
    }
    return changed
}

export function setShareToken(token, data) {
    if (data == null) return
    /* Prune expired entries first so a re-set with an expired
       _timestamp (used in tests) is preserved. */
    pruneExpired()
    jsonStore.data[token] = {
        ...data,
        _timestamp: typeof data._timestamp === "number" ? data._timestamp : Date.now(),
    }
    jsonStore.scheduleWrite()
}

export function getShareToken(token) {
    /* Returns the entry if it exists, regardless of TTL — the caller
       is expected to check expiration. Mirrors Map.get semantics. */
    return jsonStore.data[token]
}

export function deleteShareToken(token) {
    if (jsonStore.data[token]) {
        delete jsonStore.data[token]
        jsonStore.scheduleWrite()
    }
}

export function hasShareToken(token) {
    const entry = jsonStore.data[token]
    if (!entry) return false
    if (Date.now() - (entry._timestamp || 0) > COLLAB_TOKEN_TTL) {
        delete jsonStore.data[token]
        jsonStore.scheduleWrite()
        return false
    }
    return true
}

export function sizeShareTokens() {
    pruneExpired()
    return Object.keys(jsonStore.data).length
}

export function clearShareTokens() {
    for (const k of Object.keys(jsonStore.data)) delete jsonStore.data[k]
    jsonStore.scheduleWrite()
}

export function* iterateShareTokens() {
    pruneExpired()
    for (const [k, v] of Object.entries(jsonStore.data)) yield [k, v]
}

export async function flushShareTokens() {
    if (pruneExpired()) jsonStore.scheduleWrite()
    await jsonStore.flush()
}

/* M4: scheduled prune hook called by the index.js boot sequence.
   Runs at startup and can be called periodically to keep the JSON
   file from accumulating expired tokens that are never read. */
export function pruneShareTokens() {
    const changed = pruneExpired()
    if (changed) jsonStore.scheduleWrite()
    return changed
}

export const SHARE_TOKEN_TTL = COLLAB_TOKEN_TTL

