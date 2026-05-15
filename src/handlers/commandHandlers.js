import { Markup } from "telegraf";
import { parseThaiDate, formatDueDisplay } from "../utils/dateParser.js";
import {
    detectSubject,
    cleanTitle,
    subjectEmoji,
} from "../utils/subjectDetector.js";
import { isCalendarReady } from "../services/googleCalendarService.js";
import { parseHomework, isAIReady } from "../services/aiService.js";
import { isQaReady, askAI } from "../services/qaService.js";
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
        Markup.button.callback("📊 Dashboard", "DASHBOARD"),
    ],
    [
        Markup.button.callback("📋 งานค้าง", "LIST_ACTIVE"),
        Markup.button.callback("✅ งานเสร็จ", "LIST_DONE"),
    ],
    [
        Markup.button.callback("🗓 ปฏิทิน 7 วัน", "CAL_VIEW"),
        Markup.button.callback("🤖 ถาม AI", "ASK_AI"),
    ],
    ...(WEB_URL
        ? [[Markup.button.url("🌐 Web Dashboard", WEB_URL)]]
        : []),
]);

export const cancelMenu = Markup.inlineKeyboard([
    [Markup.button.callback("❌ ยกเลิก", "CANCEL")],
]);

export const confirmMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback("✅ บันทึก", "CONFIRM_SAVE"),
        Markup.button.callback("✏️ ชื่อ", "CONFIRM_EDIT"),
    ],
    [
        Markup.button.callback("📚 วิชา", "EDIT_SUBJECT"),
        Markup.button.callback("📅 วันที่", "EDIT_DATE"),
    ],
    [Markup.button.callback("❌ ยกเลิก", "CANCEL")],
]);

function buildWelcomeMessage(name) {
    return (
        `👋 สวัสดี ${safeBold(name)}\n` +
        `ผมคือ ${safeBold("Homework Bot")} ผู้ช่วยจัดการการบ้านของคุณ\n\n` +
        `ใช้งานง่าย ๆ 3 ขั้นตอน\n` +
        `1. กด ${safeBold("➕ เพิ่มการบ้าน")}\n` +
        `2. พิมพ์ข้อความแบบธรรมชาติ\n` +
        `3. ตรวจสอบแล้วกดบันทึก\n\n` +
        `${safeItalic("ตัวอย่างที่พิมพ์ได้ทันที")}\n` +
        `${safeCode("คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้")}\n` +
        `${safeCode("รายงานอังกฤษ วันศุกร์")}\n` +
        `${safeCode("ชีวะ บทที่ 3 อีก 3 วัน")}`
    );
}

function buildMenuMessage() {
    return (
        `🏠 ${safeBold("เมนูหลัก")}\n` +
        `เลือกสิ่งที่อยากทำได้เลย\n\n` +
        `➕ เพิ่มการบ้านใหม่\n` +
        `📋 ดูงานที่ยังค้าง\n` +
        `✅ ดูงานที่ทำเสร็จแล้ว\n` +
        `📊 ดูภาพรวมทั้งหมด\n` +
        `🗓 ดูกิจกรรม 7 วันข้างหน้า`
    );
}

