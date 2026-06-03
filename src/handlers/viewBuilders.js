import { Markup } from "telegraf"
import { formatDate, formatDueDisplay, parseYMDToLocalDate, THAI_DAYS, THAI_MONTHS } from "../utils/dateParser.js"
import { subjectEmoji } from "../utils/subjectDetector.js"
import { escapeMarkdown, safeBold } from "../utils/telegramFormat.js"
import { PRIORITY, priorityWeight } from "../utils/constants.js"

function statusEmoji(status) {
    return status === "Done" ? "✅" : status === "In Progress" ? "🔄" : "📌"
}

function badgeForDiff(diff) {
    if (diff === null) return ""
    if (diff < 0) return ` 🚨 (เลย ${Math.abs(diff)} วัน!)`
    if (diff === 0) return ` (🔥 วันนี้!)`
    if (diff === 1) return ` (⏰ พรุ่งนี้)`
    return ` (อีก ${diff} วัน)`
}

function todayMidnight() {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return t
}

/* ── /panic ── */
export function buildPanic(sorted, topN = 3) {
    const top = sorted.slice(0, topN)
    const today = todayMidnight()

    let msg = `🚨 ${safeBold("โหมดฉุกเฉิน!")}\n`
    msg += `━━━━━━━━━━━━━━━━━━\n`
    msg += `${top.length} งานที่ควรทำที่สุดตอนนี้\n`
    msg += `━━━━━━━━━━━━━━━━━━\n\n`
    for (const p of top) {
        const title = p.properties.Name?.title?.[0]?.plain_text || "ไม่มีชื่อ"
        const status = p.properties.Status?.select?.name || "Todo"
        const due = p.properties.Due?.date?.start || null
        const subject = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
        const priority = p.properties.Priority?.select?.name || PRIORITY.MEDIUM
        const dt = due ? parseYMDToLocalDate(due) : null
        const diff = dt ? Math.ceil((dt - today) / 86400000) : null

        let badge = ""
        if (diff !== null && diff < 0) badge = `🚨 (เลย ${Math.abs(diff)} วัน)`
        else if (diff !== null && diff <= 3) badge = `⏰ (เหลือ ${diff} วัน)`
        else if (diff !== null && diff <= 7) badge = `⌛ (เหลือ ${diff} วัน)`

        msg += `${statusEmoji(status)} ${safeBold(title)} ${badge}\n`
        msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}  |  ${formatDueDisplay(due)}\n\n`
    }
    msg += `💪 ${safeBold("เริ่มจากอันแรกเลย!")}`

    const keyboard = top.map((p) => [
        Markup.button.callback("✅ เสร็จ", `done_${p.id}`),
        Markup.button.callback("🔄 กำลังทำ", `prog_${p.id}`),
        Markup.button.callback("🗑️ ลบ", `del_${p.id}`),
    ])
    keyboard.push([
        Markup.button.callback("➕ เพิ่ม", "ADD"),
        Markup.button.callback("📋 ค้าง", "LIST_ACTIVE"),
        Markup.button.callback("🏠 หน้าหลัก", "HOME"),
    ])

    return { msg, keyboard }
}

/* ── /tomorrow ── (takes pre-filtered dueTomorrow list) */
export function buildTomorrow(dueTomorrow) {
    const today = todayMidnight()

    let msg = `📅 ${safeBold("งานที่ต้องส่งพรุ่งนี้")} (${dueTomorrow.length} รายการ)\n`
    msg += `━━━━━━━━━━━━━━━━━━\n\n`
    for (const p of dueTomorrow) {
        const title = p.properties.Name?.title?.[0]?.plain_text || "ไม่มีชื่อ"
        const status = p.properties.Status?.select?.name || "Todo"
        const due = p.properties.Due?.date?.start || null
        const subject = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
        const priority = p.properties.Priority?.select?.name || PRIORITY.MEDIUM
        const dt = due ? parseYMDToLocalDate(due) : null
        const diff = dt ? Math.ceil((dt - today) / 86400000) : null
        msg += `${statusEmoji(status)} ${safeBold(title)}${badgeForDiff(diff)}\n`
        msg += `${subjectEmoji(subject)} ${escapeMarkdown(subject)} • ${priority}\n\n`
    }
    msg += `💪 ${safeBold("เตรียมตัวให้พร้อม!")}`

    const keyboard = dueTomorrow.map((p) => [
        Markup.button.callback("✅ เสร็จ", `done_${p.id}`),
        Markup.button.callback("🔄 กำลังทำ", `prog_${p.id}`),
        Markup.button.callback("🗑️ ลบ", `del_${p.id}`),
    ])
    keyboard.push([
        Markup.button.callback("➕ เพิ่ม", "ADD"),
        Markup.button.callback("🚨 ฉุกเฉิน", "PANIC"),
        Markup.button.callback("📊 Dashboard", "DASHBOARD"),
        Markup.button.callback("🏠 หน้าหลัก", "HOME"),
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

    let msg = `📅 ${safeBold("ตารางประจำสัปดาห์")}\n`
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`
    for (const day of days) {
        const dayName = THAI_DAYS[day.date.getDay()]
        const dateLabel = `${day.date.getDate()} ${THAI_MONTHS[day.date.getMonth()]}`
        const prefix = day.isToday ? ">>> 📌 " : ""
        const countLabel = day.items.length ? `(${day.items.length} งาน)` : "(✅ ว่าง)"
        msg += `${prefix}${dayName} ${dateLabel}  ${countLabel}\n`
        for (const p of day.items) {
            const title = p.properties.Name?.title?.[0]?.plain_text || "ไม่มีชื่อ"
            const status = p.properties.Status?.select?.name || "Todo"
            const due = p.properties.Due?.date?.start || null
            const subject = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
            const priority = p.properties.Priority?.select?.name || PRIORITY.MEDIUM
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
            const title = p.properties.Name?.title?.[0]?.plain_text || "ไม่มีชื่อ"
            const status = p.properties.Status?.select?.name || "Todo"
            const subject = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
            const priority = p.properties.Priority?.select?.name || PRIORITY.MEDIUM
            msg += `  ${statusEmoji(status)} ${safeBold(title)} ${subjectEmoji(subject)} ${priority}\n`
        }
        msg += `━━━━━━━━━━━━━━━━━━━━\n`
    }

    msg += `\n📊 รวม ${totalCount} งานในสัปดาห์นี้`
    if (noDueItems.length) msg += ` (+ ${noDueItems.length} ไม่มีกำหนด)`

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
        const diff = Math.ceil((dt - today) / 86400000)
        if (Math.abs(diff) < Math.abs(closestDiff)) {
            closest = p
            closestDiff = diff
        }
    }
    if (!closest) return null

    const title = closest.properties.Name?.title?.[0]?.plain_text || "ไม่มีชื่อ"
    const subject = closest.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป"
    const priority = closest.properties.Priority?.select?.name || PRIORITY.MEDIUM
    const due = closest.properties.Due?.date?.start
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
    return { msg, keyboard, pageId: closest.id }
}

/* ── /progress ── */
export function buildProgress(activePages, donePages) {
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
    if (!entries.length) return null

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
    let totalDone = 0
    let totalAll = 0
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
    return { msg, keyboard }
}

/* Re-export helper for callers that need it */
export { statusEmoji, priorityWeight }
