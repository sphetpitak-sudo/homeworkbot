import { logger } from "../utils/logger.js";
import { formatDate, parseThaiDate } from "../utils/dateParser.js";
import { detectSubject, cleanTitle, canonSubj } from "../utils/subjectDetector.js";
import { inferAndParseTags } from "../utils/tagDetector.js";
import { getAICache, setAICache } from "./aiCache.js";
import { getClient, initAI as modelInit, callWithModelFallback } from "./modelClient.js";

export function initAI() {
    return modelInit();
}

export function isAIReady() {
    return !!getClient();
}

/**
 * Extract JSON from AI response text.
 * Handles code fences, trims content, and finds the matching closing brace
 * using brace-depth tracking instead of lastIndexOf (which can fail if
 * "}" appears inside a string value).
 */
function extractJson(raw) {
    if (!raw) return null;
    let cleaned = raw.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    const braceIdx = cleaned.indexOf("{");
    if (braceIdx === -1) return null;
    cleaned = cleaned.slice(braceIdx);

    // Find matching closing brace by tracking depth, ignoring braces inside strings
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let endIdx = -1;
    for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (ch === "\\" && inString) {
            escapeNext = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (ch === "{") {
            depth++;
        } else if (ch === "}") {
            depth--;
            if (depth === 0) {
                endIdx = i;
                break;
            }
        }
    }

    if (endIdx === -1) return null;
    cleaned = cleaned.slice(0, endIdx + 1);

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
        "subject: one of: Math, Thai, English, Physics, Chemistry, Biology, Social Studies, History, Computer, Health, General (output in English)",
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
        `Output: {"title":"แบบฝึกหัดหน้า 20","subject":"Math","dueDate":"${tomorrow}","priority":"สูง"}`,
        `Input: "สอบคนิด พุทหน้า"`,
        `Output: {"title":"สอบคณิต","subject":"Math","dueDate":"${nextWed}","priority":"สูง"}`,
        `Input: "รายงานอังกฤษส่งอาทิตย์หน้า วันศุกร์"`,
        `Output: {"title":"รายงานอังกฤษ","subject":"English","dueDate":"${nextFri}","priority":"กลาง"}`,
        `Input: "งานกลุ่มสังคม อีก 2 อาทิตย์"`,
        `Output: {"title":"งานกลุ่มสังคม","subject":"Social Studies","dueDate":"...","priority":"ต่ำ"}`,
        `Input: "ท่องอาขยานบทที่ 5"`,
        `Output: {"title":"ท่องอาขยานบทที่ 5","subject":"Thai","dueDate":null,"priority":"ต่ำ"}`,
        "",
        "IMPORTANT: Always output a subject if text relates to homework/exam.",
    ].join("\n");
}

export async function parseHomework(text, opts = {}) {
    if (!getClient()) return null;

    const cached = getAICache(text);
    if (cached) {
        logger.info(`AI cache hit: "${text.slice(0, 30)}..." (${cached.source})`);
        return {
            title: cached.title || cleanTitle(text) || text,
            subject: canonSubj(cached.subject && cached.subject !== "ทั่วไป" ? cached.subject : detectSubject(text)),
            dueDate: cached.dueDate || parseThaiDate(text),
            priority: cached.priority,
            model: cached.source,
            tags: inferAndParseTags(text, cached.priority),
        };
    }

    if (!opts.skipLengthCheck && text.length >= 300) return null;

    const today = formatDate(new Date());
    const tomorrow = formatDate(new Date(Date.now() + 86400000));
    const nextWed = nextWeekday(3);
    const nextFri = nextWeekday(5);
    const systemMsg = buildSystemMsg(today, tomorrow, nextWed, nextFri);

    try {
        const fallbackResult = await callWithModelFallback({ systemMsg, userMsg: text });
        if (!fallbackResult) return null;
        const { resp, model } = fallbackResult;
        const raw = resp.choices[0]?.message?.content;
        let parsed = extractJson(raw);

        if (!parsed) {
            logger.warn(`${model} bad format, retrying once...`);
            const retry = await callWithModelFallback({ systemMsg: "Extract homework as JSON: {\"title\":...,\"subject\":...,\"dueDate\":...}", userMsg: text });
            if (!retry) return null;
            const raw2 = retry.resp.choices[0]?.message?.content;
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
            subject: canonSubj(parsed.subject && parsed.subject !== "ทั่วไป" ? parsed.subject : detectSubject(text)),
            dueDate: parsed.dueDate || parseThaiDate(text),
            priority,
            model,
            tags: inferAndParseTags(text, priority),
        };

        setAICache(text, result);
        return result;
    } catch (err) {
        const msg = String(err.message || err).slice(0, 120);
        logger.error("AI error:", msg);
        return null;
    }
}
