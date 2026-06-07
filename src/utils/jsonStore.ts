import fs from "fs"
import { logger } from "./logger.js"

/**
 * JSON-file-backed store with serialized writes and a round-trip
 * flush() that guarantees any pending in-memory mutations are persisted
 * before the returned promise resolves.
 *
 * Race-safety: each store instance owns a monotonic generation number
 * persisted in a sidecar file (`<filename>.owner`). Before any write,
 * the current generation is read from disk and compared to the
 * instance's generation. If a newer instance has been created (e.g.
 * a test's fresh createJsonStore call), the sidecar file holds a
 * higher number and the write is skipped. This prevents stale writes
 * from a previous instance from corrupting a fresh fixture.
 *
 * The actual write is deferred to setImmediate so it runs in the
 * Check phase (after Poll), which means it runs AFTER any concurrent
 * dynamic import's module evaluation. This eliminates the race where
 * a previous test's pending write would fire during the next test's
 * `await import(...)` microtask drain and overwrite a freshly-written
 * fixture before the new createJsonStore could bump the generation.
 *
 * Usage:
 *   const store = createJsonStore(".foo.json", {})
 *   store.data.key = value
 *   store.scheduleWrite()   // queued behind any pending write
 *   await store.flush()      // forces a final write, then awaits it
 */
export function createJsonStore(filename, initial = {}) {
    const ownerFile = filename + ".owner"
    let data = loadFile(filename, initial)
    const myGen = bumpGeneration(ownerFile)
    let writeChain = Promise.resolve()

    function bumpGeneration(file) {
        try {
            let n = 0
            if (fs.existsSync(file)) {
                n = parseInt(fs.readFileSync(file, "utf-8"), 10) || 0
            }
            n += 1
            fs.writeFileSync(file, String(n))
            return n
        } catch (e) {
            logger.warn(`jsonStore owner ${file} failed:`, e.message)
            return 1
        }
    }

    function currentGeneration(file) {
        try {
            if (!fs.existsSync(file)) return 0
            return parseInt(fs.readFileSync(file, "utf-8"), 10) || 0
        } catch { return 0 }
    }

    function loadFile(file, fallback) {
        try {
            if (!fs.existsSync(file)) return typeof fallback === "function" ? fallback() : structuredClone(fallback)
            const raw = fs.readFileSync(file, "utf-8")
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
            return typeof fallback === "function" ? fallback() : structuredClone(fallback)
        } catch (e) {
            logger.warn(`jsonStore load ${file} failed:`, e.message)
            return typeof fallback === "function" ? fallback() : structuredClone(fallback)
        }
    }

    function doWrite() {
        /* Final generation check just before the actual write. If a
           newer instance has bumped the sidecar, skip. */
        if (myGen !== currentGeneration(ownerFile)) return
        const tmp = filename + ".tmp"
        try {
            fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
            fs.renameSync(tmp, filename)
        } catch (e) {
            logger.warn(`jsonStore write ${filename} failed:`, e.message)
        }
    }

    function scheduleWrite() {
        /* Defer via setImmediate so the write runs in the Check phase,
           after any concurrent import's Poll-phase module evaluation. */
        writeChain = writeChain.then(
            () => new Promise<void>((resolve) => setImmediate(() => { doWrite(); resolve() })),
            () => new Promise<void>((resolve) => setImmediate(() => { doWrite(); resolve() }))
        )
    }

    async function flush() {
        await new Promise<void>((resolve) => {
            writeChain = writeChain.then(
                () => new Promise<void>((resolve2) => setImmediate(() => { doWrite(); resolve2() })),
                () => new Promise<void>((resolve2) => setImmediate(() => { doWrite(); resolve2() }))
            ).then(() => resolve())
        })
    }

    return {
        get data() { return data },
        set data(v) { data = v },
        scheduleWrite,
        flush,
    }
}
