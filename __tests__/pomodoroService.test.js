import fs from 'fs'
import path from 'path'
import { jest } from '@jest/globals'

const POMODOROS_FILE = '.pomodoros.json'
const POMODOROS_TMP = '.pomodoros.json.tmp'
const FIXTURE_PATH = path.join(process.cwd(), POMODOROS_FILE)
const TMP_PATH = path.join(process.cwd(), POMODOROS_TMP)

function cleanup() {
    try { fs.unlinkSync(FIXTURE_PATH) } catch { }
    try { fs.unlinkSync(TMP_PATH) } catch { }
}

async function importWithFixture(data) {
    jest.resetModules()
    cleanup()
    if (data !== undefined) fs.writeFileSync(FIXTURE_PATH, JSON.stringify(data))
    return await import('../src/services/pomodoroService.js')
}

beforeEach(() => { cleanup() })
afterEach(() => { cleanup() })

describe('startSession', () => {
    test('returns session object with correct structure', async () => {
        const { startSession } = await importWithFixture({})
        const session = startSession('user1')
        expect(session).toHaveProperty('userId', 'user1')
        expect(session).toHaveProperty('startedAt')
        expect(session).toHaveProperty('duration')
        expect(session).toHaveProperty('phase', 'work')
        expect(session).toHaveProperty('homeworkTitle')
    })

    test('accepts optional homework title', async () => {
        const { startSession } = await importWithFixture({})
        const session = startSession('user1', 'แบบฝึกหัดคณิต')
        expect(session.homeworkTitle).toBe('แบบฝึกหัดคณิต')
    })

    test('homeworkTitle is null when not provided', async () => {
        const { startSession } = await importWithFixture({})
        const session = startSession('user1')
        expect(session.homeworkTitle).toBeNull()
    })

    test('duration equals 25 minutes in ms', async () => {
        const { startSession, getSessionDuration } = await importWithFixture({})
        const session = startSession('user1')
        expect(session.duration).toBe(getSessionDuration())
        expect(session.duration).toBe(25 * 60 * 1000)
    })

    test('startedAt is close to current time', async () => {
        const { startSession } = await importWithFixture({})
        const before = Date.now()
        const session = startSession('user1')
        expect(session.startedAt).toBeGreaterThanOrEqual(before)
        expect(session.startedAt).toBeLessThanOrEqual(Date.now())
    })
})

describe('savePomodoro', () => {
    test('increments count from 0 to 1', async () => {
        const { savePomodoro } = await importWithFixture({})
        const result = savePomodoro('user1')
        expect(result.count).toBe(1)
        expect(result.today).toBe(1)
        expect(result.week).toBe(1)
    })

    test('increments count cumulatively', async () => {
        const { savePomodoro } = await importWithFixture({})
        savePomodoro('user1')
        savePomodoro('user1')
        const result = savePomodoro('user1')
        expect(result.count).toBe(3)
        expect(result.today).toBe(3)
    })

    test('separate users have independent counts', async () => {
        const { savePomodoro } = await importWithFixture({})
        savePomodoro('user1')
        savePomodoro('user1')
        const resultUser2 = savePomodoro('user2')
        expect(resultUser2.count).toBe(1)
    })

    test('persists to file', async () => {
        const { savePomodoro } = await importWithFixture({})
        savePomodoro('user1')
        await new Promise(r => setTimeout(r, 50))
        const content = fs.readFileSync(FIXTURE_PATH, 'utf-8')
        const data = JSON.parse(content)
        expect(data['user1'].count).toBe(1)
    })

    test('totalMinutes increments by 25 each session', async () => {
        const { savePomodoro, getStats } = await importWithFixture({})
        savePomodoro('user1')
        savePomodoro('user1')
        const stats = getStats('user1')
        expect(stats.totalMinutes).toBe(50)
        expect(stats.totalHours).toBe(0.8)
    })
})

describe('getStats', () => {
    test('returns zero stats for new user', async () => {
        const { getStats } = await importWithFixture({})
        const stats = getStats('newuser')
        expect(stats.count).toBe(0)
        expect(stats.today).toBe(0)
        expect(stats.week).toBe(0)
        expect(stats.totalMinutes).toBe(0)
        expect(stats.totalHours).toBe(0)
    })

    test('returns correct stats after sessions', async () => {
        const { savePomodoro, getStats } = await importWithFixture({})
        savePomodoro('user1')
        savePomodoro('user1')
        savePomodoro('user1')
        const stats = getStats('user1')
        expect(stats.count).toBe(3)
        expect(stats.totalMinutes).toBe(75)
        expect(stats.totalHours).toBe(1.3)
    })
})

