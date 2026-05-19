import { Markup } from "telegraf";
import {
    formatDueDisplay, formatCompletedDisplay, formatDateLabel,
    parseYMDToLocalDate,
    parseThaiDate,
    THAI_DAYS,
    THAI_MONTHS,
} from "../utils/dateParser.js";
import { subjectEmoji } from "../utils/subjectDetector.js";
import { VALID_TAGS } from "../utils/tagDetector.js";
import {
    fetchActive,
    fetchDone,
    createHomework,
    updateStatus,
    updatePriority,
    archivePage,
    getPageProps,
    getPageTitle,
} from "../services/notionService.js";

import { mainMenu, cancelMenu, showConfirm, compactConfirmMenu, moreOptionsMenu } from "./commandHandlers.js";
import {
    escapeMarkdown,
    safeBold,
    safeItalic,
    safeCode,
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

function progressBar(percent) {
    const filled = Math.max(
        0,
        Math.min(PROGRESS_BAR_SLOTS, Math.round(percent / 10)),
    );
    return "█".repeat(filled) + "░".repeat(PROGRESS_BAR_SLOTS - filled);
}

function sectionHeader(icon, title, meta = "") {
    return `${icon} ${safeBold(title)}${meta ? ` ${safeItalic(meta)}` : ""}`;
}

/* ── menus ── */
function dashboardMenu() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("➕ เพิ่ม", "ADD"),
            Markup.button.callback("📋 ค้าง", "LIST_ACTIVE"),
            Markup.button.callback("✅ เสร็จ", "LIST_DONE"),
        ],
        [
            Markup.button.callback("🤖 ถาม AI", "ASK_AI"),
            Markup.button.callback("🏠 หน้าหลัก", "HOME"),
        ],
    ]);
}

function listFooterMenu() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("➕ เพิ่ม", "ADD"),
            Markup.button.callback("📊 Dashboard", "DASHBOARD"),
        ],
        [Markup.button.callback("🏠 หน้าหลัก", "HOME")],
    ]);
}

function actionButtons(pageId, mode = "active") {
    if (mode === "done") {
        return Markup.inlineKeyboard([
            [
                Markup.button.callback("↩️ คืนกลับ", `todo_${pageId}`),
                Markup.button.callback("🗑️ ลบทิ้ง", `del_${pageId}`),
            ],
        ]);
    }
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("✅ เสร็จ", `done_${pageId}`),
            Markup.button.callback("🔄 กำลังทำ", `prog_${pageId}`),
            Markup.button.callback("🗑️ ลบ", `del_${pageId}`),
        ],
    ]);
}

/* ── card builder (compact, no box art) ── */
function buildHomeworkCard(page, mode = "active") {
    const { title, status, due, subject, priority, tags, completed } = getPageProps(page);
    const dateLabel = status === STATUS.DONE && completed
        ? formatDateLabel(completed, "completed")
        : formatDateLabel(due, "due");
    const tagsStr = tags?.length ? tags.map(t => `#${t}`).join(" ") : null;

    let text = `${statusEmoji(status)} ${safeBold(title)} ${subjectEmoji(subject)} ${priority} — ${dateLabel}`;
    if (tagsStr) text += `\n${tagsStr}`;

    return { text, extra: { parse_mode: "Markdown", ...actionButtons(page.id, mode) } };
}

async function sendPageCard(ctx, page, mode = "active") {
    const card = buildHomeworkCard(page, mode);
    await ctx.reply(card.text, card.extra);
}

