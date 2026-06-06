import { Markup } from "telegraf";
import { parseThaiDate, formatDate, formatDateLabel, formatDueDisplay, isPossiblyLastMonth, parseYMDToLocalDate } from "../utils/dateParser.js";
import { getHomeworkStats, fetchActive, fetchDone, getPageProps, updateStatus, updateHomework, createHomework, getPageStatus, archivePage } from "../services/notionService.js";
import {
    detectSubject,
    cleanTitle,
    subjectEmoji,
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
        Markup.button.callback("➕ เพิ่มการบ้าน", "ADD"),
        Markup.button.callback("📋 งานค้าง", "LIST_ACTIVE"),
    ],
    [
        Markup.button.callback("✅ เสร็จ", "LIST_DONE"),
        Markup.button.callback("📊 Dashboard", "DASHBOARD"),
    ],
    [
        Markup.button.callback("🤖 ถาม AI", "ASK_AI"),
        Markup.button.callback("🚨 ฉุกเฉิน", "PANIC"),
    ],
    ...(WEB_URL
        ? [[Markup.button.url("🌐 Web Dashboard", createDashboardUrl(WEB_URL) || WEB_URL)]]
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
        `👋 ${safeBold("สวัสดี " + name + "!")}\n` +
        `🤖 พิมพ์การบ้านมาที่แชทเลย\n` +
        `${safeItalic("เช่น")} ${safeCode("คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้")}\n` +
        `หรือกด /menu เพื่อดูคำสั่งอื่นๆ`
    );
}

function buildMenuMessage() {
    return (
        `🏠 ${safeBold("เมนูหลัก")}\n\n` +
        `พิมพ์การบ้านมาที่แชทได้เลย เช่น\n` +
        `${safeCode("คณิต แบบฝึกหัดหน้า 20 พรุ่งนี้")}\n\n` +
        `หรือเลือกเมนูด้านล่าง`
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
        dateHint = "\n📅 ตีความเป็นเดือนหน้า — ถ้าต้องการเดือนนี้ให้แก้วันที่\n";
    }
    return ctx.reply(
        `📝 ${safeBold("ตรวจสอบก่อนบันทึก")}\n\n` +
            `${buildHomeworkPreview(srcPending)}` +
            `${dateHint}` +
            `\n✅ กดบันทึก หรือ ✏️ แก้ไข`,
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

        const diffA = dtA ? Math.ceil((dtA - today) / 86400000) : Infinity
        const diffB = dtB ? Math.ceil((dtB - today) / 86400000) : Infinity

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
        return dtA - dtB
    })
}

