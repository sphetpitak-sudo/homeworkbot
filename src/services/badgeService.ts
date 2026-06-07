import { logger } from "../utils/logger.js"
import { safeBold } from "../utils/telegramFormat.js"
import { createJsonStore } from "../utils/jsonStore.js"

const RARITY = {
    COMMON:    { level: 0, label: "Common",   emoji: "🟢" },
    UNCOMMON:  { level: 1, label: "Uncommon", emoji: "🔵" },
    RARE:      { level: 2, label: "Rare",     emoji: "🟣" },
    EPIC:      { level: 3, label: "Epic",     emoji: "🟠" },
    LEGENDARY: { level: 4, label: "Legendary", emoji: "🟡" },
}

const RARITY_ORDER = [
    RARITY.COMMON,
    RARITY.UNCOMMON,
    RARITY.RARE,
    RARITY.EPIC,
    RARITY.LEGENDARY,
]

const BADGES = {
    FIRST_TASK:      { id: "FIRST_TASK",      icon: "🎯", name: "ก้าวแรก",         desc: "ทำการบ้านเสร็จชิ้นแรก",       rarity: RARITY.COMMON },
    TEN_TASKS:       { id: "TEN_TASKS",       icon: "⭐", name: "ขยัน",            desc: "ทำการบ้านเสร็จ 10 ชิ้น",      rarity: RARITY.UNCOMMON },
    FIFTY_TASKS:     { id: "FIFTY_TASKS",     icon: "🌟", name: "ครึ่งร้อย",        desc: "ทำการบ้านเสร็จ 50 ชิ้น",      rarity: RARITY.RARE },
    HUNDRED_TASKS:   { id: "HUNDRED_TASKS",   icon: "💎", name: "ร้อยชิ้น",         desc: "ทำการบ้านเสร็จ 100 ชิ้น",     rarity: RARITY.EPIC },

    ZERO_OVERDUE_30: { id: "ZERO_OVERDUE_30", icon: "⏰", name: "ตรงเวลา",         desc: "ไม่มี overdue 30 วัน",         rarity: RARITY.RARE },
    HINT_10:         { id: "HINT_10",         icon: "🔍", name: "นักสืบ",          desc: "ใช้ /hint 10 ครั้ง",          rarity: RARITY.UNCOMMON },
    PANIC_5:         { id: "PANIC_5",         icon: "🚨", name: "วิกฤตการณ์",      desc: "ใช้ /panic 5 ครั้ง",          rarity: RARITY.COMMON },
    EXPORT_3:        { id: "EXPORT_3",        icon: "📋", name: "นักรายงาน",       desc: "export 3 ครั้ง",              rarity: RARITY.COMMON },
    POMO_10:         { id: "POMO_10",         icon: "🍅", name: "นักจัดเวลา",       desc: "ทำ Pomodoro ครบ 10 เซสชัน",  rarity: RARITY.UNCOMMON },
    POMO_50:         { id: "POMO_50",         icon: "🍅", name: "เจ้าแห่งสมาธิ",    desc: "ทำ Pomodoro ครบ 50 เซสชัน",  rarity: RARITY.RARE },
    POMO_100:        { id: "POMO_100",        icon: "🍅", name: "เซนปรมาจารย์",    desc: "ทำ Pomodoro ครบ 100 เซสชัน", rarity: RARITY.LEGENDARY },
    POMO_500:        { id: "POMO_500",        icon: "💎", name: "ไทม์ลอร์ด",       desc: "ทำ Pomodoro ครบ 500 เซสชัน", rarity: RARITY.LEGENDARY },
}

const TASK_MILESTONES = [
    { threshold: 1,   badge: "FIRST_TASK" },
    { threshold: 10,  badge: "TEN_TASKS" },
    { threshold: 50,  badge: "FIFTY_TASKS" },
    { threshold: 100, badge: "HUNDRED_TASKS" },
]

const BADGES_FILE = ".badges.json"
const badgeStore = createJsonStore(BADGES_FILE, {})

function getEarned(userId) {
    const key = String(userId)
    return badgeStore.data[key] || []
}

function setEarned(userId, badges) {
    const key = String(userId)
    badgeStore.data[key] = badges
    badgeStore.scheduleWrite()
}

export function checkTaskBadges(userId, totalDone) {
    const earned = getEarned(userId)
    const newBadges = []

    for (const { threshold, badge } of TASK_MILESTONES) {
        if (totalDone >= threshold && !earned.includes(badge)) {
            newBadges.push(badge)
        }
    }

    return newBadges
}

