import { Markup } from "telegraf";
import {
    formatDueDisplay,
    parseYMDToLocalDate,
    parseThaiDate,
    THAI_DAYS,
    THAI_MONTHS,
} from "../utils/dateParser.js";
import { subjectEmoji } from "../utils/subjectDetector.js";
import {
    fetchActive,
    fetchDone,
    createHomework,
    updateStatus,
    updatePriority,
    archivePage,
    getPageProps,
} from "../services/notionService.js";

import { mainMenu, cancelMenu, showConfirm } from "./commandHandlers.js";
import {
    escapeMarkdown,
    safeBold,
    safeItalic,
} from "../utils/telegramFormat.js";
import {
    STATUS,
    PRIORITY,
    PRIORITY_ORDER,
    priorityWeight,
    URGENT_DAYS,
    URGENT_DISPLAY_MAX,
    SUBJECT_BAR_MAX,
    SUBJECT_DISPLAY_MAX,
    PROGRESS_BAR_SLOTS,
} from "../utils/constants.js";
import { logger } from "../utils/logger.js";
import { setCorrection } from "../services/aiCache.js";

/* ── small helpers ── */
function statusEmoji(status) {
    return status === STATUS.DONE
        ? "✅"
        : status === STATUS.IN_PROGRESS
          ? "🔄"
          : "📌";
}

function statusLabel(status) {
    return status === STATUS.DONE
        ? "เสร็จแล้ว"
        : status === STATUS.IN_PROGRESS
          ? "กำลังทำ"
          : "ยังไม่ทำ";
}

function summarizeCounts(activePages, donePages) {
    const todo = activePages.filter(
        (p) => p.properties.Status?.select?.name === STATUS.TODO,
    ).length;
    const prog = activePages.filter(
        (p) => p.properties.Status?.select?.name === STATUS.IN_PROGRESS,
    ).length;
    const done = donePages.length;
    return { todo, prog, done, total: todo + prog + done };
}

function progressBar(percent) {
    const filled = Math.max(
        0,
        Math.min(PROGRESS_BAR_SLOTS, Math.round(percent / 10)),
    );
    return "█".repeat(filled) + "░".repeat(PROGRESS_BAR_SLOTS - filled);
}

function sectionHeader(icon, title, meta = "") {
    return `${icon} ${safeBold(title)}${meta ? `  ${meta}` : ""}`;
}

/* ── menus ── */
function dashboardMenu() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("➕ เพิ่มการบ้าน", "ADD"),
            Markup.button.callback("📋 งานค้าง", "LIST_ACTIVE"),
        ],
        [
            Markup.button.callback("✅ งานเสร็จ", "LIST_DONE"),
            Markup.button.callback("🤖 ถาม AI", "ASK_AI"),
        ],
        [Markup.button.callback("🏠 กลับหน้าหลัก", "HOME")],
    ]);
}

function listFooterMenu() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("➕ เพิ่มการบ้าน", "ADD"),
            Markup.button.callback("📊 Dashboard", "DASHBOARD"),
        ],
        [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
    ]);
}

function actionButtons(pageId, mode = "active") {
    if (mode === "done") {
        return Markup.inlineKeyboard([
            [
                Markup.button.callback("↩️ ย้ายกลับ", `todo_${pageId}`),
                Markup.button.callback("🗑️ ลบ", `del_${pageId}`),
            ],
        ]);
    }
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("✅ เสร็จแล้ว", `done_${pageId}`),
            Markup.button.callback("🔄 กำลังทำ", `prog_${pageId}`),
        ],
        [Markup.button.callback("🗑️ ลบ", `del_${pageId}`)],
    ]);
}