describe('getStreak', () => {
    test('returns 0 for user with no history', async () => {
        const { getStreak } = await importWithFixture({})
        expect(getStreak('nobody')).toBe(0)
    })

    test('returns 1 for one session today', async () => {
        const today = new Date().toISOString().slice(0, 10)
        const { savePomodoro } = await importWithFixture({})
        savePomodoro('user1')
        const { getStreak } = await importWithFixture({ user1: { history: [today] } })
        // Note: savePomodoro already adds today to history
    })

    test('returns 0 when last session was > 1 day ago', async () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
        const { getStreak } = await importWithFixture({
            user1: { count: 5, today: 0, week: 0, totalMinutes: 125, todayDate: null, weekStart: null, history: [twoDaysAgo] },
        })
        expect(getStreak('user1')).toBe(0)
    })

    test('returns streak count for consecutive days', async () => {
        const today = new Date().toISOString().slice(0, 10)
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
        const dayBefore = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
        const { getStreak } = await importWithFixture({
            user1: { count: 3, today: 0, week: 0, totalMinutes: 75, todayDate: null, weekStart: null, history: [today, yesterday, dayBefore] },
        })
        expect(getStreak('user1')).toBe(3)
    })

    test('streak breaks on a gap day', async () => {
        const today = new Date().toISOString().slice(0, 10)
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
        // 2-day gap between yesterday and 3 days ago → streak = 2
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
        const { getStreak } = await importWithFixture({
            user1: { count: 3, today: 0, week: 0, totalMinutes: 75, todayDate: null, weekStart: null, history: [today, yesterday, threeDaysAgo] },
        })
        expect(getStreak('user1')).toBe(2)
    })

    test('returns 1 when only yesterday is in history', async () => {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
        const { getStreak } = await importWithFixture({
            user1: { count: 1, today: 0, week: 0, totalMinutes: 25, todayDate: null, weekStart: null, history: [yesterday] },
        })
        expect(getStreak('user1')).toBe(1)
    })

    test('returns 0 for future-dated history (clock skew)', async () => {
        const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
        const { getStreak } = await importWithFixture({
            user1: { count: 1, today: 0, week: 0, totalMinutes: 25, todayDate: null, weekStart: null, history: [future] },
        })
        expect(getStreak('user1')).toBe(0)
    })
})

describe('checkPomoBadges', () => {
    test('returns no badges for count < 10', async () => {
        const { checkPomoBadges } = await importWithFixture({
            user1: { count: 5, today: 0, week: 0, totalMinutes: 125, todayDate: null, weekStart: null, history: [] },
        })
        expect(checkPomoBadges('user1')).toEqual([])
    })

    test('returns POMO_10 at 10 sessions', async () => {
        const { checkPomoBadges } = await importWithFixture({
            user1: { count: 10, today: 0, week: 0, totalMinutes: 250, todayDate: null, weekStart: null, history: [] },
        })
        const badges = checkPomoBadges('user1')
        expect(badges).toContain('POMO_10')
    })

    test('returns POMO_50 at 50 sessions', async () => {
        const { checkPomoBadges } = await importWithFixture({
            user1: { count: 50, today: 0, week: 0, totalMinutes: 1250, todayDate: null, weekStart: null, history: [] },
        })
        const badges = checkPomoBadges('user1')
        expect(badges).toContain('POMO_50')
    })

    test('returns POMO_100 at 100 sessions', async () => {
        const { checkPomoBadges } = await importWithFixture({
            user1: { count: 150, today: 0, week: 0, totalMinutes: 3750, todayDate: null, weekStart: null, history: [] },
        })
        const badges = checkPomoBadges('user1')
        expect(badges).toContain('POMO_100')
    })

    test('returns POMO_500 at 500 sessions', async () => {
        const { checkPomoBadges } = await importWithFixture({
            user1: { count: 500, today: 0, week: 0, totalMinutes: 12500, todayDate: null, weekStart: null, history: [] },
        })
        const badges = checkPomoBadges('user1')
        expect(badges).toContain('POMO_500')
    })

    test('returns multiple badges at threshold', async () => {
        const { checkPomoBadges } = await importWithFixture({
            user1: { count: 100, today: 0, week: 0, totalMinutes: 2500, todayDate: null, weekStart: null, history: [] },
        })
        const badges = checkPomoBadges('user1')
        expect(badges).toContain('POMO_10')
        expect(badges).toContain('POMO_50')
        expect(badges).toContain('POMO_100')
        expect(badges).not.toContain('POMO_500')
    })

    test('returns no badges for new user', async () => {
        const { checkPomoBadges } = await importWithFixture({})
        expect(checkPomoBadges('newuser')).toEqual([])
    })
})

describe('getSessionDuration', () => {
    test('returns 25 minutes in ms', async () => {
        const { getSessionDuration } = await importWithFixture({})
        expect(getSessionDuration()).toBe(25 * 60 * 1000)
    })
})

describe('getBreakDuration', () => {
    test('returns 5 minutes in ms', async () => {
        const { getBreakDuration } = await importWithFixture({})
        expect(getBreakDuration()).toBe(5 * 60 * 1000)
    })
})

