import { Markup } from "telegraf";
import {
    formatDate, formatDueDisplay, formatDateLabel,
    parseYMDToLocalDate,
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

import { mainMenu, cancelMenu, showConfirm, moreOptionsMenu, errorWithRetry, sortByUrgency, buildPanicCard } from "./commandHandlers.js";
import { buildPanic, buildTomorrow, buildWeek, buildDeadline, buildProgress } from "./viewBuilders.js";
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
import { recordCompletion, getStreak, getNextMilestone } from "../services/streakService.js";
import { QUOTES } from "../utils/quotes.js";
import { getStudyTip } from "../services/hintService.js";
import { checkBadges, checkTaskBadges, checkUsageBadgeOnAction, awardBadges, buildBadgeMessage } from "../services/badgeService.js";
import { startSession as pomoStartSession, savePomodoro, getStats as pomoGetStats, getStreak as pomoGetStreak, getSessionDuration, getBreakDuration, checkPomoBadges } from "../services/pomodoroService.js";

/* ── pomodoro timer tracking for graceful shutdown ── */
const pomoTimers = new Set()
export function cleanupPomoTimers() {
    for (const t of pomoTimers) clearTimeout(t)
    pomoTimers.clear()
}
function trackPomoTimer(t) {
    pomoTimers.add(t)
    t._pomoTimerId = Symbol()
}
import crypto from "crypto";

const hintsShown = new Map();  // uid -> { keys: Set, ts: number }
const deletedItems = new Map();
const HINT_TTL = 3_600_000; // 1 hour
const HINT_MAX_ENTRIES = 1000;

// Periodic cleanup to prevent unbounded memory growth.
// Idempotent: only one interval is ever scheduled, even if
// registerActionHandlers is called more than once (e.g. hot reload).
let cleanupIntervalStarted = false
function startCleanupInterval() {
    if (cleanupIntervalStarted) return
    cleanupIntervalStarted = true
    setInterval(() => {
        pruneHints(hintsShown)
        pruneHints(sessionHints)
        const now = Date.now()
        for (const [uid, item] of deletedItems) {
            if (now - item._timestamp > 10000) deletedItems.delete(uid)
        }
        if (hintsShown.size > HINT_MAX_ENTRIES) {
            const sorted = [...hintsShown.entries()].sort((a, b) => a[1].ts - b[1].ts)
            const toDelete = sorted.slice(0, sorted.length - HINT_MAX_ENTRIES)
            for (const [uid] of toDelete) hintsShown.delete(uid)
        }
        if (sessionHints.size > HINT_MAX_ENTRIES) {
            const sorted = [...sessionHints.entries()].sort((a, b) => a[1].ts - b[1].ts)
            const toDelete = sorted.slice(0, sorted.length - HINT_MAX_ENTRIES)
            for (const [uid] of toDelete) sessionHints.delete(uid)
        }
    }, HINT_TTL).unref()
}
startCleanupInterval()

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
            Markup.button.callback("🏠 เมนูหลัก", "HOME"),
        ],
    ]);
}

