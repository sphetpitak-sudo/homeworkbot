import { Markup } from "telegraf";
import {
    formatDueDisplay, formatDateLabel,
    parseYMDToLocalDate,
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
    restorePage,
    getPageProps,
    getPageTitle,
    getPageStatus,
} from "../services/notionService.js";

import { mainMenu, cancelMenu, showConfirm, compactConfirmMenu, moreOptionsMenu, errorWithRetry } from "./commandHandlers.js";
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

const hintsShown = new Map();  // uid -> { keys: Set, ts: number }
const deletedItems = new Map();
const HINT_TTL = 3_600_000; // 1 hour

/* ── session-scoped hint tracking ── */
const sessionHints = new Map(); // uid -> { keys: Set, ts: number }

function pruneHints(map) {
    const now = Date.now();
    for (const [uid, entry] of map) {
        if (now - entry.ts > HINT_TTL) map.delete(uid);
    }
}

function showOncePerSession(uid, key) {
    pruneHints(sessionHints);
    let entry = sessionHints.get(uid);
    if (!entry) { entry = { keys: new Set(), ts: Date.now() }; sessionHints.set(uid, entry); }
    entry.ts = Date.now();
    if (entry.keys.has(key)) return false;
    entry.keys.add(key);
    return true;
}

function showHintOnce(uid, key, message, extra = {}) {
    pruneHints(hintsShown);
    let entry = hintsShown.get(uid);
    if (!entry) { entry = { keys: new Set(), ts: Date.now() }; hintsShown.set(uid, entry); }
    entry.ts = Date.now();
    if (entry.keys.has(key)) return null;
    entry.keys.add(key);
    return { text: message, extra };
}

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
    const tagsStr = tags?.length ? tags.join("  ") : null;

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
    msg += `${bar} ${pct}% (${total} รายการ)\n`;
    msg += `📌 ${todo}  🔄 ${prog}  ✅ ${done}`;
    if (overduePages.length) msg += `  🚨 ${overduePages.length}`;
    msg += `\n`;

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
        const rows = [];
        for (const [subject, count] of sorted.slice(0, SUBJECT_DISPLAY_MAX)) {
            rows.push(`${subjectEmoji(subject)} ${safeBold(subject)} ${"█".repeat(Math.min(count, SUBJECT_BAR_MAX))} ${count}`);
        }
        for (let i = 0; i < rows.length; i += 2) {
            const left = rows[i];
            const right = rows[i + 1] || "";
            msg += `${left}${right ? `  ${right}` : ""}\n`;
        }
    }

    return msg;
}

