import { Markup } from "telegraf";
import { parseThaiDate, formatDate, formatDateLabel, formatDueDisplay, isPossiblyLastMonth, parseYMDToLocalDate } from "../utils/dateParser.js";
import { getHomeworkStats, fetchActive, fetchDone, getPageProps, updateStatus, updateHomework, createHomework, getPageStatus, archivePage } from "../services/notionService.js";
import {
    detectSubject,
    cleanTitle,
    subjectEmoji,
    canonSubj,
} from "../utils/subjectDetector.js";
import { parseHomework, isAIReady } from "../services/aiService.js";
import { isQaReady, askAI } from "../services/qaService.js";
import { recalcPriority } from "../utils/priority.js";
import { inferAndParseTags } from "../utils/tagDetector.js";
import { createDashboardUrl } from "../web/server.js";
import { logger } from "../utils/logger.js";
import { QUOTES } from "../utils/quotes.js";
import { buildPanic, buildTomorrow, buildWeek, buildDeadline, buildProgress, statusEmoji } from "./viewBuilders.js";
import { getStudyTip } from "../services/hintService.js";
import { buildBadgeMessage } from "../services/badgeService.js";
import { getStats as pomoGetStats } from "../services/pomodoroService.js";
import {
    escapeMarkdown,
    safeBold,
    safeItalic,
    safeCode,
} from "../utils/telegramFormat.js";
import { STATUS, PRIORITY, priorityWeight } from "../utils/constants.js";
import { t } from "../utils/i18n.js";


const WEB_URL = process.env.WEB_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
    || "";
const BOT_USERNAME = process.env.BOT_USERNAME || "homeworkbot";

// ── Collab share tokens (persisted across restarts) ──
import { setShareToken as setShareTokenPersist, getShareToken, deleteShareToken, hasShareToken, sizeShareTokens, clearShareTokens, iterateShareTokens, SHARE_TOKEN_TTL } from "../services/shareTokenService.js"
export const shareTokens = {
    set: (token, data) => setShareTokenPersist(token, data),
    get: (token) => getShareToken(token),
    delete: (token) => deleteShareToken(token),
    has: (token) => hasShareToken(token),
    get size() { return sizeShareTokens() },
    clear: () => clearShareTokens(),
    [Symbol.iterator]: () => iterateShareTokens(),
}
const COLLAB_TOKEN_TTL = SHARE_TOKEN_TTL

export const mainMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback(t("cmd.menu.add"), "ADD"),
        Markup.button.callback(t("cmd.menu.active"), "LIST_ACTIVE"),
    ],
    [
        Markup.button.callback(t("cmd.menu.done"), "LIST_DONE"),
        Markup.button.callback(t("cmd.menu.dashboard"), "DASHBOARD"),
    ],
    [
        Markup.button.callback(t("cmd.menu.ask"), "ASK_AI"),
        Markup.button.callback(t("cmd.menu.panic"), "PANIC"),
    ],
    ...(WEB_URL
        ? [[Markup.button.url("🌐 Web Dashboard", createDashboardUrl(WEB_URL) || WEB_URL)]]
        : []),
]);

export const cancelMenu = Markup.inlineKeyboard([
    [Markup.button.callback(t("cmd.menu.cancel"), "CANCEL")],
]);

export const compactConfirmMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback(t("cmd.menu.save"), "CONFIRM_SAVE"),
        Markup.button.callback(t("cmd.menu.edit"), "CONFIRM_EDIT"),
    ],
    [
        Markup.button.callback(t("cmd.menu.subject"), "EDIT_SUBJECT"),
        Markup.button.callback(t("cmd.menu.date"), "EDIT_DATE"),
    ],
    [
        Markup.button.callback(t("cmd.menu.more"), "MORE_OPTIONS"),
        Markup.button.callback(t("cmd.menu.cancel"), "CANCEL"),
    ],
]);

export const moreOptionsMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback(t("cmd.menu.priority"), "EDIT_PRIORITY"),
        Markup.button.callback(t("cmd.menu.tags"), "EDIT_TAGS"),
    ],
    [
        Markup.button.callback(t("cmd.menu.back"), "BACK_TO_CONFIRM"),
        Markup.button.callback(t("cmd.menu.cancel"), "CANCEL"),
    ],
]);

/* Retry actions must come from this allowlist to prevent user-controlled
   callback_data from being rendered into reply_markup. */
const ALLOWED_RETRY_PREFIXES = [
    "RETRY_FETCH_ACTIVE",
    "RETRY_FETCH_DONE",
    "RETRY_FETCH_DASHBOARD",
    "RETRY_STATUS_",
    "RETRY_ARCHIVE_",
]

function isValidRetryAction(retryAction) {
    if (typeof retryAction !== "string") return false
    if (retryAction.length > 64) return false
    return ALLOWED_RETRY_PREFIXES.some((p) => retryAction.startsWith(p))
}

export function errorWithRetry(message, retryAction) {
    const safeAction = isValidRetryAction(retryAction) ? retryAction : "HOME"
    return {
        text: `❌ *${escapeMarkdown(message)}*\n${t("cmd.error.retry")}`,
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [[
                { text: t("cmd.error.retryBtn"), callback_data: safeAction },
                { text: t("cmd.error.homeBtn"), callback_data: "HOME" },
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
    const subject = parsed?.subject || t("fallback.subject");
    const title = parsed?.title || t("bot.fallbackTitle");
    const due = parsed?.due ? formatDueDisplay(parsed.due) : `${t("bot.fallbackDue")} 📅`;
    const priority = parsed?.priority || "🟡 Medium";
    const tags = parsed?.tags?.length ? parsed.tags.join("  ") : null;
    const badge = parsed?.parseSource === "ai"
        ? `\n🤖 ${safeItalic(t("badge.ai") + " — " + t("badge.aiHint"))}`
        : parsed?.parseSource === "regex"
        ? `\n📝 ${safeItalic(t("badge.regex") + " — " + t("badge.regexHint"))}`
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
        `👋 ${safeBold(t("cmd.welcome.greet", { name }))}\n` +
        `🤖 ${t("cmd.welcome.line1")}\n` +
        `${safeItalic(t("cmd.welcome.example"))} ${safeCode(t("cmd.welcome.exampleText"))}\n` +
        `${t("cmd.welcome.line2")}`
    );
}

function buildMenuMessage() {
    return (
        `🏠 ${safeBold(t("cmd.menuMsg.title"))}\n\n` +
        `${t("cmd.menuMsg.line1")}\n` +
        `${safeCode(t("cmd.menuMsg.exampleText"))}\n\n` +
        `${t("cmd.menuMsg.line2")}`
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
        dateHint = `\n📅 ${t("cmd.confirm.dateHint")}\n`;
    }
    return ctx.reply(
        `📝 ${safeBold(t("cmd.confirm.title"))}\n\n` +
            `${buildHomeworkPreview(srcPending)}` +
            `${dateHint}` +
            `\n✅ ${t("cmd.confirm.actions")}`,
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
            priority: hasDue ? (aiResult.priority || "🟡 Medium") : "🟢 Low",
            tags: aiResult.tags,
            parseSource: "ai",
        };
    }
    const due = parseThaiDate(text);
    const subject = detectSubject(text);
    const priority = due ? "🟡 Medium" : "🟢 Low";
    return {
        due,
        subject,
        title: shortenTitle(cleanTitle(text) || text, subject),
        priority,
        tags: inferAndParseTags(text, priority),
        parseSource: "regex",
    };
}

/* ── /panic helpers ── */
export function sortByUrgency(pages) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const THIRTY_DAYS_AGO = new Date(today)
    THIRTY_DAYS_AGO.setDate(today.getDate() - 30)

    const filtered = pages.filter(p => {
        const due = p.properties.Due?.date?.start
        if (!due) return true
        return parseYMDToLocalDate(due) >= THIRTY_DAYS_AGO
    })

    return [...filtered].sort((a, b) => {
        const dueA = a.properties.Due?.date?.start
        const dueB = b.properties.Due?.date?.start
        const dtA = dueA ? parseYMDToLocalDate(dueA) : null
        const dtB = dueB ? parseYMDToLocalDate(dueB) : null

        const diffA = dtA ? Math.ceil((dtA.getTime() - today.getTime()) / 86400000) : Infinity
        const diffB = dtB ? Math.ceil((dtB.getTime() - today.getTime()) / 86400000) : Infinity

        if (diffA < 0 && diffB < 0) return diffA - diffB
        if (diffA < 0) return -1
        if (diffB < 0) return 1

        if (diffA <= 3 && diffB > 3) return -1
        if (diffB <= 3 && diffA > 3) return 1
        if (diffA <= 7 && diffB > 7) return -1
        if (diffB <= 7 && diffA > 7) return 1

        const priA = a.properties.Priority?.select?.name || PRIORITY.MEDIUM
        const priB = b.properties.Priority?.select?.name || PRIORITY.MEDIUM
        const wA = priorityWeight(priA)
        const wB = priorityWeight(priB)
        if (wA !== wB) return wB - wA

        if (!dtA) return 1
        if (!dtB) return -1
        return dtA.getTime() - dtB.getTime()
    })
}

