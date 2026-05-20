import fs from "fs";
import { cacheGet, cacheSet } from "./cache.js";
import { logger } from "../utils/logger.js";

const CORRECTIONS_FILE = ".corrections.json";
const AI_CACHE_TTL = 3600_000;
const MAX_CORRECTIONS = 500;
const DEBOUNCE_MS = 5000;

let corrections = {};
let debounceTimer = null;
let saveResolve = null;  // for flushing

/* ── concurrency guard: serializes writeFile calls ── */
let writeInProgress = false;
let pendingWrite = false;

function doWrite() {
    if (writeInProgress) { pendingWrite = true; return; }
    writeInProgress = true;
    pendingWrite = false;
    const tmp = CORRECTIONS_FILE + ".tmp";
    const data = JSON.stringify(corrections, null, 2);
    fs.promises.writeFile(tmp, data)
        .then(() => fs.promises.rename(tmp, CORRECTIONS_FILE))
        .then(() => {
            writeInProgress = false;
            if (pendingWrite) { doWrite(); return; }
            if (saveResolve) { saveResolve(); saveResolve = null; }
        })
        .catch((e) => {
            writeInProgress = false;
            logger.warn("Failed to save corrections:", e.message);
            if (pendingWrite) { doWrite(); return; }
            if (saveResolve) { saveResolve(); saveResolve = null; }
        });
}

function loadCorrections() {
    try {
        if (fs.existsSync(CORRECTIONS_FILE)) {
            const raw = fs.readFileSync(CORRECTIONS_FILE, "utf-8");
            corrections = JSON.parse(raw);
            logger.info(`Loaded ${Object.keys(corrections).length} corrections`);
        }
    } catch {
        corrections = {};
    }
}

function debouncedSave() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; doWrite(); }, DEBOUNCE_MS);
}

export async function flushCorrections() {
    for (;;) {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
            doWrite();
        }
        if (!writeInProgress && !pendingWrite) break;
        await new Promise((resolve) => {
            saveResolve = resolve;
        });
    }
}

export function getCorrection(key) {
    const match = corrections[key];
    if (match) return { ...match, source: "correction" };
    return null;
}

/**
 * Saves a user correction for the given rawText key.
 * Thread safety: last-writer-wins for concurrent calls with the same key.
 * This is intentional — corrections are low-stakes and rarely concurrent.
 * The debounced write ensures the final state is always persisted.
 */
export function setCorrection(text, pending) {
    if (!text) return;
    const key = text.trim().toLowerCase();
    if (!key) return;
    corrections[key] = {
        title: pending.title || null,
        subject: pending.subject || null,
        dueDate: pending.due || null,
        priority: pending.priority || null,
    };
    const keys = Object.keys(corrections);
    if (keys.length > MAX_CORRECTIONS) {
        const toDelete = keys.slice(0, keys.length - MAX_CORRECTIONS);
        for (const k of toDelete) delete corrections[k];
    }
    debouncedSave();
    cacheSet(`ai:${key}`, corrections[key], AI_CACHE_TTL);
}

export function getAICache(text) {
    const key = text.trim().toLowerCase();
    const correction = getCorrection(key);
    if (correction) return correction;
    const cached = cacheGet(`ai:${key}`);
    if (cached) return { ...cached, source: "cache" };
    return null;
}

export function setAICache(text, result) {
    const key = text.trim().toLowerCase();
    cacheSet(`ai:${key}`, {
        title: result.title || null,
        subject: result.subject || null,
        dueDate: result.dueDate || null,
        priority: result.priority || null,
    }, AI_CACHE_TTL);
}

loadCorrections();