function listFooterMenu() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("➕ เพิ่ม", "ADD"),
            Markup.button.callback("📊 Dashboard", "DASHBOARD"),
        ],
        [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
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

    let msg = `📊 ${safeBold("ภาพรวมการบ้าน")}\n\n`;
    msg += `${bar} ${pct}%\n`;
    msg += `📌 ${todo}  🔄 ${prog}  ✅ ${done}`;
    if (overduePages.length) msg += `  🚨 ${overduePages.length}`;
    msg += `\n`;

    if (urgent.length) {
        msg += `\n⚡ ใกล้ครบ (${URGENT_DAYS} วัน)\n`;
        for (const p of urgent.slice(0, URGENT_DISPLAY_MAX)) {
            const { title, due, status, subject, priority } = getPageProps(p);
            msg += `${statusEmoji(status)} ${escapeMarkdown(title)}  ${priority} ${subjectEmoji(subject)}${formatDueDisplay(due)}\n`;
        }
        if (urgent.length > URGENT_DISPLAY_MAX) {
            msg += `… +${urgent.length - URGENT_DISPLAY_MAX}\n`;
        }
    }

    msg += `\n📖 วิชาที่ค้าง\n`;
    const sorted = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
        msg += `🎉 ไม่มีค้าง\n`;
    } else {
        for (const [subject, count] of sorted.slice(0, SUBJECT_DISPLAY_MAX)) {
            msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)}  ${"█".repeat(Math.min(count, SUBJECT_BAR_MAX))} ${count}\n`;
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
            `✏️ ${safeBold("เพิ่มการบ้านใหม่")}\n\n` +
                `พิมพ์การบ้าน เช่น\n` +
                `${safeCode("คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้")}\n` +
                `${safeCode("รายงานอังกฤษ วันศุกร์")}\n` +
                `${safeCode("ชีวะ บทที่ 3 อีก 3 วัน")}\n\n` +
                `🤖 ระบบเดาวิชา + วันที่ให้อัตโนมัติ`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* CANCEL */
    bot.action("CANCEL", async (ctx) => {
        userState.delete(ctx.from.id);
        await ctx.answerCbQuery("ยกเลิกแล้ว ✅").catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        try {
            await ctx.editMessageText(
                `❌ ${safeBold("ยกเลิกแล้ว")}\n`,
                { parse_mode: "Markdown", ...mainMenu },
            );
        } catch {
            await ctx.reply(
                `❌ ${safeBold("ยกเลิกแล้ว")}\n`,
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
                    `\n` +
                    `${subjectEmoji(subject)} ${safeBold(title)}\n` +
                    `📚 ${safeSubject} • ${priText}\n` +
                    `📅 ${dueText}\n` +
                    `\n` +
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
                    `\n` +
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
                `\n` +
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
                `\n` +
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
                `\n` +
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
                `\n` +
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
                `\n` +
                `แท็กที่มี: ${VALID_TAGS.join(", ")}\n\n` +
                `พิมพ์แท็กที่ต้องการ คั่นด้วยช่องว่าง\n` +
                `เช่น สอบ ด่วน อ่าน\n` +
                `หรือพิมพ์ \`-\` เพื่อล้างแท็ก\n` +
                ``,
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
        } catch { logger.debug("Non-critical: delete confirm message failed") }
        return showConfirm(ctx, pending);
    });

    /* ASK AI */
    bot.action("ASK_AI", async (ctx) => {
        const uid = ctx.from.id;
        userState.set(uid, { mode: "ASK_AI", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        return ctx.reply(
            `🤖 ${safeBold("ถามเกี่ยวกับการบ้าน")}\n\n` +
                `พิมพ์คำถาม เช่น\n` +
                `${safeCode("งานคณิตส่งวันไหนบ้าง")}\n` +
                `${safeCode("อาทิตย์นี้มีงานกี่ชิ้น")}\n\n` +
                `หรือกดยกเลิก`,
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
            return `${statusEmoji(status)} ${escapeMarkdown(title)}  ${subjectEmoji(subject)}${priority}  ${formatDateLabel(due, "due")}`;
        });
        const totalPages = Math.ceil(pages.length / ITEMS_PER_PAGE);
        let msg = `📋 ${safeBold("งานค้าง")} (${pages.length})\n\n${items.join("\n")}`;
        if (totalPages > 1) msg += `\n\nหน้า ${page + 1}/${totalPages}`;
        if (page === 0 && showOncePerSession(uid, "PRIORITY_LEGEND")) {
            msg += `\n\n🔴 สูง  🟡 กลาง  🟢 ต่ำ`;
        }
        return msg;
    }

    function renderDonePage(pages, page, uid) {
        const start = page * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const display = pages.slice(start, end);
        const items = display.map(p => {
            const { title, status, subject, priority, completed } = getPageProps(p);
            return `${statusEmoji(status)} ${escapeMarkdown(title)}  ${subjectEmoji(subject)}${priority}  ${formatDateLabel(completed, "completed")}`;
        });
        const totalPages = Math.ceil(pages.length / ITEMS_PER_PAGE);
        let msg = `✅ ${safeBold("งานเสร็จ")} (${pages.length})\n\n${items.join("\n")}`;
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
        buttons.push([Markup.button.callback("🏠 เมนูหลัก", "HOME")]);
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
                    `🎉 ${safeBold("ไม่มีการบ้านค้าง")}\n\nพักผ่อนได้เต็มที่เลย 🏆`,
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
                    `📭 ${safeBold("ยังไม่มีงานที่ทำเสร็จ")}\n\nสู้ต่ออีกนิด 💪`,
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
            const { msg: baseMsg, keyboard } = buildPanic(sorted, 3)
            let msg = baseMsg

            // award PANIC_5 badge
            try {
                const uid = ctx.from.id
                const newBadge = checkUsageBadgeOnAction(uid, "panic", "PANIC_5", 5)
                if (newBadge.length) {
                    const awarded = awardBadges(uid, newBadge)
                    if (awarded.length) {
                        msg += `\n\n🏅 ${awarded[0].icon} ${awarded[0].rarityEmoji} ${safeBold(awarded[0].name)} — ${awarded[0].desc}!`
                    }
                }
            } catch { logger.debug("Non-critical: panic badge check failed") }

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
            const dueTomorrow = pages.filter(p => p.properties.Due?.date?.start === tomorrowStr)

            if (!dueTomorrow.length) {
                return ctx.reply(
                    `🎉 ${safeBold("พรุ่งนี้ไม่มีการบ้านส่ง!")}\nไปเที่ยวได้เลย 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const { msg, keyboard } = buildTomorrow(dueTomorrow)
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
            `\n` +
            `พิมพ์คำที่ต้องการค้นหา\n` +
            `เช่น ${safeCode("คณิต")} หรือ ${safeCode("แคลคูลัส")}\n` +
            ``,
            { parse_mode: "Markdown", ...cancelMenu },
        )
    })

    /* WEEK */
    bot.action("WEEK", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มีการบ้านอาทิตย์นี้เลย!")}\nพักผ่อนได้ 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            const { msg, keyboard } = buildWeek(pages)
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
            const result = buildDeadline(pages)
            if (!result) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มี deadline!")}\nพักผ่อนได้เลย 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            return ctx.reply(result.msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(result.keyboard),
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
            const result = buildProgress(activePages, donePages)
            if (!result) {
                return ctx.reply(
                    `📊 ${safeBold("ยังไม่มีการบ้านในระบบ")}\nลองเพิ่มการบ้านก่อน!`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            return ctx.reply(result.msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(result.keyboard),
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
            `\n\n` +
            `💪 ${safeBold("สู้ๆ นะ!")}`
        const keyboard = [
            [
                Markup.button.callback("💬 อีกคำคม", "QUOTE"),
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
            ],
            [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
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

            const hint = await getStudyTip(subject, filtered)

            if (!hint) {
                return ctx.reply(
                    `📭 ${safeBold(`ไม่มีงานวิชา ${subject} ค้างอยู่`)}\n` +
                    `\n` +
                    `ลองเลือกวิชาอื่น หรือเพิ่มการบ้านก่อน!`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            // award HINT_10 badge
            try {
                const uid = ctx.from.id
                const newBadge = checkUsageBadgeOnAction(uid, "hint", "HINT_10", 10)
                if (newBadge.length) {
                    const awarded = awardBadges(uid, newBadge)
                    if (awarded.length) {
                        await ctx.reply(
                            `🏅 ${awarded[0].icon} ${awarded[0].rarityEmoji} ${safeBold(awarded[0].name)} — ${awarded[0].desc}!`,
                            { parse_mode: "Markdown" },
                        )
                    }
                }
            } catch { logger.debug("Non-critical: HINT badge check failed") }

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
                `\n` +
                `${safeCode(text)}\n` +
                `\n` +
                `💡 คัดลอกข้อความในกรอบไปแชร์ต่อได้เลย!`

            const keyboard = [
                [
                    Markup.button.callback("➕ เพิ่ม", "ADD"),
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                ],
                [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
            ]
            // award EXPORT_3 badge
            try {
                const uid = ctx.from.id
                const newBadge = checkUsageBadgeOnAction(uid, "export", "EXPORT_3", 3)
                if (newBadge.length) {
                    const awarded = awardBadges(uid, newBadge)
                    if (awarded.length) {
                        msg += `\n\n🏅 ${awarded[0].icon} ${awarded[0].rarityEmoji} ${safeBold(awarded[0].name)} — ${awarded[0].desc}!`
                    }
                }
            } catch { logger.debug("Non-critical: EXPORT badge check failed") }

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("EXPORT action:", err)
            const errMsg = errorWithRetry("ส่งออกไม่ได้", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errorWithRetry("ส่งออกไม่ได้", "RETRY_FETCH_ACTIVE").reply_markup })
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
                `\n` +
                `📌 "${escapeMarkdown(title)}"\n` +
                `📝 ${escapeMarkdown(note)}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("NOTED_SEL:", err)
            return ctx.answerCbQuery("❌ บันทึกไม่ได้").catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        }
    })

    /* FOCUS_SEL — select task to focus from inline keyboard */
    bot.action(/FOCUS_SEL_(\d+)/, async (ctx) => {
        const pageId = ctx.match[1]
        const uid = ctx.from.id
        await ctx.answerCbQuery().catch(() => {})

        try {
            const pages = await fetchActive()
            const page = pages.find(p => p.id === pageId)
            if (!page) {
                return ctx.reply(
                    `❌ ${safeBold("ไม่พบงานนี้")}\nอาจถูกลบไปแล้ว`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const { title, status, due, subject, priority } = getPageProps(page)
            userState.set(uid, {
                _focusActive: true,
                _focusHomeworkId: pageId,
                _focusTitle: title,
                _timestamp: Date.now(),
            })

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
            msg += `\n\n`
            msg += `${statusEmoji(status)} ${safeBold(title)}${badge}\n`
            msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  ${formatDueDisplay(due)}\n\n`
            msg += `\n`
            msg += `💡 พิมพ์คำสั่งอื่นไม่ได้ขณะโฟกัส\nพิมพ์ /focus เพื่อดู หรือ /focus exit เพื่อออก`

            const keyboard = [
                [
                    Markup.button.callback("✅ เสร็จ", "FOCUS_STATUS_DONE"),
                    Markup.button.callback("🔄 กำลังทำ", "FOCUS_STATUS_PROGRESS"),
                ],
                [
                    Markup.button.callback("❌ เลิกโฟกัส", "FOCUS_EXIT"),
                    Markup.button.callback("📋 ดูทั้งหมด", "LIST_ACTIVE"),
                ],
            ]

            try {
                await ctx.editMessageText(msg, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(keyboard),
                })
            } catch {
                return ctx.reply(msg, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(keyboard),
                })
            }
        } catch (err) {
            logger.error("FOCUS_SEL:", err)
            return ctx.reply(
                `❌ ${safeBold("เลือกงานไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* FOCUS_STATUS_DONE — mark focused task as done + exit focus */
    bot.action("FOCUS_STATUS_DONE", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid)
        const pageId = state?._focusHomeworkId

        if (!pageId) {
            await ctx.answerCbQuery("❌ ไม่มีงานในโฟกัส").catch(() => {})
            return ctx.reply(
                `❌ ${safeBold("ไม่มีงานในโฟกัส")}\nพิมพ์ /focus เพื่อเลือกงาน`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        await ctx.answerCbQuery().catch(() => {})

        try {
            const oldStatus = await getPageStatus(pageId)
            await updateStatus(pageId, STATUS.DONE)
            state._lastAction = { type: "STATUS_CHANGE", pageId, from: oldStatus, to: STATUS.DONE, _timestamp: Date.now() }
            userState.delete(uid)
            await ctx.editMessageReplyMarkup(undefined).catch(() => {})

            let streakMsg = ""
            try {
                const result = recordCompletion(uid)
                if (result.isNewMilestone) {
                    streakMsg = `\n\n🎉🎉🎉 *ครบ ${result.current} วันติดแล้ว!* 🔥🔥🔥`
                }
            } catch { logger.debug("Non-critical: streak record failed in focus done") }

            try {
                const newBadgeIds = checkBadges(uid)
                const awarded = awardBadges(uid, newBadgeIds)
                if (awarded.length) {
                    streakMsg += `\n\n🏅 ${safeBold("ปลดล็อกเหรียญใหม่!")}\n`
                    for (const b of awarded) {
                        streakMsg += `${b.icon} ${b.name} — ${b.desc}\n`
                    }
                }
            } catch { logger.debug("Non-critical: streak badge check failed in focus done") }

            try {
                const donePages = await fetchDone()
                const totalDone = donePages.length
                const taskBadgeIds = checkTaskBadges(uid, totalDone)
                const taskAwarded = awardBadges(uid, taskBadgeIds)
                if (taskAwarded.length) {
                    streakMsg += `\n\n`
                    for (const b of taskAwarded) {
                        streakMsg += `🏅 ${b.icon} ${safeBold(b.name)} — ${b.desc}!\n`
                    }
                }
            } catch { logger.debug("Non-critical: task badge check failed in focus done") }

            return ctx.reply(
                `✅ ${safeBold("เสร็จแล้ว!")} 🎉\n` +
                `\n` +
                `เก่งมาก! ออกจากโฟกัสแล้ว${streakMsg}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("FOCUS_STATUS_DONE:", err)
            return ctx.reply(
                `❌ ${safeBold("อัปเดตไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* FOCUS_STATUS_PROGRESS — set focused task to In Progress + update card */
    bot.action("FOCUS_STATUS_PROGRESS", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid)
        const pageId = state?._focusHomeworkId

        if (!pageId) {
            await ctx.answerCbQuery("❌ ไม่มีงานในโฟกัส").catch(() => {})
            return
        }

        await ctx.answerCbQuery().catch(() => {})

        try {
            await updateStatus(pageId, STATUS.IN_PROGRESS)
            return ctx.reply(
                `✏️ ${safeBold("อัปเดตแล้ว")} — กำลังทำอยู่ 💪`,
                { parse_mode: "Markdown" },
            )
        } catch (err) {
            logger.error("FOCUS_STATUS_PROGRESS:", err)
            await ctx.answerCbQuery("❌ อัปเดตไม่ได้").catch(() => {})
        }
    })

    /* FOCUS_EXIT — exit focus mode */
    bot.action("FOCUS_EXIT", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid)
        const focusTitle = state?._focusTitle || ""
        await ctx.answerCbQuery().catch(() => {})

        userState.delete(uid)
        await ctx.editMessageReplyMarkup(undefined).catch(() => {})

        return ctx.reply(
            `❌ ${safeBold("ยกเลิกโฟกัสแล้ว")}\n` +
            `\n` +
            `${focusTitle ? `เลิกโฟกัส "${escapeMarkdown(focusTitle)}"` : "เลิกโฟกัสแล้ว"}\n` +
            `กลับสู่หน้าหลัก`,
            { parse_mode: "Markdown", ...mainMenu },
        )
    })

    /* FOCUS_NEXT — removed; no flow populates _focusPages (was a dead path) */


    /* STREAK */
    bot.action("STREAK", async (ctx) => {
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        const uid = ctx.from.id
        const streak = getStreak(uid)
        const nextMilestone = getNextMilestone(streak.current)

        if (!streak.current) {
            return ctx.reply(
                `🔥 ${safeBold("ยังไม่มีสถิติ Streak")}\n\n` +
                `กด ✅ เสร็จจากการบ้านเลย!\n` +
                `ทำติดต่อกันทุกวันเพื่อรักษาไฟ`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        const fireEmojis = streak.current >= 30 ? "🔥🔥🔥" : streak.current >= 14 ? "🔥🔥" : "🔥"
        let msg = `🔥 ${safeBold("สถิติ Streak")}\n\n`
        msg += `${fireEmojis}  ปัจจุบัน ${streak.current} วัน\n`
        msg += `🏆  สูงสุด ${streak.best} วัน\n`

        if (nextMilestone) {
            const remaining = nextMilestone - streak.current
            msg += `\n🎯 เป้าหมายถัดไป ${nextMilestone} วัน (อีก ${remaining} วัน)`
        }

        const keyboard = [
            [
                Markup.button.callback("➕ เพิ่ม", "ADD"),
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
            ],
            [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
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
                await ctx.reply(`${fullMsg}\n\n────\n${tip.text}`, {
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
                ``,
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
                `\n` +
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
            }, 10000).unref();
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
        } catch { logger.debug("Non-critical: cancel delete message failed") }
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
                `\n` +
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
            `\n` +
            `${subjectEmoji(subject)} ${safeBold(title)}\n` +
            `🎯 ${priority || "🟡 กลาง"}  |  📅 ${dueText}\n` +
            `\n` +
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
            [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
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

            const total = donePages.length
            const today = new Date(); today.setHours(0, 0, 0, 0)
            const weekAgo = new Date(today)
            weekAgo.setDate(today.getDate() - 7)
            const monthAgo = new Date(today)
            monthAgo.setDate(today.getDate() - 30)

            const weekCount = donePages.filter(p => {
                const d = p.properties.Completed?.date?.start
                return d && new Date(d + "T00:00:00") >= weekAgo
            }).length

            const monthCount = donePages.filter(p => {
                const d = p.properties.Completed?.date?.start
                return d && new Date(d + "T00:00:00") >= monthAgo
            }).length

            let msg = `📋 ${safeBold("สรุปการบ้านที่ทำเสร็จแล้ว")}\n`
            msg += `\n\n`
            msg += `✅ เสร็จทั้งหมด: ${total} รายการ\n`
            msg += `📅 สัปดาห์นี้: ${weekCount} รายการ\n`
            msg += `📅 30 วัน: ${monthCount} รายการ\n`
            msg += `\n`
            msg += `📊 ${safeBold("เลือกช่วงเวลาเพื่อดูรายละเอียด:")}`

            const keyboard = [
                [
                    Markup.button.callback("📅 วันนี้", "REVIEW_PERIOD_today"),
                    Markup.button.callback("📅 7 วัน", "REVIEW_PERIOD_7d"),
                    Markup.button.callback("📅 30 วัน", "REVIEW_PERIOD_30d"),
                ],
                [
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                    Markup.button.callback("🏠 เมนูหลัก", "HOME"),
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

    /* REVIEW_PERIOD — show summary for selected period */
    bot.action(/REVIEW_PERIOD_(.+)/, async (ctx) => {
        const period = ctx.match[1]
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))

        try {
            const donePages = await fetchDone()
            if (!donePages.length) {
                return ctx.reply(
                    `📭 ${safeBold("ไม่มีงานที่ทำเสร็จในช่วงนี้")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const today = new Date(); today.setHours(0, 0, 0, 0)
            let cutoff = new Date(today)
            let periodLabel = ""

            if (period === "today") {
                periodLabel = "วันนี้"
            } else if (period === "7d") {
                cutoff.setDate(today.getDate() - 7)
                periodLabel = "7 วันที่ผ่านมา"
            } else if (period === "30d") {
                cutoff.setDate(today.getDate() - 30)
                periodLabel = "30 วันที่ผ่านมา"
            }

            const filtered = donePages.filter(p => {
                const d = p.properties.Completed?.date?.start
                return d && new Date(d + "T00:00:00") >= cutoff
            })

            if (!filtered.length) {
                return ctx.reply(
                    `📭 ${safeBold("ไม่มีงานที่ทำเสร็จในช่วง")} ${periodLabel}\n` +
                    `\n` +
                    `ลองเพิ่มการบ้านและทำให้เสร็จก่อน!`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const totalInPeriod = filtered.length
            const bySubject = {}
            let overdueCount = 0
            for (const p of filtered) {
                const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
                bySubject[sub] = (bySubject[sub] || 0) + 1
                const due = p.properties.Due?.date?.start
                if (due && new Date(due + "T00:00:00") < today) {
                    overdueCount++
                }
            }

            const topSubject = Object.entries(bySubject)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([s, c]) => `${subjectEmoji(s)} ${s} (${c})`)
                .join(", ")

            const completedPct = donePages.length > 0
                ? Math.round((filtered.length / donePages.length) * 100)
                : 0

            // Sentiment emoji
            let sentiment = "😊"
            if (overdueCount > totalInPeriod * 0.5) {
                sentiment = "😅"
            } else if (overdueCount > totalInPeriod * 0.25) {
                sentiment = "😐"
            }

            let msg = `📋 ${safeBold("สรุปการบ้าน — " + periodLabel)}\n`
            msg += `\n\n`
            msg += `✅ ทำเสร็จ: ${totalInPeriod} รายการ\n`
            if (topSubject) msg += `📚 วิชาที่ทำมากสุด: ${topSubject}\n`
            msg += `📊 คิดเป็น ${completedPct}% ของทั้งหมด\n`
            if (overdueCount > 0) {
                msg += `⚠️ Overdue: ${overdueCount} รายการ\n`
            }
            msg += `\n`
            msg += `${sentiment}`

            const keyboard = [
                [
                    Markup.button.callback("📋 ดูรายละเอียด", "REVIEW_DETAIL_0"),
                ],
                [
                    Markup.button.callback("📅 เปลี่ยนช่วง", "REVIEW"),
                    Markup.button.callback("🏠 เมนูหลัก", "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("REVIEW_PERIOD:", err)
            return ctx.reply(
                `❌ ${safeBold("โหลดข้อมูลไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* COLLAB_SEL — generate share token for selected task */
    bot.action(/COLLAB_SEL_(\d+)/, async (ctx) => {
        const pageId = ctx.match[1]
        const uid = ctx.from.id
        await ctx.answerCbQuery().catch(() => {})

        try {
            const pages = await fetchActive()
            const page = pages.find(p => p.id === pageId)
            if (!page) {
                return ctx.reply(
                    `❌ ${safeBold("ไม่พบงานนี้")}\nอาจถูกลบไปแล้ว`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const { title, subject, due, priority } = getPageProps(page)
            const note = page.properties.Note?.rich_text?.[0]?.plain_text || ""
            const tags = page.properties.Tags?.multi_select?.map(t => t.name) || []
            const token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)

            const { shareTokens } = await import("./commandHandlers.js")
            shareTokens.set(token, {
                title,
                subject,
                due,
                priority,
                note,
                tags,
                ownerUid: uid,
                _timestamp: Date.now(),
            })

            const botUsername = process.env.BOT_USERNAME || "homeworkbot"

            return ctx.reply(
                `👥 ${safeBold("แชร์งานนี้กับเพื่อน!")}\n` +
                `\n\n` +
                `${safeBold(title)}\n` +
                `${subjectEmoji(subject)} ${priority} — ${formatDueDisplay(due)}\n\n` +
                `\n` +
                `📤 ส่งข้อความนี้ให้เพื่อน:\n\n` +
                `${safeCode(`@${botUsername} /collab accept ${token}`)}\n\n` +
                `⏱️ token มีอายุ 24 ชม.`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("COLLAB_SEL:", err)
            return ctx.reply(
                `❌ ${safeBold("แชร์ไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* POMODORO START — begin a 25 min work session */
    bot.action("POMODORO_START", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid) || {}
        await ctx.answerCbQuery().catch(() => {})

        // Clear any existing break state
        if (state._pomoBreakTimeout) {
            clearTimeout(state._pomoBreakTimeout)
        }

        const homeworkTitle = state._focusTitle || null
        const session = pomoStartSession(uid, homeworkTitle)

        const timeout = setTimeout(async () => {
            pomoTimers.delete(timeout)
            try {
                const userStateNow = userState.get(uid) || {}
                savePomodoro(uid)
                const breakTimeout = setTimeout(() => {
                    pomoTimers.delete(breakTimeout)
                    const s = userState.get(uid) || {}
                    userState.set(uid, {
                        ...s,
                        _pomoBreak: false,
                        _pomoBreakTimeout: null,
                    })
                }, getBreakDuration()).unref()
                trackPomoTimer(breakTimeout)
                userState.set(uid, {
                    ...userStateNow,
                    _pomoActive: false,
                    _pomoTimeout: null,
                    _pomoBreak: true,
                    _pomoBreakStartedAt: Date.now(),
                    _pomoBreakDuration: getBreakDuration(),
                    _pomoBreakTimeout: breakTimeout,
                    _timestamp: Date.now(),
                })

                // Check badges
                let badgeMsg = ""
                try {
                    const newBadgeIds = checkPomoBadges(uid)
                    if (newBadgeIds.length) {
                        const awarded = awardBadges(uid, newBadgeIds)
                        if (awarded.length) {
                            badgeMsg = `\n\n🏅 ${safeBold("ปลดล็อกเหรียญใหม่!")}\n`
                            for (const b of awarded) {
                                badgeMsg += `${b.icon} ${b.name} — ${b.desc}\n`
                            }
                        }
                    }
                } catch { logger.debug("Non-critical: pomo badge check failed") }

                const title = state._pomoHomeworkTitle || ""
                let msg = `☕ ${safeBold("พักเบรก 5 นาที!")}\n`
                msg += `\n`
                msg += `🍅 เซสชันเสร็จแล้ว!\n`
                if (title) msg += `📌 งานที่ทำ: ${escapeMarkdown(title)}\n`
                msg += `\nพักผ่อนสักครู่ แล้วกลับมาลุยต่อ!`
                msg += badgeMsg

                const keyboard = [
                    [Markup.button.callback("⏭️ เริ่มรอบใหม่", "POMODORO_START")],
                    [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
                ]
                await bot.telegram.sendMessage(uid, msg, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(keyboard),
                })
            } catch (err) {
                logger.error("POMODORO timeout:", err)
            }
        }, session.duration).unref()
        trackPomoTimer(timeout)

        userState.set(uid, {
            ...state,
            _pomoActive: true,
            _pomoStartedAt: session.startedAt,
            _pomoDuration: session.duration,
            _pomoTimeout: timeout,
            _pomoHomeworkTitle: homeworkTitle,
            _pomoBreak: false,
            _pomoBreakTimeout: null,
            _timestamp: Date.now(),
        })

        const title = homeworkTitle || ""
        let msg = `🍅 ${safeBold("เริ่ม Pomodoro!")}\n`
        msg += `\n`
        msg += `⏱️ 25 นาที — เริ่มเลย!\n`
        if (title) msg += `📌 งาน: ${escapeMarkdown(title)}\n`
        msg += `\n💪 สู้ๆ ไฟighting!`

        const keyboard = [
            [Markup.button.callback("❌ ยกเลิก", "POMODORO_CANCEL")],
        ]

        try {
            await ctx.editMessageText(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch {
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        }
    })

    /* POMODORO CANCEL — cancel current session */
    bot.action("POMODORO_CANCEL", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid) || {}
        await ctx.answerCbQuery().catch(() => {})

        if (state._pomoTimeout) clearTimeout(state._pomoTimeout)
        if (state._pomoBreakTimeout) clearTimeout(state._pomoBreakTimeout)

        userState.set(uid, {
            ...state,
            _pomoActive: false,
            _pomoTimeout: null,
            _pomoBreak: false,
            _pomoBreakTimeout: null,
            _pomoHomeworkTitle: null,
            _timestamp: Date.now(),
        })

        return ctx.reply(
            `❌ ${safeBold("ยกเลิก Pomodoro แล้ว")}\n` +
            `\n` +
            `พิมพ์ /pomodoro เพื่อเริ่มใหม่`,
            { parse_mode: "Markdown", ...mainMenu },
        )
    })

    /* POMODORO STATS — show pomodoro statistics */
    bot.action("POMODORO_STATS", async (ctx) => {
        const uid = ctx.from.id
        await ctx.answerCbQuery().catch(() => {})

        const stats = pomoGetStats(uid)
        const streak = pomoGetStreak(uid)

        let msg = `🍅 ${safeBold("สถิติ Pomodoro")}\n`
        msg += `\n`
        msg += `📅 วันนี้: ${stats.today} เซสชัน\n`
        msg += `📅 สัปดาห์: ${stats.week} เซสชัน\n`
        msg += `🏆 รวม: ${stats.count} เซสชัน\n`
        msg += `⏱️ เวลาทั้งหมด: ${stats.totalHours} ชั่วโมง\n`
        if (streak > 0) msg += `🔥 Streak: ${streak} วัน\n`
        msg += ``

        const keyboard = [
            [Markup.button.callback("🍅 เริ่มใหม่", "POMODORO_START")],
            [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
        ]

        return ctx.reply(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(keyboard),
        })
    })

    /* SUGGEST_REFRESH — re-trigger suggest */
    bot.action("SUGGEST_REFRESH", async (ctx) => {
        await ctx.answerCbQuery().catch(() => {})
        return ctx.reply(
            `🔄 ${safeBold("กำลังแนะนำใหม่...")}\n` +
            `\n` +
            `พิมพ์ /suggest เพื่อรับคำแนะนำใหม่`,
            { parse_mode: "Markdown", ...mainMenu },
        )
    })

    /* SMARTBOOK actions */
    bot.action("SMARTBOOK_SAVE", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid)
        await ctx.answerCbQuery("💾 บันทึกแผนแล้ว!").catch(() => {})
        if (state) {
            userState.set(uid, { ...state, _timestamp: Date.now() })
        }
        return ctx.reply(
            `💾 ${safeBold("บันทึกแผนแล้ว!")}\n` +
            `\n` +
            `พิมพ์ /smartbook view เพื่อดูแผนที่บันทึกไว้`,
            { parse_mode: "Markdown", ...mainMenu },
        )
    })

    bot.action("SMARTBOOK_REFRESH", async (ctx) => {
        await ctx.answerCbQuery().catch(() => {})
        try {
            // Re-trigger AI by sending /smartbook message
            return ctx.reply(
                `🔄 ${safeBold("กำลังรีเฟรชแผน...")}\n` +
                `\n` +
                `พิมพ์ /smartbook เพื่อสร้างแผนใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("SMARTBOOK_REFRESH:", err)
            return ctx.reply(
                `❌ ${safeBold("รีเฟรชไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.action("SMARTBOOK_ICAL", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid)
        await ctx.answerCbQuery().catch(() => {})

        const plan = state?._smartbookPlan
        if (!plan || !plan.plan || !plan.plan.length) {
            return ctx.reply(
                `❌ ${safeBold("ไม่มีแผนที่บันทึกไว้")}\n` +
                `พิมพ์ /smartbook เพื่อสร้างแผนก่อน`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        try {
            let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//HomeworkBot//Smartbook//EN\r\n"
            for (const day of plan.plan) {
                if (!day.date) continue
                const startDate = day.date.replace(/-/g, "")
                const endDate = startDate
                const duration = day.duration_min || 120
                const summary = `[${day.focus}] ${(day.tasks || []).join(", ")}`
                ics += "BEGIN:VEVENT\r\n"
                ics += `DTSTART;VALUE=DATE:${startDate}\r\n`
                ics += `DTEND;VALUE=DATE:${endDate}\r\n`
                ics += `SUMMARY:${summary.replace(/,/g, "\\,")}\r\n`
                ics += `DESCRIPTION:${(day.tasks || []).join("\\n")}\r\n`
                ics += "END:VEVENT\r\n"
            }
            ics += "END:VCALENDAR\r\n"

            const buffer = Buffer.from(ics, "utf-8")
            await ctx.replyWithDocument({
                source: buffer,
                filename: "smartbook_plan.ics",
            })
        } catch (err) {
            logger.error("SMARTBOOK_ICAL:", err)
            return ctx.reply(
                `❌ ${safeBold("สร้าง iCal ไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* REVIEW_DETAIL — show paginated list of done tasks in period */
    bot.action(/REVIEW_DETAIL_(\d+)/, async (ctx) => {
        const pageNum = parseInt(ctx.match[1], 10) || 0
        const uid = ctx.from.id
        const state = userState.get(uid) || {}
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))

        try {
            const donePages = state._reviewPages || await fetchDone()
            const today = new Date(); today.setHours(0, 0, 0, 0)
            const cutoff = state._reviewCutoff
                ? new Date(state._reviewCutoff)
                : new Date(today.getTime() - 7 * 86400000)

            const filtered = donePages.filter(p => {
                const d = p.properties.Completed?.date?.start
                return d && new Date(d + "T00:00:00") >= cutoff
            })

            if (!filtered.length) {
                return ctx.reply(
                    `📭 ${safeBold("ไม่มีงานในช่วงนี้")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const PAGE_SIZE = 10
            const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
            const start = pageNum * PAGE_SIZE
            const pageItems = filtered.slice(start, start + PAGE_SIZE)

            if (!state._reviewPages) {
                userState.set(uid, {
                    ...state,
                    _reviewPages: donePages,
                    _reviewCutoff: cutoff.toISOString(),
                    _timestamp: Date.now(),
                })
            }

            let msg = `📋 ${safeBold("รายละเอียด (หน้า ${pageNum + 1}/${totalPages})")}\n`
            msg += `\n\n`
            for (let i = 0; i < pageItems.length; i++) {
                const p = pageItems[i]
                const { title, subject, priority, completed } = getPageProps(p)
                const doneDate = completed ? completed.slice(5).replace("-", "/") : "?"
                msg += `${start + i + 1}. [${subject}] ${safeBold(title)}\n`
                msg += `   ${priority} — เสร็จ ${doneDate}\n\n`
            }

            const keyboard = []
            const row = []
            if (pageNum > 0) {
                row.push(Markup.button.callback("◀ ก่อนหน้า", `REVIEW_DETAIL_${pageNum - 1}`))
            }
            if (pageNum + 1 < totalPages) {
                row.push(Markup.button.callback("ถัดไป ▶", `REVIEW_DETAIL_${pageNum + 1}`))
            }
            if (row.length) keyboard.push(row)
            keyboard.push([
                Markup.button.callback("📅 เปลี่ยนช่วง", "REVIEW"),
                Markup.button.callback("🏠 เมนูหลัก", "HOME"),
            ])

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("REVIEW_DETAIL:", err)
            return ctx.reply(
                `❌ ${safeBold("โหลดข้อมูลไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })
}