export function checkUsageBadge(userId, badgeId) {
    const earned = getEarned(userId)
    if (!earned.includes(badgeId)) {
        return [badgeId]
    }
    return []
}

export function checkZeroOverdue(userId, overdueCount) {
    const earned = getEarned(userId)
    if (overdueCount === 0 && !earned.includes("ZERO_OVERDUE_30")) {
        return ["ZERO_OVERDUE_30"]
    }
    return []
}

function getUsage(userId) {
    const key = "usage_" + userId
    return badgeStore.data[key] || { hint: 0, panic: 0, export: 0 }
}

function saveUsage(userId, usage) {
    const key = "usage_" + userId
    badgeStore.data[key] = usage
    badgeStore.scheduleWrite()
}

export function checkUsageBadgeOnAction(userId, action, badgeId, threshold) {
    const usage = getUsage(userId)
    usage[action] = (usage[action] || 0) + 1
    saveUsage(userId, usage)
    if (usage[action] >= threshold) {
        return checkUsageBadge(userId, badgeId)
    }
    return []
}

export function awardBadges(userId, badgeIds) {
    if (!badgeIds.length) return []
    const earned = getEarned(userId)
    const newlyEarned = badgeIds.filter(id => !earned.includes(id))
    if (!newlyEarned.length) return []
    setEarned(userId, [...earned, ...newlyEarned])
    logger.info(`Badges awarded to ${userId}: ${newlyEarned.join(", ")}`)
    return newlyEarned.map(id => BADGES[id]).filter(Boolean)
}

export function getAllBadges(userId) {
    const earned = getEarned(userId)
    const all = Object.values(BADGES)
    const earnedBadges = all.filter(b => earned.includes(b.id))
    const lockedBadges = all.filter(b => !earned.includes(b.id))

    const sortedByRarity = [...earnedBadges.sort((a, b) => {
        const rDiff = b.rarity.level - a.rarity.level
        if (rDiff !== 0) return rDiff
        return a.name.localeCompare(b.name, "th")
    }), ...lockedBadges.sort((a, b) => {
        const rDiff = b.rarity.level - a.rarity.level
        if (rDiff !== 0) return rDiff
        return a.name.localeCompare(b.name, "th")
    })]

    return sortedByRarity.map(b => ({
        ...b,
        earned: earned.includes(b.id),
        rarityLabel: b.rarity.label,
        rarityEmoji: b.rarity.emoji,
    }))
}

export function buildBadgeMessage(userId) {
    const allBadges = getAllBadges(userId)
    const earned = allBadges.filter(b => b.earned)
    const locked = allBadges.filter(b => !b.earned)

    let msg = `🏅 ${safeBold("เหรียญตราความสำเร็จ")}\n`
    msg += `━━━━━━━━━━━━━━━━━━\n\n`

    if (!earned.length) {
        msg += `📭 ยังไม่มีเหรียญ\n`
        msg += `💪 ทำการบ้านเพื่อรับเหรียญ!\n\n`
    } else {
        msg += `✅ ${safeBold("ปลดล็อกแล้ว")} (${earned.length}/${allBadges.length})\n\n`
        for (const b of earned) {
            msg += `${b.icon} ${b.rarityEmoji} ${safeBold(b.name)} — ${b.desc}\n`
        }
        msg += `\n`
    }

    if (locked.length) {
        msg += `🔒 ${safeBold("ยังไม่ได้ปลดล็อก")}\n\n`
        for (const b of locked) {
            msg += `${b.icon} ${b.rarityEmoji} ${b.name} — ${b.desc}\n`
        }
    }

    return msg
}

export function buildBadgeGrid(userId) {
    const allBadges = getAllBadges(userId)
    return allBadges.map(b => ({
        id: b.id,
        icon: b.icon,
        name: b.name,
        desc: b.desc,
        rarity: b.rarityLabel,
        rarityEmoji: b.rarityEmoji,
        earned: b.earned,
    }))
}

export function getBadgeById(id) {
    return BADGES[id] || null
}

export function getBadgeCount(userId) {
    const earned = getEarned(userId)
    return earned.length
}

export function getRarestBadge(userId) {
    const earned = getEarned(userId)
    if (!earned.length) return null
    const sorted = earned
        .map(id => BADGES[id])
        .filter(Boolean)
        .sort((a, b) => b.rarity.level - a.rarity.level)
    return sorted[0] || null
}

export async function flushBadges() {
    await badgeStore.flush()
}
