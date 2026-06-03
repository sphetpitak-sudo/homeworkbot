import fs from "fs"
import { logger } from "../utils/logger.js"
import { createJsonStore } from "../utils/jsonStore.js"

const FILENAME = ".streaks.json"
const MAX_ENTRIES = 10000
const MILESTONES = [3, 7, 14, 30, 60, 100, 365]

const store = createJsonStore(FILENAME, {})

function getToday() {
    return new Date().toISOString().slice(0, 10)
}

function getYesterday() {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
}

export function recordCompletion(userId) {
    const today = getToday()
    const key = String(userId)
    const data = store.data
    let entry = data[key]
    if (!entry) {
        entry = { current: 0, best: 0, lastDate: null }
    }

    if (entry.lastDate === today) {
        return { current: entry.current, best: entry.best, isNewMilestone: false }
    }

    const yesterday = getYesterday()
    if (entry.lastDate === yesterday) {
        entry.current++
    } else {
        entry.current = 1
    }

    entry.best = Math.max(entry.best, entry.current)
    entry.lastDate = today

    const isNewUser = !(key in data)
    if (!isNewUser || Object.keys(data).length < MAX_ENTRIES) {
        data[key] = entry
    } else {
        return { current: entry.current, best: entry.best, isNewMilestone: false, capped: true }
    }

    store.scheduleWrite()

    const isNewMilestone = MILESTONES.includes(entry.current)
    return { current: entry.current, best: entry.best, isNewMilestone }
}

export function getStreak(userId) {
    const entry = store.data[String(userId)]
    if (!entry) return { current: 0, best: 0, lastDate: null }
    return { current: entry.current, best: entry.best, lastDate: entry.lastDate }
}

export function getNextMilestone(current) {
    for (const m of MILESTONES) {
        if (m > current) return m
    }
    return null
}

export function getStreakCalendar(userId) {
    const entry = store.data[String(userId)]
    if (!entry || !entry.lastDate) return []

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
    await store.flush()
}
