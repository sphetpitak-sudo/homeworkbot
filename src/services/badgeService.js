import fs from "fs"
import { logger } from "../utils/logger.js"
import { safeBold } from "../utils/telegramFormat.js"
import { getStreak } from "./streakService.js"
import { fetchDone } from "./notionService.js"

const BADGES = {
    FIRST_TASK:    { id: "FIRST_TASK",    icon: "🎯", name: "เริ่มต้น",            desc: "ทำการบ้านเสร็จชิ้นแรก" },
    TEN_TASKS:     { id: "TEN_TASKS",     icon: "⭐", name: "ขยัน",               desc: "ทำการบ้านเสร็จ 10 ชิ้น" },
    FIFTY_TASKS:   { id: "FIFTY_TASKS",   icon: "🌟", name: "อุตสาหะ",            desc: "ทำการบ้านเสร็จ 50 ชิ้น" },
    HUNDRED_TASKS: { id: "HUNDRED_TASKS", icon: "💎", name: "มหาบัณฑิต",          desc: "ทำการบ้านเสร็จ 100 ชิ้น" },
    STREAK_3:      { id: "STREAK_3",      icon: "🔥", name: "ไฟเริ่มติด",          desc: "ทำติดต่อ 3 วัน" },
    STREAK_7:      { id: "STREAK_7",      icon: "🔥🔥", name: "ไฟแรง",             desc: "ทำติดต่อ 7 วัน" },
    STREAK_14:     { id: "STREAK_14",     icon: "🔥🔥🔥", name: "เพลิงลุก",        desc: "ทำติดต่อ 14 วัน" },
    STREAK_30:     { id: "STREAK_30",     icon: "🏆", name: "เดอะเบสต์",          desc: "ทำติดต่อ 30 วัน" },
    STREAK_60:     { id: "STREAK_60",     icon: "👑", name: "ราชาแห่งไฟ",         desc: "ทำติดต่อ 60 วัน" },
    STREAK_100:    { id: "STREAK_100",    icon: "💯", name: "เซียนร้อย",          desc: "ทำติดต่อ 100 วัน" },
    STREAK_365:    { id: "STREAK_365",    icon: "🎖️", name: "ตำนาน",            desc: "ทำติดต่อ 1 ปี" },
}

const STREAK_MILESTONES = {
    3:   "STREAK_3",
    7:   "STREAK_7",
    14:  "STREAK_14",
    30:  "STREAK_30",
    60:  "STREAK_60",
    100: "STREAK_100",
    365: "STREAK_365",
}

const TASK_MILESTONES = [
    { threshold: 1,   badge: "FIRST_TASK" },
    { threshold: 10,  badge: "TEN_TASKS" },
    { threshold: 50,  badge: "FIFTY_TASKS" },
    { threshold: 100, badge: "HUNDRED_TASKS" },
]

const BADGES_FILE = ".badges.json"
let badgeStore = {}
let writePromise = Promise.resolve()

async function doWrite() {
    const tmp = BADGES_FILE + ".tmp"
    try {
        await fs.promises.writeFile(tmp, JSON.stringify(badgeStore, null, 2))
        await fs.promises.rename(tmp, BADGES_FILE)
    } catch {
        // ignore
    }
}

function scheduleWrite() {
    writePromise = doWrite()
}

function loadBadges() {
    try {
        const raw = fs.readFileSync(BADGES_FILE, "utf-8")
        badgeStore = JSON.parse(raw)
        if (typeof badgeStore !== "object" || Array.isArray(badgeStore)) badgeStore = {}
    } catch {
        badgeStore = {}
    }
}

loadBadges()

function getEarned(userId) {
    const key = String(userId)
    return badgeStore[key] || []
}

function setEarned(userId, badges) {
    const key = String(userId)
    badgeStore[key] = badges
    scheduleWrite()
}

export function checkBadges(userId) {
    const earned = getEarned(userId)
    const newBadges = []
    const streak = getStreak(userId)

    if (streak.current > 0) {
        const milestoneId = STREAK_MILESTONES[streak.current]
        if (milestoneId && !earned.includes(milestoneId)) {
            newBadges.push(milestoneId)
        }
    }

    return newBadges
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
    return Object.values(BADGES).map(b => ({
        ...b,
        earned: earned.includes(b.id),
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
        msg += `💪 ทำการบ้านและรักษา streak เพื่อรับเหรียญ!\n\n`
    } else {
        msg += `✅ ${safeBold("ปลดล็อกแล้ว")} (${earned.length}/${allBadges.length})\n\n`
        for (const b of earned) {
            msg += `${b.icon} ${safeBold(b.name)} — ${b.desc}\n`
        }
        msg += `\n`
    }

    if (locked.length) {
        msg += `🔒 ${safeBold("ยังไม่ได้ปลดล็อก")}\n\n`
        for (const b of locked) {
            msg += `${b.icon} ${b.name} — ${b.desc}\n`
        }
    }

    return msg
}

export function getBadgeById(id) {
    return BADGES[id] || null
}

export async function flushBadges() {
    await writePromise
}
