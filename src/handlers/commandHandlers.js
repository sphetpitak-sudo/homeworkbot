import { Markup } from "telegraf";
import { parseThaiDate, formatDueDisplay, isPossiblyLastMonth } from "../utils/dateParser.js";
import { updateStatus } from "../services/notionService.js";
import {
    detectSubject,
    cleanTitle,
    subjectEmoji,
} from "../utils/subjectDetector.js";
import { parseHomework, isAIReady } from "../services/aiService.js";
import { isQaReady, askAI } from "../services/qaService.js";
import { recalcPriority } from "../utils/priority.js";
import { inferAndParseTags } from "../utils/tagDetector.js";
import { getDashboardToken } from "../web/server.js";
import { logger } from "../utils/logger.js";
import {
    escapeMarkdown,
    safeBold,
    safeItalic,
    safeCode,
} from "../utils/telegramFormat.js";


const WEB_URL = process.env.WEB_URL || "";

export const mainMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback("➕ เพิ่มการบ้าน", "ADD"),
        Markup.button.callback("📋 งานค้าง", "LIST_ACTIVE"),
    ],
    [
        Markup.button.callback("✅ งานเสร็จ", "LIST_DONE"),
        Markup.button.callback("📊 Dashboard", "DASHBOARD"),
    ],
    [
        Markup.button.callback("🤖 ถาม AI", "ASK_AI"),
    ],
    ...(WEB_URL
        ? [[Markup.button.url("🌐 Web Dashboard", `${WEB_URL}?token=${getDashboardToken()}`)]]
        : []),
]);

export const cancelMenu = Markup.inlineKeyboard([
    [Markup.button.callback("❌ ยกเลิก", "CANCEL")],
]);

export const compactConfirmMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback("✅ บันทึก", "CONFIRM_SAVE"),
        Markup.button.callback("✏️ แก้ไข", "CONFIRM_EDIT"),
    ],
    [
        Markup.button.callback("📚 วิชา", "EDIT_SUBJECT"),
        Markup.button.callback("📅 วันที่", "EDIT_DATE"),
    ],
    [
        Markup.button.callback("🎯 เพิ่มเติม ▼", "MORE_OPTIONS"),
        Markup.button.callback("❌ ยกเลิก", "CANCEL"),
    ],
]);

export const moreOptionsMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback("🎯 สำคัญ", "EDIT_PRIORITY"),
        Markup.button.callback("🏷️ Tags", "EDIT_TAGS"),
    ],
    [
        Markup.button.callback("🔙 กลับ", "BACK_TO_CONFIRM"),
        Markup.button.callback("❌ ยกเลิก", "CANCEL"),
    ],
]);

export function errorWithRetry(message, retryAction) {
    return {
        text: `❌ *${escapeMarkdown(message)}*\nกรุณาลองใหม่`,
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [[
                { text: "🔁 ลองอีกครั้ง", callback_data: retryAction },
                { text: "🏠 เมนูหลัก", callback_data: "HOME" },
            ]],
        },
    };
}

function isUnambiguous(parsed, rawText) {
    if (parsed.parseSource !== "ai") return false;
    const regexSubject = detectSubject(rawText);
    if (!regexSubject || regexSubject === "ทั่วไป") return false;
    return parsed.subject === regexSubject;
}

/**
 * Build a markdown preview string for the user to review before saving.
 * Shows subject, title, due date, priority, tags, and an AI/regex source badge.
 */
export function buildHomeworkPreview(parsed) {
    const subject = parsed?.subject || "ทั่วไป";
    const title = parsed?.title || "ไม่มีชื่อ";
    const due = parsed?.due ? formatDueDisplay(parsed.due) : "ไม่มีกำหนดส่ง 📅";
    const priority = parsed?.priority || "🟡 กลาง";
    const tags = parsed?.tags?.length ? parsed.tags.join("  ") : null;
    const badge = parsed.parseSource === "ai"
        ? `\n🤖 ${safeItalic("AI ช่วยตรวจจับ — ถ้าไม่ตรงแก้ไขได้ด้านล่าง")}`
        : parsed.parseSource === "regex"
        ? `\n📝 ${safeItalic("ตรวจจับอัตโนมัติ — กรุณาตรวจสอบความถูกต้อง")}`
        : "";
    let msg =
        `${subjectEmoji(subject)} ${safeBold(title)}\n` +
        `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  📅 ${escapeMarkdown(due)}`;
    if (tags) msg += `\n🏷️ ${tags}`;
    if (badge) msg += badge;
    return msg;
}

