import { Markup } from "telegraf"
import { formatDate, formatDueDisplay, parseYMDToLocalDate } from "../utils/dateParser.js"
import { subjectEmoji, canonSubj } from "../utils/subjectDetector.js"
import { escapeMarkdown, safeBold } from "../utils/telegramFormat.js"
import { PRIORITY, priorityWeight } from "../utils/constants.js"
import { t } from "../utils/i18n.js"

function statusEmoji(status) {
    return status === "Done" ? "✅" : status === "In Progress" ? "🔄" : "📌"
}

function badgeForDiff(diff) {
    if (diff === null) return ""
    if (diff < 0) return ` 🚨 (${t("vb.overdueSuffix", { days: Math.abs(diff) })})`
    if (diff === 0) return ` (🔥 ${t("vb.today")}!)`
    if (diff === 1) return ` (⏰ ${t("vb.tomorrow")})`
    return ` (${t("vb.daysLeftSuffix", { days: diff })})`
}

function todayMidnight() {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return t
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/* ── /panic ── */
export function buildPanic(sorted, topN = 3) {
    const top = sorted.slice(0, topN)
    const today = todayMidnight()

    let msg = `🚨 ${safeBold(t("vb.panic.title"))}\n\n`
    msg += `${t("vb.panic.topN", { count: top.length })}\n\n`
    for (const p of top) {
        const title = p.properties.Name?.title?.[0]?.plain_text || t("bot.fallbackTitle")
        const status = p.properties.Status?.select?.name || "Todo"
        const due = p.properties.Due?.date?.start || null
        const subject = p.properties.Subject?.rich_text?.[0]?.plain_text || t("fallback.subject")
        const priority = p.properties.Priority?.select?.name || PRIORITY.MEDIUM
        const dt = due ? parseYMDToLocalDate(due) : null
        const diff = dt ? Math.ceil((dt.getTime() - today.getTime()) / 86400000) : null

        msg += `${statusEmoji(status)} ${safeBold(title)}${badgeForDiff(diff)}\n`
        msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  ${formatDueDisplay(due)}\n\n`
    }

    const keyboard = top.map((p) => [
        Markup.button.callback(t("cmd.btn.done"), `done_${p.id}`),
        Markup.button.callback(t("cmd.btn.inProgress"), `prog_${p.id}`),
        Markup.button.callback(t("cmd.btn.delete"), `del_${p.id}`),
    ])
    keyboard.push([
        Markup.button.callback(t("cmd.btn.add"), "ADD"),
        Markup.button.callback(t("cmd.btn.active"), "LIST_ACTIVE"),
        Markup.button.callback(t("cmd.btn.home"), "HOME"),
    ])

    return { msg, keyboard }
}

/* ── /tomorrow ── (takes pre-filtered dueTomorrow list) */
export function buildTomorrow(dueTomorrow) {
    const today = todayMidnight()

    let msg = `📅 ${safeBold(t("vb.tomorrow.title"))} (${dueTomorrow.length})\n\n`
    for (const p of dueTomorrow) {
        const title = p.properties.Name?.title?.[0]?.plain_text || t("bot.fallbackTitle")
        const status = p.properties.Status?.select?.name || "Todo"
        const due = p.properties.Due?.date?.start || null
        const subject = p.properties.Subject?.rich_text?.[0]?.plain_text || t("fallback.subject")
        const priority = p.properties.Priority?.select?.name || PRIORITY.MEDIUM
        const dt = due ? parseYMDToLocalDate(due) : null
        const diff = dt ? Math.ceil((dt.getTime() - today.getTime()) / 86400000) : null
        msg += `${statusEmoji(status)} ${safeBold(title)}${badgeForDiff(diff)}\n`
        msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}\n\n`
    }

    const keyboard = dueTomorrow.map((p) => [
        Markup.button.callback(t("cmd.btn.done"), `done_${p.id}`),
        Markup.button.callback(t("cmd.btn.inProgress"), `prog_${p.id}`),
        Markup.button.callback(t("cmd.btn.delete"), `del_${p.id}`),
    ])
    keyboard.push([
        Markup.button.callback(t("cmd.btn.add"), "ADD"),
        Markup.button.callback(t("cmd.btn.panic"), "PANIC"),
        Markup.button.callback(t("cmd.btn.home"), "HOME"),
    ])

    return { msg, keyboard }
}

/* ── /week ── */
export function buildWeek(pages) {
    const today = todayMidnight()
    const dayOfWeek = today.getDay()
    const mon = new Date(today)
    mon.setDate(today.getDate() - ((dayOfWeek + 6) % 7))

    const days = []
    let totalCount = 0
    for (let i = 0; i < 7; i++) {
        const d = new Date(mon)
        d.setDate(mon.getDate() + i)
        const dateStr = formatDate(d)
        const items = pages.filter((p) => p.properties.Due?.date?.start === dateStr)
        const isToday = dateStr === formatDate(today)
        days.push({ date: d, dateStr, items, isToday })
        totalCount += items.length
    }

    const noDueItems = pages.filter((p) => !p.properties.Due?.date?.start)

    let msg = `📅 ${safeBold(t("vb.week.title"))}\n\n`
    for (const day of days) {
        const dayName = t(`days.full.${DAY_KEYS[day.date.getDay()]}`)
        const dateLabel = `${day.date.getDate()} ${t(`months.${MONTH_KEYS[day.date.getMonth()]}`)}`
        const prefix = day.isToday ? "▸ " : "  "
        const countLabel = day.items.length ? `(${day.items.length})` : ""
        msg += `${prefix}${safeBold(dayName)} ${dateLabel}  ${countLabel}\n`
        for (const p of day.items) {
            const title = p.properties.Name?.title?.[0]?.plain_text || t("bot.fallbackTitle")
            const status = p.properties.Status?.select?.name || "Todo"
            const due = p.properties.Due?.date?.start || null
            const subject = p.properties.Subject?.rich_text?.[0]?.plain_text || t("fallback.subject")
            const priority = p.properties.Priority?.select?.name || PRIORITY.MEDIUM
            const dt = due ? parseYMDToLocalDate(due) : null
            const diff = dt ? Math.ceil((dt.getTime() - today.getTime()) / 86400000) : null
            const dayLabel = diff !== null
                ? (diff < 0 ? t("vb.overdueBy", { days: Math.abs(diff) }) : (diff === 0 ? `${t("vb.today")}!` : t("vb.daysLeft", { days: diff })))
                : ""
            msg += `  ${statusEmoji(status)} ${escapeMarkdown(title)}  ${subjectEmoji(subject)}${priority}`
            if (dayLabel) msg += `  ${dayLabel}`
            msg += `\n`
        }
        if (day.isToday) msg += `\n`
    }

    if (noDueItems.length) {
        msg += `📌 ${t("vb.noDue", { count: noDueItems.length })}\n`
        for (const p of noDueItems) {
            const title = p.properties.Name?.title?.[0]?.plain_text || t("bot.fallbackTitle")
            const status = p.properties.Status?.select?.name || "Todo"
            const subject = p.properties.Subject?.rich_text?.[0]?.plain_text || t("fallback.subject")
            const priority = p.properties.Priority?.select?.name || PRIORITY.MEDIUM
            msg += `  ${statusEmoji(status)} ${escapeMarkdown(title)}  ${subjectEmoji(subject)}${priority}\n`
        }
    }

    msg += `\n📊 ${t("vb.totalCount", { count: totalCount })}`
    if (noDueItems.length) msg += ` (+${noDueItems.length} ${t("vb.noDueShort")})`

    const keyboard = [
        [
            Markup.button.callback(t("cmd.btn.add"), "ADD"),
            Markup.button.callback(t("cmd.btn.panic"), "PANIC"),
        ],
        [
            Markup.button.callback(t("vb.dashboardBtn"), "DASHBOARD"),
            Markup.button.callback(t("cmd.btn.home"), "HOME"),
        ],
    ]
    return { msg, keyboard, totalCount, hasAny: pages.length > 0 }
}

/* ── /deadline ── */
export function buildDeadline(pages) {
    const now = new Date()
    const today = todayMidnight()
    let closest = null
    let closestDiff = Infinity
    for (const p of pages) {
        const due = p.properties.Due?.date?.start
        if (!due) continue
        const dt = parseYMDToLocalDate(due)
        const diff = Math.ceil((dt.getTime() - today.getTime()) / 86400000)
        if (Math.abs(diff) < Math.abs(closestDiff)) {
            closest = p
            closestDiff = diff
        }
    }
    if (!closest) return null

    const title = closest.properties.Name?.title?.[0]?.plain_text || t("bot.fallbackTitle")
    const subject = closest.properties.Subject?.rich_text?.[0]?.plain_text || t("fallback.subject")
    const priority = closest.properties.Priority?.select?.name || PRIORITY.MEDIUM
    const due = closest.properties.Due?.date?.start
    const dt = parseYMDToLocalDate(due)
    const diffMs = dt.getTime() - now.getTime()
    const absDiffMs = Math.abs(diffMs)
    const totalDays = Math.floor(absDiffMs / 86400000)
    const totalHours = Math.floor((absDiffMs % 86400000) / 3600000)
    const totalMinutes = Math.floor((absDiffMs % 3600000) / 60000)

    let badge, urgency
    if (closestDiff < 0) {
        badge = "🚨"
        urgency = t("vb.overdueByShort", { days: Math.abs(closestDiff) })
    } else if (closestDiff <= 3) {
        badge = "🔥"
        urgency = t("vb.daysLeftShort", { days: closestDiff })
    } else if (closestDiff <= 7) {
        badge = "⏰"
        urgency = t("vb.daysLeftShort", { days: closestDiff })
    } else {
        badge = "📅"
        urgency = t("vb.daysLeftShort", { days: closestDiff })
    }

    const barSlots = 20
    const totalAvailable = closestDiff > 0 ? closestDiff + 14 : 14
    const elapsed = totalAvailable - (closestDiff > 0 ? closestDiff : 0)
    const filled = Math.max(0, Math.min(barSlots, Math.round((elapsed / totalAvailable) * barSlots)))
    const bar = "█".repeat(filled) + "░".repeat(barSlots - filled)

    let msg = `⏰ ${safeBold(t("vb.deadline.title"))}\n\n`
    msg += `${badge} ${safeBold(title)}\n`
    msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)}  ${priority}  |  ${urgency}\n\n`
    msg += `${bar}\n`
    if (closestDiff < 0) {
        msg += `⏱️ ${t("vb.overdueByLong", { days: totalDays, hours: totalHours })}\n`
    } else {
        msg += `⏱️ ${t("vb.leftLong", { days: totalDays, hours: totalHours, minutes: totalMinutes })}\n`
    }
    msg += `📅 ${formatDueDisplay(due)}`

    const keyboard = [
        [
            Markup.button.callback(t("cmd.btn.done"), `done_${closest.id}`),
            Markup.button.callback(t("cmd.btn.inProgress"), `prog_${closest.id}`),
            Markup.button.callback(t("cmd.btn.delete"), `del_${closest.id}`),
        ],
        [
            Markup.button.callback(t("vb.dashboardBtn"), "DASHBOARD"),
            Markup.button.callback(t("cmd.btn.home"), "HOME"),
        ],
    ]
    return { msg, keyboard, pageId: closest.id }
}

/* ── /progress ── */
export function buildProgress(activePages, donePages) {
    const bySubject: Record<string, { done: number; total: number }> = {}
    for (const p of activePages) {
        const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || t("fallback.subject")
        if (!bySubject[sub]) bySubject[sub] = { done: 0, total: 0 }
        bySubject[sub].total++
    }
    for (const p of donePages) {
        const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || t("fallback.subject")
        if (!bySubject[sub]) bySubject[sub] = { done: 0, total: 0 }
        bySubject[sub].done++
        bySubject[sub].total++
    }
    const entries = Object.entries(bySubject)
    if (!entries.length) return null

    const sorted = entries
        .map(([sub, stats]) => ({
            subject: sub,
            pct: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
            done: stats.done,
            total: stats.total,
        }))
        .sort((a, b) => a.pct - b.pct)

    let msg = `📊 ${safeBold(t("vb.progress.title"))}\n\n`
    let totalDone = 0
    let totalAll = 0
    for (const s of sorted) {
        const filled = Math.max(0, Math.min(10, Math.round(s.pct / 10)))
        const bar = "█".repeat(filled) + "░".repeat(10 - filled)
        const pctStr = s.pct === 100 ? "🎉" : `${s.pct}%`
        msg += `${subjectEmoji(s.subject)} ${escapeMarkdown(s.subject)}  ${bar}  ${pctStr} (${s.done}/${s.total})\n`
        totalDone += s.done
        totalAll += s.total
    }
    const totalPct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0
    msg += `\n📈 ${t("vb.progressTotal", { done: totalDone, all: totalAll, pct: totalPct })}`

    const keyboard = [
        [
            Markup.button.callback(t("cmd.btn.add"), "ADD"),
            Markup.button.callback(t("cmd.btn.panic"), "PANIC"),
        ],
        [
            Markup.button.callback(t("vb.dashboardBtn"), "DASHBOARD"),
            Markup.button.callback(t("cmd.btn.home"), "HOME"),
        ],
    ]
    return { msg, keyboard }
}

/* Re-export helper for callers that need it */
export { statusEmoji, priorityWeight }