/* ── register handlers ── */
export function registerActionHandlers(bot, userState) {
    /* ADD — carries PENDING_PARSE if available */
    bot.action("ADD", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);
        if (state?.mode === "PENDING_PARSE" && Date.now() - state._timestamp < 60000) {
            userState.set(uid, {
                mode: "CONFIRM", pending: state.pending,
                originalText: state.originalText, _timestamp: Date.now(),
            });
            await ctx.answerCbQuery().catch(() => {});
            return showConfirm(ctx, state.pending, state.pending._parseSource || "");
        }
        userState.set(uid, { mode: "ADD", _timestamp: Date.now() });
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

            const tip = showHintOnce(uid, "post_save",
                `💡 *เคล็ดลับ:* พิมพ์ /ask เพื่อถาม AI เกี่ยวกับการบ้าน`);
            if (tip) ctx.reply(tip.text, { parse_mode: "Markdown" }).catch(() => {});
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

    const ITEMS_PER_PAGE = 10;

    function renderListPage(pages, page, uid) {
        const start = page * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const display = pages.slice(start, end);
        const items = display.map(p => {
            const { title, status, due, subject, priority } = getPageProps(p);
            return `${statusEmoji(status)} ${safeBold(title)} ${subjectEmoji(subject)} ${priority} — ${formatDateLabel(due, "due")}`;
        });
        const totalPages = Math.ceil(pages.length / ITEMS_PER_PAGE);
        let msg = `📋 ${safeBold("งานที่ยังค้าง")} (${pages.length})\n━━━━━━━━━━━━━━━━━━\n${items.join("\n")}`;
        if (totalPages > 1) msg += `\n\nหน้า ${page + 1}/${totalPages}`;
        if (page === 0 && showOncePerSession(uid, "PRIORITY_LEGEND")) {
            msg += `\n━━━━━━━━━━━━━━━━━━\n🔴 สูง = ด่วน  🟡 กลาง = ปกติ  🟢 ต่ำ = ยังมีเวลา`;
        }
        return msg;
    }

    function renderDonePage(pages, page, uid) {
        const start = page * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const display = pages.slice(start, end);
        const items = display.map(p => {
            const { title, status, subject, priority, completed } = getPageProps(p);
            return `${statusEmoji(status)} ${safeBold(title)} ${subjectEmoji(subject)} ${priority} — ${formatDateLabel(completed, "completed")}`;
        });
        const totalPages = Math.ceil(pages.length / ITEMS_PER_PAGE);
        let msg = `✅ ${safeBold("งานที่ทำเสร็จแล้ว")} (${pages.length})\n━━━━━━━━━━━━━━━━━━\n${items.join("\n")}`;
        if (totalPages > 1) msg += `\n\nหน้า ${page + 1}/${totalPages}`;
        return msg;
    }

    function listKeyboard(type, page, totalPages) {
        const buttons = [];
        const nav = [];
        if (page > 0) nav.push(Markup.button.callback("◀ ก่อนหน้า", `LIST_PAGE_${type}_${page - 1}`));
        if (page < totalPages - 1) nav.push(Markup.button.callback("หน้าถัดไป ▶", `LIST_PAGE_${type}_${page + 1}`));
        if (nav.length) buttons.push(nav);
        buttons.push([
            Markup.button.callback("➕ เพิ่ม", "ADD"),
            Markup.button.callback("📊 Dashboard", "DASHBOARD"),
        ]);
        buttons.push([Markup.button.callback("🏠 หน้าหลัก", "HOME")]);
        return Markup.inlineKeyboard(buttons);
    }

    /* LIST ACTIVE — paginated */
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

            const uid = ctx.from.id;
            const totalPages = Math.ceil(pages.length / ITEMS_PER_PAGE);
            userState.set(uid, { mode: "LIST_VIEW", listType: "active", listItems: pages, listPage: 0, _timestamp: Date.now() });

            return ctx.reply(renderListPage(pages, 0, uid), {
                parse_mode: "Markdown",
                ...listKeyboard("active", 0, totalPages),
            });
        } catch (err) {
            logger.error("LIST_ACTIVE:", err);
            const errMsg = errorWithRetry("โหลดรายการงานค้างไม่ได้", "RETRY_FETCH_ACTIVE");
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
    });

    /* LIST DONE — paginated */
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

            const uid = ctx.from.id;
            const totalPages = Math.ceil(pages.length / ITEMS_PER_PAGE);
            userState.set(uid, { mode: "LIST_VIEW", listType: "done", listItems: pages, listPage: 0, _timestamp: Date.now() });

            return ctx.reply(renderDonePage(pages, 0), {
                parse_mode: "Markdown",
                ...listKeyboard("done", 0, totalPages),
            });
        } catch (err) {
            logger.error("LIST_DONE:", err);
            const errMsg = errorWithRetry("โหลดรายการงานเสร็จไม่ได้", "RETRY_FETCH_DONE");
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
    });

    /* LIST PAGE — pagination handler */
    bot.action(/LIST_PAGE_(\w+)_(\d+)/, async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        const uid = ctx.from.id;
        const state = userState.get(uid);
        const page = parseInt(ctx.match[2]);

        if (!state?.listItems || Date.now() - state._timestamp > 300_000) {
            return ctx.reply("⏱️ หมดเวลา กรุณากดรายการใหม่อีกครั้ง", {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }

        state.listPage = page;
        state._timestamp = Date.now();
        userState.set(uid, state);

        const pages = state.listItems;
        const totalPages = Math.ceil(pages.length / ITEMS_PER_PAGE);
        const renderer = state.listType === "done" ? renderDonePage : renderListPage;

        try {
            await ctx.editMessageText(renderer(pages, page, uid), {
                parse_mode: "Markdown",
                ...listKeyboard(state.listType, page, totalPages),
            });
        } catch {
            await ctx.reply(renderer(pages, page, uid), {
                parse_mode: "Markdown",
                ...listKeyboard(state.listType, page, totalPages),
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
            const errMsg = errorWithRetry("โหลด Dashboard ไม่ได้", "RETRY_FETCH_DASHBOARD");
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
    });

    /* STATUS helpers */
    async function setStatus(ctx, pageId, status, message) {
        try {
            const oldStatus = await getPageStatus(pageId);
            await updateStatus(pageId, status);
            await ctx.answerCbQuery().catch(() => {});

            const uid = ctx.from.id;
            const state = userState.get(uid) || {};
            state._lastAction = { type: "STATUS_CHANGE", pageId, from: oldStatus, to: status, _timestamp: Date.now() };
            userState.set(uid, state);

            await ctx.editMessageReplyMarkup(undefined).catch(() => {});
            const tip = showHintOnce(uid, "status_change",
                `💡 *รู้ไหม?* แก้ไขหรือลบได้ที่ปุ่มใต้การ์ดแต่ละรายการ\nหรือพิมพ์ /undo เพื่อยกเลิกการเปลี่ยนสถานะล่าสุด`);
            if (tip) {
                await ctx.reply(`${message}\n\n━━━━\n${tip.text}`, {
                    parse_mode: "Markdown",
                    ...dashboardMenu(),
                }).catch(() => {});
            } else {
                await ctx.reply(message, {
                    parse_mode: "Markdown",
                    ...dashboardMenu(),
                });
            }
        } catch (err) {
            logger.error("setStatus:", err);
            const action = status === STATUS.DONE ? "done" : status === STATUS.IN_PROGRESS ? "prog" : "todo";
            const errMsg = errorWithRetry(`อัปเดตสถานะ "${action}" ไม่ได้`, `RETRY_STATUS_${pageId}_${action}`);
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
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
            const errMsg = errorWithRetry("โหลดข้อมูลลบไม่ได้", "RETRY_FETCH_ACTIVE");
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
    });

    /* CONFIRM DELETE — actually archive + offer 10s recovery */
    bot.action(/confirm_del_(.+)/, async (ctx) => {
        const pageId = ctx.match[1];
        const uid = ctx.from.id;
        await ctx.answerCbQuery().catch(() => {});
        try {
            const name = await getPageTitle(pageId);
            await archivePage(pageId);
            await ctx.editMessageReplyMarkup(undefined).catch(() => {});

            deletedItems.set(uid, { pageId, name, _timestamp: Date.now() });

            const recoveryMsg = await ctx.reply(
                `🗑️ ${safeBold("ลบแล้ว")}\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `↩️ กู้คืนได้ใน 10 วินาที`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("↩️ กู้คืน", `RECOVER_DELETE_${pageId}`)],
                    ]),
                },
            );

            setTimeout(async () => {
                try {
                    await ctx.telegram.editMessageReplyMarkup(
                        ctx.chat.id, recoveryMsg.message_id, undefined, { inline_keyboard: [] },
                    );
                } catch {}
                deletedItems.delete(uid);
            }, 10000);
        } catch (err) {
            logger.error("DELETE confirm:", err);
            const errMsg = errorWithRetry("ลบไม่ได้", `RETRY_ARCHIVE_${pageId}`);
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
    });

    /* CANCEL DELETE */
    bot.action(/cancel_del_(.+)/, async (ctx) => {
        await ctx.answerCbQuery("✅ ยกเลิกการลบ").catch(() => {});
        try {
            await ctx.deleteMessage();
        } catch {}
    });

    /* RECOVER DELETE — restore archived page */
    bot.action(/RECOVER_DELETE_(.+)/, async (ctx) => {
        const pageId = ctx.match[1];
        const uid = ctx.from.id;
        const item = deletedItems.get(uid);
        if (!item || item.pageId !== pageId || Date.now() - item._timestamp > 10000) {
            return ctx.answerCbQuery("⏱️ หมดเวลากู้คืนแล้ว").catch(() => {});
        }
        try {
            await restorePage(pageId);
            deletedItems.delete(uid);
            await ctx.answerCbQuery("✅ กู้คืนสำเร็จ").catch(() => {});
            return ctx.reply(
                `↩️ ${safeBold("กู้คืนแล้ว")}\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `${safeBold(item.name)} ถูกนำกลับมาแล้ว`,
                { parse_mode: "Markdown", ...dashboardMenu() },
            );
        } catch (err) {
            logger.error("RECOVER_DELETE:", err);
            const errMsg = errorWithRetry("กู้คืนไม่ได้", `RETRY_ARCHIVE_${pageId}`);
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
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
