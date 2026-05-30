import fs from "fs"
import { logger } from "../utils/logger.js"

const POMODOROS_FILE = ".pomodoros.json"
const MAX_ENTRIES = 5000
const SESSION_DURATION = 25 * 60 * 1000   // 25 minutes
const BREAK_DURATION = 5 * 60 * 1000      // 5 minutes
const AUTO_CLOSE_MS = 5 * 60 * 1000       // 5 min inactivity

const POMO_MILESTONES = [
    { threshold: 10,  badge: "POMO_10" },
    { threshold: 50,  badge: "POMO_50" },
    { threshold: 100, badge: "POMO_100" },
    { threshold: 500, badge: "POMO_500" },
]

let store = {}
let writePromise = Promise.resolve()

function getToday() {
    return new Date().toISOString().slice(0, 10)
}

function getWeekStart() {
    const d = new Date()
    const day = d.getDay()
    const diff = (day + 6) % 7
    d.setDate(d.getDate() - diff)
    d.setHours(0, 0, 0, 0)
    return d.toISOString().slice(0, 10)
}

async function doWrite() {
    const tmp = POMODOROS_FILE + ".tmp"
    const data = JSON.stringify(store, null, 2)
    try {
        await fs.promises.writeFile(tmp, data)
        await fs.promises.rename(tmp, POMODOROS_FILE)
    } catch {
        // silently ignore
    }
}

function scheduleWrite() {
    writePromise = doWrite()
}

function loadStore() {
    try {
        const raw = fs.readFileSync(POMODOROS_FILE, "utf-8")
        store = JSON.parse(raw)
        if (typeof store !== "object" || Array.isArray(store)) store = {}
    } catch {
        store = {}
    }
}

loadStore()

function getUserEntry(userId) {
    const key = String(userId)
    if (!store[key]) {
        store[key] = {
            count: 0,
            today: 0,
            week: 0,
            totalMinutes: 0,
            todayDate: null,
            weekStart: null,
            history: [],
        }
    }
    return store[key]
}

function ensurePeriods(entry) {
    const today = getToday()
    const weekStart = getWeekStart()
    if (entry.todayDate !== today) {
        entry.today = 0
        entry.todayDate = today
    }
    if (entry.weekStart !== weekStart) {
        entry.week = 0
        entry.weekStart = weekStart
    }
}

export function startSession(userId, homeworkTitle) {
    const key = String(userId)
    const entry = getUserEntry(key)
    ensurePeriods(entry)
    scheduleWrite()
    return {
        userId: key,
        homeworkTitle: homeworkTitle || null,
        startedAt: Date.now(),
        duration: SESSION_DURATION,
        phase: "work", // "work" or "break"
    }
}

export function savePomodoro(userId) {
    const key = String(userId)
    const entry = getUserEntry(key)
    ensurePeriods(entry)

    entry.count++
    entry.today++
    entry.week++
    entry.totalMinutes += 25
    const today = getToday()
    if (!entry.history.includes(today)) {
        entry.history.push(today)
    }
    // Keep max 365 days in history
    if (entry.history.length > 365) {
        entry.history = entry.history.slice(-365)
    }
    scheduleWrite()
    return { count: entry.count, today: entry.today, week: entry.week }
}

export function getStats(userId) {
    const key = String(userId)
    const entry = getUserEntry(key)
    ensurePeriods(entry)
    scheduleWrite()
    return {
        count: entry.count,
        today: entry.today,
        week: entry.week,
        totalMinutes: entry.totalMinutes,
        totalHours: Math.round(entry.totalMinutes / 60 * 10) / 10,
    }
}

export function getStreak(userId) {
    const key = String(userId)
    const entry = getUserEntry(key)
    if (!entry.history.length) return 0

    const sorted = [...entry.history].sort().reverse()
    const today = getToday()
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    if (sorted[0] !== today && sorted[0] !== yesterdayStr) return 0

    let streak = 1
    for (let i = 0; i < sorted.length - 1; i++) {
        const curr = new Date(sorted[i])
        const next = new Date(sorted[i + 1])
        const diff = (curr - next) / 86400000
        if (diff === 1) {
            streak++
        } else {
            break
        }
    }
    return streak
}

export function checkPomoBadges(userId) {
    const key = String(userId)
    const entry = getUserEntry(key)
    const newBadges = []
    for (const { threshold, badge } of POMO_MILESTONES) {
        if (entry.count >= threshold) {
            newBadges.push(badge)
        }
    }
    return newBadges
}

export function getSessionDuration() {
    return SESSION_DURATION
}

export function getBreakDuration() {
    return BREAK_DURATION
}

export function getAutoCloseMs() {
    return AUTO_CLOSE_MS
}

export async function flushPomodoros() {
    await writePromise
}