export function showConfirm(ctx, pending, aiUsed = false, model = "") {
    const title = pending?.title || "ไม่มีชื่อ";
    const subject = pending?.subject || "ทั่วไป";
    const due = pending?.due ? formatDueDisplay(pending.due) : "ไม่กำหนดวัน";
    const aiBadge = aiUsed
        ? `\n🤖 ${safeItalic("วิเคราะห์โดย AI")}${model ? ` (${safeCode(model)})` : ""}`
        : "";
    const calLine = isCalendarReady()
        ? `\n🗓 ${safeItalic("จะเพิ่มลง Google Calendar อัตโนมัติ")}`
        : `\n🗓 ${safeItalic("ยังไม่ได้เชื่อม Google Calendar")}`;

    return ctx.reply(
        `🔍 ${safeBold("ตรวจสอบก่อนบันทึก")}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `${subjectEmoji(subject)} ${safeBold(escapeMarkdown(title))}\n` +
            `📚 วิชา: ${safeBold(escapeMarkdown(subject))}\n` +
            `📅 กำหนดส่ง: ${safeBold(escapeMarkdown(due))}` +
            calLine +
            aiBadge +
            `\n━━━━━━━━━━━━━━━━━━\n` +
            `${safeItalic("ถ้าทุกอย่างถูกต้อง กดบันทึกได้เลย")}`,
        {
            parse_mode: "Markdown",
            ...confirmMenu,
        },
    );
}

async function parseText(text) {
    const aiResult = text.length < 300 && isAIReady() ? await parseHomework(text) : null;
    if (aiResult) {
        return {
            due: aiResult.dueDate,
            subject: aiResult.subject || detectSubject(text),
            title: aiResult.title || cleanTitle(text) || text,
            usedAI: true,
            model: aiResult.model || "",
        };
    }
    return {
        due: parseThaiDate(text),
        subject: detectSubject(text),
        title: cleanTitle(text) || text,
        usedAI: false,
        model: "",
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
            return ctx.reply("⚠️ ยังไม่ได้ตั้งค่า GROQ_API_KEY", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
        userState.set(ctx.from.id, { mode: "ASK_AI", _timestamp: Date.now() });
        return ctx.reply(
            `🤖 ${safeBold("ถามเกี่ยวกับการบ้าน")}\n\n` +
                `${safeItalic("พิมพ์คำถามที่อยากรู้ เช่น")}\n` +
                `• \`งานคณิตส่งวันไหนบ้าง\`\n` +
                `• \`มีงานอะไรที่ยังไม่ทำ\`\n` +
                `• \`อาทิตย์นี้มีงานกี่ชิ้น\`\n\n` +
                `พิมพ์คำถามได้เลย หรือกดยกเลิก`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    bot.command("help", (ctx) =>
        ctx.reply(
            `🆘 ${safeBold("วิธีใช้งาน")}\n` +
                `• กด ${safeBold("➕ เพิ่มการบ้าน")} เพื่อเริ่มเพิ่มงาน\n` +
                `• พิมพ์ชื่อวิชา เนื้องาน และวันส่งในข้อความเดียว\n` +
                `• ใช้ ${safeCode("/menu")} เพื่อกลับเมนูหลักได้เสมอ\n\n` +
                `${safeItalic("ตัวอย่าง")}\n` +
                `${safeCode("ฟิสิกส์ ทำโจทย์ข้อ 1-10 พรุ่งนี้")}`,
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

    bot.on("text", async (ctx) => {
        const text = ctx.message.text.trim();
        if (!text || text.startsWith("/")) return;

        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (state?.mode === "EDIT_TITLE") {
            const pending = { ...state.pending, title: text };
            userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
            return showConfirm(ctx, pending);
        }

        if (state?.mode === "EDIT_SUBJECT") {
            const pending = { ...state.pending, subject: text };
            userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
            return showConfirm(ctx, pending);
        }

        if (state?.mode === "EDIT_DATE") {
            const due = parseThaiDate(text) || text;
            const pending = { ...state.pending, due };
            userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
            return showConfirm(ctx, pending);
        }

        if (state?.mode === "ADD") {
            userState.delete(uid);
            const parsed = await parseText(text);
            const pending = { title: parsed.title, subject: parsed.subject, due: parsed.due, rawText: text };
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
            `⚡ ${safeBold("ตรวจพบข้อความการบ้าน")}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `${subjectEmoji(parsed.subject)} ${safeBold(escapeMarkdown(parsed.title))}\n` +
            `📚 วิชา: ${safeBold(escapeMarkdown(parsed.subject))}\n` +
            `📅 กำหนดส่ง: ${safeBold(escapeMarkdown(parsed.due ? formatDueDisplay(parsed.due) : "ไม่กำหนดวัน"))}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `${safeItalic("กด ➕ เพิ่มการบ้าน แล้วส่งข้อความนี้อีกครั้งเพื่อบันทึก")}`;

        userState.set(uid, { mode: "ADD_HELPER", preview: parsed, _timestamp: Date.now() });

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