export function buildPanicCard(page) {
    const { title, status, due, subject, priority } = getPageProps(page)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const dt = due ? parseYMDToLocalDate(due) : null
    const diff = dt ? Math.ceil((dt - today) / 86400000) : null

    let badge = ""
    if (diff !== null && diff < 0) {
        badge = `🚨 (เลย ${Math.abs(diff)} วัน)`
    } else if (diff !== null && diff <= 3) {
        badge = `⏰ (เหลือ ${diff} วัน)`
    } else if (diff !== null && diff <= 7) {
        badge = `⌛ (เหลือ ${diff} วัน)`
    }

    let text = `${statusEmoji(status)} ${safeBold(title)} ${badge}\n`
    text += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  ${formatDueDisplay(due)}`
    return text
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
            `🤖 ${safeBold("ถามเกี่ยวกับการบ้าน")}\n\n` +
                `พิมพ์คำถาม เช่น\n` +
                `${safeCode("งานคณิตส่งวันไหนบ้าง")}\n` +
                `${safeCode("อาทิตย์นี้มีงานกี่ชิ้น")}\n\n` +
                `หรือกดยกเลิก`,
            { parse_mode: "Markdown", ...cancelMenu },
        );
    });

    bot.command("help", (ctx) =>
        ctx.reply(
            `🆘 ${safeBold("วิธีใช้งาน")}\n\n` +
                `📝 ${safeBold("เพิ่มงาน")}\n` +
                `พิมพ์การบ้านมาที่แชท เช่น\n` +
                `${safeCode("คณิต หน้า 45 พรุ่งนี้")}\n` +
                `${safeCode("รายงานอังกฤษ วันศุกร์")}\n` +
                `${safeCode("ชีวะ บทที่ 3 อีก 3 วัน")}\n\n` +
                `🤖 ระบบจะเดาวิชา + วันที่ให้อัตโนมัติ\n\n` +
                `📋 ${safeBold("คำสั่งที่ใช้บ่อย")}\n` +
                `/menu — เมนูหลัก\n` +
                `/stats — ดูสถิติ\n` +
                `/panic — งานด่วน\n` +
                `/week — ตารางสัปดาห์\n` +
                `/ask — ถาม AI`,
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
                `📊 ${safeBold("สถิติการบ้าน")}\n\n` +
                `📌 ยังไม่ทำ  ${stats.todo}\n` +
                `🔄 กำลังทำ  ${stats.prog}\n` +
                `✅ เสร็จแล้ว  ${stats.done}\n\n` +
                `⚡ ด่วน  ${stats.urgent}  │  🚨 เลยกำหนด  ${stats.overdue}\n\n` +
                `${bar}  ${stats.pct}%`
            return ctx.reply(msg, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("/stats:", err)
            return ctx.reply(
                `❌ โหลดสถิติไม่ได้ กรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("panic", async (ctx) => {
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มีการบ้านด่วน!")}\nพักผ่อนได้เลย 🏆`,
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
                `❌ ${safeBold("เกิดข้อผิดพลาด")}\nกรุณาลองใหม่`,
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
            logger.error("/tomorrow:", err)
            return ctx.reply(
                `❌ ${safeBold("เกิดข้อผิดพลาด")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("search", async (ctx) => {
        const args = ctx.message.text.split(" ").slice(1).join(" ").trim()
        if (!args) {
            return ctx.reply(
                `🔍 ${safeBold("พิมพ์คำค้นหา")}\n` +
                `\n` +
                `เช่น /search ${safeCode("คณิต")}\n` +
                `    /search ${safeCode("แคลคูลัส")}`,
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
                    `🔍 ${safeBold(`ไม่พบ "${escapeMarkdown(args)}"`)} ในระบบ\n` +
                    `\n` +
                    `ลองค้นหาด้วยคำอื่น หรือกลับไปที่เมนูหลัก`,
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

            let msg = `🔍 ${safeBold(`ผลค้นหา: "${escapeMarkdown(args)}"`)} (${total} รายการ)\n`
            msg += `\n\n`

            const keyboard = []

            if (activePage.length) {
                msg += `📌 ${safeBold("ยังไม่เสร็จ")} (${totalActive}):\n`
                for (const p of activePage) {
                    const { title, status, due, subject, priority } = getPageProps(p)
                    msg += `${statusEmoji(status)} ${safeBold(title)} ${subjectEmoji(subject)} ${priority} — ${formatDueDisplay(due)}\n`
                    keyboard.push([
                        Markup.button.callback("✅ เสร็จ", `done_${p.id}`),
                        Markup.button.callback("🔄 กำลังทำ", `prog_${p.id}`),
                    ])
                }
                if (remainingActive > 0) {
                    msg += `\n_…แสดง ${activePage.length} จาก ${totalActive} — ลองค้นหาให้แคบลง_`
                }
                msg += `\n`
            }

            if (matchedDone.length) {
                msg += `✅ ${safeBold("เสร็จแล้ว")} (${totalDone}):\n`
                for (const p of matchedDone) {
                    const props = getPageProps(p)
                    msg += `${statusEmoji(props.status)} ${safeBold(props.title)} ${subjectEmoji(props.subject)} ${props.priority} — ✅ ${formatDateLabel(props.completed, "completed")}\n`
                }
                msg += `\n`
            }

            keyboard.push([
                Markup.button.callback("🔍 ค้นหาอีก", "SEARCH"),
                Markup.button.callback("➕ เพิ่ม", "ADD"),
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                Markup.button.callback("🏠 เมนูหลัก", "HOME"),
            ])

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/search:", err)
            return ctx.reply(
                `❌ ${safeBold("ค้นหาไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("week", async (ctx) => {
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
            logger.error("/week:", err)
            const errMsg = errorWithRetry("โหลดตารางไม่ได้", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    bot.command("deadline", async (ctx) => {
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
            logger.error("/deadline:", err)
            const errMsg = errorWithRetry("โหลดข้อมูลไม่ได้", "RETRY_FETCH_ACTIVE")
            return ctx.reply(errMsg.text, { parse_mode: "Markdown", reply_markup: errMsg.reply_markup })
        }
    })

    bot.command("progress", async (ctx) => {
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
            logger.error("/progress:", err)
            const errMsg = errorWithRetry("โหลดข้อมูลไม่ได้", "RETRY_FETCH_ACTIVE")
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

    bot.command("export", async (ctx) => {
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
                    `📋 ${safeBold(`ส่งออก ${total} รายการ`)}\n` +
                    `\n` +
                    `📎 ไฟล์แนบอยู่ด้านบน (${(buffer.length / 1024).toFixed(1)} KB)\n` +
                    `เสร็จแล้ว ${pct}%`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

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
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/export:", err)
            return ctx.reply(
                `❌ ${safeBold("ส่งออกไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("noted", async (ctx) => {
        const args = ctx.message.text.split(" ").slice(1).join(" ").trim()
        if (!args) {
            return ctx.reply(
                `📝 ${safeBold("การใช้งาน: /noted [ชื่องาน] [โน๊ต]")}\n` +
                `\n` +
                `เช่น ${safeCode("/noted แคลคูลัส ใช้หนังสือเล่มแดง")}\n` +
                `${safeCode("/noted ฟิสิกส์ ส่งที่โต๊ะครู")}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }

        const firstSpace = args.indexOf(" ")
        if (firstSpace === -1) {
            return ctx.reply(
                `📝 ${safeBold("กรุณาระบุโน๊ตด้วย")}\n` +
                `\n` +
                `เช่น ${safeCode("/noted แคลคูลัส ใช้หนังสือเล่มแดง")}`,
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
                    `🔍 ${safeBold(`ไม่พบ "${escapeMarkdown(keyword)}"`)} ในระบบ\n` +
                    `\n` +
                    `ลองค้นหาด้วยคำอื่น`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            if (matched.length > 1) {
                userState.set(ctx.from.id, { mode: "NOTED_SELECT", _pendingNoted: { keyword, note, matched }, _timestamp: Date.now() })
                let msg = `📝 ${safeBold(`เจอหลายรายการ (${matched.length})`)}\n`
                msg += `\n\n`
                const keyboard = []
                for (let i = 0; i < matched.length; i++) {
                    const { title, subject } = getPageProps(matched[i])
                    msg += `${i + 1}. ${safeBold(title)} (${subjectEmoji(subject)} ${subject})\n`
                    keyboard.push([Markup.button.callback(`${i + 1}. ${title.slice(0, 25)}`, `NOTED_SEL_${i}`)])
                }
                msg += `\n`
                msg += `เลือกรายการที่ต้องการเพิ่มโน๊ต`
                keyboard.push([Markup.button.callback("❌ ยกเลิก", "CANCEL")])
                return ctx.reply(msg, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(keyboard),
                })
            }

            const page = matched[0]
            const { title } = getPageProps(page)
            await updateHomework(page.id, { note })

            return ctx.reply(
                `📝 ${safeBold("เพิ่มโน๊ตแล้ว!")}\n` +
                `\n` +
                `📌 "${escapeMarkdown(title)}"\n` +
                `📝 ${escapeMarkdown(note)}`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        } catch (err) {
            logger.error("/noted:", err)
            return ctx.reply(
                `❌ ${safeBold("เพิ่มโน๊ตไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    bot.command("hint", async (ctx) => {
        const args = ctx.message.text.split(" ").slice(1).join(" ").trim()
        const subject = args ? detectSubject(args) : null

        if (!subject || subject === "ทั่วไป") {
            if (args) {
                return ctx.reply(
                    `🤔 ${safeBold(`ไม่รู้จักวิชา "${escapeMarkdown(args)}"`)}\n` +
                    `\n` +
                    `วิชาที่มี: คณิต, ไทย, อังกฤษ, ฟิสิกส์, เคมี, ชีวะ, สังคม, ประวัติ, คอม, สุขศึกษา`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            const keyboard = [
                [
                    Markup.button.callback("🔢 คณิต", "HINT_คณิต"),
                    Markup.button.callback("📖 ไทย", "HINT_ไทย"),
                    Markup.button.callback("🔤 อังกฤษ", "HINT_อังกฤษ"),
                ],
                [
                    Markup.button.callback("⚛️ ฟิสิกส์", "HINT_ฟิสิกส์"),
                    Markup.button.callback("🧪 เคมี", "HINT_เคมี"),
                    Markup.button.callback("🧬 ชีวะ", "HINT_ชีวะ"),
                ],
                [
                    Markup.button.callback("🌏 สังคม", "HINT_สังคม"),
                    Markup.button.callback("🏛️ ประวัติ", "HINT_ประวัติ"),
                    Markup.button.callback("💻 คอม", "HINT_คอม"),
                ],
                [Markup.button.callback("❌ ยกเลิก", "CANCEL")],
            ]
            return ctx.reply(
                `🧠 ${safeBold("เลือกวิชาที่ต้องการคำแนะนำ")}\n` +
                `\n` +
                `หรือพิมพ์ ${safeCode("/hint คณิต")} เพื่อระบุวิชา`,
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
                    `📭 ${safeBold(`ไม่มีงานวิชา ${subject} ค้างอยู่`)}\n` +
                    `\n` +
                    `ลองเลือกวิชาอื่น หรือเพิ่มการบ้านก่อน!`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            return ctx.reply(hint, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("/hint:", err)
            return ctx.reply(
                `❌ ${safeBold("ขออภัย เกิดข้อผิดพลาด")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

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
                        `❌ ${safeBold("ยกเลิกโฟกัสแล้ว")}\n` +
                        `\n` +
                        `${focusTitle ? `เลิกโฟกัส "${escapeMarkdown(focusTitle)}"` : "เลิกโฟกัสแล้ว"}`,
                        { parse_mode: "Markdown", ...mainMenu },
                    )
                }
                return ctx.reply(
                    `❌ ${safeBold("ไม่มีงานที่กำลังโฟกัส")}\nพิมพ์ /focus เพื่อเลือกงาน`,
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
                    const diff = dt ? Math.ceil((dt - today) / 86400000) : null

                    let badge = ""
                    if (diff !== null && diff < 0) badge = ` 🚨 เลย ${Math.abs(diff)} วัน`
                    else if (diff !== null && diff <= 3) badge = ` 🔥 เหลือ ${diff} วัน`
                    else if (diff !== null && diff <= 7) badge = ` ⏰ เหลือ ${diff} วัน`

                    let msg = `🎯 ${safeBold("กำลังโฟกัส:")}\n`
                    msg += `\n\n`
                    msg += `${statusEmoji(status)} ${safeBold(title)}${badge}\n`
                    msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  ${formatDueDisplay(due)}\n\n`
                    msg += `\n`
                    msg += `💡 พิมพ์ /focus exit เพื่อออกจากโฟกัส`

                    const keyboard = [
                        [
                            Markup.button.callback("✅ เสร็จ", "FOCUS_STATUS_DONE"),
                            Markup.button.callback("🔄 กำลังทำ", "FOCUS_STATUS_PROGRESS"),
                        ],
                        [
                            Markup.button.callback("❌ เลิกโฟกัส", "FOCUS_EXIT"),
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
                    `🎉 ${safeBold("ไม่มีการบ้านค้าง!")}\nโฟกัสอะไรดีล่ะ? พักผ่อนก่อน 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const sorted = sortByUrgency(pages)
            let msg = `🎯 ${safeBold("เลือกงานที่ต้องการโฟกัส")}\n`
            msg += `\n\n`
            for (let i = 0; i < Math.min(sorted.length, 10); i++) {
                const p = sorted[i]
                const { title, subject, priority, due } = getPageProps(p)
                msg += `${i + 1}. ${safeBold(title)}\n`
                msg += `   ${subjectEmoji(subject)} ${priority} — ${formatDueDisplay(due)}\n\n`
            }
            if (sorted.length > 10) {
                msg += `… และอีก ${sorted.length - 10} รายการ`
            }

            const keyboard = []
            for (let i = 0; i < Math.min(sorted.length, 10); i++) {
                keyboard.push([
                    Markup.button.callback(`${i + 1}. ${getPageProps(sorted[i]).title.slice(0, 30)}`, `FOCUS_SEL_${sorted[i].id}`),
                ])
            }
            keyboard.push([
                Markup.button.callback("📋 ดูทั้งหมด", "LIST_ACTIVE"),
                Markup.button.callback("🏠 เมนูหลัก", "HOME"),
            ])

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/focus:", err)
            return ctx.reply(
                `❌ ${safeBold("โหลดข้อมูลไม่ได้")}\nกรุณาลองใหม่`,
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
                Markup.button.callback("📊 Dashboard", "DASHBOARD"),
            ],
            [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
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
            logger.error("/review:", err)
            return ctx.reply(
                `❌ ${safeBold("โหลดข้อมูลไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* ── /collab — แชร์การบ้านกับเพื่อน ── */
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
                    `❌ ${safeBold("token ไม่ถูกต้องหรือหมดอายุ")}\n` +
                    `\n` +
                    `ให้เพื่อนส่ง token ใหม่ให้คุณ`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
            if (Date.now() - shareData._timestamp > COLLAB_TOKEN_TTL) {
                shareTokens.delete(token)
                return ctx.reply(
                    `⏱️ ${safeBold("token หมดอายุแล้ว")}\n` +
                    `\n` +
                    `ขอให้เจ้าของงานส่ง token ใหม่ให้คุณ`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            try {
                await createHomework({
                    title: shareData.title,
                    subject: shareData.subject,
                    due: shareData.due,
                    priority: shareData.priority,
                    note: shareData.note || "",
                    tags: shareData.tags,
                })
                shareTokens.delete(token)
                return ctx.reply(
                    `✅ ${safeBold("รับงานแชร์สำเร็จ!")}\n` +
                    `\n` +
                    `"${escapeMarkdown(shareData.title)}" ถูกเพิ่มเข้าในระบบแล้ว\n` +
                    `ไปดูที่ /list หรือ /menu`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            } catch (err) {
                logger.error("COLLAB accept:", err)
                return ctx.reply(
                    `❌ ${safeBold("บันทึกไม่ได้")}\nกรุณาลองใหม่`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
        }

        // /collab — show active list to pick
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `📭 ${safeBold("ไม่มีการบ้านที่จะแชร์")}\n` +
                    `━เพิ่มการบ้านก่อน แล้วค่อยแชร์กับเพื่อน!`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const sorted = sortByUrgency(pages)
            let msg = `👥 ${safeBold("เลือกงานที่จะแชร์")}\n`
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
                Markup.button.callback("📋 ดูทั้งหมด", "LIST_ACTIVE"),
                Markup.button.callback("🏠 เมนูหลัก", "HOME"),
            ])

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/collab:", err)
            return ctx.reply(
                `❌ ${safeBold("โหลดข้อมูลไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* ── /smartbook — AI จัดตารางอ่านหนังสือ ── */
    bot.command("smartbook", async (ctx) => {
        const uid = ctx.from.id
        const state = userState.get(uid) || {}
        const text = ctx.message.text.trim()
        const parts = text.split(/\s+/)

        // /smartbook view — show saved plan
        if (parts[1] === "view" && state._smartbookPlan) {
            const plan = state._smartbookPlan
            let msg = `📚 ${safeBold("แผนอ่านหนังสือ (ที่บันทึกไว้)")}\n`
            msg += `\n\n`
            for (const day of plan.plan || []) {
                msg += `${safeBold(day.day)} (${day.date || ""})\n`
                msg += `🎯 โฟกัส: ${day.focus}\n`
                msg += `⏱️ ${day.duration_min || 0} นาที\n`
                for (const t of day.tasks || []) {
                    msg += `  • ${t}\n`
                }
                msg += `\n`
            }
            if (plan.summary) {
                msg += `\n💡 ${plan.summary}`
            }
            const keyboard = [
                [
                    Markup.button.callback("🔄 รีเฟรช", "SMARTBOOK_REFRESH"),
                    Markup.button.callback("📅 iCal", "SMARTBOOK_ICAL"),
                ],
                [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
            ]
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        }

        // /smartbook — generate new plan via AI
        try {
            await ctx.reply("⏳ *กำลังวิเคราห์การบ้านและสร้างตารางอ่านหนังสือ...*", { parse_mode: "Markdown" })

            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มีการบ้านค้าง!")}\nพักผ่อนได้เลย 🏆`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }

            const contextLines = pages.map((p, i) => {
                const { title, subject, due, priority } = getPageProps(p)
                return `${i + 1}. [${subject}] ${title} — ส่ง ${due || "ไม่มีกำหนด"} (${priority})`
            }).join("\n")

            const prompt = `สร้างตารางอ่านหนังสือ 7 วันจากนี้ ตามการบ้านที่มี deadline เรียงตาม priority\n\nการบ้าน:\n${contextLines}\n\nตอบเป็น JSON:\n{ "plan": [{ "day": "วันXX", "date": "YYYY-MM-DD", "focus": "วิชา", "tasks": ["task1", "task2"], "duration_min": 120 }], "summary": "..." }`

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
                    const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
                    bySubject[sub] = (bySubject[sub] || 0) + 1
                }
                const today = new Date()
                planData = {
                    plan: Object.entries(bySubject).slice(0, 7).map(([sub, count], i) => {
                        const d = new Date(today)
                        d.setDate(d.getDate() + i)
                        const dayNames = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]
                        return {
                            day: "วัน" + dayNames[d.getDay()],
                            date: d.toISOString().slice(0, 10),
                            focus: sub,
                            tasks: [`ทบทวน${sub}`, `ทำการบ้าน${sub}ให้เสร็จ (${count} รายการ)`],
                            duration_min: 90,
                        }
                    }),
                    summary: `โฟกัส ${Object.keys(bySubject).length} วิชา — ลองปรับตามความเหมาะสม`,
                }
            }

            let msg = `📚 ${safeBold("แผนอ่านหนังสือ 7 วัน")}\n`
            msg += `\n\n`
            for (const day of planData.plan) {
                msg += `${safeBold(day.day)} (${day.date || ""})\n`
                msg += `🎯 โฟกัส: ${day.focus}\n`
                msg += `⏱️ ${day.duration_min || 0} นาที\n`
                for (const t of day.tasks || []) {
                    msg += `  • ${t}\n`
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
                    Markup.button.callback("💾 บันทึก", "SMARTBOOK_SAVE"),
                    Markup.button.callback("🔄 รีเฟรช", "SMARTBOOK_REFRESH"),
                ],
                [
                    Markup.button.callback("📅 iCal", "SMARTBOOK_ICAL"),
                    Markup.button.callback("🏠 เมนูหลัก", "HOME"),
                ],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/smartbook:", err)
            return ctx.reply(
                `❌ ${safeBold("สร้างแผนไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* ── /pomodoro — ตัวจับเวลา Pomodoro ── */
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
            let msg = `🍅 ${safeBold("Pomodoro กำลังทำงาน!")}\n`
            msg += `\n`
            msg += `⏱️ เหลือ ${mins}:${String(secs).padStart(2, "0")} นาที\n`
            if (title) msg += `📌 งาน: ${escapeMarkdown(title)}\n`
            msg += `\n💪 สู้ๆ ไฟighting!`

            const keyboard = [
                [Markup.button.callback("❌ ยกเลิก", "POMODORO_CANCEL")],
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
            let msg = `☕ ${safeBold("พักเบรก!")}\n`
            msg += `\n`
            msg += `⏱️ เหลือ ${mins}:${String(secs).padStart(2, "0")} นาที\n`
            msg += `พักผ่อนสักครู่ แล้วกลับมาลุยต่อ!`

            const keyboard = [
                [Markup.button.callback("⏭️ เริ่มรอบใหม่", "POMODORO_START")],
                [Markup.button.callback("❌ ยกเลิก", "POMODORO_CANCEL")],
            ]
            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        }

        // No active session — show main menu
        const stats = pomoGetStats(uid)
        let msg = `🍅 ${safeBold("Pomodoro Timer")}\n`
        msg += `\n`
        msg += `⏱️ 25 นาทีทำงาน + 5 นาทีพัก\n\n`
        msg += `📊 ${safeBold("สถิติวันนี้")}\n`
        msg += `  🍅 เซสชันวันนี้: ${stats.today}\n`
        msg += `  📅 เซสชันสัปดาห์: ${stats.week}\n`
        msg += `  🏆 รวมทั้งหมด: ${stats.count} เซสชัน (${stats.totalHours} ชม.)\n`

        const keyboard = [
            [Markup.button.callback("🍅 เริ่ม 25 นาที", "POMODORO_START")],
            [
                Markup.button.callback("📊 สถิติวันนี้", "POMODORO_STATS"),
                Markup.button.callback("🏠 เมนูหลัก", "HOME"),
            ],
        ]

        return ctx.reply(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(keyboard),
        })
    })

    /* ── /suggest — AI แนะนำว่าควรทำการบ้านไหน ── */
    bot.command("suggest", async (ctx) => {
        try {
            await ctx.reply("⏳ *กำลังวิเคราะห์และวางแผน...*", { parse_mode: "Markdown" })

            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(
                    `🎉 ${safeBold("ไม่มีการบ้านที่ค้างอยู่!")}\nไปพักผ่อนได้เลย 🏆`,
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
                const daysLeft = dt ? Math.ceil((dt - today) / 86400000) : null
                const urgencyLabel = isOverdue
                    ? `เลย ${Math.abs(daysLeft)} วัน`
                    : daysLeft !== null
                        ? `อีก ${daysLeft} วัน`
                        : "ไม่มีกำหนด"
                return `${i + 1}. [${subject}] ${title} — due: ${due || "N/A"} (${urgencyLabel}) — priority: ${priority}`
            }).join("\n")

            const subjectBreakdown = Object.entries(bySubject)
                .map(([s, c]) => `- ${s}: ${c} ชิ้น`)
                .join("\n")

            const thaiDate = today.toLocaleDateString("th-TH", {
                weekday: "long", year: "numeric", month: "long", day: "numeric",
            })

            const prompt = `คุณคือโค้ชการบ้าน ให้คำแนะนำว่านักเรียนควรทำอะไรก่อน
วันนี้: ${thaiDate}
การบ้านที่ค้าง (เรียงตาม deadline):
${contextLines}

จำนวนแยกวิชา:
${subjectBreakdown}

Overdue: ${overdueCount} ชิ้น

ตอบสั้นๆ ภาษาไทย ไม่เกิน 150 ตัวอักษร ให้เหตุผลสั้นๆ 1-2 บรรทัด
ลงท้ายด้วย emoji ตามความรู้สึก: 😊 (ดี) 😐 (ปานกลาง) 😅 (ต้องปรับ)`

            let suggestion = null
            try {
                const { askAI } = await import("../services/qaService.js")
                suggestion = await askAI(prompt)
            } catch {
                logger.debug("AI suggest failed, using rule-based fallback")
            }

            if (!suggestion) {
                // Rule-based fallback
                const overdueItems = sorted.filter(p => {
                    const due = p.properties.Due?.date?.start
                    return due && new Date(due + "T00:00:00") < today
                })
                const urgentItems = sorted.filter(p => {
                    const due = p.properties.Due?.date?.start
                    if (!due) return false
                    const dt = new Date(due + "T00:00:00")
                    const diff = Math.ceil((dt - today) / 86400000)
                    return diff >= 0 && diff <= 3
                })
                const laterItems = sorted.filter(p => {
                    const due = p.properties.Due?.date?.start
                    if (!due) return false
                    const dt = new Date(due + "T00:00:00")
                    const diff = Math.ceil((dt - today) / 86400000)
                    return diff > 3
                })

                suggestion = ""
                if (overdueItems.length) {
                    suggestion += `🔥 ด่วน! เกินกำหนด ${overdueItems.length} ชิ้น!\n`
                    for (const p of overdueItems.slice(0, 3)) {
                        const { title, subject } = getPageProps(p)
                        suggestion += `  • ${title} (${subject})\n`
                    }
                }
                if (urgentItems.length) {
                    suggestion += `⚠️ ใกล้ deadline ${urgentItems.length} ชิ้น:\n`
                    for (const p of urgentItems.slice(0, 3)) {
                        const { title, subject } = getPageProps(p)
                        suggestion += `  • ${title} (${subject})\n`
                    }
                }
                if (laterItems.length) {
                    suggestion += `✅ มีเวลาเหลือ ${laterItems.length} ชิ้น\n`
                }
                if (!suggestion) suggestion = "🎉 ลองเพิ่มการบ้านแล้วกลับมาใหม่นะ!"
            }

            let msg = `💡 ${safeBold("คำแนะนำวันนี้")}\n`
            msg += `\n\n`
            msg += `${suggestion}\n`
            msg += `\n`
            msg += `\n📊 งานที่ค้าง: ${sorted.length} ชิ้น`
            if (overdueCount > 0) msg += ` (🚨 ${overdueCount} เลยกำหนด)`

            const keyboard = [
                [Markup.button.callback("🔄 แนะนำใหม่", "SUGGEST_REFRESH")],
                [
                    Markup.button.callback("🎯 โฟกัส", "FOCUS"),
                    Markup.button.callback("📋 ดูทั้งหมด", "LIST_ACTIVE"),
                ],
                [Markup.button.callback("🏠 เมนูหลัก", "HOME")],
            ]

            return ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(keyboard),
            })
        } catch (err) {
            logger.error("/suggest:", err)
            return ctx.reply(
                `❌ ${safeBold("วิเคราะห์ไม่ได้")}\nกรุณาลองใหม่`,
                { parse_mode: "Markdown", ...mainMenu },
            )
        }
    })

    /* RETRY handlers — re-trigger the failed action */
    bot.action("RETRY_FETCH_ACTIVE", async (ctx) => {
        await ctx.answerCbQuery("🔁 ลองใหม่…").catch(() => {})
        try {
            const pages = await fetchActive()
            if (!pages.length) {
                return ctx.reply(`🎉 ${safeBold("ไม่มีการบ้านค้าง")}`, { parse_mode: "Markdown", ...mainMenu })
            }
            return ctx.reply(`📋 ${safeBold("โหลดสำเร็จ")} (${pages.length} รายการ)`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_FETCH_ACTIVE:", err)
            return ctx.reply(`❌ ${safeBold("ยังโหลดไม่ได้")}`, { parse_mode: "Markdown", ...mainMenu })
        }
    })

    bot.action("RETRY_FETCH_DONE", async (ctx) => {
        await ctx.answerCbQuery("🔁 ลองใหม่…").catch(() => {})
        try {
            const pages = await fetchDone()
            return ctx.reply(`✅ ${safeBold("โหลดสำเร็จ")} (${pages.length} รายการ)`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_FETCH_DONE:", err)
            return ctx.reply(`❌ ${safeBold("ยังโหลดไม่ได้")}`, { parse_mode: "Markdown", ...mainMenu })
        }
    })

    bot.action("RETRY_FETCH_DASHBOARD", async (ctx) => {
        await ctx.answerCbQuery("🔁 ลองใหม่…").catch(() => {})
        try {
            const stats = await getHomeworkStats()
            return ctx.reply(`📊 ${safeBold("โหลดสำเร็จ")}\n\n📌 ${stats.todo}  🔄 ${stats.prog}  ✅ ${stats.done}  🚨 ${stats.overdue}`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_FETCH_DASHBOARD:", err)
            return ctx.reply(`❌ ${safeBold("ยังโหลดไม่ได้")}`, { parse_mode: "Markdown", ...mainMenu })
        }
    })

    /* RETRY_STATUS_<id>_<action> — re-attempt status update with strict id validation */
    bot.action(/^RETRY_STATUS_([A-Za-z0-9_-]{1,40})_(\w+)$/, async (ctx) => {
        const [, pageId, action] = ctx.match
        const map = { done: STATUS.DONE, prog: STATUS.IN_PROGRESS, todo: STATUS.TODO }
        const newStatus = map[action]
        if (!newStatus) {
            return ctx.answerCbQuery("❌ ไม่รู้จัก action").catch(() => {})
        }
        await ctx.answerCbQuery("🔁 ลองใหม่…").catch(() => {})
        try {
            const oldStatus = await getPageStatus(pageId)
            await updateStatus(pageId, newStatus)
            const uid = ctx.from.id
            const state = userState.get(uid) || {}
            state._lastAction = { type: "STATUS_CHANGE", pageId, from: oldStatus, to: newStatus, _timestamp: Date.now() }
            userState.set(uid, state)
            return ctx.reply(`✅ ${safeBold("อัปเดตสำเร็จ")} — ${newStatus}`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_STATUS:", err)
            return ctx.reply(`❌ ${safeBold("ยังอัปเดตไม่ได้")}`, { parse_mode: "Markdown", ...mainMenu })
        }
    })

    /* RETRY_ARCHIVE_<id> — re-attempt archive with strict id validation */
    bot.action(/^RETRY_ARCHIVE_([A-Za-z0-9_-]{1,40})$/, async (ctx) => {
        const [, pageId] = ctx.match
        await ctx.answerCbQuery("🔁 ลองใหม่…").catch(() => {})
        try {
            const { archivePage } = await import("../services/notionService.js")
            await archivePage(pageId)
            return ctx.reply(`🗑️ ${safeBold("ลบสำเร็จ")}`, { parse_mode: "Markdown", ...mainMenu })
        } catch (err) {
            logger.error("RETRY_ARCHIVE:", err)
            return ctx.reply(`❌ ${safeBold("ยังลบไม่ได้")}`, { parse_mode: "Markdown", ...mainMenu })
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

        // Block non-command text while in focus mode
        if (state?._focusActive && !text.startsWith("/")) {
            const ft = state._focusTitle || ""
            return ctx.reply(
                `🎯 ${safeBold("คุณกำลังโฟกัสงาน")} "${escapeMarkdown(ft)}" อยู่\n` +
                `\n` +
                `พิมพ์ /focus เพื่อดู หรือ /focus exit เพื่อออกจากโฟกัส`,
                { parse_mode: "Markdown" },
            );
        }

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

        if (state?.mode === "SEARCH") {
            const keyword = text.trim()
            if (!keyword) {
                userState.set(uid, { mode: "SEARCH", _timestamp: Date.now() })
                return ctx.reply(
                    `🔍 ${safeBold("พิมพ์คำค้นหา")}\n` +
                    `\n` +
                    `เช่น ${safeCode("คณิต")} หรือ ${safeCode("แคลคูลัส")}`,
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
                        `🔍 ${safeBold(`ไม่พบ "${escapeMarkdown(keyword)}"`)} ในระบบ\n` +
                        `\n` +
                        `ลองค้นหาด้วยคำอื่น`,
                        { parse_mode: "Markdown", ...mainMenu },
                    )
                }

                const total = matchedActive.length + matchedDone.length
                let msg = `🔍 ${safeBold(`ผลค้นหา: "${escapeMarkdown(keyword)}"`)} (${total} รายการ)\n`
                msg += `\n\n`

                const keyboard = []

                if (matchedActive.length) {
                    msg += `📌 ${safeBold("ยังไม่เสร็จ")} (${matchedActive.length}):\n`
                    for (const p of matchedActive) {
                        const { title, due, subject, priority } = getPageProps(p)
                        msg += `${safeBold(title)} ${subjectEmoji(subject)} ${priority} — ${formatDueDisplay(due)}\n`
                        keyboard.push([
                            Markup.button.callback("✅ เสร็จ", `done_${p.id}`),
                            Markup.button.callback("🔄 กำลังทำ", `prog_${p.id}`),
                        ])
                    }
                    msg += `\n`
                }

                if (matchedDone.length) {
                    msg += `✅ ${safeBold("เสร็จแล้ว")} (${matchedDone.length}):\n`
                    for (const p of matchedDone) {
                        const props = getPageProps(p)
                        msg += `${safeBold(props.title)} ${subjectEmoji(props.subject)} ${props.priority} — ✅\n`
                    }
                    msg += `\n`
                }

                keyboard.push([
                    Markup.button.callback("🔍 ค้นหาอีก", "SEARCH"),
                    Markup.button.callback("➕ เพิ่ม", "ADD"),
                    Markup.button.callback("📊 Dashboard", "DASHBOARD"),
                    Markup.button.callback("🏠 เมนูหลัก", "HOME"),
                ])

                return ctx.reply(msg, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(keyboard),
                })
            } catch (err) {
                logger.error("SEARCH mode:", err)
                userState.delete(uid)
                return ctx.reply(
                    `❌ ${safeBold("ค้นหาไม่ได้")}\nกรุณาลองใหม่`,
                    { parse_mode: "Markdown", ...mainMenu },
                )
            }
        }

        if (state?.mode === "ASK_AI") {
            await ctx.reply("⏳ *กำลังค้นหาคำตอบ...*", { parse_mode: "Markdown" });
            const answer = await askAI(text);
            userState.delete(uid);
            return ctx.reply(
                answer
                    ? `🤖 ${safeBold("คำตอบ")}\n\n${answer}`
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
            `\n` +
            `${buildHomeworkPreview(parsed)}\n` +
            `\n` +
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
