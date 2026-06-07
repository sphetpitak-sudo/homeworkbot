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
import { buildPanic, buildTomorrow, buildWeek, buildDeadline, buildProgress, statusEmoji } from "./viewBuilders.js";
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
import { QUOTES } from "../utils/quotes.js";
import { getStudyTip } from "../services/hintService.js";
import { checkTaskBadges, checkUsageBadgeOnAction, awardBadges, buildBadgeMessage } from "../services/badgeService.js";
import { startSession as pomoStartSession, savePomodoro, getStats as pomoGetStats, getStreak as pomoGetStreak, getSessionDuration, getBreakDuration, checkPomoBadges, persistInFlightSession, clearInFlightSession } from "../services/pomodoroService.js";
import { t } from "../utils/i18n.js";

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
// M1: use a globalThis flag so hot reload / re-evaluation can't
// start a second interval. Mirrors the pattern in src/web/server.js.
if (!globalThis.__hbActionCleanupStarted) {
    globalThis.__hbActionCleanupStarted = true
    setInterval(() => {
        pruneHints(hintsShown)
        pruneHints(sessionHints)
        const now = Date.now()
        /* H3: deletedItems is now keyed by pageId, not uid, so a user
           can delete multiple items in quick succession and recover
           each independently. */
        for (const [pageId, item] of deletedItems) {
            if (now - item._timestamp > 10000) deletedItems.delete(pageId)
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

/* H4: iCal builder. Escapes per RFC 5545 §3.3.11 (TEXT values)
   and folds long lines per §3.1. The DTSTART is 09:00 Bangkok time
   (the typical study start) and DTEND is DTSTART + duration_min;
   the start is 09:00 local Bangkok. */
const ICS_TZID = "Asia/Bangkok"
const ICS_LOCAL_TZDEF = [
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Bangkok",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0700",
    "TZOFFSETTO:+0700",
    "TZNAME:+07",
    "END:STANDARD",
    "END:VTIMEZONE",
].join("\r\n")

function icsEscapeText(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n")
}

function icsFoldLine(line) {
    /* RFC 5545: lines MUST be ≤75 octets; continuation lines start
       with a single whitespace. We fold on UTF-8 byte boundaries to
       avoid splitting multi-byte characters. */
    const bytes = Buffer.byteLength(line, "utf-8")
    if (bytes <= 75) return line
    const out = []
    let buf = ""
    let bufBytes = 0
    /* First chunk gets the full 75; continuation chunks get 74
       (75 minus the leading space we add later). */
    const limit = (out.length === 0) ? 75 : 74
    for (const ch of line) {
        const chBytes = Buffer.byteLength(ch, "utf-8")
        if (bufBytes + chBytes > limit) {
            out.push(buf)
            buf = ch
            bufBytes = chBytes
        } else {
            buf += ch
            bufBytes += chBytes
        }
    }
    if (buf) out.push(buf)
    return out.map((seg, i) => i === 0 ? seg : " " + seg).join("\r\n")
}

function icsDateAddOneDay(ymd) {
    const [y, m, d] = ymd.split("-").map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    dt.setUTCDate(dt.getUTCDate() + 1)
    const yy = dt.getUTCFullYear()
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0")
    const dd = String(dt.getUTCDate()).padStart(2, "0")
    return `${yy}${mm}${dd}`
}

function buildSmartbookIcs(days) {
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//HomeworkBot//Smartbook//EN",
        "CALSCALE:GREGORIAN",
        ICS_LOCAL_TZDEF,
    ]
    const nowStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
    for (const day of days) {
        if (!day.date) continue
        const ymd = String(day.date)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue
        const dateCompact = ymd.replace(/-/g, "")
        const startTime = "T090000" /* 09:00 Bangkok */
        const summary = `[${day.focus || "study"}] ${(day.tasks || []).join(", ")}`
        const description = (day.tasks || []).join("\n")
        const durationMin = day.duration_min || 120
        const endDt = new Date(`${ymd}T09:00:00+07:00`)
        endDt.setMinutes(endDt.getMinutes() + durationMin)
        const endCompact = endDt.toISOString().slice(0, 10).replace(/-/g, "")
        const endTime = endDt.toISOString().slice(11, 19).replace(/:/g, "")
        const uid = `${dateCompact}-${Math.random().toString(36).slice(2, 10)}@homeworkbot`
        lines.push(
            "BEGIN:VEVENT",
            `UID:${uid}`,
            `DTSTAMP:${nowStamp}`,
            `DTSTART;TZID=${ICS_TZID}:${dateCompact}${startTime}`,
            `DTEND;TZID=${ICS_TZID}:${endCompact}${endTime}`,
            `SUMMARY:${icsEscapeText(summary)}`,
            `DESCRIPTION:${icsEscapeText(description)}`,
            "END:VEVENT",
        )
    }
    lines.push("END:VCALENDAR")
    return lines.map(icsFoldLine).join("\r\n") + "\r\n"
}

/* ── menus ── */
function dashboardMenu() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(t("cmd.btn.add"), "ADD"),
            Markup.button.callback(t("cmd.btn.active"), "LIST_ACTIVE"),
            Markup.button.callback("✅ " + t("cmd.btn.done"), "LIST_DONE"),
        ],
        [
            Markup.button.callback(t("cmd.btn.askAi"), "ASK_AI"),
            Markup.button.callback(t("cmd.btn.home"), "HOME"),
        ],
    ]);
}