export function buildPanicCard(page) {
    const { title, status, due, subject, priority } = getPageProps(page)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const dt = due ? parseYMDToLocalDate(due) : null
    const diff = dt ? Math.ceil((dt.getTime() - today.getTime()) / 86400000) : null

    let badge = ""
    if (diff !== null && diff < 0) {
        badge = `🚨 (${t("badge.overdue", { days: Math.abs(diff) })})`
    } else if (diff !== null && diff <= 3) {
        badge = `⏰ (${t("badge.left", { days: diff })})`
    } else if (diff !== null && diff <= 7) {
        badge = `⌛ (${t("badge.left", { days: diff })})`
    }

    let text = `${statusEmoji(status)} ${safeBold(title)} ${badge}\n`
    text += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  ${formatDueDisplay(due)}`
    return text
}

export async function runSuggest(ctx) {
    const pages = await fetchActive()
    if (!pages.length) {
        return ctx.reply(
            `🎉 ${safeBold(t("cmd.suggest.empty"))}\n${t("cmd.suggest.emptyLine2")} 🏆`,
            { parse_mode: "Markdown", ...mainMenu },
        )
    }

    const sorted = sortByUrgency(pages)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const bySubject = {}
    let overdueCount = 0
    const contextLines = sorted.map((p, i) => {
        const { title, subject, due, priority } = getPageProps(p)
        bySubject[subject] = (bySubject[subject] || 0) + 1
        const dt = due ? new Date(due + "T00:00:00") : null
        const isOverdue = dt && dt < today
        if (isOverdue) overdueCount++
        const daysLeft = dt ? Math.ceil((dt.getTime() - today.getTime()) / 86400000) : null
        const urgencyLabel = isOverdue
            ? t("cmd.suggest.daysOverdue", { days: Math.abs(daysLeft) })
            : daysLeft !== null
                ? t("cmd.suggest.daysLeft", { days: daysLeft })
                : t("cmd.suggest.noDue")
        return `${i + 1}. [${subject}] ${title} — ${t("cmd.suggest.dueLabel")}: ${due || "N/A"} (${urgencyLabel}) — ${t("cmd.suggest.priorityLabel")}: ${priority}`
    }).join("\n")

    const subjectBreakdown = Object.entries(bySubject)
        .map(([s, c]) => `- ${s}: ${c} ${t("cmd.suggest.items")}`)
        .join("\n")

    const prompt = t("cmd.suggest.promptIntro", { date: today.toISOString().slice(0, 10), contextLines, subjectBreakdown, overdueCount })

    let suggestion = null
    try {
        const { askAI } = await import("../services/qaService.js")
        suggestion = await askAI(prompt)
    } catch {
        logger.debug("AI suggest failed, using rule-based fallback")
    }

    if (!suggestion) {
        const overdueItems = sorted.filter(p => {
            const due = p.properties.Due?.date?.start
            return due && new Date(due + "T00:00:00") < today
        })
        const urgentItems = sorted.filter(p => {
            const due = p.properties.Due?.date?.start
            if (!due) return false
            const dt = new Date(due + "T00:00:00")
            const diff = Math.ceil((dt.getTime() - today.getTime()) / 86400000)
            return diff >= 0 && diff <= 3
        })
        const laterItems = sorted.filter(p => {
            const due = p.properties.Due?.date?.start
            if (!due) return false
            const dt = new Date(due + "T00:00:00")
            const diff = Math.ceil((dt.getTime() - today.getTime()) / 86400000)
            return diff > 3
        })

        suggestion = ""
        if (overdueItems.length) {
            suggestion += t("cmd.suggest.fbOverdue", { count: overdueItems.length }) + "\n"
            for (const p of overdueItems.slice(0, 3)) {
                const { title, subject } = getPageProps(p)
                suggestion += `  • ${title} (${subject})\n`
            }
        }
        if (urgentItems.length) {
            suggestion += t("cmd.suggest.fbUrgent", { count: urgentItems.length }) + ":\n"
            for (const p of urgentItems.slice(0, 3)) {
                const { title, subject } = getPageProps(p)
                suggestion += `  • ${title} (${subject})\n`
            }
        }
        if (laterItems.length) {
            suggestion += t("cmd.suggest.fbLater", { count: laterItems.length }) + "\n"
        }
        if (!suggestion) suggestion = t("cmd.suggest.noSuggestion")
    }

    let msg = `💡 ${safeBold(t("cmd.suggest.title"))}\n`
    msg += `\n\n`
    msg += `${suggestion}\n`
    msg += `\n`
    msg += `\n📊 ${t("cmd.suggest.footer", { count: sorted.length })}`
    if (overdueCount > 0) msg += ` (🚨 ${t("cmd.suggest.overdueSuffix", { count: overdueCount })})`

    const keyboard = [
        [Markup.button.callback(t("cmd.suggest.refresh"), "SUGGEST_REFRESH")],
        [
            Markup.button.callback(t("cmd.suggest.focusBtn"), "FOCUS"),
            Markup.button.callback(t("cmd.suggest.viewAll"), "LIST_ACTIVE"),
        ],
        [Markup.button.callback(t("cmd.btn.home"), "HOME")],
    ]

    return ctx.reply(msg, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(keyboard),
    })
}

export function registerCommandHandlers(bot, userState) {
    bot.start((ctx) => {
        const name = escapeMarkdown(ctx.from?.first_name || t("cmd.fallbackName"));
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
            return ctx.reply(t("cmd.ask.noKey"), {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }
        userState.set(ctx.from.id, { mode: "ASK_AI", _timestamp: Date.now() });
        return ctx.reply(
            `🤖 ${safeBold(t("cmd.ask.title"))}\n\n` +
                `${t("cmd.ask.line1")}\n` +
                `${safeCode(t("cmd.ask.ex1"))}\n` +
                `${safeCode(t("cmd.ask.ex2"))}\n\n` +
                `${t("cmd.ask.line2")}`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    bot.command("help", (ctx) =>
        ctx.reply(
            `🆘 ${safeBold(t("cmd.help.title"))}\n\n` +
                `📝 ${safeBold(t("cmd.help.addTitle"))}\n` +
                `${t("cmd.help.addLine1")}\n` +
                `${safeCode(t("cmd.help.ex1"))}\n` +
                `${safeCode(t("cmd.help.ex2"))}\n` +
                `${safeCode(t("cmd.help.ex3"))}\n\n` +
                `🤖 ${t("cmd.help.autoDetect")}\n\n` +
                `📋 ${safeBold(t("cmd.help.cmdListTitle"))}\n` +
                `${t("cmd.help.cmdList")}`,
            {
                parse_mode: "Markdown",
                ...mainMenu,
            },
        ),
    );

    bot.command("stats", async (ctx) => {
        try {
            const stats = await getHomeworkStats()
            const total = stats.total || 1
            const filled = Math.round(stats.pct / 10)
            const bar = "█".repeat(filled) + "░".repeat(10 - filled)
            const msg =
                `📊 ${safeBold(t("cmd.stats.title"))}\n\n` +
                `📌 ${t("cmd.stats.todo")}  ${stats.todo}\n` +
                `🔄 ${t("cmd.stats.prog")}  ${stats.prog}\n` +
                `✅ ${t("cmd.stats.done")}  ${stats.done}\n\n` +
                `⚡ ${t("cmd.stats.urgent")}  ${stats.urgent}  │  🚨 ${t("cmd.stats.overdue")}  ${stats.overdue}\n\n` +
                `${bar}  ${stats.pct}%`
            return ctx.reply(msg, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("/stats:", err)
            return ctx.reply(
                `❌ ${t("cmd.stats.err")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("panic", async (ctx) => {
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold(t("cmd.panic.empty"))}\n${t("cmd.panic.emptyLine2")} 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const sorted = sortByUrgency(pages)
            const { msg, keyboard } = buildPanic(sorted, 3)
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/panic:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.errors.generic"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("tomorrow", async (ctx) => {
        try {
            const pages = await fetchActive()
            const tomorrow = new Date()
            tomorrow.setDate(tomorrow.getDate() + 1)
            const tomorrowStr = formatDate(tomorrow)
            const dueTomorrow = pages.filter(p => p.properties.Due?.date?.start === tomorrowStr)

            if (!dueTomorrow.length) {
                return ctx.reply(
                    `🎉 ${safeBold(t("cmd.tomorrow.empty"))}\n${t("cmd.tomorrow.emptyLine2")} 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const { msg, keyboard } = buildTomorrow(dueTomorrow)
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/tomorrow:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.errors.generic"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("search", async (ctx) => {
        const args = ctx.message.text.split(" ").slice(1).join(" ").trim()
        if (!args) {
            return ctx.reply(
                `🔍 ${safeBold(t("cmd.search.prompt"))}\n` +
                `\n` +
                `${t("cmd.search.example1")} /search ${safeCode("math")}\n` +
                `    /search ${safeCode("calculus")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        try {
            const [activePages, donePages] = await Promise.all([fetchActive(), fetchDone()])
            const keyword = args.toLowerCase()

            function matchPage(p) {
                const title = (p.properties.Name?.title?.[0]?.plain_text || "").toLowerCase()
                const subject = (p.properties.Subject?.rich_text?.[0]?.plain_text || "").toLowerCase()
                return title.includes(keyword) || subject.includes(keyword)
            }

            const matchedActive = activePages.filter(matchPage)
            const matchedDone = donePages.filter(matchPage)

            if (!matchedActive.length && !matchedDone.length) {
                return ctx.reply(
                    `🔍 ${safeBold(t("cmd.search.notFound", { term: escapeMarkdown(args) }))} ${t("cmd.search.notFoundLine2")}\n` +
                    `\n` +
                    `${t("cmd.search.tryAnother")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            /* M2: cap how many results we render per page. Telegram
               silently rejects messages with more than 100 inline
               keyboard buttons, and 200+ results can blow past the
               4096-char message limit. We paginate 8 active at a time
               and always show the count so the user knows. */
            const PAGE_SIZE = 8
            const totalActive = matchedActive.length
            const totalDone = matchedDone.length
            const total = totalActive + totalDone

            const activePage = matchedActive.slice(0, PAGE_SIZE)
            const remainingActive = Math.max(0, totalActive - activePage.length)

            let msg = `🔍 ${safeBold(t("cmd.search.results", { term: escapeMarkdown(args), count: total }))}\n`
            msg += `\n\n`

            const keyboard = []

            if (activePage.length) {
                msg += `📌 ${safeBold(t("cmd.search.active"))} (${totalActive}):\n`
                for (const p of activePage) {
                    const { title, status, due, subject, priority } = getPageProps(p)
                    msg += `${statusEmoji(status)} ${safeBold(title)} ${subjectEmoji(subject)} ${priority} — ${formatDueDisplay(due)}\n`
                    keyboard.push([
                        Markup.button.callback(t("cmd.btn.done"), `done_${p.id}`),
                        Markup.button.callback(t("cmd.btn.inProgress"), `prog_${p.id}`),
                    ])
                }
                if (remainingActive > 0) {
                    msg += `\n_${t("cmd.search.truncated", { shown: activePage.length, total: totalActive })}_`
                }
                msg += `\n`
            }

            if (matchedDone.length) {
                msg += `✅ ${safeBold(t("cmd.search.completed"))} (${totalDone}):\n`
                for (const p of matchedDone) {
                    const props = getPageProps(p)
                    msg += `${statusEmoji(props.status)} ${safeBold(props.title)} ${subjectEmoji(props.subject)} ${props.priority} — ✅ ${formatDateLabel(props.completed, "completed")}\n`
                }
                msg += `\n`
            }

            keyboard.push([
                Markup.button.callback(t("cmd.btn.searchMore"), "SEARCH"),
                Markup.button.callback(t("cmd.menu.add"), "ADD"),
                Markup.button.callback(t("cmd.menu.dashboard"), "DASHBOARD"),
                Markup.button.callback(t("cmd.btn.home"), "HOME"),
            ])

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/search:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.errors.notFound"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("week", async (ctx) => {
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold(t("cmd.week.empty"))}\n${t("cmd.week.emptyLine2")} 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            const { msg, keyboard } = buildWeek(pages)
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/week:", err)
            const errMsg = errorWithRetry(t("cmd.errors.loadWeek"), "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    bot.command("deadline", async (ctx) => {
        try {
            const pages = await fetchActive()
            const result = buildDeadline(pages)
            if (!result) {
                return ctx.reply(
                    `🎉 ${safeBold(t("cmd.deadline.empty"))}\n${t("cmd.deadline.emptyLine2")} 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            return ctx.reply(result.msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(result.keyboard),
            })
        } catch (err) {
            logger.error("/deadline:", err)
            const errMsg = errorWithRetry(t("cmd.errors.loadData"), "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    bot.command("progress", async (ctx) => {
        try {
            const [activePages, donePages] = await Promise.all([fetchActive(), fetchDone()])
            const result = buildProgress(activePages, donePages)
            if (!result) {
                return ctx.reply(
                    `📊 ${safeBold(t("cmd.progress.empty"))}\n${t("cmd.progress.emptyLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            return ctx.reply(result.msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(result.keyboard),
            })
        } catch (err) {
            logger.error("/progress:", err)
            const errMsg = errorWithRetry(t("cmd.errors.loadData"), "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    bot.command("quote", async (ctx) => {
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
            `💪 ${safeBold(t("cmd.quote.cheer"))}`

        const keyboard = [
            [
                Markup.button.callback(t("cmd.quote.another"), "QUOTE"),
                Markup.button.callback(t("cmd.menu.dashboard"), "DASHBOARD"),
            ],
            [Markup.button.callback(t("cmd.btn.home"), "HOME")],
        ]
        return ctx.reply(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(keyboard),
        })
    })

    bot.command("export", async (ctx) => {
        try {
            const [activePages, donePages] = await Promise.all([fetchActive(), fetchDone()])
            const today = formatDate(new Date())

            if (!activePages.length && !donePages.length) {
                return ctx.reply(
                    `📭 ${safeBold(t("cmd.export.empty"))}\n${t("cmd.progress.emptyLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            let text = `${t("cmd.export.header", { date: today })}\n`
            text += `=====================================\n\n`

            if (activePages.length) {
                text += `📌 ${t("cmd.export.active")} (${activePages.length}):\n`
                activePages.forEach((p, i) => {
                    const { title, subject, due, priority } = getPageProps(p)
                    const dueStr = due ? `${t("cmd.export.due")} ${due.slice(5).replace("-", "/")}` : t("bot.fallbackDue")
                    text += `  ${i + 1}. [${subject}] ${title} — ${dueStr} ${priority}\n`
                })
                text += `\n`
            }

            if (donePages.length) {
                text += `✅ ${t("cmd.export.done")} (${donePages.length}):\n`
                donePages.forEach((p, i) => {
                    const { title, subject, completed, priority } = getPageProps(p)
                    const doneStr = completed ? `${t("cmd.export.completedAt")} ${completed.slice(5).replace("-", "/")}` : t("cmd.export.doneShort")
                    text += `  ${i + 1}. [${subject}] ${title} — ${doneStr} ${priority}\n`
                })
                text += `\n`
            }

            const total = activePages.length + donePages.length
            const pct = total > 0 ? Math.round((donePages.length / total) * 100) : 0
            text += `=====================================\n`
            text += `${t("cmd.export.total", { total, pct })}\n`

            /* M2: Telegram rejects messages longer than 4096 chars
               with "Bad Request: message is too long". For large
               lists, send the full text as a .txt file (no length
               limit) and reply with a short summary. Threshold picked
               to leave headroom for the Markdown wrapper. */
            const TELEGRAM_MAX = 3500
            if (text.length > TELEGRAM_MAX) {
                const buffer = Buffer.from(text, "utf-8")
                await ctx.replyWithDocument({
                    source: buffer,
                    filename: `homework_export_${today}.txt`,
                })
                return ctx.reply(
                    `📋 ${safeBold(t("cmd.export.exported", { total }))}\n` +
                    `\n` +
                    `📎 ${t("cmd.export.attached", { size: (buffer.length / 1024).toFixed(1) })}\n` +
                    `${t("cmd.export.completedPct", { pct })}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const msg =
                `📋 ${safeBold(t("cmd.export.title"))}\n` +
                `\n` +
                `${safeCode(text)}\n` +
                `\n` +
                `💡 ${t("cmd.export.shareHint")}`

            const keyboard = [
                [
                    Markup.button.callback(t("cmd.menu.add"), "ADD"),
                    Markup.button.callback(t("cmd.menu.dashboard"), "DASHBOARD"),
                ],
                [Markup.button.callback(t("cmd.btn.home"), "HOME")],
            ]
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/export:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.export.err"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("noted", async (ctx) => {
        const args = ctx.message.text.split(" ").slice(1).join(" ").trim()
        if (!args) {
            return ctx.reply(
                `📝 ${safeBold(t("cmd.noted.usage"))}\n` +
                `\n` +
                `${t("cmd.noted.example1Label")} ${safeCode(t("cmd.noted.example1"))}\n` +
                `${safeCode(t("cmd.noted.example2"))}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        const firstSpace = args.indexOf(" ")
        if (firstSpace === -1) {
            return ctx.reply(
                `📝 ${safeBold(t("cmd.noted.missing"))}\n` +
                `\n` +
                `${t("cmd.noted.example1Label")} ${safeCode(t("cmd.noted.example1"))}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        const keyword = args.slice(0, firstSpace).trim()
        const note = args.slice(firstSpace + 1).trim()

        try {
            const pages = await fetchActive()
            const kw = keyword.toLowerCase()
            const matched = pages.filter(p => {
                const title = (p.properties.Name?.title?.[0]?.plain_text || "").toLowerCase()
                return title.includes(kw)
            })

            if (!matched.length) {
                return ctx.reply(
                    `🔍 ${safeBold(t("cmd.noted.notFound", { term: escapeMarkdown(keyword) }))}\n` +
                    `\n` +
                    `${t("cmd.noted.tryAnother")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            if (matched.length > 1) {
                userState.set(ctx.from.id, { mode: "NOTED_SELECT", _pendingNoted: { keyword, note, matched }, _timestamp: Date.now() })
                let msg = `📝 ${safeBold(t("cmd.noted.multiple", { count: matched.length }))}\n`
                msg += `\n\n`
                const keyboard = []
                for (let i = 0; i < matched.length; i++) {
                    const { title, subject } = getPageProps(matched[i])
                    msg += `${i + 1}. ${safeBold(title)} (${subjectEmoji(subject)} ${subject})\n`
                    keyboard.push([Markup.button.callback(`${i + 1}. ${title.slice(0, 25)}`, `NOTED_SEL_${i}`)])
                }
                msg += `\n`
                msg += `${t("cmd.noted.pickOne")}`
                keyboard.push([Markup.button.callback(t("cmd.menu.cancel"), "CANCEL")])
                return ctx.reply(msg, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(keyboard),
                })
            }

            const page = matched[0]
            const { title } = getPageProps(page)
            await updateHomework(page.id, { note })

            return ctx.reply(
                `📝 ${safeBold(t("cmd.noted.added"))}\n` +
                `\n` +
                `📌 "${escapeMarkdown(title)}"\n` +
                `📝 ${escapeMarkdown(note)}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("/noted:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.noted.err"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("hint", async (ctx) => {
        const args = ctx.message.text.split(" ").slice(1).join(" ").trim()
        const subject = args ? canonSubj(detectSubject(args)) : null

        if (!subject || subject === "General") {
            if (args) {
                return ctx.reply(
                    `🤔 ${safeBold(t("cmd.hint.unknown", { term: escapeMarkdown(args) }))}\n` +
                    `\n` +
                    `${t("cmd.hint.list")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            const keyboard = [
                [
                    Markup.button.callback("🔢 Math", "HINT_คณิต"),
                    Markup.button.callback("📖 Thai", "HINT_ไทย"),
                    Markup.button.callback("🔤 English", "HINT_อังกฤษ"),
                ],
                [
                    Markup.button.callback("⚛️ Physics", "HINT_ฟิสิกส์"),
                    Markup.button.callback("🧪 Chemistry", "HINT_เคมี"),
                    Markup.button.callback("🧬 Biology", "HINT_ชีวะ"),
                ],
                [
                    Markup.button.callback("🌏 Social", "HINT_สังคม"),
                    Markup.button.callback("🏛️ History", "HINT_ประวัติ"),
                    Markup.button.callback("💻 Computer", "HINT_คอม"),
                ],
                [Markup.button.callback(t("cmd.menu.cancel"), "CANCEL")],
            ]
            return ctx.reply(
                `🧠 ${safeBold(t("cmd.hint.pickSubject"))}\n` +
                `\n` +
                t("cmd.hint.pickSubjectLine2"),
                { parse_mode: "Markdown", ...Markup.inlineKeyboard(keyboard) },
            )
        }

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
                    `📭 ${safeBold(t("cmd.hint.emptyForSubject", { subject }))}\n` +
                    `\n` +
                    `${t("cmd.hint.emptyForSubjectLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            return ctx.reply(hint, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("/hint:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.errors.generic"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("undo", async (ctx) => {
        const uid = ctx.from.id;
        const state = userState.get(uid);
        if (!state?._lastAction?._timestamp || Date.now() - state._lastAction._timestamp > 30000) {
            return ctx.reply(t("cmd.undo.expired"), { parse_mode: "Markdown" });
        }
        const { type, pageId, from, to } = state._lastAction;
        if (type === "STATUS_CHANGE") {
            try {
                await updateStatus(pageId, from);
                delete state._lastAction;
                userState.set(uid, state);
                return ctx.reply(`↩️ ${safeBold(t("cmd.undo.undone"))} — ${t("cmd.undo.restoredTo", { status: from })}`, {
                    parse_mode: "Markdown",
                    ...mainMenu,
                });
            } catch (err) {
                logger.error("UNDO:", err);
                return ctx.reply(`❌ ${safeBold(t("cmd.undo.err"))} — ${t("cmd.errors.retry")}`, {
                    parse_mode: "Markdown",
                    ...mainMenu,
                });
            }
        }
        return ctx.reply(t("cmd.undo.cantUndo"), { parse_mode: "Markdown" });
    });

    /* ── /focus ── */
    bot.command("focus", async (ctx) => {
        try {
            const uid = ctx.from.id
            const state = userState.get(uid) || {}

            // Handle /focus exit
            const args = ctx.message.text.split(/\s+/)
            if (args[1] === "exit") {
                if (state._focusActive) {
                    const focusTitle = state._focusTitle || ""
                    userState.delete(uid)
                    return ctx.reply(
                        `❌ ${safeBold(t("cmd.focus.exited"))}\n` +
                        `\n` +
                        `${focusTitle ? t("cmd.focus.stoppedFocusing", { title: escapeMarkdown(focusTitle) }) : t("cmd.focus.stoppedFocusingShort")}`,
                        { parse_mode: "Markdown", ...mainMenu },
                    )
                }
                return ctx.reply(
                    `❌ ${safeBold(t("cmd.focus.noActive"))}\n${t("cmd.focus.noActiveLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            // If already in focus mode, show current focus card
            if (state._focusActive && state._focusHomeworkId) {
                const pages = await fetchActive()
                const page = pages.find(p => p.id === state._focusHomeworkId)
                if (page) {
                    const { title, status, due, subject, priority } = getPageProps(page)
                    const today = new Date(); today.setHours(0, 0, 0, 0)
                    const dt = due ? parseYMDToLocalDate(due) : null
                    const diff = dt ? Math.ceil((dt.getTime() - today.getTime()) / 86400000) : null

                    let badge = ""
                    if (diff !== null && diff < 0) badge = ` 🚨 ${t("cmd.focus.overdue", { days: Math.abs(diff) })}`
                    else if (diff !== null && diff <= 3) badge = ` 🔥 ${t("cmd.focus.left", { days: diff })}`
                    else if (diff !== null && diff <= 7) badge = ` ⏰ ${t("cmd.focus.left", { days: diff })}`

                    let msg = `🎯 ${safeBold(t("cmd.focus.focusing"))}\n`
                    msg += `\n\n`
                    msg += `${statusEmoji(status)} ${safeBold(title)}${badge}\n`
                    msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  ${formatDueDisplay(due)}\n\n`
                    msg += `\n`
                    msg += `💡 ${t("cmd.focus.exitHint")}`

                    const keyboard = [
                        [
                            Markup.button.callback(t("cmd.btn.done"), "FOCUS_STATUS_DONE"),
                            Markup.button.callback(t("cmd.btn.inProgress"), "FOCUS_STATUS_PROGRESS"),
                        ],
                        [
                            Markup.button.callback(t("cmd.focus.exitBtn"), "FOCUS_EXIT"),
                        ],
                    ]

                    return ctx.reply(msg, {
                        parse_mode: "Markdown",
                        ...Markup.inlineKeyboard(keyboard),
                    })
                }
            }

            // No active focus — pick a task
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold(t("cmd.focus.empty"))}\n${t("cmd.focus.emptyLine2")} 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const sorted = sortByUrgency(pages)
            let msg = `🎯 ${safeBold(t("cmd.focus.pickTask"))}\n`
            msg += `\n\n`
            for (let i = 0; i < Math.min(sorted.length, 10); i++) {
                const p = sorted[i]
                const { title, subject, priority, due } = getPageProps(p)
                msg += `${i + 1}. ${safeBold(title)}\n`
                msg += `   ${subjectEmoji(subject)} ${priority} — ${formatDueDisplay(due)}\n\n`
            }
            if (sorted.length > 10) {
                msg += `… ${t("cmd.focus.moreItems", { count: sorted.length - 10 })}`
            }

            const keyboard = []
            for (let i = 0; i < Math.min(sorted.length, 10); i++) {
                keyboard.push([
                    Markup.button.callback(`${i + 1}. ${getPageProps(sorted[i]).title.slice(0, 30)}`, `FOCUS_SEL_${sorted[i].id}`),
                ])
            }
            keyboard.push([
                Markup.button.callback(t("cmd.focus.viewAll"), "LIST_ACTIVE"),
                Markup.button.callback(t("cmd.btn.home"), "HOME"),
            ])

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/focus:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.errors.loadData"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* ── /badges ── */
    bot.command("badges", async (ctx) => {
        const uid = ctx.from.id
        const msg = buildBadgeMessage(uid)
        const keyboard = [
            [
                Markup.button.callback(t("cmd.menu.dashboard"), "DASHBOARD"),
            ],
            [Markup.button.callback(t("cmd.btn.home"), "HOME")],
        ]
        return ctx.reply(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(keyboard),
        })
    })

    /* ── /review ── */
    bot.command("review", async (ctx) => {
        try {
            const donePages = await fetchDone()
            if (!donePages.length) {
                return ctx.reply(
                    `📭 ${safeBold(t("cmd.review.empty"))}\n` +
                    `${t("cmd.review.emptyLine2")}`,
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

            let msg = `📋 ${safeBold(t("cmd.review.title"))}\n`
            msg += `\n\n`
            msg += `✅ ${t("cmd.review.allTime", { total })}\n`
            msg += `📅 ${t("cmd.review.thisWeek", { count: weekCount })}\n`
            msg += `📅 ${t("cmd.review.last30", { count: monthCount })}\n`
            msg += `\n`
            msg += `📊 ${safeBold(t("cmd.review.pickRange"))}`

            const keyboard = [
                [
                    Markup.button.callback(t("cmd.review.today"), "REVIEW_PERIOD_today"),
                    Markup.button.callback(t("cmd.review.7d"), "REVIEW_PERIOD_7d"),
                    Markup.button.callback(t("cmd.review.30d"), "REVIEW_PERIOD_30d"),
                ],
                [
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                    Markup.button.callback(t("cmd.btn.home"), "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/review:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.errors.loadData"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* ── /collab — share homework with friends ── */
    bot.command("collab", async (ctx) => {
        const uid = ctx.from.id
        const text = ctx.message.text.trim()

        // /collab accept <token>
        const parts = text.split(/\s+/)
        if (parts[1] === "accept" && parts[2]) {
            const token = parts[2]
            const shareData = shareTokens.get(token)
            if (!shareData) {
                return ctx.reply(
                    `❌ ${safeBold(t("collab.invalidToken"))}\n` +
                    `\n` +
                    `${t("collab.invalidTokenLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            if (Date.now() - shareData._timestamp > COLLAB_TOKEN_TTL) {
                shareTokens.delete(token)
                return ctx.reply(
                    `⏱️ ${safeBold(t("collab.expiredToken"))}\n` +
                    `\n` +
                    `${t("collab.expiredTokenLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            try {
                await createHomework({
                    title: shareData.title,
                    subject: shareData.subject,
                    due: shareData.due,
                    rawText: "",
                    priority: shareData.priority,
                    note: shareData.note || "",
                    tags: shareData.tags,
                })
                shareTokens.delete(token)
                return ctx.reply(
                    `✅ ${safeBold(t("collab.accepted"))}\n` +
                    `\n` +
                    `"${escapeMarkdown(shareData.title)}" ${t("collab.addedToSystem")}\n` +
                    `${t("collab.viewList")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            } catch (err) {
                logger.error("COLLAB accept:", err)
                return ctx.reply(
                    `❌ ${safeBold(t("collab.saveErr"))}\n${t("cmd.errors.retry")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
        }

        // /collab — show active list to pick
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `📭 ${safeBold(t("collab.empty"))}\n` +
                    `${t("collab.emptyLine2")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const sorted = sortByUrgency(pages)
            let msg = `👥 ${safeBold(t("collab.pickTask"))}\n`
            msg += `\n\n`
            for (let i = 0; i < Math.min(sorted.length, 8); i++) {
                const p = sorted[i]
                const { title, subject, priority, due } = getPageProps(p)
                msg += `${i + 1}. ${safeBold(title)}\n`
                msg += `   ${subjectEmoji(subject)} ${priority} — ${formatDueDisplay(due)}\n\n`
            }

            const keyboard = sorted.slice(0, 8).map((p, i) => {
                const props = getPageProps(p)
                return [Markup.button.callback(`${i + 1}. ${props.title.slice(0, 25)}`, `COLLAB_SEL_${p.id}`)]
            })
            keyboard.push([
                Markup.button.callback(t("cmd.focus.viewAll"), "LIST_ACTIVE"),
                Markup.button.callback(t("cmd.btn.home"), "HOME"),
            ])

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/collab:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.errors.loadData"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* ── /smartbook — AI study plan ── */
    bot.command("smartbook", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid) || {}
        const text = ctx.message.text.trim()
        const parts = text.split(/\s+/)

        // /smartbook view — show saved plan
        if (parts[1] === "view" && state._smartbookPlan) {
            const plan = state._smartbookPlan
            let msg = `📚 ${safeBold(t("cmd.smartbook.savedTitle"))}\n`
            msg += `\n\n`
            for (const day of plan.plan || []) {
                msg += `${safeBold(day.day)} (${day.date || ""})\n`
                msg += `🎯 ${t("cmd.smartbook.focus", { focus: day.focus })}\n`
                msg += `⏱️ ${day.duration_min || 0} ${t("cmd.smartbook.minutes")}\n`
                for (const t2 of day.tasks || []) {
                    msg += `  • ${t2}\n`
                }
                msg += `\n`
            }
            if (plan.summary) {
                msg += `\n💡 ${plan.summary}`
            }
            const keyboard = [
                [
                    Markup.button.callback(t("cmd.smartbook.refresh"), "SMARTBOOK_REFRESH"),
                    Markup.button.callback("📅 iCal", "SMARTBOOK_ICAL"),
                ],
                [Markup.button.callback(t("cmd.btn.home"), "HOME")],
            ]
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        }

        // /smartbook — generate new plan via AI
        try {
            await ctx.reply(t("cmd.smartbook.generating"), { parse_mode: "Markdown" })

            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold(t("cmd.smartbook.empty"))}\n${t("cmd.smartbook.emptyLine2")} 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const contextLines = pages.map((p, i) => {
                const { title, subject, due, priority } = getPageProps(p)
                return `${i + 1}. [${subject}] ${title} — ${t("cmd.export.due")} ${due || t("bot.fallbackDue")} (${priority})`
            }).join("\n")

            const prompt = `${t("cmd.smartbook.promptIntro")}\n\n${t("cmd.smartwork.taskLabel")}:\n${contextLines}\n\n${t("cmd.smartbook.promptFormat")}`

            let planData = null
            try {
                const aiText = await askAI(prompt)
                if (aiText) {
                    const cleaned = aiText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()
                    const jsonStart = cleaned.indexOf("{")
                    const jsonEnd = cleaned.lastIndexOf("}")
                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        planData = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1))
                    }
                }
            } catch {
                logger.debug("AI smartbook failed, using static fallback")
            }

            if (!planData || !planData.plan) {
                // Static fallback
                const bySubject = {}
                for (const p of pages) {
                    const sub = canonSubj(p.properties.Subject?.rich_text?.[0]?.plain_text) || "General"
                    bySubject[sub] = (bySubject[sub] || 0) + 1
                }
                const today = new Date()
                planData = {
                    plan: Object.entries(bySubject).slice(0, 7).map(([sub, count], i) => {
                        const d = new Date(today)
                        d.setDate(d.getDate() + i)
                        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
                        return {
                            day: dayNames[d.getDay()],
                            date: d.toISOString().slice(0, 10),
                            focus: sub,
                            tasks: [`Review ${sub}`, `Finish ${sub} homework (${count} items)`],
                            duration_min: 90,
                        }
                    }),
                    summary: `Focus on ${Object.keys(bySubject).length} subjects — adjust as needed`,
                }
            }

            let msg = `📚 ${safeBold(t("cmd.smartbook.weekTitle"))}\n`
            msg += `\n\n`
            for (const day of planData.plan) {
                msg += `${safeBold(day.day)} (${day.date || ""})\n`
                msg += `🎯 ${t("cmd.smartbook.focus", { focus: day.focus })}\n`
                msg += `⏱️ ${day.duration_min || 0} ${t("cmd.smartbook.minutes")}\n`
                for (const t2 of day.tasks || []) {
                    msg += `  • ${t2}\n`
                }
                msg += `\n`
            }
            if (planData.summary) {
                msg += `\n💡 ${planData.summary}`
            }

            userState.set(uid, {
                ...state,
                _smartbookPlan: planData,
                _timestamp: Date.now(),
            })

            const keyboard = [
                [
                    Markup.button.callback(t("cmd.smartbook.save"), "SMARTBOOK_SAVE"),
                    Markup.button.callback(t("cmd.smartbook.refresh"), "SMARTBOOK_REFRESH"),
                ],
                [
                    Markup.button.callback("📅 iCal", "SMARTBOOK_ICAL"),
                    Markup.button.callback(t("cmd.btn.home"), "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/smartbook:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.smartbook.createErr"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* ── /pomodoro — Pomodoro Timer ── */
    bot.command("pomodoro", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid) || {}

        // If already in a pomodoro session, show remaining time
        if (state._pomoActive && state._pomoTimeout) {
            const elapsed = Date.now() - state._pomoStartedAt
            const remaining = Math.max(0, state._pomoDuration - elapsed)
            const mins = Math.floor(remaining / 60000)
            const secs = Math.floor((remaining % 60000) / 1000)
            const title = state._pomoHomeworkTitle || ""
            let msg = `🍅 ${safeBold(t("cmd.pomodoro.running"))}\n`
            msg += `\n`
            msg += `⏱️ ${t("cmd.pomodoro.remaining", { mins, secs: String(secs).padStart(2, "0") })}\n`
            if (title) msg += `📌 ${t("cmd.pomodoro.task", { title: escapeMarkdown(title) })}\n`
            msg += `\n${t("cmd.pomodoro.encouragement")}`

            const keyboard = [
                [Markup.button.callback(t("cmd.pomodoro.cancel"), "POMODORO_CANCEL")],
            ]
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        }

        // If in break mode
        if (state._pomoBreak && state._pomoBreakTimeout) {
            const elapsed = Date.now() - state._pomoBreakStartedAt
            const remaining = Math.max(0, state._pomoBreakDuration - elapsed)
            const mins = Math.floor(remaining / 60000)
            const secs = Math.floor((remaining % 60000) / 1000)
            let msg = `☕ ${safeBold(t("cmd.pomodoro.break"))}\n`
            msg += `\n`
            msg += `⏱️ ${t("cmd.pomodoro.remaining", { mins, secs: String(secs).padStart(2, "0") })}\n`
            msg += `${t("cmd.pomodoro.restMsg")}`

            const keyboard = [
                [Markup.button.callback(t("cmd.pomodoro.nextRound"), "POMODORO_START")],
                [Markup.button.callback(t("cmd.pomodoro.cancel"), "POMODORO_CANCEL")],
            ]
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        }

        // No active session — show main menu
        const stats = pomoGetStats(uid)
        let msg = `🍅 ${safeBold(t("cmd.pomodoro.title"))}\n`
        msg += `\n`
        msg += `⏱️ ${t("cmd.pomodoro.schedule")}\n\n`
        msg += `📊 ${safeBold(t("cmd.pomodoro.statsTitle"))}\n`
        msg += `  🍅 ${t("cmd.pomodoro.sessionsToday", { count: stats.today })}\n`
        msg += `  📅 ${t("cmd.pomodoro.sessionsWeek", { count: stats.week })}\n`
        msg += `  🏆 ${t("cmd.pomodoro.totalSessions", { count: stats.count, hours: stats.totalHours })}\n`

        const keyboard = [
            [Markup.button.callback(t("cmd.pomodoro.startBtn"), "POMODORO_START")],
            [
                Markup.button.callback(t("cmd.pomodoro.statsBtn"), "POMODORO_STATS"),
                Markup.button.callback(t("cmd.btn.home"), "HOME"),
            ],
        ]

        return ctx.reply(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(keyboard),
        })
    })

    /* ── /suggest — AI suggest what to do first ── */
    bot.command("suggest", async (ctx) => {
        try {
            await ctx.reply(t("cmd.suggest.generating"), { parse_mode: "Markdown" })
            return runSuggest(ctx)
        } catch (err) {
            logger.error("/suggest:", err)
            return ctx.reply(
                `❌ ${safeBold(t("cmd.suggest.err"))}\n${t("cmd.errors.retry")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* RETRY handlers — re-trigger the failed action */
    bot.action("RETRY_FETCH_ACTIVE", async (ctx) => {
        await ctx.answerCbQuery(t("retry.retrying")).catch(() => {})
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(`🎉 ${safeBold(t("retry.activeEmpty"))}`, { parse_mode: "Markdown", ...mainMenu })
            }
            return ctx.reply(`📋 ${safeBold(t("retry.activeSuccess"))} (${t("retry.count", { count: pages.length })})`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_FETCH_ACTIVE:", err)
            return ctx.reply(`❌ ${safeBold(t("retry.activeFail"))}`, { parse_mode: "Markdown", ...mainMenu })
        }
    })

    bot.action("RETRY_FETCH_DONE", async (ctx) => {
        await ctx.answerCbQuery(t("retry.retrying")).catch(() => {})
        try {
            const pages = await fetchDone()
            return ctx.reply(`✅ ${safeBold(t("retry.doneSuccess"))} (${t("retry.count", { count: pages.length })})`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_FETCH_DONE:", err)
            return ctx.reply(`❌ ${safeBold(t("retry.doneFail"))}`, { parse_mode: "Markdown", ...mainMenu })
        }
    })

    bot.action("RETRY_FETCH_DASHBOARD", async (ctx) => {
        await ctx.answerCbQuery(t("retry.retrying")).catch(() => {})
        try {
            const stats = await getHomeworkStats()
            return ctx.reply(`📊 ${safeBold(t("retry.dashboardSuccess"))}\n\n📌 ${stats.todo}  🔄 ${stats.prog}  ✅ ${stats.done}  🚨 ${stats.overdue}`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_FETCH_DASHBOARD:", err)
            return ctx.reply(`❌ ${safeBold(t("retry.dashboardFail"))}`, { parse_mode: "Markdown", ...mainMenu })
        }
    })

    /* RETRY_STATUS_<id>_<action> — re-attempt status update with strict id validation */
    bot.action(/^RETRY_STATUS_([A-Za-z0-9_-]{1,40})_(\w+)$/, async (ctx) => {
        const [, pageId, action] = ctx.match
        const map = { done: STATUS.DONE, prog: STATUS.IN_PROGRESS, todo: STATUS.TODO }
        const newStatus = map[action]
        if (!newStatus) {
            return ctx.answerCbQuery(t("retry.unknownAction")).catch(() => {})
        }
        await ctx.answerCbQuery(t("retry.retrying")).catch(() => {})
        try {
            const oldStatus = await getPageStatus(pageId)
            await updateStatus(pageId, newStatus)
            const uid = ctx.from.id
            const state = userState.get(uid) || {}
            state._lastAction = { type: "STATUS_CHANGE", pageId, from: oldStatus, to: newStatus, _timestamp: Date.now() }
            userState.set(uid, state)
            return ctx.reply(`✅ ${safeBold(t("retry.statusSuccess"))} — ${newStatus}`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_STATUS:", err)
            return ctx.reply(`❌ ${safeBold(t("retry.statusFail"))}`, { parse_mode: "Markdown", ...mainMenu })
        }
    })

    /* RETRY_ARCHIVE_<id> — re-attempt archive with strict id validation */
    bot.action(/^RETRY_ARCHIVE_([A-Za-z0-9_-]{1,40})$/, async (ctx) => {
        const [, pageId] = ctx.match
        await ctx.answerCbQuery(t("retry.retrying")).catch(() => {})
        try {
            const { archivePage } = await import("../services/notionService.js")
            await archivePage(pageId)
            return ctx.reply(`🗑️ ${safeBold(t("retry.archiveSuccess"))}`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_ARCHIVE:", err)
            return ctx.reply(`❌ ${safeBold(t("retry.archiveFail"))}`, { parse_mode: "Markdown", ...mainMenu })
        }
    })

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
                `🤔 ${t("text.unknownCmd", { cmd: safeCode(text.split(" ")[0]) })}\n` +
                `${t("text.unknownCmdLine2")}`,
                { parse_mode: "Markdown" },
            );
        }
        if (text.length > MAX_TEXT_LENGTH) {
            return ctx.reply(`⚠️ ${safeBold(t("text.msgTooLong"))}\n\n${t("text.maxChars", { max: MAX_TEXT_LENGTH })}`, {
                parse_mode: "Markdown",
                ...mainMenu,
            });
        }

        const uid = ctx.from.id;
        const state = userState.get(uid);

        // Block non-command text while in focus mode
        if (state?._focusActive && !text.startsWith("/")) {
            const ft = state._focusTitle || ""
            return ctx.reply(
                `🎯 ${safeBold(t("text.focusActive", { title: escapeMarkdown(ft) }))}\n` +
                `\n` +
                `${t("text.focusActiveLine2")}`,
                { parse_mode: "Markdown" },
            );
        }

        if (state?.mode === "EDIT_TITLE") {
            if (text.length > MAX_TEXT_LENGTH) {
                return ctx.reply(`⚠️ ${safeBold(t("text.editTitleTooLong"))}\n\n${t("text.maxChars", { max: MAX_TEXT_LENGTH })}`, {
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
                return ctx.reply(`⚠️ ${safeBold(t("text.editSubjectTooLong"))}\n\n${t("text.maxChars", { max: MAX_TEXT_LENGTH })}`, {
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
                    `❌ ${safeBold(t("text.editDateInvalid"))}\n` +
                        `${t("text.editDateExamples")}`,
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
                    .map(t2 => t2.trim())
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
                    `❌ ${safeBold(t("cmd.errors.generic"))}\n${t("cmd.errors.retry")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                );
            }
            userState.delete(uid);
            const pending = { title: parsed.title, subject: parsed.subject, due: parsed.due, priority: parsed.priority, rawText: text, tags: parsed.tags };
            userState.set(uid, { mode: "CONFIRM", pending, _timestamp: Date.now(), originalText: text });
            return showConfirm(ctx, pending, parsed.parseSource);
        }

        if (state?.mode === "SEARCH") {
            const keyword = text.trim()
            if (!keyword) {
                userState.set(uid, { mode: "SEARCH", _timestamp: Date.now() })
                return ctx.reply(
                    `🔍 ${safeBold(t("text.searchPrompt"))}\n` +
                    `\n` +
                    `${t("text.searchExamples")}`,
                    { parse_mode: "Markdown", ...cancelMenu },
                )
            }

            try {
                const [activePages, donePages] = await Promise.all([fetchActive(), fetchDone()])
                const kw = keyword.toLowerCase()

                function matchPage(p) {
                    const title = (p.properties.Name?.title?.[0]?.plain_text || "").toLowerCase()
                    const subject = (p.properties.Subject?.rich_text?.[0]?.plain_text || "").toLowerCase()
                    return title.includes(kw) || subject.includes(kw)
                }

                const matchedActive = activePages.filter(matchPage)
                const matchedDone = donePages.filter(matchPage)

                userState.delete(uid)

                if (!matchedActive.length && !matchedDone.length) {
                    return ctx.reply(
                        `🔍 ${safeBold(t("text.searchNoMatch", { term: escapeMarkdown(keyword) }))}\n` +
                        `\n` +
                        `${t("text.searchNoMatchLine2")}`,
                        { parse_mode: "Markdown", ...mainMenu },
                    )
                }

                const total = matchedActive.length + matchedDone.length
                let msg = `🔍 ${safeBold(t("text.searchResults", { term: escapeMarkdown(keyword) }))} (${t("text.searchCount", { count: total })})\n`
                msg += `\n\n`

                const keyboard = []

                if (matchedActive.length) {
                    msg += `📌 ${safeBold(t("text.searchActive"))} (${matchedActive.length}):\n`
                    for (const p of matchedActive) {
                        const { title, due, subject, priority } = getPageProps(p)
                        msg += `${safeBold(title)} ${subjectEmoji(subject)} ${priority} — ${formatDueDisplay(due)}\n`
                        keyboard.push([
                            Markup.button.callback(t("text.searchDoneBtn"), `done_${p.id}`),
                            Markup.button.callback(t("text.searchProgBtn"), `prog_${p.id}`),
                        ])
                    }
                    msg += `\n`
                }

                if (matchedDone.length) {
                    msg += `✅ ${safeBold(t("text.searchDoneSection"))} (${matchedDone.length}):\n`
                    for (const p of matchedDone) {
                        const props = getPageProps(p)
                        msg += `${safeBold(props.title)} ${subjectEmoji(props.subject)} ${props.priority} — ✅\n`
                    }
                    msg += `\n`
                }

                keyboard.push([
                    Markup.button.callback(t("text.searchAgain"), "SEARCH"),
                    Markup.button.callback(t("text.addBtn"), "ADD"),
                    Markup.button.callback(t("text.dashboardBtn"), "DASHBOARD"),
                    Markup.button.callback(t("cmd.btn.home"), "HOME"),
                ])

                return ctx.reply(msg, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(keyboard),
                })
            } catch (err) {
                logger.error("SEARCH mode:", err)
                userState.delete(uid)
                return ctx.reply(
                    `❌ ${safeBold(t("text.searchFail"))}\n${t("cmd.errors.retry")}`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
        }

        if (state?.mode === "ASK_AI") {
            await ctx.reply(t("ask.searching"), { parse_mode: "Markdown" });
            const answer = await askAI(text);
            userState.delete(uid);
            return ctx.reply(
                answer
                    ? `🤖 ${safeBold(t("ask.answer"))}\n\n${answer}`
                    : t("ask.fail"),
                { parse_mode: "Markdown", ...mainMenu },
            );
        }

        // Not in any mode — smart preview with AI or regex
        const parsed = await parseText(text);
        const pending = { title: parsed.title, subject: parsed.subject, due: parsed.due, priority: parsed.priority, rawText: text, tags: parsed.tags, parseSource: parsed.parseSource };

        // Fix 1: skip preview if AI is confident + regex agrees
        if (isUnambiguous(parsed, text)) {
            userState.set(uid, { mode: "CONFIRM", pending, originalText: text, _timestamp: Date.now() });
            await ctx.reply(`🤖 ${safeItalic(t("text.aiConfident"))}`, { parse_mode: "Markdown" });
            return showConfirm(ctx, pending, "ai");
        }

        userState.set(uid, { mode: "PENDING_PARSE", pending, originalText: text, _timestamp: Date.now() });

        const previewText =
            `⚡ ${safeBold(t("text.previewIntro"))}\n` +
            `\n` +
            `${buildHomeworkPreview(parsed)}\n` +
            `\n` +
            `${t("text.previewCta")}`;

        return ctx.reply(previewText, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(t("text.addBtn"), "ADD")],
                [
                    Markup.button.callback(t("text.activeBtn"), "LIST_ACTIVE"),
                    Markup.button.callback(t("text.dashboardBtn"), "DASHBOARD"),
                ],
            ]),
        });
    });

}
