import OpenAI from "openai";
import { logger } from "../utils/logger.js";
import { formatDate, parseThaiDate } from "../utils/dateParser.js";
import { detectSubject, cleanTitle } from "../utils/subjectDetector.js";
import { getAICache, setAICache } from "./aiCache.js";

const MODELS = [
    "typhoon-v2.5-30b-a3b-instruct",
    "typhoon-v2.1-12b-instruct",
];

let client = null;
let currentModelIdx = 0;
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 500;

export function initAI() {
    const key = process.env.TYPHOON_API_KEY?.trim();
    if (!key) {
        logger.warn("TYPHOON_API_KEY not set — AI parsing disabled, using regex fallback");
        return;
    }
    try {
        client = new OpenAI({
            apiKey: key,
            baseURL: "https://api.opentyphoon.ai/v1",
        });
        logger.info(`AI service ready ✅ (${MODELS.length} models, primary: ${MODELS[0]})`);
    } catch (e) {
        logger.error("AI init failed:", e.message);
    }
}

export function isAIReady() {
    return !!client;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function completeWithRetry(systemMsg, userMsg) {
    const startIdx = currentModelIdx;
    for (let attempt = 0; attempt < MODELS.length; attempt++) {
        const idx = (startIdx + attempt) % MODELS.length;
        const model = MODELS[idx];

        const now = Date.now();
        const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestTime));
        if (wait > 0) await sleep(wait);

        try {
            lastRequestTime = Date.now();
            const resp = await client.chat.completions.create({
                model,
                messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: userMsg },
                ],
                temperature: 0.1,
                max_tokens: 150,
            });
            currentModelIdx = idx;
            return { resp, model };
        } catch (err) {
            const isQuota = String(err.status || err.message).includes("429");
            if (isQuota && attempt < MODELS.length - 1) {
                logger.warn(`${model} quota hit, switching to ${MODELS[(idx + 1) % MODELS.length]}...`);
                continue;
            }
            if (isQuota) {
                logger.warn(`All models exhausted — falling back to regex`);
                throw err;
            }
            throw err;
        }
    }
}

function extractJson(raw) {
    if (!raw) return null;
    let cleaned = raw.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    const braceIdx = cleaned.indexOf("{");
    if (braceIdx !== -1) cleaned = cleaned.slice(braceIdx);
    const endBrace = cleaned.lastIndexOf("}");
    if (endBrace !== -1) cleaned = cleaned.slice(0, endBrace + 1);
    try {
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

function nextWeekday(dayNum) {
    const d = new Date();
    let diff = (dayNum - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    d.setDate(d.getDate() + diff);
    return formatDate(d);
}

function buildSystemMsg(today, tomorrow, nextWed, nextFri) {
    return [
        "You are a Thai homework assistant. Extract homework info from Thai messages.",
        `Current date: ${today}.`,
        "",
        "Handle Thai typos/misspellings intelligently.",
        'Examples: "คนิด" → คณิต, "พุท" → พุธ or พรุ่งนี้, "อิ๊ง" → อังกฤษ',
        "",
        "Return ONLY JSON:",
        '  {"title": "short descriptive title (max 50 chars, e.g. แบบฝึกหัดที่ 1, ใบงานเคมี, รายงานวิทย์)", "subject": "subject", "dueDate": "YYYY-MM-DD or null", "priority": "สูง or กลาง or ต่ำ"}',
        "",
        "subject: one of คณิต, ไทย, อังกฤษ, ฟิสิกส์, เคมี, ชีวะ, สังคม, ประวัติ, คอม, ทั่วไป",
        "",
        "priority rules:",
        '- "สูง" if due is urgent (≤3 days), or words like "ด่วน", "สำคัญ", "สอบ", "ส่งพรุ่งนี้"',
        '- "ต่ำ" if due is far (>14 days) or if no due date is mentioned, or words like "งานกลุ่ม", "รายงาน", "สอบปลายภาค"',
        '- "กลาง" for everything else (due 4-14 days)',
        "",
        "Calculate dueDate from the text relative to today's date:",
        `- "พรุ่งนี้" → ${tomorrow}`,
        `- "พุธหน้า" → next Wednesday → ${nextWed}`,
        `- "วันศุกร์" → next Friday → ${nextFri}`,
        `- "อีก X วัน" → today + X`,
        "",
        "Examples:",
        `Input: "คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้"`,
        `Output: {"title":"แบบฝึกหัดหน้า 20","subject":"คณิต","dueDate":"${tomorrow}","priority":"สูง"}`,
        `Input: "สอบคนิด พุทหน้า"`,
        `Output: {"title":"สอบคณิต","subject":"คณิต","dueDate":"${nextWed}","priority":"สูง"}`,
        `Input: "รายงานอังกฤษส่งอาทิตย์หน้า วันศุกร์"`,
        `Output: {"title":"รายงานอังกฤษ","subject":"อังกฤษ","dueDate":"${nextFri}","priority":"กลาง"}`,
        `Input: "งานกลุ่มสังคม อีก 2 อาทิตย์"`,
        `Output: {"title":"งานกลุ่มสังคม","subject":"สังคม","dueDate":"...","priority":"ต่ำ"}`,
        "",
        "IMPORTANT: Always output a subject if text relates to homework/exam.",
    ].join("\n");
}

export async function parseHomework(text, opts = {}) {
    if (!client) return null;
    if (!opts.skipLengthCheck && text.length >= 300) return null;

    const cached = getAICache(text);
    if (cached) {
        logger.info(`AI cache hit: "${text.slice(0, 30)}..." (${cached.source})`);
        return {
            title: cached.title || cleanTitle(text) || text,
            subject: cached.subject && cached.subject !== "ทั่วไป" ? cached.subject : detectSubject(text),
            dueDate: cached.dueDate || parseThaiDate(text),
            priority: cached.priority,
            model: cached.source,
        };
    }

    const today = formatDate(new Date());
    const tomorrow = formatDate(new Date(Date.now() + 86400000));
    const nextWed = nextWeekday(3);
    const nextFri = nextWeekday(5);
    const systemMsg = buildSystemMsg(today, tomorrow, nextWed, nextFri);

    try {
        const { resp, model } = await completeWithRetry(systemMsg, text);
        const raw = resp.choices[0]?.message?.content;
        let parsed = extractJson(raw);

        if (!parsed) {
            logger.warn(`${model} bad format, retrying once...`);
            const { resp: resp2 } = await completeWithRetry(
                "Extract homework as JSON: {\"title\":...,\"subject\":...,\"dueDate\":...}",
                text,
            );
            const raw2 = resp2.choices[0]?.message?.content;
            parsed = extractJson(raw2);
        }

        if (!parsed) {
            logger.warn("AI returned unparseable response, falling back to regex");
            return null;
        }

        const PRIORITY_MAP = { สูง: "🔴 สูง", กลาง: "🟡 กลาง", ต่ำ: "🟢 ต่ำ" };
        const priority = PRIORITY_MAP[parsed.priority] || "🟡 กลาง";

        const result = {
            title: parsed.title || cleanTitle(text) || text,
            subject: parsed.subject && parsed.subject !== "ทั่วไป" ? parsed.subject : detectSubject(text),
            dueDate: parsed.dueDate || parseThaiDate(text),
            priority,
            model,
        };

        setAICache(text, result);
        return result;
    } catch (err) {
        const msg = String(err.message || err).slice(0, 120);
        logger.error("AI error:", msg);
        return null;
    }
}