function actionButtons(pageId, mode = "active") {
    if (mode === "done") {
        return Markup.inlineKeyboard([
            [
                Markup.button.callback("↩️ " + t("action.cancelSuccess"), `todo_${pageId}`),
                Markup.button.callback("🗑️ " + t("action.deleted"), `del_${pageId}`),
            ],
        ]);
    }
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(t("cmd.btn.done"), `done_${pageId}`),
            Markup.button.callback(t("cmd.btn.inProgress"), `prog_${pageId}`),
            Markup.button.callback(t("cmd.btn.delete"), `del_${pageId}`),
        ],
    ]);
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

    let msg = `📊 ${safeBold(t("action.dashboard"))}\n\n`;
    msg += `${bar} ${pct}%\n`;
    msg += `📌 ${todo}  🔄 ${prog}  ✅ ${done}`;
    if (overduePages.length) msg += `  🚨 ${overduePages.length}`;
    msg += `\n`;

    if (urgent.length) {
        msg += `\n⚡ ${t("action.nearDue")} (${URGENT_DAYS} ${t("action.nearDueDays")})\n`;
        for (const p of urgent.slice(0, URGENT_DISPLAY_MAX)) {
            const { title, due, status, subject, priority } = getPageProps(p);
            msg += `${statusEmoji(status)} ${escapeMarkdown(title)}  ${priority} ${subjectEmoji(subject)}${formatDueDisplay(due)}\n`;
        }
        if (urgent.length > URGENT_DISPLAY_MAX) {
            msg += `… +${urgent.length - URGENT_DISPLAY_MAX}\n`;
        }
    }

    msg += `\n📖 ${t("action.subjectsPending")}\n`;
    const sorted = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
        msg += `🎉 ${t("action.noPending")}\n`;
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
            `✏️ ${safeBold(t("action.addNew"))}\n\n` +
                `${t("action.typeHomework")}\n` +
                `${safeCode(t("action.example1"))}\n` +
                `${safeCode(t("action.example2"))}\n` +
                `${safeCode(t("action.example3"))}\n\n` +
                t("action.autoDetect"),
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* CANCEL */
    bot.action("CANCEL", async (ctx) => {
        userState.delete(ctx.from.id);
        await ctx.answerCbQuery(t("action.cancelSuccessEmoji")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        try {
            await ctx.editMessageText(
                `❌ ${safeBold(t("action.cancelSuccess"))}\n`,
                { parse_mode: "Markdown", ...mainMenu },
            );
        } catch {
            await ctx.reply(
                `❌ ${safeBold(t("action.cancelSuccess"))}\n`,
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
                .answerCbQuery(t("action.noData"))
                .catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        if (state._saving) {
            return ctx.answerCbQuery(t("action.saving")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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

            const priText = priority || "🟡 Medium";
            await ctx.editMessageText(
                `🎉 ${safeBold(t("action.saveSuccess"))}\n` +
                    `\n` +
                    `${subjectEmoji(subject)} ${safeBold(title)}\n` +
                    `📚 ${safeSubject} • ${priText}\n` +
                    `📅 ${dueText}\n` +
                    `\n` +
                    t("action.saveSuccessLine2"),
                { parse_mode: "Markdown", ...dashboardMenu() },
            ).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));

            const tip = showHintOnce(uid, "post_save", t("action.saveHint"));
            if (tip) ctx.reply(tip.text, { parse_mode: "Markdown" }).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        } catch (err) {
            logger.error("CONFIRM_SAVE:", err);
            await ctx.editMessageText(
                `❌ ${safeBold(t("action.saveErr"))}\n` +
                    `\n` +
                    t("action.saveErrLine2"),
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback(t("action.retrySave"), "CONFIRM_SAVE"),
                            Markup.button.callback(t("action.cancelSuccess"), "CANCEL"),
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
            return ctx.answerCbQuery(t("action.noData")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        userState.set(uid, { mode: "EDIT_TITLE", pending: state.pending, _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        return ctx.reply(
            `✏️ ${safeBold(t("action.editTitle"))}\n` +
                `\n` +
                t("action.editTitleLine2"),
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* EDIT SUBJECT */
    bot.action("EDIT_SUBJECT", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery(t("action.noData")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        userState.set(uid, { ...state, mode: "EDIT_SUBJECT", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        return ctx.reply(
            `📚 ${safeBold(t("action.editSubject"))}\n` +
                `\n` +
                t("action.editSubjectLine2") + "\n" +
                t("action.editSubjectExamples"),
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* EDIT DATE */
    bot.action("EDIT_DATE", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery(t("action.noData")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        userState.set(uid, { ...state, mode: "EDIT_DATE", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        return ctx.reply(
            `📅 ${safeBold(t("action.editDate"))}\n` +
                `\n` +
                t("action.editDateLine2") + "\n" +
                t("action.editDateExamples"),
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* EDIT PRIORITY */
    bot.action("EDIT_PRIORITY", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery(t("action.noData")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            `🎯 ${safeBold(t("action.editPriority"))}\n` +
                `\n` +
                `${t("action.editPriorityLine1")} ${current}\n\n` +
                t("action.editPriorityLine2"),
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    options,
                    [Markup.button.callback(t("action.cancelDelete"), "CANCEL")],
                ]),
            },
        );
    });

    /* EDIT TAGS */
    bot.action("EDIT_TAGS", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);

        if (!state?.pending) {
            return ctx.answerCbQuery(t("action.noData")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        userState.set(uid, { ...state, mode: "EDIT_TAGS", _timestamp: Date.now() });
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        return ctx.reply(
            `🏷️ ${safeBold(t("cmd.menu.tags"))}\n` +
                `\n` +
                `${t("noted.usage")}\n\n` +
                `${VALID_TAGS.join(", ")}\n` +
                t("hint.pickSubjectLine2"),
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    /* SET PRIORITY */
    bot.action(/SET_PRIORITY_(.+)/, async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);
        const priority = ctx.match[1];

        if (!state?.pending) {
            return ctx.answerCbQuery(t("action.noData")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        if (!PRIORITY_ORDER.includes(priority)) {
            return ctx.answerCbQuery(t("action.invalidPriority")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }

        const pending = { ...state.pending, priority, _manualPriority: true };
        userState.set(uid, { ...state, mode: "CONFIRM", pending, _timestamp: Date.now() });
        await ctx.answerCbQuery(t("action.setPrioritySuccess", { })).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
            `🤖 ${safeBold(t("action.askAiTitle"))}\n\n` +
                `${t("action.askAiLine1")}\n` +
                `${safeCode(t("action.askAiEx1"))}\n` +
                `${safeCode(t("action.askAiEx2"))}\n\n` +
                t("action.askAiLine2"),
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
        let msg = `📋 ${safeBold(t("cmd.menu.active"))} (${pages.length})\n\n${items.join("\n")}`;
        if (totalPages > 1) msg += `\n\n${t("text.searchCount", { count: `${page + 1}/${totalPages}` })}`;
        if (page === 0 && showOncePerSession(uid, "PRIORITY_LEGEND")) {
            msg += `\n\n🔴 High  🟡 Medium  🟢 Low`;
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
        let msg = `✅ ${safeBold(t("cmd.menu.done"))} (${pages.length})\n\n${items.join("\n")}`;
        if (totalPages > 1) msg += `\n\n${t("text.searchCount", { count: `${page + 1}/${totalPages}` })}`;
        return msg;
    }

    function listKeyboard(type, page, totalPages) {
        const buttons = [];
        const nav = [];
        if (page > 0) nav.push(Markup.button.callback(t("text.searchAgain"), `LIST_PAGE_${type}_${page - 1}`));
        if (page < totalPages - 1) nav.push(Markup.button.callback(t("cmd.menu.back"), `LIST_PAGE_${type}_${page + 1}`));
        if (nav.length) buttons.push(nav);
        buttons.push([
            Markup.button.callback(t("cmd.menu.add"), "ADD"),
            Markup.button.callback("📊 Dashboard", "DASHBOARD"),
        ]);
        buttons.push([Markup.button.callback(t("cmd.menu.back"), "HOME")]);
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
                    `🎉 ${safeBold(t("vb.noPendingLong"))}\n\n${t("vb.cheer")}`,
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
            const errMsg = errorWithRetry(t("retry.activeFail"), "RETRY_FETCH_ACTIVE");
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
                    `📭 ${safeBold(t("vb.noDoneLong"))}\n\n${t("quote.cheer")}`,
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
            const errMsg = errorWithRetry(t("retry.doneFail"), "RETRY_FETCH_DONE");
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
            return ctx.reply(t("retry.retrying"), {
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
            const errMsg = errorWithRetry(t("retry.dashboardFail"), "RETRY_FETCH_DASHBOARD");
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
                    `🎉 ${safeBold(t("panic.empty"))}\n${t("panic.emptyLine2")}`,
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
            const errMsg = errorWithRetry(t("retry.activeFail"), "RETRY_FETCH_ACTIVE")
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
                    `🎉 ${safeBold(t("tomorrow.empty"))}\n${t("tomorrow.emptyLine2")}`,
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
            const errMsg = errorWithRetry(t("retry.activeFail"), "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    /* SEARCH */
    bot.action("SEARCH", async (ctx) => {
        const uid = ctx.from.id
        userState.set(uid, { mode: "SEARCH", _timestamp: Date.now() })
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        return ctx.reply(
            `🔍 ${safeBold(t("text.searchPrompt"))}\n` +
            `\n` +
            `${t("text.searchExamples")}\n` +
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
                    `🎉 ${safeBold(t("week.empty"))}\n${t("week.emptyLine2")}`,
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
            const errMsg = errorWithRetry(t("cmd.errors.loadWeek"), "RETRY_FETCH_ACTIVE")
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
                    `🎉 ${safeBold(t("deadline.empty"))}\n${t("deadline.emptyLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            return ctx.reply(result.msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(result.keyboard),
            })
        } catch (err) {
            logger.error("DEADLINE action:", err)
            const errMsg = errorWithRetry(t("retry.activeFail"), "RETRY_FETCH_ACTIVE")
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
                    `📊 ${safeBold(t("progress.empty"))}\n${t("progress.emptyLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            return ctx.reply(result.msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(result.keyboard),
            })
        } catch (err) {
            logger.error("PROGRESS action:", err)
            const errMsg = errorWithRetry(t("retry.activeFail"), "RETRY_FETCH_ACTIVE")
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
            `💪 ${safeBold(t("quote.cheer"))}`
        const keyboard = [
            [
                Markup.button.callback(t("quote.another"), "QUOTE"),
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
            ],
            [Markup.button.callback(t("cmd.menu.back"), "HOME")],
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
                    `📭 ${safeBold(t("hint.emptyForSubject", { subject }))}\n` +
                    `\n` +
                    t("hint.emptyForSubjectLine2"),
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
            const errMsg = errorWithRetry(t("cmd.errors.generic"), "RETRY_FETCH_ACTIVE")
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
                    `📭 ${safeBold(t("progress.empty"))}\n${t("progress.emptyLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            let text = `📋 ${t("export.header", { date: today })}\n`
            text += `=====================================\n\n`

            if (activePages.length) {
                text += `${t("export.active")} (${activePages.length}):\n`
                activePages.forEach((p, i) => {
                    const { title, subject, due, priority } = getPageProps(p)
                    const dueStr = due ? `${t("export.due")} ${due.slice(5).replace("-", "/")}` : t("vb.noDueShort")
                    text += `  ${i + 1}. [${subject}] ${title} — ${dueStr} ${priority}\n`
                })
                text += `\n`
            }

            if (donePages.length) {
                text += `${t("export.done")} (${donePages.length}):\n`
                donePages.forEach((p, i) => {
                    const { title, subject, completed, priority } = getPageProps(p)
                    const doneStr = completed ? `${t("export.completedAt")} ${completed.slice(5).replace("-", "/")}` : t("export.doneShort")
                    text += `  ${i + 1}. [${subject}] ${title} — ${doneStr} ${priority}\n`
                })
                text += `\n`
            }

            const total = activePages.length + donePages.length
            const pct = total > 0 ? Math.round((donePages.length / total) * 100) : 0
            text += `=====================================\n`
            text += t("export.total", { total, pct }) + "\n"

            let msg =
                `📋 ${safeBold(t("export.title"))}\n` +
                `\n` +
                `${safeCode(text)}\n` +
                `\n` +
                t("export.shareHint")

            const keyboard = [
                [
                    Markup.button.callback(t("cmd.menu.add"), "ADD"),
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                ],
                [Markup.button.callback(t("cmd.menu.back"), "HOME")],
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
            const errMsg = errorWithRetry(t("export.err"), "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errorWithRetry(t("export.err"), "RETRY_FETCH_ACTIVE").reply_markup })
        }
    })

    /* NOTED — select page from results */
    bot.action(/NOTED_SEL_(\d+)/, async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid)
        if (!state?._pendingNoted) {
            return ctx.answerCbQuery(t("retry.retrying")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        }
        const idx = parseInt(ctx.match[1])
        const { matched, note } = state._pendingNoted
        if (idx < 0 || idx >= matched.length) {
            return ctx.answerCbQuery(t("cmd.errors.notFound")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
        }
        try {
            const page = matched[idx]
            const { title } = getPageProps(page)
            await updateHomework(page.id, { note })
            userState.delete(uid)
            await ctx.answerCbQuery(t("noted.added")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
            return ctx.reply(
                `📝 ${safeBold(t("noted.added"))}\n` +
                `\n` +
                `📌 "${escapeMarkdown(title)}"\n` +
                `📝 ${escapeMarkdown(note)}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("NOTED_SEL:", err)
            return ctx.answerCbQuery(t("noted.err")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message))
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
                    `❌ ${safeBold(t("cmd.errors.notFound"))}\n${t("cmd.error.retry")}`,
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
                badge = ` 🚨 ${t("focus.overdue", { days: Math.abs(diff) })}`
            } else if (diff !== null && diff <= 3) {
                badge = ` 🔥 ${t("focus.left", { days: diff })}`
            } else if (diff !== null && diff <= 7) {
                badge = ` ⏰ ${t("focus.left", { days: diff })}`
            }

            let msg = `🎯 ${safeBold(t("action.focusTitle"))}\n`
            msg += `\n\n`
            msg += `${statusEmoji(status)} ${safeBold(title)}${badge}\n`
            msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  ${formatDueDisplay(due)}\n\n`
            msg += `\n`
            msg += t("action.focusLine3")

            const keyboard = [
                [
                    Markup.button.callback(t("cmd.btn.done"), "FOCUS_STATUS_DONE"),
                    Markup.button.callback(t("cmd.btn.inProgress"), "FOCUS_STATUS_PROGRESS"),
                ],
                [
                    Markup.button.callback(t("focus.exitBtn") || "❌ Exit focus", "FOCUS_EXIT"),
                    Markup.button.callback(t("focus.viewAll") || "📋 View all", "LIST_ACTIVE"),
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
                `❌ ${safeBold(t("action.focusSelectErr"))}\n${t("cmd.error.retry")}`,
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
            await ctx.answerCbQuery(t("focus.noActive")).catch(() => {})
            return ctx.reply(
                `❌ ${safeBold(t("focus.noActive"))}\n${t("focus.noActiveLine2")}`,
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

            let badgeMsg = ""
            try {
                const donePages = await fetchDone()
                const totalDone = donePages.length
                const taskBadgeIds = checkTaskBadges(uid, totalDone)
                const taskAwarded = awardBadges(uid, taskBadgeIds)
                if (taskAwarded.length) {
                    badgeMsg += `\n\n`
                    for (const b of taskAwarded) {
                        badgeMsg += `🏅 ${b.icon} ${safeBold(b.name)} — ${b.desc}!\n`
                    }
                }
            } catch { logger.debug("Non-critical: task badge check failed in focus done") }

            return ctx.reply(
                `✅ ${safeBold(t("action.doneMsg"))}\n` +
                `\n` +
            `${t("action.focusDoneLine2")} ${badgeMsg}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("FOCUS_STATUS_DONE:", err)
            return ctx.reply(
                `❌ ${safeBold(t("action.focusStatusErr"))}\n${t("cmd.error.retry")}`,
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
            await ctx.answerCbQuery(t("focus.noActive")).catch(() => {})
            return
        }

        await ctx.answerCbQuery().catch(() => {})

        try {
            await updateStatus(pageId, STATUS.IN_PROGRESS)
            return ctx.reply(
                `✏️ ${safeBold(t("action.progressMsg"))}`,
                { parse_mode: "Markdown" },
            )
        } catch (err) {
            logger.error("FOCUS_STATUS_PROGRESS:", err)
            await ctx.answerCbQuery(t("action.focusStatusErr")).catch(() => {})
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
            `❌ ${safeBold(t("action.focusExit"))}\n` +
            `\n` +
            `${focusTitle ? t("action.focusExitLine2", { title: escapeMarkdown(focusTitle) }) : t("action.focusExitLine2") }\n` +
            t("action.focusExitLine3"),
            { parse_mode: "Markdown", ...mainMenu },
        )
    })

    /* FOCUS_NEXT — removed; no flow populates _focusPages (was a dead path) */

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

            let badgeMsg = ""
            if (status === STATUS.DONE) {
                try {
                    const donePages = await fetchDone()
                    const totalDone = donePages.length
                    const taskBadgeIds = checkTaskBadges(uid, totalDone)
                    const taskAwarded = awardBadges(uid, taskBadgeIds)
                    if (taskAwarded.length) {
                        for (const b of taskAwarded) {
                            badgeMsg += `\n\n🏅 ${b.icon} ${safeBold(b.name)} — ${b.desc}!`
                        }
                    }
                } catch (e) {
                    logger.debug("Task badge check error:", e?.message)
                }
            }

            await ctx.editMessageReplyMarkup(undefined).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
            const tip = showHintOnce(uid, "status_change",
                t("action.statusChangeHint"));
            const fullMsg = message + badgeMsg
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
            const actionLabel = status === STATUS.DONE ? "done" : status === STATUS.IN_PROGRESS ? "prog" : "todo";
            await ctx.answerCbQuery("❌ " + t("retry.statusFail")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
            const errMsg = errorWithRetry(t("retry.statusFail"), `RETRY_STATUS_${pageId}_${actionLabel}`);
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
    }

    bot.action(/done_(.+)/, (ctx) =>
        setStatus(
            ctx,
            ctx.match[1],
            STATUS.DONE,
            `✅ ${safeBold(t("action.doneMsg"))}`,
        ),
    );

    bot.action(/prog_(.+)/, (ctx) =>
        setStatus(
            ctx,
            ctx.match[1],
            STATUS.IN_PROGRESS,
            `✏️ ${safeBold(t("action.progressMsg"))}`,
        ),
    );

    bot.action(/todo_(.+)/, (ctx) =>
        setStatus(
            ctx,
            ctx.match[1],
            STATUS.TODO,
            `↩️ ${safeBold(t("action.revertMsg"))}`,
        ),
    );

    /* DELETE — confirmation first */
    bot.action(/del_(.+)/, async (ctx) => {
        const pageId = ctx.match[1];
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));

        try {
            const title = await getPageTitle(pageId);
            return ctx.reply(
                `🗑️ ${safeBold(t("action.delConfirm", { title }))}\n` +
                `${t("action.delConfirmLine2")}\n` +
                ``,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback(t("action.confirmDelete"), `confirm_del_${pageId}`),
                            Markup.button.callback(t("action.cancelDelete"), `cancel_del_${pageId}`),
                        ],
                    ]),
                },
            );
        } catch (err) {
            logger.error("DELETE confirm fetch:", err);
            const errMsg = errorWithRetry(t("cmd.errors.generic"), "RETRY_FETCH_ACTIVE");
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

            /* H3: key by pageId, not uid, so a user can delete
               multiple items in quick succession and recover each
               independently. The 10s recovery window still applies
               to each entry. uid is stored for the response. */
            deletedItems.set(pageId, { pageId, uid, name, _timestamp: Date.now() });

            const recoveryMsg = await ctx.reply(
                `🗑️ ${safeBold(t("action.deleted"))}\n` +
                `\n` +
                t("action.recoverIn10s"),
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(t("action.recoverBtn"), `RECOVER_DELETE_${pageId}`)],
                    ]),
                },
            );

            setTimeout(() => {
                deletedItems.delete(pageId);
                ctx.telegram.editMessageReplyMarkup(
                    ctx.chat.id, recoveryMsg.message_id, undefined, { inline_keyboard: [] },
                ).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
            }, 10000).unref();
        } catch (err) {
            logger.error("DELETE confirm:", err);
            const errMsg = errorWithRetry(t("cmd.errors.generic"), `RETRY_ARCHIVE_${pageId}`);
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
    });

    /* CANCEL DELETE */
    bot.action(/cancel_del_(.+)/, async (ctx) => {
        await ctx.answerCbQuery(t("action.recoverSuccess")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        try {
            await ctx.deleteMessage();
        } catch { logger.debug("Non-critical: cancel delete message failed") }
    });

    /* RECOVER DELETE — restore archived page */
    bot.action(/RECOVER_DELETE_(.+)/, async (ctx) => {
        const pageId = ctx.match[1];
        const uid = ctx.from.id;
        /* H3: look up by pageId (the recovery button carries it) and
           verify the clicker matches the user who deleted it. */
        const item = deletedItems.get(pageId);
        if (!item || item.uid !== uid || Date.now() - item._timestamp > 10000) {
            return ctx.answerCbQuery(t("action.recoverTimeout")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }
        try {
            await restorePage(pageId);
            deletedItems.delete(pageId);
            await ctx.answerCbQuery("✅ " + t("action.recoverSuccess")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
            return ctx.reply(
                `↩️ ${safeBold(t("action.recoverSuccess"))}\n` +
                `\n` +
                t("action.recoverSuccessLine2", { title: safeBold(item.name) }),
                { parse_mode: "Markdown", ...dashboardMenu() },
            );
        } catch (err) {
            logger.error("RECOVER_DELETE:", err);
            const errMsg = errorWithRetry(t("cmd.errors.generic"), `RETRY_ARCHIVE_${pageId}`);
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup });
        }
    });

    /* MORE OPTIONS (from compact confirm) */
    bot.action("MORE_OPTIONS", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);
        if (!state?.pending) {
            return ctx.answerCbQuery(t("action.noData")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        }
        await ctx.answerCbQuery().catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
        const { title, subject, due, priority } = state.pending;
        const dueText = formatDueDisplay(due);
        const msg =
            `📝 ${safeBold(t("action.moreOptions"))}\n` +
            `\n` +
            `${subjectEmoji(subject)} ${safeBold(title)}\n` +
            `🎯 ${priority || "🟡 Medium"}  |  📅 ${dueText}\n` +
            `\n` +
            t("action.moreOptionsLine2");

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
            return ctx.answerCbQuery(t("action.noData")).catch((err) => logger.debug("Non-critical telegram action error:", err?.message));
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
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
            ],
            [Markup.button.callback(t("cmd.menu.back"), "HOME")],
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
                    `📭 ${safeBold(t("review.empty"))}\n` +
                    t("review.emptyLine2"),
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

            let msg = `📋 ${safeBold(t("review.title"))}\n`
            msg += `\n\n`
            msg += `✅ ${t("review.allTime", { total })}\n`
            msg += `📅 ${t("review.thisWeek", { count: weekCount })}\n`
            msg += `📅 ${t("review.last30", { count: monthCount })}\n`
            msg += `\n`
            msg += `📊 ${safeBold(t("review.pickRange"))}`

            const keyboard = [
                [
                    Markup.button.callback(t("review.today"), "REVIEW_PERIOD_today"),
                    Markup.button.callback(t("review.7d"), "REVIEW_PERIOD_7d"),
                    Markup.button.callback(t("review.30d"), "REVIEW_PERIOD_30d"),
                ],
                [
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                    Markup.button.callback(t("cmd.menu.back"), "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("REVIEW action:", err)
            const errMsg = errorWithRetry(t("retry.doneFail"), "RETRY_FETCH_DONE")
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
                    `📭 ${safeBold(t("review.noCompleteInPeriod"))}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const today = new Date(); today.setHours(0, 0, 0, 0)
            let cutoff = new Date(today)
            let periodLabel = ""

            if (period === "today") {
                periodLabel = t("review.today")
            } else if (period === "7d") {
                cutoff.setDate(today.getDate() - 7)
                periodLabel = t("review.7d")
            } else if (period === "30d") {
                cutoff.setDate(today.getDate() - 30)
                periodLabel = t("review.30d")
            }

            const filtered = donePages.filter(p => {
                const d = p.properties.Completed?.date?.start
                return d && new Date(d + "T00:00:00") >= cutoff
            })

            if (!filtered.length) {
                return ctx.reply(
                    `📭 ${safeBold(t("review.noCompleteInPeriodWithLabel", { period: periodLabel }))}\n` +
                    `\n` +
                    t("review.addHomeworkFirst"),
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

            let msg = `📋 ${safeBold(t("review.title"))} ${periodLabel}\n`
            msg += `\n\n`
            msg += `${t("review.allTime", { total: totalInPeriod })}\n`
            if (topSubject) msg += `📚 ${t("review.topSubjects", { subjects: topSubject })}\n`
            msg += `📊 ${t("review.percentageOfAll", { pct: completedPct })}\n`
            if (overdueCount > 0) {
                msg += `${t("review.overdueCount", { count: overdueCount })}\n`
            }
            msg += `\n`
            msg += `${sentiment}`

            const keyboard = [
                [
                    Markup.button.callback(t("review.today"), "REVIEW_DETAIL_0"),
                ],
                [
                    Markup.button.callback(t("review.changePeriod"), "REVIEW"),
                    Markup.button.callback(t("cmd.menu.back"), "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("REVIEW_PERIOD:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.errors.generic"))}\n${t("cmd.error.retry")}`,
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
                    `❌ ${safeBold(t("cmd.errors.notFound"))}\n${t("cmd.error.retry")}`,
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
                `👥 ${safeBold(t("collab.pickTask"))}\n` +
                `\n\n` +
                `${safeBold(title)}\n` +
                `${subjectEmoji(subject)} ${priority} — ${formatDueDisplay(due)}\n\n` +
                `\n` +
                t("collab.shareMessage") +
                `${safeCode(`@${botUsername} /collab accept ${token}`)}\n\n` +
                t("collab.tokenExpiryNote"),
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("COLLAB_SEL:", err)
            return ctx.reply(
                `❌ ${safeBold(t("collab.saveErr"))}\n${t("cmd.error.retry")}`,
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
        /* H1: persist the in-flight session so a restart mid-pomodoro
           can be detected and the work phase can be credited instead
           of silently lost. */
        persistInFlightSession(uid, session)

        const timeout = setTimeout(async () => {
            pomoTimers.delete(timeout)
            try {
                const userStateNow = userState.get(uid) || {}
                savePomodoro(uid)
                /* H1: work phase is over — clear the in-flight marker
                   (a new break session would be tracked separately, but
                   we don't persist break phases since they don't earn
                   a pomodoro count). */
                clearInFlightSession(uid)
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
                            badgeMsg = `\n\n🏅 ${safeBold(t("action.newBadgeUnlocked"))}\n`
                            for (const b of awarded) {
                                badgeMsg += `${b.icon} ${b.name} — ${b.desc}\n`
                            }
                        }
                    }
                } catch { logger.debug("Non-critical: pomo badge check failed") }

                const title = state._pomoHomeworkTitle || ""
                let msg = `☕ ${safeBold(t("action.pomoBreak"))}\n`
                msg += `\n`
                msg += `${t("action.pomoSessionComplete")}\n`
                if (title) msg += `📌 ${t("action.pomoBreakLine2")} ${escapeMarkdown(title)}\n`
                msg += `\n${t("pomodoro.restMsg")}`
                msg += badgeMsg

                const keyboard = [
                    [Markup.button.callback(t("pomodoro.nextRound"), "POMODORO_START")],
                    [Markup.button.callback(t("cmd.menu.back"), "HOME")],
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
        let msg = `🍅 ${safeBold(t("pomodoro.startBtn"))}\n`
        msg += `\n`
        msg += `${t("pomodoro.pomoStartLine2")}\n`
        if (title) msg += `📌 ${t("pomodoro.task", { title: escapeMarkdown(title) })}\n`
        msg += `\n${t("pomodoro.encouragement")}`

        const keyboard = [
            [Markup.button.callback(t("pomodoro.cancel"), "POMODORO_CANCEL")],
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
        /* H1: clear the persisted in-flight marker so we don't credit
           a session the user explicitly cancelled. */
        clearInFlightSession(uid)

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
            `❌ ${safeBold(t("pomodoro.cancel"))}\n` +
            `\n` +
            t("pomodoro.cancelLine2"),
            { parse_mode: "Markdown", ...mainMenu },
        )
    })

    /* POMODORO STATS — show pomodoro statistics */
    bot.action("POMODORO_STATS", async (ctx) => {
        const uid = ctx.from.id
        await ctx.answerCbQuery().catch(() => {})

        const stats = pomoGetStats(uid)
        const streak = pomoGetStreak(uid)

        let msg = `🍅 ${safeBold(t("pomodoro.title"))}\n`
        msg += `\n`
        msg += `${t("pomodoro.sessionsToday", { count: stats.today })}\n`
        msg += `${t("pomodoro.sessionsWeek", { count: stats.week })}\n`
        msg += `${t("pomodoro.totalSessions", { count: stats.count, hours: stats.totalHours })}\n`
        if (streak > 0) msg += `${t("pomodoro.streak", { days: streak })}\n`
        msg += ``

        const keyboard = [
            [Markup.button.callback(t("pomodoro.startBtn"), "POMODORO_START")],
            [Markup.button.callback(t("cmd.menu.back"), "HOME")],
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
            `🔄 ${safeBold(t("suggest.generating"))}\n` +
            `\n` +
            t("suggest.title"),
            { parse_mode: "Markdown", ...mainMenu },
        )
    })

    /* SMARTBOOK actions */
    bot.action("SMARTBOOK_SAVE", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid)
        await ctx.answerCbQuery(t("smartbook.savedPlan")).catch(() => {})
        if (state) {
            userState.set(uid, { ...state, _timestamp: Date.now() })
        }
        return ctx.reply(
            `💾 ${safeBold(t("smartbook.savedPlan"))}\n` +
            `\n` +
            t("smartbook.savedPlanLine2"),
            { parse_mode: "Markdown", ...mainMenu },
        )
    })

    bot.action("SMARTBOOK_REFRESH", async (ctx) => {
        await ctx.answerCbQuery().catch(() => {})
        try {
            // Re-trigger AI by sending /smartbook message
            return ctx.reply(
                `🔄 ${safeBold(t("smartbook.refreshing"))}\n` +
                `\n` +
                t("smartbook.typeToCreate"),
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("SMARTBOOK_REFRESH:", err)
            return ctx.reply(
                `❌ ${safeBold(t("smartbook.refreshErr"))}\n${t("cmd.error.retry")}`,
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
                `❌ ${safeBold(t("smartbook.noPlanSaved"))}\n` +
                t("smartbook.typeToCreateFirst"),
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        /* H4: build an RFC 5545-compliant iCal feed.
           - Escape `\`, `;`, `,`, newline in SUMMARY/DESCRIPTION
           - Fold long lines (≥75 octets) with CRLF + single space
           - Use TZID on timed events and include a VTIMEZONE block
             so calendar apps in other zones don't shift the events
           - DTEND for an all-day event is exclusive (start + 1 day) */
        const ics = buildSmartbookIcs(plan.plan)
        const buffer = Buffer.from(ics, "utf-8")
        try {
            await ctx.replyWithDocument({
                source: buffer,
                filename: "smartbook_plan.ics",
            })
        } catch (err) {
            logger.error("SMARTBOOK_ICAL:", err)
            return ctx.reply(
                `❌ ${safeBold(t("action.pomoErr"))}\n${t("cmd.error.retry")}`,
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
                    `📭 ${safeBold(t("review.noCompleteInPeriod"))}`,
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

            let msg = `📋 ${safeBold(t("text.searchCount", { count: `${pageNum + 1}/${totalPages}` }))}\n`
            msg += `\n\n`
            for (let i = 0; i < pageItems.length; i++) {
                const p = pageItems[i]
                const { title, subject, priority, completed } = getPageProps(p)
                const doneDate = completed ? completed.slice(5).replace("-", "/") : "?"
                msg += `${start + i + 1}. [${subject}] ${safeBold(title)}\n`
                msg += `   ${priority} — ${t("export.completedAt")} ${doneDate}\n\n`
            }

            const keyboard = []
            const row = []
            if (pageNum > 0) {
                row.push(Markup.button.callback(t("text.searchAgain"), `REVIEW_DETAIL_${pageNum - 1}`))
            }
            if (pageNum + 1 < totalPages) {
                row.push(Markup.button.callback(t("text.searchAgain"), `REVIEW_DETAIL_${pageNum + 1}`))
            }
            if (row.length) keyboard.push(row)
            keyboard.push([
                Markup.button.callback(t("review.changePeriod"), "REVIEW"),
                Markup.button.callback(t("cmd.menu.back"), "HOME"),
            ])

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("REVIEW_DETAIL:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.errors.loadData"))}\n${t("cmd.error.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })
}
