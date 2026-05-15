import fs from "fs";
import { cacheGet, cacheSet } from "./cache.js";
import { logger } from "../utils/logger.js";

const CORRECTIONS_FILE = ".corrections.json";
const AI_CACHE_TTL = 3600_000;
const MAX_CORRECTIONS = 500;

let corrections = {};

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

function saveCorrections() {
    try {
        const tmp = CORRECTIONS_FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(corrections, null, 2));
        fs.renameSync(tmp, CORRECTIONS_FILE);
    } catch (e) {
        logger.warn("Failed to save corrections:", e.message);
    }
}

export function getCorrection(text) {
    const key = text.trim().toLowerCase();
    const match = corrections[key];
    if (match) return { ...match, source: "correction" };
    return null;
}

export function setCorrection(text, pending) {
    const key = text.trim().toLowerCase();
    corrections[key] = {
        title: pending.title || null,
        subject: pending.subject || null,
        dueDate: pending.due || null,
    };
    const entries = Object.entries(corrections);
    if (entries.length > MAX_CORRECTIONS) {
        corrections = Object.fromEntries(entries.slice(-MAX_CORRECTIONS));
    }
    saveCorrections();
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
        dueDate: result.due || null,
    }, AI_CACHE_TTL);
}

loadCorrections();