function buildWelcomeMessage(name) {
    return (
        `👋 ${safeBold("สวัสดี " + name + "!")}\n` +
        `🤖 พิมพ์การบ้านมาที่แชทเลย\n` +
        `${safeItalic("เช่น")} ${safeCode("คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้")}\n` +
        `หรือกด /menu เพื่อดูคำสั่งอื่นๆ`
    );
}

function buildMenuMessage() {
    return (
        `🏠 ${safeBold("เมนูหลัก")}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `▸ ${safeBold("➕ เพิ่มการบ้าน")} — เพิ่มงานใหม่\n` +
        `▸ ${safeBold("📋 งานค้าง")} — ดูงานที่ยังไม่เสร็จ\n` +
        `▸ ${safeBold("✅ งานเสร็จ")} — ดูงานที่ทำแล้ว\n` +
        `▸ ${safeBold("📊 Dashboard")} — สถิติภาพรวม\n` +
        `▸ ${safeBold("🤖 ถาม AI")} — ถามเกี่ยวกับงาน\n` +
        `━━━━━━━━━━━━━━━━━━`
    );
}

/**
 * Show a confirmation message with the parsed homework details and action buttons.
 * Includes a date ambiguity hint if the parsed date might refer to the wrong month.
 *
 * @param {import('telegraf').Context} ctx - Telegraf context
 * @param {object} pending - Parsed homework data { title, subject, due, priority, rawText, tags }
 * @param {string} [parseSource=""] - Source of parsing ("ai" or "regex")
 */
export function showConfirm(ctx, pending, parseSource = "") {
    const srcPending = { ...pending, parseSource: parseSource || pending?.parseSource };
    let dateHint = "";
    if (pending?.due && isPossiblyLastMonth(pending.due, pending?.rawText)) {
        dateHint = "📅 ตีความเป็นเดือนหน้า — ถ้าต้องการเดือนนี้ให้แก้วันที่\n";
    }
    return ctx.reply(
        `📝 ${safeBold("ตรวจสอบก่อนบันทึก")}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `${buildHomeworkPreview(srcPending)}\n` +
            `${dateHint ? `━━━━━━━━━━━━━━━━━━━━\n${dateHint}` : ""}` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `✅ กดบันทึก หรือ ✏️ แก้ไขส่วนที่ต้องการ`,
        {
            parse_mode: "Markdown",
            ...compactConfirmMenu,
        },
    );
}

/**
 * Shorten a title to fit display limits.
 * - Takes only the first line if multi-line.
 * - If > 80 chars, tries to extract a meaningful prefix (แบบฝึกหัด, ใบงาน, etc.)
 *   and appends the subject in parentheses.
 * - Otherwise truncates with "..." and appends subject.
 */
function shortenTitle(title, subject = "") {
    if (!title) return "";
    const firstLine = title.split("\n")[0].trim();
    if (!firstLine) return subject || "...";
    if (firstLine.length <= 80) return firstLine;

    const prefixMatch = firstLine.match(
        /^(แบบฝึกหัด[^\s\d]*\s*\d*|ใบงาน[^\s]*|ข้อสอบ[^\s]*|แบบทดสอบ[^\s]*|รายงาน[^\s]*|สอบ[^\s]*|โครงการ[^\s]*)/,
    );
    if (prefixMatch) {
        const p = prefixMatch[1].trim();
        return subject ? `${p} (${subject})` : p;
    }

    const truncated = firstLine.slice(0, 45) + "...";
    return subject ? `${truncated} (${subject})` : truncated;
}

async function parseText(text) {
    const aiResult = isAIReady() ? await parseHomework(text) : null;
    if (aiResult) {
        const hasDue = !!aiResult.dueDate;
        const subject = aiResult.subject || detectSubject(text);
        return {
            due: aiResult.dueDate,
            subject,
            title: shortenTitle(aiResult.title || cleanTitle(text) || text, subject),
            priority: hasDue ? (aiResult.priority || "🟡 กลาง") : "🟢 ต่ำ",
            usedAI: true,
            model: aiResult.model || "",
            tags: aiResult.tags,
            parseSource: "ai",
        };
    }
    const due = parseThaiDate(text);
    const subject = detectSubject(text);
    const priority = due ? "🟡 กลาง" : "🟢 ต่ำ";
    return {
        due,
        subject,
        title: shortenTitle(cleanTitle(text) || text, subject),
        priority,
        usedAI: false,
        model: "",
        tags: inferAndParseTags(text, priority),
        parseSource: "regex",
    };
}

