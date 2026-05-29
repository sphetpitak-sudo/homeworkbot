import { Markup } from "telegraf";
import {
    formatDate, formatDueDisplay, formatDateLabel,
    parseYMDToLocalDate, THAI_DAYS,
} from "../utils/dateParser.js";
import { detectSubject, subjectEmoji } from "../utils/subjectDetector.js";
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

import { mainMenu, cancelMenu, showConfirm, compactConfirmMenu, moreOptionsMenu, errorWithRetry, sortByUrgency, buildPanicCard } from "./commandHandlers.js";
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
    statusLabel,
    URGENT_DAYS,
    URGENT_DISPLAY_MAX,
    SUBJECT_BAR_MAX,
    SUBJECT_DISPLAY_MAX,
    PROGRESS_BAR_SLOTS,
} from "../utils/constants.js";
import { logger } from "../utils/logger.js";
import { setCorrection } from "../services/aiCache.js";
import { recordCompletion, getStreak } from "../services/streakService.js";
import { QUOTES } from "../utils/quotes.js";
import { askHint } from "../services/hintService.js";
import { checkBadges, checkTaskBadges, awardBadges, buildBadgeMessage } from "../services/badgeService.js";

const hintsShown = new Map();  // uid -> { keys: Set, ts: number }
const deletedItems = new Map();
const HINT_TTL = 3_600_000; // 1 hour
const HINT_MAX_ENTRIES = 1000;

