import { logger } from "../utils/logger.js"
import { createJsonStore } from "../utils/jsonStore.js"

const POMODOROS_FILE = ".pomodoros.json"
const MAX_ENTRIES = 5000
const SESSION_DURATION = 25 * 60 * 1000   // 25 minutes
const BREAK_DURATION = 5 * 60 * 1000      // 5 minutes
const AUTO_CLOSE_MS = 5 * 60 * 1000       // 5 min inactivity (used by startup recovery)

const POMO_MILESTONES = [
    { threshold: 10,  badge: "POMO_10" },
    { threshold: 50,  badge: "POMO_50" },
    { threshold: 100, badge: "POMO_100" },
    { threshold: 500, badge: "POMO_500" },
]

const jsonStore = createJsonStore(POMODOROS_FILE, {})

/* H1: in-flight pomodoro persistence.
   In-memory `setTimeout` was lost on restart, silently dropping a
   session the user thought was running. We persist the in-flight
   session in the same JSON store under `_in_flight` and offer a
   recovery hook (`recoverInterruptedSessions`) the boot sequence
   can call to fire phase transitions that would have happened
   during downtime. */
function inFlightBucket() {
    if (!jsonStore.data._in_flight) jsonStore.data._in_flight = {}
    return jsonStore.data._in_flight
}

export function persistInFlightSession(userId, session) {
    const bucket = inFlightBucket()
    bucket[String(userId)] = {
        startedAt: session.startedAt,
        duration: session.duration,
        phase: session.phase,
        homeworkTitle: session.homeworkTitle || null,
    }
    jsonStore.scheduleWrite()
}

export function clearInFlightSession(userId) {
    const bucket = inFlightBucket()
    if (bucket[String(userId)]) {
        delete bucket[String(userId)]
        jsonStore.scheduleWrite()
    }
}

export function getInFlightSession(userId) {
    const bucket = inFlightBucket()
    return bucket[String(userId)] || null
}

export function listInFlightSessions() {
    const bucket = inFlightBucket()
    return Object.entries(bucket).map(([userId, session]) => ({ userId, ...session as any }))
}

/* Recover sessions that should have transitioned during downtime.
   Returns a list of { userId, action: "completed" | "ended" }
   so the caller can notify the user. Idempotent: clearing a
   session ensures we don't re-fire on the next boot. */
interface InFlightSession {
    startedAt: number
    duration: number
    phase: string
    homeworkTitle?: string
}

export function recoverInterruptedSessions() {
    const now = Date.now()
    const recovered: Array<{ userId: string; action: string; homeworkTitle?: string }> = []
    const bucket = inFlightBucket()
    for (const [userId, raw] of Object.entries(bucket)) {
        const session = raw as InFlightSession
        const elapsed = now - session.startedAt
        /* "ended" is stricter than "completed" — we mark a session
           ended only if downtime has exceeded BOTH the work phase
           AND the break phase AND the auto-close grace window
           (i.e. the entire session is in the past). */
        if (elapsed >= session.duration + BREAK_DURATION + AUTO_CLOSE_MS) {
            if (session.phase === "work") {
                /* The work phase ended during downtime — credit it. */
                savePomodoro(userId)
                recovered.push({ userId, action: "completed", homeworkTitle: session.homeworkTitle })
            }
            delete bucket[userId]
            recovered.push({ userId, action: "ended", homeworkTitle: session.homeworkTitle })
        } else if (session.phase === "work" && elapsed >= session.duration) {
            /* Work phase finished during downtime but the break
               window is still active — credit the work, keep the
               in-flight marker gone, and let the next boot
               re-evaluate. */
            savePomodoro(userId)
            delete bucket[userId]
            recovered.push({ userId, action: "completed", homeworkTitle: session.homeworkTitle })
        }
    }
    if (recovered.length) jsonStore.scheduleWrite()
    return recovered
}

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

function getUserEntry(userId) {
    const store = jsonStore.data
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
    const entry = getUserEntry(userId)
    ensurePeriods(entry)
    jsonStore.scheduleWrite()
    return {
        userId: String(userId),
        homeworkTitle: homeworkTitle || null,
        startedAt: Date.now(),
        duration: SESSION_DURATION,
        phase: "work",
    }
}

export function savePomodoro(userId) {
    const entry = getUserEntry(userId)
    ensurePeriods(entry)

    entry.count++
    entry.today++
    entry.week++
    entry.totalMinutes += 25
    const today = getToday()
    if (!entry.history.includes(today)) {
        entry.history.push(today)
    }
    if (entry.history.length > 365) {
        entry.history = entry.history.slice(-365)
    }
    jsonStore.scheduleWrite()
    return { count: entry.count, today: entry.today, week: entry.week }
}

export function getStats(userId) {
    const entry = getUserEntry(userId)
    ensurePeriods(entry)
    jsonStore.scheduleWrite()
    return {
        count: entry.count,
        today: entry.today,
        week: entry.week,
        totalMinutes: entry.totalMinutes,
        totalHours: Math.round(entry.totalMinutes / 60 * 10) / 10,
    }
}

export function getStreak(userId) {
    const entry = getUserEntry(userId)
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
        const diff = (curr.getTime() - next.getTime()) / 86400000
        if (diff === 1) streak++
        else break
    }
    return streak
}

export function checkPomoBadges(userId) {
    const entry = getUserEntry(userId)
    const newBadges = []
    for (const { threshold, badge } of POMO_MILESTONES) {
        if (entry.count >= threshold) newBadges.push(badge)
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
    await jsonStore.flush()
}