export function registerCommandHandlers(bot, userState) {
    bot.start((ctx) => {
        const name = escapeMarkdown(ctx.from?.first_name || "เพื่อน");
        ctx.reply(buildWelcomeMessage(name), {
            parse_mode: "Markdown",
            ...mainMenu,
        });
    });

    bot.command("menu", (ctx) =>
        ctx.reply(buildMenuMessage(), {
            parse_mode: "Markdown",
            ...mainMenu,
        }),
    );

    bot.command("ask", async (ctx) => {
        if (!isQaReady()) {
            return ctx.reply("⚠️ ยังไม่ได้ตั้งค่า TYPHOON_API_KEY", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
        userState.set(ctx.from.id, { mode: "ASK_AI", _timestamp: Date.now() });
        return ctx.reply(
            `🤖 ${safeBold("ถามเกี่ยวกับการบ้าน")}\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `พิมพ์คำถาม เช่น\n` +
                `• "งานคณิตส่งวันไหนบ้าง"\n` +
                `• "มีงานอะไรที่ยังไม่ทำ"\n` +
                `• "อาทิตย์นี้มีงานกี่ชิ้น"\n\n` +
                `พิมพ์คำถามเลย หรือกดยกเลิก\n` +
                `━━━━━━━━━━━━━━━━━━`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    bot.command("help", (ctx) =>
        ctx.reply(
            `🆘 ${safeBold("วิธีใช้งาน")}\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `๑. พิมพ์การบ้าน เช่น ${safeCode("คณิต หน้า 45 พรุ่งนี้")}\n` +
                `๒. ตรวจสอบความถูกต้อง → กดบันทึก\n` +
                `๓. จัดการงานได้ที่ /menu\n\n` +
                `━━━━━━━━━━━━━━━━━━`,
            {
                parse_mode: "Markdown",
                ...mainMenu,
            },
        ),
    );

    bot.command("undo", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);
        if (!state?._lastAction?._timestamp || Date.now() - state._lastAction._timestamp > 30000) {
            return ctx.reply("⏱️ ไม่มีการกระทำล่าสุดที่ยกเลิกได้", { parse_mode: "Markdown" });
        }
        const { type, pageId, from, to } = state._lastAction;
        if (type === "STATUS_CHANGE") {
            try {
                await updateStatus(pageId, from);
                delete state._lastAction;
                userState.set(uid, state);
                return ctx.reply(`↩️ ${safeBold("ยกเลิกแล้ว")} — คืนค่าเป็น "${from}" เรียบร้อย`, {
                    parse_mode: "Markdown",
                    ...mainMenu,
                });
            } catch (err) {
                logger.error("UNDO:", err);
                return ctx.reply(`❌ ${safeBold("ยกเลิกไม่ได้")} — กรุณาลองอีกครั้ง`, {
                    parse_mode: "Markdown",
                    ...mainMenu,
                });
            }
        }
        return ctx.reply("⏱️ ไม่สามารถยกเลิกการกระทำนี้ได้", { parse_mode: "Markdown" });
    });

    bot.action("HOME", async (ctx) => {
        userState.delete(ctx.from.id);
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        try {
            await ctx.editMessageText(buildMenuMessage(), {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        } catch {
            await ctx.reply(buildMenuMessage(), {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    });

    const MAX_TEXT_LENGTH = 4000;

    bot.on("text", async (ctx) => {
        const text = ctx.message.text.trim();
        if (!text) return;

        // Unknown command → friendly hint
        if (text.startsWith("/")) {
            return ctx.reply(
                `🤔 ไม่เข้าใจคำสั่ง "${safeCode(text.split(" ")[0])}"\n` +
                `ลองพิมพ์การบ้านมาได้เลย หรือกด /menu`,
                { parse_mode: "Markdown" },
            );
        }
        if (text.length > MAX_TEXT_LENGTH) {
            return ctx.reply(`⚠️ ${safeBold("ข้อความยาวเกินไป")}\n\nสูงสุด ${MAX_TEXT_LENGTH} ตัวอักษร`, {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }

        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (state?.mode === "EDIT_TITLE") {
            if (text.length > MAX_TEXT_LENGTH) {
                return ctx.reply(`⚠️ ${safeBold("ชื่อยาวเกินไป")}\n\nสูงสุด ${MAX_TEXT_LENGTH} ตัวอักษร`, {
                    parse_mode: "Markdown",
                    ...cancelMenu,
                });
            }
            const pending = { ...state.pending, title: text };
            userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
            return showConfirm(ctx, pending);
        }

        if (state?.mode === "EDIT_SUBJECT") {
            if (text.length > MAX_TEXT_LENGTH) {
                return ctx.reply(`⚠️ ${safeBold("ชื่อวิชายาวเกินไป")}\n\nสูงสุด ${MAX_TEXT_LENGTH} ตัวอักษร`, {
                    parse_mode: "Markdown",
                    ...cancelMenu,
                });
            }
            const pending = { ...state.pending, subject: text };
            userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
            return showConfirm(ctx, pending);
        }

        if (state?.mode === "EDIT_DATE") {
            const due = parseThaiDate(text);
            if (!due) {
                return ctx.reply(
                    `❌ ${safeBold("รูปแบบวันที่ไม่ถูกต้อง")}\n` +
                        `กรุณาพิมพ์วันที่ที่ต้องการ เช่น "พรุ่งนี้", "15/06/2026", "อีก 3 วัน", "พุธหน้า"`,
                    { parse_mode: "Markdown", ...cancelMenu },
                );
            }
            const pending = {
                ...state.pending, due,
                priority: state.pending._manualPriority ? state.pending.priority : recalcPriority(due),
            };
            userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
            return showConfirm(ctx, pending);
        }

        if (state?.mode === "EDIT_TAGS") {
            const raw = text.trim();
            let tags = [];
            if (raw !== "-") {
                tags = raw
                    .replace(/#/g, "")
                    .split(/[\s,]+/)
                    .map(t => t.trim())
                    .filter(Boolean);
            }
            const pending = { ...state.pending, tags: tags.length ? tags : undefined };
            userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
            return showConfirm(ctx, pending);
        }

        if (state?.mode === "ADD") {
            let parsed;
            try {
                parsed = await parseText(text);
            } catch (err) {
                userState.delete(uid);
                logger.error("parseText:", err);
                return ctx.reply(
                    `❌ ${safeBold("เกิดข้อผิดพลาด")}\nกรุณาลองใหม่อีกครั้ง`,
                    { parse_mode: "Markdown", ...mainMenu },
                );
            }
            userState.delete(uid);
            const pending = { title: parsed.title, subject: parsed.subject, due: parsed.due, priority: parsed.priority, rawText: text, tags: parsed.tags };
            userState.set(uid, { mode: "CONFIRM", pending, _timestamp: Date.now(), originalText: text });
            return showConfirm(ctx, pending, parsed.parseSource);
        }

        if (state?.mode === "ASK_AI") {
            await ctx.reply("⏳ *กำลังค้นหาคำตอบ...*", { parse_mode: "Markdown" });
            const answer = await askAI(text);
            userState.delete(uid);
            return ctx.reply(
                answer
                    ? `🤖 ${safeBold("คำตอบ")}\n━━━━━━━━━━━━━━━━━━\n${answer}`
                    : "❌ ไม่สามารถตอบคำถามได้ กรุณาลองใหม่",
                { parse_mode: "Markdown", ...mainMenu },
            );
        }

        // Not in any mode — smart preview with AI or regex
        const parsed = await parseText(text);
        const pending = { title: parsed.title, subject: parsed.subject, due: parsed.due, priority: parsed.priority, rawText: text, tags: parsed.tags, parseSource: parsed.parseSource };

        // Fix 1: skip preview if AI is confident + regex agrees
        if (isUnambiguous(parsed, text)) {
            userState.set(uid, { mode: "CONFIRM", pending, originalText: text, _timestamp: Date.now() });
            await ctx.reply(`🤖 ${safeItalic("AI มั่นใจ — ตรวจสอบก่อนบันทึก")}`, { parse_mode: "Markdown" });
            return showConfirm(ctx, pending, "ai");
        }

        userState.set(uid, { mode: "PENDING_PARSE", pending, originalText: text, _timestamp: Date.now() });

        const previewText =
            `⚡ ${safeBold("เจองานแล้ว!")}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `${buildHomeworkPreview(parsed)}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `กดปุ่มด้านล่างเพื่อเพิ่มเข้าสู่ระบบ`;

        return ctx.reply(previewText, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("➕ เพิ่มการบ้าน", "ADD")],
                [
                    Markup.button.callback("📋 งานค้าง", "LIST_ACTIVE"),
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                ],
            ]),
        });
    });

}