// Periodic cleanup to prevent unbounded memory growth
setInterval(() => {
    pruneHints(hintsShown);
    pruneHints(sessionHints);
    const now = Date.now();
    for (const [uid, item] of deletedItems) {
        if (now - item._timestamp > 10000) deletedItems.delete(uid);
    }
    if (hintsShown.size > HINT_MAX_ENTRIES) {
        const sorted = [...hintsShown.entries()].sort((a, b) => a[1].ts - b[1].ts);
        const toDelete = sorted.slice(0, sorted.length - HINT_MAX_ENTRIES);
        for (const [uid] of toDelete) hintsShown.delete(uid);
    }
    if (sessionHints.size > HINT_MAX_ENTRIES) {
        const sorted = [...sessionHints.entries()].sort((a, b) => a[1].ts - b[1].ts);
        const toDelete = sorted.slice(0, sorted.length - HINT_MAX_ENTRIES);
        for (const [uid] of toDelete) sessionHints.delete(uid);
    }
}, HINT_TTL).unref();

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
/**
 * Build a comprehensive dashboard summary string.
 * Shows completion progress bar, urgent items (≤ URGENT_DAYS days),
 * overdue count, and subject breakdown with horizontal bars.
 */
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
            return showConfirm(ctx, state.pending, state.pending.parseSource || "");
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
        await ctx.answerCbQuery("ยกเลิกแล้ว ✅").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
                .catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        if (state._saving) {
            return ctx.answerCbQuery("⏳ กำลังบันทึก…").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }
        state._saving = true;
        userState.set(uid, state);

        const { title, subject, due, rawText, priority, tags } = state.pending;

        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));

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
            ).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));

            const tip = showHintOnce(uid, "post_save",
                `💡 *เคล็ดลับ:* พิมพ์ /ask เพื่อถาม AI เกี่ยวกับการบ้าน`);
            if (tip) ctx.reply(tip.text, { parse_mode: "Markdown" }).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            ).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }
    });

    /* CONFIRM EDIT */
    bot.action("CONFIRM_EDIT", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        userState.set(uid, { mode: "EDIT_TITLE", pending: state.pending, _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        userState.set(uid, { ...state, mode: "EDIT_SUBJECT", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        userState.set(uid, { ...state, mode: "EDIT_DATE", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        const current = state.pending.priority || PRIORITY.MEDIUM;
        const options = PRIORITY_ORDER.map((p) =>
            Markup.button.callback(
                `${p === current ? "✅ " : ""}${p}`,
                `SET_PRIORITY_${p}`,
            ),
        );

        userState.set(uid, { mode: "EDIT_PRIORITY", pending: state.pending, _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        userState.set(uid, { ...state, mode: "EDIT_TAGS", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        if (!PRIORITY_ORDER.includes(priority)) {
            return ctx.answerCbQuery("❌ ค่าความสำคัญไม่ถูกต้อง").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        const pending = { ...state.pending, priority, _manualPriority: true };
        userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
        await ctx.answerCbQuery(`✅ ตั้งค่า: ${priority}`).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        try {
            await ctx.deleteMessage();
        } catch {}
        return showConfirm(ctx, pending);
    });

    /* ASK AI */
    bot.action("ASK_AI", async (ctx) => {
        const uid = ctx.from.id;
        userState.set(uid, { mode: "ASK_AI", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));

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

    /* PANIC — same logic as /panic command */
    bot.action("PANIC", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มีการบ้านด่วน!")}\nพักผ่อนได้เลย 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const sorted = sortByUrgency(pages)
            const top3 = sorted.slice(0, 3)

            const keyboard = []
            for (const p of top3) {
                keyboard.push([
                    Markup.button.callback("✅ เสร็จ", `done_${p.id}`),
                    Markup.button.callback("🔄 กำลังทำ", `prog_${p.id}`),
                    Markup.button.callback("🗑️ ลบ", `del_${p.id}`),
                ])
            }
            keyboard.push([
                Markup.button.callback("➕ เพิ่ม", "ADD"),
                Markup.button.callback("📋 ค้าง", "LIST_ACTIVE"),
                Markup.button.callback("🏠 หน้าหลัก", "HOME"),
            ])

            let msg = `🚨 ${safeBold("โหมดฉุกเฉิน!")}\n`
            msg += `━━━━━━━━━━━━━━━━━━\n`
            msg += `${top3.length} งานที่ควรทำที่สุดตอนนี้\n`
            msg += `━━━━━━━━━━━━━━━━━━\n\n`
            for (const p of top3) {
                msg += `${buildPanicCard(p)}\n\n`
            }
            msg += `💪 ${safeBold("เริ่มจากอันแรกเลย!")}`

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("PANIC action:", err)
            const errMsg = errorWithRetry("โหลดข้อมูลไม่ได้", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    /* TOMORROW — same logic as /tomorrow command */
    bot.action("TOMORROW", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        try {
            const pages = await fetchActive()
            const tomorrow = new Date()
            tomorrow.setDate(tomorrow.getDate() + 1)
            const tomorrowStr = formatDate(tomorrow)

            const dueTomorrow = pages.filter(p => {
                const due = p.properties.Due?.date?.start
                return due === tomorrowStr
            })

            if (!dueTomorrow.length) {
                return ctx.reply(
                    `🎉 ${safeBold("พรุ่งนี้ไม่มีการบ้านส่ง!")}\nไปเที่ยวได้เลย 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const today = new Date(); today.setHours(0, 0, 0, 0)
            const keyboard = []
            for (const p of dueTomorrow) {
                keyboard.push([
                    Markup.button.callback("✅ เสร็จ", `done_${p.id}`),
                    Markup.button.callback("🔄 กำลังทำ", `prog_${p.id}`),
                    Markup.button.callback("🗑️ ลบ", `del_${p.id}`),
                ])
            }
            keyboard.push([
                Markup.button.callback("➕ เพิ่ม", "ADD"),
                Markup.button.callback("🚨 ฉุกเฉิน", "PANIC"),
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                Markup.button.callback("🏠 หน้าหลัก", "HOME"),
            ])

            let msg = `📅 ${safeBold("งานที่ต้องส่งพรุ่งนี้")} (${dueTomorrow.length} รายการ)\n`
            msg += `━━━━━━━━━━━━━━━━━━\n\n`
            for (const p of dueTomorrow) {
                const { title, status, due, subject, priority } = getPageProps(p)
                const dt = due ? parseYMDToLocalDate(due) : null
                const diff = dt ? Math.ceil((dt - today) / 86400000) : null
                let badge = ""
                if (diff !== null && diff < 0) {
                    badge = ` 🚨 (เลย ${Math.abs(diff)} วัน!)`
                }
                msg += `${statusEmoji(status)} ${safeBold(title)} ${badge}\n`
                msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}\n\n`
            }
            msg += `💪 ${safeBold("เตรียมตัวให้พร้อม!")}`

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("TOMORROW action:", err)
            const errMsg = errorWithRetry("โหลดข้อมูลไม่ได้", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    /* SEARCH */
    bot.action("SEARCH", async (ctx) => {
        const uid = ctx.from.id
        userState.set(uid, { mode: "SEARCH", _timestamp: Date.now() })
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        return ctx.reply(
            `🔍 ${safeBold("ค้นหาการบ้าน")}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `พิมพ์คำที่ต้องการค้นหา\n` +
            `เช่น ${safeCode("คณิต")} หรือ ${safeCode("แคลคูลัส")}\n` +
            `━━━━━━━━━━━━━━━━━━`,
            { parse_mode: "Markdown", ...cancelMenu },
        )
    })

    /* WEEK */
    bot.action("WEEK", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        try {
            const pages = await fetchActive()

            const today = new Date(); today.setHours(0, 0, 0, 0)
            const dayOfWeek = today.getDay()
            const mon = new Date(today)
            mon.setDate(today.getDate() - ((dayOfWeek + 6) % 7))

            const days = []
            let totalCount = 0
            for (let i = 0; i < 7; i++) {
                const d = new Date(mon)
                d.setDate(mon.getDate() + i)
                const dateStr = formatDate(d)
                const items = pages.filter(p => p.properties.Due?.date?.start === dateStr)
                const isToday = dateStr === formatDate(today)
                days.push({ date: d, dateStr, items, isToday })
                totalCount += items.length
            }

            const noDueItems = pages.filter(p => !p.properties.Due?.date?.start)

            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มีการบ้านอาทิตย์นี้เลย!")}\nพักผ่อนได้ 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            let msg = `📅 ${safeBold("ตารางประจำสัปดาห์")}\n`
            msg += `━━━━━━━━━━━━━━━━━━━━\n\n`
            for (const day of days) {
                const dayName = THAI_DAYS[day.date.getDay()]
                const dateLabel = `${day.date.getDate()} ${["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][day.date.getMonth()]}`
                const prefix = day.isToday ? ">>> 📌 " : ""
                const countLabel = day.items.length
                    ? `(${day.items.length} งาน)`
                    : "(✅ ว่าง)"
                msg += `${prefix}${dayName} ${dateLabel}  ${countLabel}\n`

                for (const p of day.items) {
                    const { title, status, due, subject, priority } = getPageProps(p)
                    const dt = due ? parseYMDToLocalDate(due) : null
                    const diff = dt ? Math.ceil((dt - today) / 86400000) : null
                    const dayLabel = diff !== null
                        ? (diff < 0 ? `เลย ${Math.abs(diff)} วัน` : (diff === 0 ? "วันนี้!" : `อีก ${diff} วัน`))
                        : ""
                    msg += `  ${statusEmoji(status)} ${safeBold(title)}  ${priority}`
                    if (dayLabel) msg += ` — ${dayLabel}`
                    msg += `\n`
                }
                msg += `━━━━━━━━━━━━━━━━━━━━\n`
            }

            if (noDueItems.length) {
                msg += `📌 ไม่มีกำหนด (${noDueItems.length} รายการ)\n`
                for (const p of noDueItems) {
                    const { title, status, subject, priority } = getPageProps(p)
                    msg += `  ${statusEmoji(status)} ${safeBold(title)} ${subjectEmoji(subject)} ${priority}\n`
                }
                msg += `━━━━━━━━━━━━━━━━━━━━\n`
            }

            msg += `\n📊 รวม ${totalCount} งานในสัปดาห์นี้`

            if (noDueItems.length) {
                msg += ` (+ ${noDueItems.length} ไม่มีกำหนด)`
            }

            const keyboard = [
                [
                    Markup.button.callback("➕ เพิ่ม", "ADD"),
                    Markup.button.callback("🚨 ฉุกเฉิน", "PANIC"),
                ],
                [
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                    Markup.button.callback("🏠 หน้าหลัก", "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("WEEK action:", err)
            const errMsg = errorWithRetry("โหลดตารางไม่ได้", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    /* DEADLINE */
    bot.action("DEADLINE", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มี deadline!")}\nพักผ่อนได้เลย 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const now = new Date()
            const today = new Date(); today.setHours(0, 0, 0, 0)

            let closest = null
            let closestDiff = Infinity
            for (const p of pages) {
                const due = p.properties.Due?.date?.start
                if (!due) continue
                const dt = parseYMDToLocalDate(due)
                const diff = Math.ceil((dt - today) / 86400000)
                if (Math.abs(diff) < Math.abs(closestDiff)) {
                    closest = p
                    closestDiff = diff
                }
            }

            if (!closest) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มี deadline!")}\nพักผ่อนได้เลย 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const { title, status, due, subject, priority } = getPageProps(closest)
            const dt = parseYMDToLocalDate(due)
            const diffMs = dt - now
            const absDiffMs = Math.abs(diffMs)
            const totalDays = Math.floor(absDiffMs / 86400000)
            const totalHours = Math.floor((absDiffMs % 86400000) / 3600000)
            const totalMinutes = Math.floor((absDiffMs % 3600000) / 60000)

            let badge, urgency
            if (closestDiff < 0) {
                badge = "🚨"
                urgency = `เลยกำหนด ${Math.abs(closestDiff)} วัน`
            } else if (closestDiff <= 3) {
                badge = "🔥"
                urgency = `เหลือ ${closestDiff} วัน`
            } else if (closestDiff <= 7) {
                badge = "⏰"
                urgency = `เหลือ ${closestDiff} วัน`
            } else {
                badge = "📅"
                urgency = `อีก ${closestDiff} วัน`
            }

            const barSlots = 20
            const totalAvailable = closestDiff > 0 ? closestDiff + 14 : 14
            const elapsed = totalAvailable - (closestDiff > 0 ? closestDiff : 0)
            const filled = Math.max(0, Math.min(barSlots, Math.round((elapsed / totalAvailable) * barSlots)))
            const bar = "█".repeat(filled) + "░".repeat(barSlots - filled)

            let msg = `⏰ ${safeBold("นับถอยหลัง")}\n`
            msg += `━━━━━━━━━━━━━━━━━━\n`
            msg += `${badge} ${safeBold("งานด่วน!")}\n\n`
            msg += `${subjectEmoji(subject)} ${safeBold(title)}\n`
            msg += `${safeBold(subject)} ${priority}  |  ${urgency}\n\n`
            msg += `${bar}\n`

            if (closestDiff < 0) {
                msg += `⏱️  เลยกำหนดมา ${totalDays} วัน ${totalHours} ชม. แล้ว!\n\n`
            } else {
                msg += `⏱️  เหลือ ${totalDays} วัน ${totalHours} ชม. ${totalMinutes} นาที\n\n`
            }

            msg += `📅 ${formatDueDisplay(due)}`

            const keyboard = [
                [
                    Markup.button.callback("✅ เสร็จ", `done_${closest.id}`),
                    Markup.button.callback("🔄 กำลังทำ", `prog_${closest.id}`),
                    Markup.button.callback("🗑️ ลบ", `del_${closest.id}`),
                ],
                [
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                    Markup.button.callback("🏠 หน้าหลัก", "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("DEADLINE action:", err)
            const errMsg = errorWithRetry("โหลดข้อมูลไม่ได้", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    /* PROGRESS */
    bot.action("PROGRESS", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        try {
            const [activePages, donePages] = await Promise.all([fetchActive(), fetchDone()])

            const bySubject = {}
            for (const p of activePages) {
                const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
                if (!bySubject[sub]) bySubject[sub] = { done: 0, total: 0 }
                bySubject[sub].total++
            }
            for (const p of donePages) {
                const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
                if (!bySubject[sub]) bySubject[sub] = { done: 0, total: 0 }
                bySubject[sub].done++
                bySubject[sub].total++
            }

            const entries = Object.entries(bySubject)
            if (!entries.length) {
                return ctx.reply(
                    `📊 ${safeBold("ยังไม่มีการบ้านในระบบ")}\nลองเพิ่มการบ้านก่อน!`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const sorted = entries
                .map(([sub, stats]) => ({
                    subject: sub,
                    pct: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
                    done: stats.done,
                    total: stats.total,
                }))
                .sort((a, b) => a.pct - b.pct)

            let msg = `📊 ${safeBold("ความคืบหน้าแยกวิชา")}\n`
            msg += `━━━━━━━━━━━━━━━━━━━━\n\n`

            let totalDone = 0, totalAll = 0
            for (const s of sorted) {
                const filled = Math.max(0, Math.min(10, Math.round(s.pct / 10)))
                const bar = "█".repeat(filled) + "░".repeat(10 - filled)
                const pctStr = s.pct === 100 ? "🎉" : `${s.pct}%`
                msg += `${subjectEmoji(s.subject)} ${safeBold(s.subject)}  ${bar}  ${pctStr} (${s.done}/${s.total})\n`
                totalDone += s.done
                totalAll += s.total
            }

            const totalPct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0
            msg += `\n━━━━━━━━━━━━━━━━━━━━\n`
            msg += `📈 รวม: ${totalDone}/${totalAll} เสร็จ  ${totalPct}%`

            const keyboard = [
                [
                    Markup.button.callback("➕ เพิ่ม", "ADD"),
                    Markup.button.callback("🚨 ฉุกเฉิน", "PANIC"),
                ],
                [
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                    Markup.button.callback("🏠 หน้าหลัก", "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("PROGRESS action:", err)
            const errMsg = errorWithRetry("โหลดข้อมูลไม่ได้", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    /* QUOTE */
    bot.action("QUOTE", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        const uid = ctx.from.id
        const state = userState.get(uid)
        let idx = Math.floor(Math.random() * QUOTES.length)
        if (state?._lastQuote === idx) {
            idx = (idx + 1) % QUOTES.length
        }
        userState.set(uid, { ...state, _lastQuote: idx, _timestamp: Date.now() })
        const quote = QUOTES[idx]
        const msg =
            `💬 "${escapeMarkdown(quote.text)}"\n\n` +
            `— ${escapeMarkdown(quote.author)}\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `💪 ${safeBold("สู้ๆ นะ!")}`
        const keyboard = [
            [
                Markup.button.callback("💬 อีกคำคม", "QUOTE"),
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
            ],
            [Markup.button.callback("🏠 หน้าหลัก", "HOME")],
        ]
        return ctx.reply(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(keyboard),
        })
    })

    /* HINT — subject picker */
    bot.action(/HINT_(.+)/, async (ctx) => {
        const subject = ctx.match[1]
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        try {
            const pages = await fetchActive()
            const kw = subject.toLowerCase()
            const filtered = pages.filter(p => {
                const subj = (p.properties.Subject?.rich_text?.[0]?.plain_text || "").toLowerCase()
                return subj === kw || subj.includes(kw)
            })

            const hint = await askHint(subject, filtered)

            if (!hint) {
                return ctx.reply(
                    `📭 ${safeBold(`ไม่มีงานวิชา ${subject} ค้างอยู่`)}\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `ลองเลือกวิชาอื่น หรือเพิ่มการบ้านก่อน!`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            return ctx.reply(hint, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("HINT action:", err)
            const errMsg = errorWithRetry("ขออภัย เกิดข้อผิดพลาด", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    /* EXPORT */
    bot.action("EXPORT", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        try {
            const [activePages, donePages] = await Promise.all([fetchActive(), fetchDone()])
            const today = formatDate(new Date())

            if (!activePages.length && !donePages.length) {
                return ctx.reply(
                    `📭 ${safeBold("ยังไม่มีการบ้านในระบบ")}\nลองเพิ่มการบ้านก่อน!`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            let text = `📋 รายการการบ้าน (export ${today})\n`
            text += `=====================================\n\n`

            if (activePages.length) {
                text += `📌 ยังไม่เสร็จ (${activePages.length}):\n`
                activePages.forEach((p, i) => {
                    const { title, subject, due, priority } = getPageProps(p)
                    const dueStr = due ? `ส่ง ${due.slice(5).replace("-", "/")}` : "ไม่มีกำหนด"
                    text += `  ${i + 1}. [${subject}] ${title} — ${dueStr} ${priority}\n`
                })
                text += `\n`
            }

            if (donePages.length) {
                text += `✅ ทำเสร็จแล้ว (${donePages.length}):\n`
                donePages.forEach((p, i) => {
                    const { title, subject, completed, priority } = getPageProps(p)
                    const doneStr = completed ? `เสร็จ ${completed.slice(5).replace("-", "/")}` : "เสร็จแล้ว"
                    text += `  ${i + 1}. [${subject}] ${title} — ${doneStr} ${priority}\n`
                })
                text += `\n`
            }

            const total = activePages.length + donePages.length
            const pct = total > 0 ? Math.round((donePages.length / total) * 100) : 0
            text += `=====================================\n`
            text += `รวม ${total} รายการ | เสร็จ ${pct}%\n`

            const msg =
                `📋 ${safeBold("รายการการบ้าน (export)")}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `${safeCode(text)}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `💡 คัดลอกข้อความในกรอบไปแชร์ต่อได้เลย!`

            const keyboard = [
                [
                    Markup.button.callback("➕ เพิ่ม", "ADD"),
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                ],
                [Markup.button.callback("🏠 หน้าหลัก", "HOME")],
            ]
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("EXPORT action:", err)
            const errMsg = errorWithRetry("ส่งออกไม่ได้", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    /* NOTED — select page from results */
    bot.action(/NOTED_SEL_(\d+)/, async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid)
        if (!state?._pendingNoted) {
            return ctx.answerCbQuery("⏱️ หมดเวลา กรุณาลองใหม่").catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        }
        const idx = parseInt(ctx.match[1])
        const { matched, note } = state._pendingNoted
        if (idx < 0 || idx >= matched.length) {
            return ctx.answerCbQuery("❌ ไม่พบรายการ").catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        }
        try {
            const page = matched[idx]
            const { title } = getPageProps(page)
            await updateHomework(page.id, { note })
            userState.delete(uid)
            await ctx.answerCbQuery("✅ เพิ่มโน๊ตแล้ว").catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
            return ctx.reply(
                `📝 ${safeBold("เพิ่มโน๊ตแล้ว!")}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📌 "${escapeMarkdown(title)}"\n` +
                `📝 ${escapeMarkdown(note)}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("NOTED_SEL:", err)
            return ctx.answerCbQuery("❌ บันทึกไม่ได้").catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        }
    })

    /* FOCUS_NEXT — skip to next task */
    bot.action("FOCUS_NEXT", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid)
        const pages = state?._focusPages
        const currentIdx = state?._focusIndex ?? 0

        if (!pages || !pages.length || currentIdx + 1 >= pages.length) {
            await ctx.answerCbQuery("⏱️ ไม่มีงานถัดไป").catch(() => {})
            return ctx.reply(
                `🎉 ${safeBold("ครบทุกงานแล้ว!")}\nพักผ่อนได้เลย 🏆`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        const nextIdx = currentIdx + 1
        const page = pages[nextIdx]
        const { title, status, due, subject, priority } = getPageProps(page)
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const dt = due ? parseYMDToLocalDate(due) : null
        const diff = dt ? Math.ceil((dt - today) / 86400000) : null

        let badge = ""
        if (diff !== null && diff < 0) {
            badge = ` 🚨 เลย ${Math.abs(diff)} วัน`
        } else if (diff !== null && diff <= 3) {
            badge = ` 🔥 เหลือ ${diff} วัน`
        } else if (diff !== null && diff <= 7) {
            badge = ` ⏰ เหลือ ${diff} วัน`
        }

        let msg = `🎯 ${safeBold("โฟกัสงานนี้!")}\n`
        msg += `━━━━━━━━━━━━━━━━━━\n\n`
        msg += `${statusEmoji(status)} ${safeBold(title)}${badge}\n`
        msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  ${formatDueDisplay(due)}\n\n`
        msg += `━━━━━━━━━━━━━━━━━━\n`
        msg += `📊 งาน ${nextIdx + 1} จาก ${pages.length} รายการ`

        const hasNext = nextIdx + 1 < pages.length
        const keyboard = [
            [
                Markup.button.callback("✅ เสร็จ", `done_${page.id}`),
                Markup.button.callback("🔄 กำลังทำ", `prog_${page.id}`),
            ],
        ]
        if (hasNext) {
            keyboard.push([Markup.button.callback("⏩ ข้ามไปข้อถัดไป", "FOCUS_NEXT")])
        }
        keyboard.push([
            Markup.button.callback("📋 ดูทั้งหมด", "LIST_ACTIVE"),
            Markup.button.callback("🏠 หน้าหลัก", "HOME"),
        ])

        userState.set(uid, {
            ...state,
            _focusIndex: nextIdx,
            _focusPages: pages,
            _timestamp: Date.now(),
        })

        await ctx.answerCbQuery().catch(() => {})
        try {
            await ctx.editMessageText(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch {
            await ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        }
    })

    /* STREAK */
    bot.action("STREAK", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        const uid = ctx.from.id
        const streak = getStreak(uid)
        const calendar = getStreakCalendar(uid)
        const nextMilestone = getNextMilestone(streak.current)

        if (!streak.current) {
            return ctx.reply(
                `🔥 ${safeBold("ยังไม่มีสถิติ Streak")}\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `เริ่มต้นด้วยการกด ✅ เสร็จจากการบ้านเลย!\n` +
                `💪 ทำติดต่อกันทุกวันเพื่อรักษาไฟนี้ไว้`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        let msg = `🔥 ${safeBold("สถิติการทำการบ้าน")}\n`
        msg += `━━━━━━━━━━━━━━━━━━\n`
        const fireEmojis = streak.current >= 30 ? "🔥🔥🔥" : streak.current >= 14 ? "🔥🔥" : "🔥"
        msg += `${fireEmojis} Streak ปัจจุบัน: ${streak.current} วัน\n`
        msg += `🏆 สูงสุดตลอดกาล: ${streak.best} วัน\n`
        msg += `━━━━━━━━━━━━━━━━━━\n`

        if (calendar.length) {
            msg += `📅 7 วันล่าสุด:\n\n`
            const dayNames = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."]
            const today = new Date()
            const weekMarks = []
            const weekDays = []
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today)
                d.setDate(d.getDate() - i)
                weekDays.push(dayNames[d.getDay()])
                const dateStr = d.toISOString().slice(0, 10)
                const cal = calendar.find(c => c.date === dateStr)
                weekMarks.push(cal?.done ? "✅" : "❌")
            }
            msg += `${weekMarks.join(" ")}\n`
            msg += `${weekDays.join("  ")}\n`
            msg += `━━━━━━━━━━━━━━━━━━\n`
        }

        if (nextMilestone) {
            const remaining = nextMilestone - streak.current
            msg += `🎯 เป้าหมายต่อไป: ${nextMilestone} วัน (อีก ${remaining} วัน)\n`
        }

        msg += `💪 รักษาไฟนี้ไว้!`

        const keyboard = [
            [
                Markup.button.callback("➕ เพิ่ม", "ADD"),
                Markup.button.callback("🔥 Streak", "STREAK"),
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
            ],
            [Markup.button.callback("🏠 หน้าหลัก", "HOME")],
        ]
        return ctx.reply(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(keyboard),
        })
    })

    /* STATUS helpers */
    async function setStatus(ctx, pageId, status, message) {
        try {
            const oldStatus = await getPageStatus(pageId);
            await updateStatus(pageId, status);
            await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));

            const uid = ctx.from.id;
            const state = userState.get(uid) || {};
            state._lastAction = { type: "STATUS_CHANGE", pageId, from: oldStatus, to: status, _timestamp: Date.now() };
            userState.set(uid, state);

            let streakMsg = ""
            if (status === STATUS.DONE) {
                try {
                    const result = recordCompletion(uid)
                    if (result.isNewMilestone) {
                        streakMsg = `\n\n🎉🎉🎉 *ครบ ${result.current} วันติดแล้ว!* 🔥🔥🔥\n💪 รักษา streak ต่อไป!`
                    }
                    // award streak badges
                    const newBadgeIds = checkBadges(uid)
                    const awarded = awardBadges(uid, newBadgeIds)
                    if (awarded.length) {
                        streakMsg += `\n\n🏅 ${safeBold("ปลดล็อกเหรียญใหม่!")}\n`
                        for (const b of awarded) {
                            streakMsg += `${b.icon} ${b.name} — ${b.desc}\n`
                        }
                    }
                    // award task count badges
                    try {
                        const donePages = await fetchDone()
                        const totalDone = donePages.length
                        const taskBadgeIds = checkTaskBadges(uid, totalDone)
                        const taskAwarded = awardBadges(uid, taskBadgeIds)
                        if (taskAwarded.length) {
                            for (const b of taskAwarded) {
                                streakMsg += `\n\n🏅 ${b.icon} ${safeBold(b.name)} — ${b.desc}!`
                            }
                        }
                    } catch (e) {
                        logger.debug("Task badge check error:", e?.message)
                    }
                } catch (e) {
                    logger.debug("Streak record error:", e?.message)
                }
            }

            await ctx.editMessageReplyMarkup(undefined).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
            const tip = showHintOnce(uid, "status_change",
                `💡 *รู้ไหม?* แก้ไขหรือลบได้ที่ปุ่มใต้การ์ดแต่ละรายการ\nหรือพิมพ์ /undo เพื่อยกเลิกการเปลี่ยนสถานะล่าสุด`);
            const fullMsg = message + streakMsg
            if (tip) {
                await ctx.reply(`${fullMsg}\n\n━━━━\n${tip.text}`, {
                    parse_mode: "Markdown",
                    ...dashboardMenu(),
                }).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
            } else {
                await ctx.reply(fullMsg, {
                    parse_mode: "Markdown",
                    ...dashboardMenu(),
                });
            }
        } catch (err) {
            logger.error("setStatus:", err);
            await ctx.answerCbQuery("❌ " + (err?.message || "Error")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));

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
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        try {
            const name = await getPageTitle(pageId);
            await archivePage(pageId);
            await ctx.editMessageReplyMarkup(undefined).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));

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

            setTimeout(() => {
                deletedItems.delete(uid);
                ctx.telegram.editMessageReplyMarkup(
                    ctx.chat.id, recoveryMsg.message_id, undefined, { inline_keyboard: [] },
                ).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
            }, 10000);
        } catch (err) {
            logger.error("DELETE confirm:", err);
            const errMsg = errorWithRetry("ลบไม่ได้", `RETRY_ARCHIVE_${pageId}`);
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
    });

    /* CANCEL DELETE */
    bot.action(/cancel_del_(.+)/, async (ctx) => {
        await ctx.answerCbQuery("✅ ยกเลิกการลบ").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            return ctx.answerCbQuery("⏱️ หมดเวลากู้คืนแล้ว").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }
        try {
            await restorePage(pageId);
            deletedItems.delete(uid);
            await ctx.answerCbQuery("✅ กู้คืนสำเร็จ").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            return ctx.answerCbQuery("❌ ไม่มีข้อมูล").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        await ctx.deleteMessage().catch(() => {});
        return showConfirm(ctx, state.pending);
    });

    /* BADGES */
    bot.action("BADGES", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        const uid = ctx.from.id
        const msg = buildBadgeMessage(uid)
        const keyboard = [
            [
                Markup.button.callback("🔥 Streak", "STREAK"),
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
            ],
            [Markup.button.callback("🏠 หน้าหลัก", "HOME")],
        ]
        return ctx.reply(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(keyboard),
        })
    })

    /* REVIEW */
    bot.action("REVIEW", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        try {
            const donePages = await fetchDone()
            if (!donePages.length) {
                return ctx.reply(
                    `📭 ${safeBold("ยังไม่มีการบ้านที่ทำเสร็จ")}\n` +
                    `ลองทำการบ้านให้เสร็จก่อน แล้วกลับมาดูสรุป!`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const lineList = donePages.slice(0, 20).map((p, i) => {
                const { title, subject, priority, completed } = getPageProps(p)
                const doneDate = completed ? completed.slice(5).replace("-", "/") : "?"
                return `${i + 1}. [${subject}] ${title} — เสร็จ ${doneDate} ${priority}`
            }).join("\n")

            const total = donePages.length
            const today = new Date(); today.setHours(0, 0, 0, 0)
            const weekAgo = new Date(today)
            weekAgo.setDate(today.getDate() - 7)
            const weekCount = donePages.filter(p => {
                const d = p.properties.Completed?.date?.start
                return d && new Date(d + "T00:00:00") >= weekAgo
            }).length

            const bySubject = {}
            for (const p of donePages) {
                const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
                bySubject[sub] = (bySubject[sub] || 0) + 1
            }
            const topSubject = Object.entries(bySubject)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([s, c]) => `${subjectEmoji(s)} ${s} (${c})`)
                .join(", ")

            let msg = `📋 ${safeBold("สรุปการบ้านที่ทำเสร็จแล้ว")}\n`
            msg += `━━━━━━━━━━━━━━━━━━\n\n`
            msg += `✅ เสร็จทั้งหมด: ${total} รายการ\n`
            msg += `📅 สัปดาห์นี้: ${weekCount} รายการ\n`
            if (topSubject) msg += `📚 วิชาที่ทำมากสุด: ${topSubject}\n`
            msg += `\n━━━━━━━━━━━━━━━━━━\n`
            msg += `📌 ${safeBold("รายการล่าสุด (สูงสุด 20):")}\n\n`
            msg += `${lineList}`

            if (total > 20) {
                msg += `\n\n… และอีก ${total - 20} รายการ`
            }

            msg += `\n\n💪 ${safeBold("เก่งมาก! ทำต่อไป!")}`

            const keyboard = [
                [
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                    Markup.button.callback("🏠 หน้าหลัก", "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("REVIEW action:", err)
            const errMsg = errorWithRetry("โหลดข้อมูลไม่ได้", "RETRY_FETCH_DONE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })
}