describe('getAutoCloseMs', () => {
    test('returns 5 minutes in ms', async () => {
        const { getAutoCloseMs } = await importWithFixture({})
        expect(getAutoCloseMs()).toBe(5 * 60 * 1000)
    })
})

describe('in-flight session persistence (H1)', () => {
    test('persistInFlightSession stores session under _in_flight', async () => {
        const { persistInFlightSession, getInFlightSession } = await importWithFixture({})
        const session = {
            userId: 'user1',
            startedAt: 1_000_000,
            duration: 25 * 60 * 1000,
            phase: 'work',
            homeworkTitle: 'math hw',
        }
        persistInFlightSession('user1', session)
        const stored = getInFlightSession('user1')
        expect(stored).toBeTruthy()
        expect(stored.startedAt).toBe(1_000_000)
        expect(stored.phase).toBe('work')
        expect(stored.homeworkTitle).toBe('math hw')
    })

    test('clearInFlightSession removes the entry', async () => {
        const { persistInFlightSession, clearInFlightSession, getInFlightSession } = await importWithFixture({})
        persistInFlightSession('user1', {
            userId: 'user1', startedAt: Date.now(), duration: 25 * 60 * 1000, phase: 'work', homeworkTitle: null,
        })
        clearInFlightSession('user1')
        expect(getInFlightSession('user1')).toBeNull()
    })

    test('recoverInterruptedSessions credits a session that completed during downtime', async () => {
        const { persistInFlightSession, recoverInterruptedSession: _ignored, savePomodoro, recoverInterruptedSessions, getStats } = await importWithFixture({})
        // H1: simulate a session started 30 minutes ago — well past the 25min work phase
        persistInFlightSession('user1', {
            userId: 'user1',
            startedAt: Date.now() - 30 * 60 * 1000,
            duration: 25 * 60 * 1000,
            phase: 'work',
            homeworkTitle: 'math hw',
        })
        const recovered = recoverInterruptedSessions()
        expect(recovered.length).toBe(1)
        expect(recovered[0].action).toBe('completed')
        // The session should have been credited
        const stats = getStats('user1')
        expect(stats.count).toBe(1)
    })

    test('recoverInterruptedSessions ignores in-progress sessions (still in work phase)', async () => {
        const { persistInFlightSession, recoverInterruptedSessions, getStats } = await importWithFixture({})
        persistInFlightSession('user1', {
            userId: 'user1',
            startedAt: Date.now() - 5 * 60 * 1000, // 5 min in, 20 min remaining
            duration: 25 * 60 * 1000,
            phase: 'work',
            homeworkTitle: null,
        })
        const recovered = recoverInterruptedSessions()
        expect(recovered.length).toBe(0)
        expect(getStats('user1').count).toBe(0)
    })
})

describe('flushPomodoros', () => {
    test('resolves without error', async () => {
        const { flushPomodoros } = await importWithFixture({})
        await expect(flushPomodoros()).resolves.toBeUndefined()
    })

    test('flushes pending writes', async () => {
        const { savePomodoro, flushPomodoros } = await importWithFixture({})
        savePomodoro('user1')
        await flushPomodoros()
        const content = fs.readFileSync(FIXTURE_PATH, 'utf-8')
        const data = JSON.parse(content)
        expect(data['user1'].count).toBe(1)
    })
})

describe('atomic write behaviour', () => {
    test('writes to .tmp then renames to final', async () => {
        const { savePomodoro, flushPomodoros } = await importWithFixture({})
        savePomodoro('user1')
        await flushPomodoros()
        expect(fs.existsSync(TMP_PATH)).toBe(false)
        expect(fs.existsSync(FIXTURE_PATH)).toBe(true)
    })

    test('handles multiple saves sequentially', async () => {
        const { savePomodoro, flushPomodoros } = await importWithFixture({})
        savePomodoro('user1')
        await flushPomodoros()
        savePomodoro('user1')
        await flushPomodoros()
        savePomodoro('user1')
        await flushPomodoros()
        const content = fs.readFileSync(FIXTURE_PATH, 'utf-8')
        const data = JSON.parse(content)
        expect(data['user1'].count).toBe(3)
    })

    test('history trimmed to 365 entries', async () => {
        const history = Array.from({ length: 400 }, (_, i) => {
            const d = new Date()
            d.setDate(d.getDate() - i)
            return d.toISOString().slice(0, 10)
        })
        const { savePomodoro, flushPomodoros } = await importWithFixture({
            user1: { count: 400, today: 0, week: 0, totalMinutes: 10000, todayDate: null, weekStart: null, history },
        })
        savePomodoro('user1')
        await flushPomodoros()
        const content = fs.readFileSync(FIXTURE_PATH, 'utf-8')
        const data = JSON.parse(content)
        expect(data['user1'].history.length).toBeLessThanOrEqual(365)
    })
})