/* ── compact dashboard builder ── */
function buildDashboard(activePages, donePages) {
    let todo = 0, prog = 0;
    const bySubject = {};
    const urgent = [];
    const overduePages = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const urgentLimit = new Date(today); urgentLimit.setDate(today.getDate() + URGENT_DAYS);

    for (const p of activePages) {
        const status = p.properties.Status?.select?.name;
        if (status === STATUS.TODO) todo++;
        else if (status === STATUS.IN_PROGRESS) prog++;

        const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป";
        bySubject[sub] = (bySubject[sub] || 0) + 1;

        const due = p.properties.Due?.date?.start;
        if (due) {
            const dt = parseYMDToLocalDate(due);
            if (dt >= today && dt <= urgentLimit) urgent.push(p);
            if (dt < today) overduePages.push(p);
        }
    }

    const done = donePages.length;
    const total = todo + prog + done;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = progressBar(pct);

    let msg = `📊 ${safeBold("ภาพรวมการบ้าน")}\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 ${todo}  🔄 ${prog}  ✅ ${done}`;
    if (overduePages.length) msg += `  🚨 ${overduePages.length}`;
    msg += `\n${bar} ${pct}% (${total} รายการ)\n`;

    msg += `\n⚡ ${safeBold("ใกล้ครบ")} (≤ ${URGENT_DAYS} วัน)\n`;
    if (!urgent.length) {
        msg += `✨ ไม่มีการบ้านเร่งด่วน\n`;
    } else {
        for (const p of urgent.slice(0, URGENT_DISPLAY_MAX)) {
            const { title, due, status, subject, priority } = getPageProps(p);
            msg += `${statusEmoji(status)} ${safeBold(title)} ${priority} ${subjectEmoji(subject)} — ${formatDueDisplay(due)}\n`;
        }
        if (urgent.length > URGENT_DISPLAY_MAX) {
            msg += `… และอีก ${urgent.length - URGENT_DISPLAY_MAX} รายการ\n`;
        }
    }

    msg += `\n📖 ${safeBold("วิชาที่ยังค้าง")}\n`;
    const sorted = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
        msg += `🎉 ไม่มีการบ้านค้าง\n`;
    } else {
        for (const [subject, count] of sorted.slice(0, SUBJECT_DISPLAY_MAX)) {
            msg += `${subjectEmoji(subject)} ${safeBold(subject)} ${"█".repeat(Math.min(count, SUBJECT_BAR_MAX))} ${count}\n`;
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
            `✏️ ${safeBold("เพิ่มการบ้านใหม่")}\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `ส่งข้อความเดียว เช่น\n` +
                `${safeCode("คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้")}\n` +
                `${safeCode("รายงานอังกฤษ วันศุกร์")}\n` +
                `${safeCode("ชีวะ บทที่ 3 อีก 3 วัน")}\n\n` +
                `🤖 ระบบเดาวิชา + วันที่ + ความสำคัญให้อัตโนมัติ\n` +
                `━━━━━━━━━━━━━━━━━━`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* CANCEL */
    bot.action("CANCEL", async (ctx) => {
        userState.delete(ctx.from.id);
        await ctx.answerCbQuery("ยกเลิกแล้ว ✅").catch(() => {});
        try {
            await ctx.editMessageText(
                `❌ ${safeBold("ยกเลิกแล้ว")}\n━━━━━━━━━━━━━━━━`,
                { parse_mode: "Markdown", ...mainMenu },
            );
        } catch {
            await ctx.reply(
                `❌ ${safeBold("ยกเลิกแล้ว")}\n━━━━━━━━━━━━━━━━`,
                { parse_mode: "Markdown", ...mainMenu },
            );
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

        if (state._saving) {
            return ctx.answerCbQuery("⏳ กำลังบันทึก…").catch(() => {});
        }
        state._saving = true;
        userState.set(uid, state);

        const { title, subject, due, rawText, priority, tags } = state.pending;

        await ctx.answerCbQuery().catch(() => {});

        try {
            const created = await createHomework({ title, subject, due, rawText, priority, tags });

            if (state.originalText) {
                setCorrection(state.originalText, { title, subject, due, priority });
            }

            userState.delete(uid);

            const safeSubject = escapeMarkdown(subject);
            const dueText = formatDueDisplay(due);

            const priText = priority || "🟡 กลาง";
            await ctx.editMessageText(
                `🎉 ${safeBold("บันทึกสำเร็จ!")}\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `${subjectEmoji(subject)} ${safeBold(title)}\n` +
                    `📚 ${safeSubject} • ${priText}\n` +
                    `📅 ${dueText}\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `เลือกเมนูด้านล่างเพื่อไปต่อ`,
                { parse_mode: "Markdown", ...dashboardMenu() },
            ).catch(() => {});
        } catch (err) {
            logger.error("CONFIRM_SAVE:", err);
            await ctx.editMessageText(
                `❌ ${safeBold("บันทึกไม่สำเร็จ")}\n` +
                    `━━━━━━━━━━━━━━━━\n` +
                    `เกิดข้อผิดพลาด กรุณาลองใหม่`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("🔁 ลองใหม่", "CONFIRM_SAVE"),
                            Markup.button.callback("❌ ยกเลิก", "CANCEL"),
                        ],
                    ]),
                },
            ).catch(() => {});
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
            `✏️ ${safeBold("แก้ชื่อการบ้าน")}\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `ส่งชื่อใหม่มาได้เลย`,
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
            `📚 ${safeBold("แก้ไขวิชา")}\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `พิมพ์ชื่อวิชาที่ถูกต้อง\n` +
                `เช่น คณิต, ไทย, อังกฤษ, ฟิสิกส์, เคมี, ชีวะ, สังคม, ประวัติ, คอม`,
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
                `━━━━━━━━━━━━━━━━\n` +
                `พิมพ์วันที่ใหม่\n` +
                `เช่น พรุ่งนี้, 15/06/2026, อีก 3 วัน, พุธหน้า`,
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
                `━━━━━━━━━━━━━━━━\n` +
                `ปัจจุบัน: ${current}\n\n` +
                "เลือกระดับความสำคัญด้านล่าง",
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    options,
                    [Markup.button.callback("❌ ยกเลิก", "CANCEL")],
                ]),
            },
        );
    });

    /* EDIT TAGS */
    bot.action("EDIT_TAGS", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch(() => {});
        }

        userState.set(uid, { ...state, mode: "EDIT_TAGS", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch(() => {});
        return ctx.reply(
            `🏷️ ${safeBold("แก้ไขแท็ก")}\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `แท็กที่มี: ${VALID_TAGS.join(", ")}\n\n` +
                `พิมพ์แท็กที่ต้องการ คั่นด้วยช่องว่าง\n` +
                `เช่น สอบ ด่วน อ่าน\n` +
                `หรือพิมพ์ \`-\` เพื่อล้างแท็ก\n` +
                `━━━━━━━━━━━━━━━━`,
            { parse_mode: "Markdown", ...cancelMenu },
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

        if (!PRIORITY_ORDER.includes(priority)) {
            return ctx.answerCbQuery("❌ ค่าความสำคัญไม่ถูกต้อง").catch(() => {});
        }

        const pending = { ...state.pending, priority, _manualPriority: true };
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

    /* LIST ACTIVE — consolidated single message */
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
                    `🎉 ${safeBold("ไม่มีการบ้านค้าง")}\n━━━━━━━━━━━━━━━━\nพักผ่อนได้เต็มที่เลย 🏆`,
                    { parse_mode: "Markdown", ...dashboardMenu() },
                );
            }

            const MAX_DISPLAY = 20;
            const display = pages.slice(0, MAX_DISPLAY);
            const items = display.map(p => {
                const { title, status, due, subject, priority } = getPageProps(p);
                return `${statusEmoji(status)} ${safeBold(title)} ${subjectEmoji(subject)} ${priority} — ${formatDateLabel(due, "due")}`;
            });

            let msg = `📋 ${safeBold("งานที่ยังค้าง")} (${pages.length})\n━━━━━━━━━━━━━━━━━━\n${items.join("\n")}`;
            if (pages.length > MAX_DISPLAY) msg += `\n… และอีก ${pages.length - MAX_DISPLAY} รายการ`;
            msg += `\n━━━━━━━━━━━━━━━━━━\n🔴 สูง = ด่วน  🟡 กลาง = ปกติ  🟢 ต่ำ = ยังมีเวลา`;

            return ctx.reply(msg, { parse_mode: "Markdown", ...listFooterMenu() });
        } catch (err) {
            logger.error("LIST_ACTIVE:", err);
            return ctx.reply(`❌ ${safeBold("โหลดรายการไม่ได้")} — ลองใหม่อีกครั้ง`, {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    });

    /* LIST DONE — consolidated single message */
    bot.action("LIST_DONE", async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});

        try {
            const pages = await fetchDone();

            if (!pages.length) {
                return ctx.reply(
                    `📭 ${safeBold("ยังไม่มีงานที่ทำเสร็จ")}\n━━━━━━━━━━━━━━━━\nสู้ต่ออีกนิด 💪`,
                    { parse_mode: "Markdown", ...dashboardMenu() },
                );
            }

            const MAX_DISPLAY = 20;
            const display = pages.slice(0, MAX_DISPLAY);
            const items = display.map(p => {
                const { title, status, due, subject, priority, completed } = getPageProps(p);
                const dateLabel = formatDateLabel(completed, "completed");
                return `${statusEmoji(status)} ${safeBold(title)} ${subjectEmoji(subject)} ${priority} — ${dateLabel}`;
            });

            let msg = `✅ ${safeBold("งานที่ทำเสร็จแล้ว")} (${pages.length})\n━━━━━━━━━━━━━━━━━━\n${items.join("\n")}`;
            if (pages.length > MAX_DISPLAY) msg += `\n… และอีก ${pages.length - MAX_DISPLAY} รายการ`;

            return ctx.reply(msg, { parse_mode: "Markdown", ...listFooterMenu() });
        } catch (err) {
            logger.error("LIST_DONE:", err);
            return ctx.reply(`❌ ${safeBold("โหลดรายการไม่ได้")} — ลองใหม่อีกครั้ง`, {
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
            return ctx.reply(`❌ ${safeBold("โหลด Dashboard ไม่ได้")} — ลองใหม่อีกครั้ง`, {
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
            await ctx.editMessageReplyMarkup(undefined).catch(() => {});
            return ctx.reply(message, {
                parse_mode: "Markdown",
                ...dashboardMenu(),
            });
        } catch (err) {
            logger.error("setStatus:", err);
            return ctx.reply(`❌ ${safeBold("อัปเดตสถานะไม่ได้")} — ลองใหม่อีกครั้ง`, {
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
            `✅ ${safeBold("เสร็จแล้ว!")} — เก่งมาก! 🎉`,
        ),
    );

    bot.action(/prog_(.+)/, (ctx) =>
        setStatus(
            ctx,
            ctx.match[1],
            STATUS.IN_PROGRESS,
            `✏️ ${safeBold("อัปเดตแล้ว")} — บันทึกเรียบร้อย`,
        ),
    );

    bot.action(/todo_(.+)/, (ctx) =>
        setStatus(
            ctx,
            ctx.match[1],
            STATUS.TODO,
            `↩️ ${safeBold("ย้ายกลับแล้ว")} — ยังไม่เสร็จก็ไม่เป็นไร`,
        ),
    );

    /* DELETE — confirmation first */
    bot.action(/del_(.+)/, async (ctx) => {
        const pageId = ctx.match[1];
        await ctx.answerCbQuery().catch(() => {});

        try {
            const title = await getPageTitle(pageId);
            return ctx.reply(
                `🗑️ ${safeBold("ลบ " + title + "?")}\n` +
                `การลบไม่สามารถยกเลิกได้\n` +
                `━━━━━━━━━━━━━━━━`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("✅ ยืนยันลบ", `confirm_del_${pageId}`),
                            Markup.button.callback("❌ ยกเลิก", `cancel_del_${pageId}`),
                        ],
                    ]),
                },
            );
        } catch (err) {
            logger.error("DELETE confirm fetch:", err);
            return ctx.reply(`❌ ${safeBold("ลบไม่ได้")} — กรุณาลองอีกครั้ง`, {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    });

    /* CONFIRM DELETE — actually archive */
    bot.action(/confirm_del_(.+)/, async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        try {
            await archivePage(ctx.match[1]);
            await ctx.editMessageReplyMarkup(undefined).catch(() => {});
            return ctx.reply(
                `🗑️ ${safeBold("ลบแล้ว")}\n` +
                `━━━━━━━━━━━━━━━━`,
                { parse_mode: "Markdown", ...dashboardMenu() },
            );
        } catch (err) {
            logger.error("DELETE confirm:", err);
            return ctx.reply(`❌ ${safeBold("ลบไม่ได้")} — กรุณาลองอีกครั้ง`, {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
    });

    /* CANCEL DELETE */
    bot.action(/cancel_del_(.+)/, async (ctx) => {
        await ctx.answerCbQuery("✅ ยกเลิกการลบ").catch(() => {});
        try {
            await ctx.deleteMessage();
        } catch {}
    });

    /* MORE OPTIONS (from compact confirm) */
    bot.action("MORE_OPTIONS", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);
        if (!state?.pending) {
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch(() => {});
        }
        await ctx.answerCbQuery().catch(() => {});
        const { title, subject, due, priority } = state.pending;
        const dueText = formatDueDisplay(due);
        const msg =
            `📝 ${safeBold("ตั้งค่าเพิ่มเติม")}\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `${subjectEmoji(subject)} ${safeBold(title)}\n` +
            `🎯 ${priority || "🟡 กลาง"}  |  📅 ${dueText}\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `เลือกรายการด้านล่าง`;

        return ctx.reply(msg, {
            parse_mode: "Markdown",
            ...moreOptionsMenu,
        });
    });

    /* BACK TO CONFIRM */
    bot.action("BACK_TO_CONFIRM", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);
        if (!state?.pending) {
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch(() => {});
        }
        await ctx.answerCbQuery().catch(() => {});
        await ctx.deleteMessage().catch(() => {});
        return showConfirm(ctx, state.pending);
    });
}