/* ── card builder ── */
function buildHomeworkCard(page, mode = "active") {
    const { title, status, due, subject, priority } = getPageProps(page);
    const safeTitle = escapeMarkdown(title);
    const safeSubject = escapeMarkdown(subject);

    return {
        text:
            `${statusEmoji(status)} ${safeBold(safeTitle)}\n` +
            `${subjectEmoji(subject)} วิชา: ${safeBold(safeSubject)}\n` +
            `${priority} ความสำคัญ: ${safeBold(priority)}\n` +
            `📍 สถานะ: ${safeBold(statusLabel(status))}\n` +
            `📅 ส่ง: ${formatDueDisplay(due)}`,
        extra: {
            parse_mode: "Markdown",
            ...actionButtons(page.id, mode),
        },
    };
}

async function sendPageCard(ctx, page, mode = "active") {
    const card = buildHomeworkCard(page, mode);
    await ctx.reply(card.text, card.extra);
}

/* ── dashboard builder ── */
function buildDashboard(activePages, donePages) {
    const { todo, prog, done, total } = summarizeCounts(activePages, donePages);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = progressBar(pct);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const urgentLimit = new Date(today);
    urgentLimit.setDate(today.getDate() + URGENT_DAYS);

    const urgent = activePages.filter((p) => {
        const due = p.properties.Due?.date?.start;
        if (!due) return false;
        const dt = parseYMDToLocalDate(due);
        return dt >= today && dt <= urgentLimit;
    });

    const overdue = activePages.filter((p) => {
        const due = p.properties.Due?.date?.start;
        if (!due) return false;
        return parseYMDToLocalDate(due) < today;
    });

    const bySubject = {};
    for (const p of activePages) {
        const subject =
            p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป";
        bySubject[subject] = (bySubject[subject] || 0) + 1;
    }

    let msg = `📊 ${safeBold("Dashboard")}\n━━━━━━━━━━━━━━━━━━\n`;
    msg += `🟥 ยังไม่ทำ: ${safeBold(String(todo))}  `;
    msg += `🟨 กำลังทำ: ${safeBold(String(prog))}  `;
    msg += `🟩 เสร็จ: ${safeBold(String(done))}\n`;
    if (overdue.length) msg += `🚨 เกินกำหนด: ${safeBold(String(overdue.length))}\n`;
    msg += `ความคืบหน้า: [${bar}] ${safeBold(`${pct}%`)}  (${total} รายการ)\n`;

    msg += `\n${sectionHeader("⚡", "ใกล้ครบกำหนด", `≤ ${URGENT_DAYS} วัน`)}\n`;
    if (!urgent.length) {
        msg += `✨ ไม่มีการบ้านเร่งด่วน\n`;
    } else {
        for (const p of urgent.slice(0, URGENT_DISPLAY_MAX)) {
            const { title, due, status, subject, priority } = getPageProps(p);
            msg += `${statusEmoji(status)} ${safeBold(escapeMarkdown(title))} `;
            msg += `${priority} ${safeItalic(escapeMarkdown(subject))} — ${formatDueDisplay(due)}\n`;
        }
        if (urgent.length > URGENT_DISPLAY_MAX) {
            msg += `… และอีก ${urgent.length - URGENT_DISPLAY_MAX} รายการ\n`;
        }
    }

    msg += `\n${sectionHeader("📖", "วิชาที่ยังค้างอยู่")}\n`;
    const sorted = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
        msg += `🎉 ไม่มีการบ้านค้าง\n`;
    } else {
        for (const [subject, count] of sorted.slice(0, SUBJECT_DISPLAY_MAX)) {
            msg += `${subjectEmoji(subject)} ${safeBold(escapeMarkdown(subject))}: `;
            msg += `${"█".repeat(Math.min(count, SUBJECT_BAR_MAX))} ${count} รายการ\n`;
        }
    }

    return msg;
}

