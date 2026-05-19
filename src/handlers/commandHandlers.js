import { Markup } from "telegraf";
import { parseThaiDate, formatDueDisplay } from "../utils/dateParser.js";
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

export const confirmMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback("✅ บันทึก", "CONFIRM_SAVE"),
        Markup.button.callback("✏️ แก้ไขชื่อ", "CONFIRM_EDIT"),
    ],
    [
        Markup.button.callback("📚 วิชา", "EDIT_SUBJECT"),
        Markup.button.callback("📅 วันที่", "EDIT_DATE"),
        Markup.button.callback("🎯 สำคัญ", "EDIT_PRIORITY"),
    ],
    [
        Markup.button.callback("🏷️ Tags", "EDIT_TAGS"),
        Markup.button.callback("❌ ยกเลิก", "CANCEL"),
    ],
]);

function buildWelcomeMessage(name) {
    return (
        `${safeItalic("━".repeat(20))}\n` +
        `👋 ${safeBold("สวัสดี " + name + "!")}\n` +
        `🤖 ผมคือ ${safeBold("Homework Bot")} ผู้ช่วยการบ้าน\n\n` +
        `✨ ${safeBold("ใช้งานง่าย ๆ แค่ 3 ขั้นตอน")}\n` +
        `๑. กด ➕ ${safeBold("เพิ่มการบ้าน")}\n` +
        `๒. พิมพ์งานที่ได้รับมอบหมาย\n` +
        `๓. ตรวจสอบ ➔ กดบันทึก!\n\n` +
        `${safeItalic("ตัวอย่าง:")}\n` +
        `${safeCode("คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้")}\n` +
        `${safeCode("รายงานอังกฤษ วันศุกร์")}\n` +
        `${safeCode("ชีวะ บทที่ 3 อีก 3 วัน")}\n` +
        `${safeItalic("━".repeat(20))}`
    );
}

function buildMenuMessage() {
    return (
        `🏠 ${safeBold("เมนูหลัก")}\n` +
        `${safeItalic("━".repeat(18))}\n` +
        `▸ ${safeBold("➕ เพิ่มการบ้าน")} — เพิ่มงานใหม่\n` +
        `▸ ${safeBold("📋 งานค้าง")} — ดูงานที่ยังไม่เสร็จ\n` +
        `▸ ${safeBold("✅ งานเสร็จ")} — ดูงานที่ทำแล้ว\n` +
        `▸ ${safeBold("📊 Dashboard")} — สถิติภาพรวม\n` +
        `▸ ${safeBold("🤖 ถาม AI")} — ถามเกี่ยวกับงาน\n` +
        `${safeItalic("━".repeat(18))}`
    );
}

