import fs from "fs"
import { logger } from "../utils/logger.js"

const STREAKS_FILE = ".streaks.json"
const MAX_ENTRIES = 10000
const MILESTONES = [3, 7, 14, 30, 60, 100, 365]

let streaks = {}
let writePromise = Promise.resolve()

function getToday() {
    return new Date().toISOString().slice(0, 10)
}

async function doWrite() {
    const tmp = STREAKS_FILE + ".tmp"
    const data = JSON.stringify(streaks, null, 2)
    try {
        await fs.promises.writeFile(tmp, data)
        await fs.promises.rename(tmp, STREAKS_FILE)
    } catch {
        // silently ignore (e.g. test cleanup races)
    }
}

function scheduleWrite() {
    writePromise = doWrite()
}

function loadStreaks() {
    try {
        const raw = fs.readFileSync(STREAKS_FILE, "utf-8")
        streaks = JSON.parse(raw)
        if (typeof streaks !== "object" || Array.isArray(streaks)) streaks = {}
    } catch {
        streaks = {}
    }
}

loadStreaks()

export function recordCompletion(userId) {
    const today = getToday()
    const key = String(userId)
    let entry = streaks[key]
    if (!entry) {
        entry = { current: 0, best: 0, lastDate: null }
    }

    if (entry.lastDate === today) {
        return { current: entry.current, best: entry.best, isNewMilestone: false }
    }

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    if (entry.lastDate === yesterdayStr) {
        entry.current++
    } else {
        entry.current = 1
    }

    entry.best = Math.max(entry.best, entry.current)
    entry.lastDate = today

    if (Object.keys(streaks).length < MAX_ENTRIES || streaks[key]) {
        streaks[key] = entry
    }

    scheduleWrite()

    const isNewMilestone = MILESTONES.includes(entry.current)

    return { current: entry.current, best: entry.best, isNewMilestone }
}

export function getStreak(userId) {
    const key = String(userId)
    const entry = streaks[key]
    if (!entry) {
        return { current: 0, best: 0, lastDate: null }
    }
    return { current: entry.current, best: entry.best, lastDate: entry.lastDate }
}

export function getNextMilestone(current) {
    for (const m of MILESTONES) {
        if (m > current) return m
    }
    return null
}

export function getStreakCalendar(userId) {
    const entry = streaks[String(userId)]
    if (!entry || !entry.lastDate) {
        return []
    }

    const today = new Date()
    const calendar = []
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().slice(0, 10)
        const isCompleted = entry.lastDate >= dateStr
        calendar.push({
            date: dateStr,
            done: isCompleted && dateStr <= entry.lastDate,
        })
    }
    return calendar
}

export async function flushStreaks() {
    await writePromise
}