/* ── register handlers ── */
export function registerActionHandlers(bot, userState) {
    /* ADD */
    bot.action("ADD", async (ctx) => {
        userState.set(ctx.from.id, { mode: "ADD", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch(() => {});
        return ctx.reply(
            `✏️ ${safeBold("เพิ่มการบ้านใหม่")}\n\n` +
                `${safeItalic("ส่งข้อความมาได้เลย 1 บรรทัด")}\n` +
                `• \`คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้\`\n` +
                `• \`รายงานอังกฤษ วันศุกร์\`\n` +
                `• \`ชีวะบทที่ 3 อีก 3 วัน\`\n\n` +
                `ระบบจะช่วยเดาชื่อวิชาและวันส่งให้อัตโนมัติ`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* CANCEL */
    bot.action("CANCEL", async (ctx) => {
        userState.delete(ctx.from.id);
        await ctx.answerCbQuery("ยกเลิกแล้ว").catch(() => {});
        try {
            await ctx.editMessageText("❌ ยกเลิกแล้ว", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        } catch {
            await ctx.reply("❌ ยกเลิกแล้ว", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    });

    /* CONFIRM SAVE — delete state only after successful save */
    bot.action("CONFIRM_SAVE", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx
                .answerCbQuery("❌ ไม่มีข้อมูลที่รอบันทึก")
                .catch(() => {});
        }

        const { title, subject, due, rawText, priority } = state.pending;

        await ctx.answerCbQuery().catch(() => {});
        await ctx.editMessageText("⏳ *กำลังบันทึก...*", {
            parse_mode: "Markdown",
        });

        try {
            await createHomework({ title, subject, due, rawText, priority });

            if (state.originalText) {
                setCorrection(state.originalText, { title, subject, due, priority });
            }

            userState.delete(uid);

            const safeTitle = escapeMarkdown(title);
            const safeSubject = escapeMarkdown(subject);
            const dueText = formatDueDisplay(due);

            const priText = priority || "🟡 กลาง";
            await ctx.editMessageText(
                `🎉 ${safeBold("บันทึกสำเร็จ")}\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `${subjectEmoji(subject)} ${safeBold(safeTitle)}\n` +
                    `📚 วิชา: ${safeBold(safeSubject)}\n` +
                    `🎯 ความสำคัญ: ${priText}\n` +
                    `📅 กำหนดส่ง: ${safeBold(dueText)}\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `พร้อมไปต่อแล้ว เลือกเมนูด้านล่างได้เลย`,
                { parse_mode: "Markdown", ...dashboardMenu() },
            );
        } catch (err) {
            logger.error("CONFIRM_SAVE:", err);
            // state ยังอยู่ → ผู้ใช้กด "ลองใหม่" ได้
            await ctx.editMessageText(
                `❌ ${safeBold("บันทึกไม่สำเร็จ")}\nกรุณาลองใหม่อีกครั้ง`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback(
                                "🔁 ลองใหม่",
                                "CONFIRM_SAVE",
                            ),
                            Markup.button.callback("❌ ยกเลิก", "CANCEL"),
                        ],
                    ]),
                },
            );
        }
    });

    /* CONFIRM EDIT */
    bot.action("CONFIRM_EDIT", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch(() => {});
        }

        userState.set(uid, { mode: "EDIT_TITLE", pending: state.pending, _timestamp: Date.now() });
        await ctx.answerCbQuery().catch(() => {});
        return ctx.reply(
            `✏️ ${safeBold("แก้ชื่อการบ้าน")}\nส่งชื่อใหม่มาได้เลย`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* EDIT SUBJECT */
    bot.action("EDIT_SUBJECT", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch(() => {});
        }

        userState.set(uid, { ...state, mode: "EDIT_SUBJECT", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch(() => {});
        return ctx.reply(
            `📚 ${safeBold("แก้วิชา")}\n` +
                `พิมพ์ชื่อวิชาที่ถูกต้อง (เช่น คณิต, ไทย, อังกฤษ, ฟิสิกส์, เคมี, ชีวะ, สังคม, ประวัติ, คอม)`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* EDIT DATE */
    bot.action("EDIT_DATE", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch(() => {});
        }

        userState.set(uid, { ...state, mode: "EDIT_DATE", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch(() => {});
        return ctx.reply(
            `📅 ${safeBold("แก้วันกำหนดส่ง")}\n` +
                `พิมพ์วันกำหนดส่ง (เช่น พรุ่งนี้, 15/06/2026, อีก 3 วัน, พุธหน้า)`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* EDIT PRIORITY */
    bot.action("EDIT_PRIORITY", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch(() => {});
        }

        const current = state.pending.priority || PRIORITY.MEDIUM;
        const options = PRIORITY_ORDER.map((p) =>
            Markup.button.callback(
                `${p === current ? "✅ " : ""}${p}`,
                `SET_PRIORITY_${p}`,
            ),
        );

        userState.set(uid, { mode: "EDIT_PRIORITY", pending: state.pending, _timestamp: Date.now() });
        await ctx.answerCbQuery().catch(() => {});
        return ctx.reply(
            `🎯 ${safeBold("เลือกความสำคัญ")}\n` +
                `ตอนนี้: ${current}\n\n` +
                "เลือกระดับความสำคัญสำหรับการบ้านนี้",
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    options,
                    [Markup.button.callback("❌ ยกเลิก", "CANCEL")],
                ]),
            },
        );
    });

    /* SET PRIORITY */
    bot.action(/SET_PRIORITY_(.+)/, async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);
        const priority = ctx.match[1];

        if (!state?.pending) {
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch(() => {});
        }

        const pending = { ...state.pending, priority };
        userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
        await ctx.answerCbQuery(`✅ ตั้งค่า: ${priority}`).catch(() => {});
        try {
            await ctx.deleteMessage();
        } catch {}
        return showConfirm(ctx, pending);
    });

    /* ASK AI */
    bot.action("ASK_AI", async (ctx) => {
        const uid = ctx.from.id;
        userState.set(uid, { mode: "ASK_AI", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch(() => {});
        return ctx.reply(
            `🤖 ${safeBold("ถามเกี่ยวกับการบ้าน")}\n\n` +
                `${safeItalic("พิมพ์คำถามที่อยากรู้ เช่น")}\n` +
                "• `งานคณิตส่งวันไหนบ้าง`\n" +
                "• `มีงานอะไรที่ยังไม่ทำ`\n" +
                "• `อาทิตย์นี้มีงานกี่ชิ้น`\n\n" +
                "พิมพ์คำถามได้เลย หรือกดยกเลิก",
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* LIST ACTIVE */
    bot.action("LIST_ACTIVE", async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});

        try {
            const rawPages = await fetchActive();
            const pages = [...rawPages].sort((a, b) => {
                const pa = a.properties.Priority?.select?.name || PRIORITY.MEDIUM;
                const pb = b.properties.Priority?.select?.name || PRIORITY.MEDIUM;
                const w = priorityWeight(pb) - priorityWeight(pa);
                if (w !== 0) return w;
                const da = a.properties.Due?.date?.start || "9999-99-99";
                const db = b.properties.Due?.date?.start || "9999-99-99";
                return da.localeCompare(db);
            });

            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มีการบ้านค้าง")}\nพักผ่อนได้เต็มที่เลย 🏆`,
                    { parse_mode: "Markdown", ...dashboardMenu() },
                );
            }

            const prog = pages.filter(
                (p) => p.properties.Status?.select?.name === STATUS.IN_PROGRESS,
            );
            const todo = pages.filter(
                (p) => p.properties.Status?.select?.name === STATUS.TODO,
            );

            await ctx.reply(
                `📋 ${safeBold("งานที่ยังค้างอยู่")}\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `🔄 กำลังทำ: ${safeBold(String(prog.length))}\n` +
                    `📌 ยังไม่ทำ: ${safeBold(String(todo.length))}\n` +
                    `รวมทั้งหมด: ${safeBold(String(pages.length))} รายการ`,
                { parse_mode: "Markdown", ...listFooterMenu() },
            );

            if (prog.length) {
                await ctx.reply(sectionHeader("🔄", "กำลังทำอยู่"), {
                    parse_mode: "Markdown",
                });
                for (const page of prog)
                    await sendPageCard(ctx, page, "active");
            }

            if (todo.length) {
                await ctx.reply(sectionHeader("📌", "ยังไม่ได้เริ่ม"), {
                    parse_mode: "Markdown",
                });
                for (const page of todo)
                    await sendPageCard(ctx, page, "active");
            }

            return ctx.reply("📋 รายการทั้งหมด", listFooterMenu());
        } catch (err) {
            logger.error("LIST_ACTIVE:", err);
            return ctx.reply("❌ ดึงข้อมูลไม่ได้ กรุณาลองใหม่", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    });

    /* LIST DONE */
    bot.action("LIST_DONE", async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});

        try {
            const pages = await fetchDone();

            if (!pages.length) {
                return ctx.reply(
                    `📭 ${safeBold("ยังไม่มีงานที่ทำเสร็จ")}\nสู้ต่ออีกนิด 💪`,
                    { parse_mode: "Markdown", ...dashboardMenu() },
                );
            }

            await ctx.reply(
                `✅ ${safeBold("งานที่ทำเสร็จแล้ว")}\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `ทั้งหมด ${safeBold(String(pages.length))} รายการ`,
                { parse_mode: "Markdown", ...listFooterMenu() },
            );

            for (const page of pages) await sendPageCard(ctx, page, "done");

            return ctx.reply("✅ รายการที่เสร็จแล้ว", listFooterMenu());
        } catch (err) {
            logger.error("LIST_DONE:", err);
            return ctx.reply("❌ ดึงข้อมูลไม่ได้ กรุณาลองใหม่", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    });

    /* DASHBOARD */
    bot.action("DASHBOARD", async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});

        try {
            const [activePages, donePages] = await Promise.all([
                fetchActive(),
                fetchDone(),
            ]);
            return ctx.reply(buildDashboard(activePages, donePages), {
                parse_mode: "Markdown",
                ...dashboardMenu(),
            });
        } catch (err) {
            logger.error("DASHBOARD:", err);
            return ctx.reply("❌ โหลด Dashboard ไม่ได้ กรุณาลองใหม่", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    });

    /* STATUS helpers */
    async function setStatus(ctx, pageId, status, message) {
        try {
            await updateStatus(pageId, status);
            await ctx.answerCbQuery().catch(() => {});
            await ctx.editMessageReplyMarkup(undefined);
            return ctx.reply(message, {
                parse_mode: "Markdown",
                ...dashboardMenu(),
            });
        } catch (err) {
            logger.error("setStatus:", err);
            return ctx.reply("❌ อัปเดตไม่ได้ กรุณาลองใหม่", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    }

    bot.action(/done_(.+)/, (ctx) =>
        setStatus(
            ctx,
            ctx.match[1],
            STATUS.DONE,
            "✅ *เยี่ยม!* บันทึกว่าเสร็จแล้ว",
        ),
    );

    bot.action(/prog_(.+)/, (ctx) =>
        setStatus(
            ctx,
            ctx.match[1],
            STATUS.IN_PROGRESS,
            "🔄 *อัปเดตแล้ว* บันทึกว่ากำลังทำอยู่",
        ),
    );

    bot.action(/todo_(.+)/, (ctx) =>
        setStatus(
            ctx,
            ctx.match[1],
            STATUS.TODO,
            "📌 *อัปเดตแล้ว* ย้ายกลับเป็นงานค้าง",
        ),
    );

    /* DELETE */
    bot.action(/del_(.+)/, async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});

        try {
            await archivePage(ctx.match[1]);
            await ctx.editMessageReplyMarkup(undefined);

            return ctx.reply(
                `🗑️ ${safeBold("ลบแล้ว")}`,
                { parse_mode: "Markdown", ...dashboardMenu() },
            );
        } catch (err) {
            logger.error("DELETE:", err);
            return ctx.reply("❌ ลบไม่ได้ กรุณาลองใหม่", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    });
}