export function showConfirm(ctx, pending, aiUsed = false, model = "") {
    const title = pending?.title || "ไม่มีชื่อ";
    const subject = pending?.subject || "ทั่วไป";
    const due = pending?.due ? formatDueDisplay(pending.due) : "ไม่กำหนดวัน";
    const priority = pending?.priority || "🟡 กลาง";
    const tags = pending?.tags?.length ? pending.tags.map(t => `#${t}`).join(" ") : null;
    const aiBadge = aiUsed
        ? `\n🤖 ${safeItalic("วิเคราะห์โดย AI")}${model ? ` (${safeCode(model)})` : ""}`
        : "";
    return ctx.reply(
        `📝 ${safeBold("ตรวจสอบก่อนบันทึก")}\n` +
            `${safeItalic("━".repeat(20))}\n` +
            `${subjectEmoji(subject)}  ${safeBold(title)}\n\n` +
            `📚 วิชา      ${escapeMarkdown(subject)}\n` +
            `🎯 สำคัญ    ${priority}\n` +
            `📅 กำหนดส่ง  ${escapeMarkdown(due)}\n` +
            (tags ? `🏷️ แท็ก     ${tags}\n` : "") +
            (aiBadge ? `${aiBadge}\n` : "") +
            `\n${safeItalic("━".repeat(20))}\n` +
            `✅ กดบันทึก หรือ ✏️ แก้ไขส่วนที่ต้องการ`,
        {
            parse_mode: "Markdown",
            ...confirmMenu,
        },
    );
}

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
        tags: inferAndParseTags(text, { priority }),
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
                `${safeItalic("━".repeat(16))}\n` +
                `${safeItalic("พิมพ์คำถามที่อยากรู้ เช่น")}\n` +
                `• "งานคณิตส่งวันไหนบ้าง"\n` +
                `• "มีงานอะไรที่ยังไม่ทำ"\n` +
                `• "อาทิตย์นี้มีงานกี่ชิ้น"\n\n` +
                `${safeItalic("พิมพ์คำถามเลย หรือกดยกเลิก")}\n` +
                `${safeItalic("━".repeat(16))}`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    bot.command("help", (ctx) =>
        ctx.reply(
            `🆘 ${safeBold("วิธีใช้งาน")}\n` +
                `${safeItalic("━".repeat(16))}\n` +
                `๑. กด ➕ เพิ่มการบ้าน\n` +
                `๒. พิมพ์ชื่องาน + วิชา + วันที่\n` +
                `๓. ตรวจสอบ ➔ กดบันทึก\n\n` +
                `${safeItalic("ตัวอย่าง:")}\n` +
                `${safeCode("ฟิสิกส์ ทำโจทย์ข้อ 1-10 พรุ่งนี้")}\n` +
                `${safeCode("คณิต หน้า 45 เสร็จวันศุกร์")}\n` +
                `${safeItalic("━".repeat(16))}\n` +
                `${safeItalic("พิมพ์ /menu เพื่อกลับเมนูหลัก")}`,
            {
                parse_mode: "Markdown",
                ...mainMenu,
            },
        ),
    );

    bot.action("HOME", async (ctx) => {
        userState.delete(ctx.from.id);
        await ctx.answerCbQuery().catch(() => {});
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

    const MAX_TEXT_LENGTH = 500;

    bot.on("text", async (ctx) => {
        const text = ctx.message.text.trim();
        if (!text) return;

        // Unknown command → show help
        if (text.startsWith("/")) {
            return ctx.reply(
                `🤖 ${safeBold("คำสั่งที่ใช้ได้")}\n` +
                `${safeItalic("━".repeat(16))}\n` +
                `/start — เริ่มต้น\n` +
                `/menu — เมนูหลัก\n` +
                `/ask — ถามเกี่ยวกับการบ้าน\n` +
                `/help — วิธีใช้งาน\n` +
                `${safeItalic("━".repeat(16))}`,
                { parse_mode: "Markdown", ...mainMenu },
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
            userState.delete(uid);
            const parsed = await parseText(text);
            const pending = { title: parsed.title, subject: parsed.subject, due: parsed.due, priority: parsed.priority, rawText: text, tags: parsed.tags };
            userState.set(uid, { mode: "CONFIRM", pending, _timestamp: Date.now(), originalText: text });
            return showConfirm(ctx, pending, parsed.usedAI, parsed.model);
        }

        if (state?.mode === "ASK_AI") {
            userState.delete(uid);
            await ctx.reply("⏳ *กำลังค้นหาคำตอบ...*", { parse_mode: "Markdown" });
            const answer = await askAI(text);
            return ctx.reply(
                answer
                    ? `🤖 ${safeBold("คำตอบ")}\n━━━━━━━━━━━━━━━━━━\n${answer}`
                    : "❌ ไม่สามารถตอบคำถามได้ กรุณาลองใหม่",
                { parse_mode: "Markdown", ...mainMenu },
            );
        }

        // Not in any mode — smart preview with AI or regex
        const parsed = await parseText(text);
        const previewText =
            `⚡ ${safeBold("เจองานแล้ว!")}\n` +
            `${safeItalic("━".repeat(18))}\n` +
            `${subjectEmoji(parsed.subject)}  ${safeBold(parsed.title)}\n` +
            `📚 ${escapeMarkdown(parsed.subject)}\n` +
            `🎯 ${parsed.priority || "🟡 กลาง"}\n` +
            `📅 ${parsed.due ? formatDueDisplay(parsed.due) : "ไม่กำหนดวัน"}\n` +
            `${safeItalic("━".repeat(18))}\n` +
            `${safeItalic("กดปุ่มด้านล่างเพื่อเพิ่มเข้าสู่ระบบ")}`;

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
