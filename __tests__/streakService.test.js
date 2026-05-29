import fs from 'fs'
import path from 'path'
import { jest } from '@jest/globals'

const STREAKS_FILE = '.streaks.json'
const FIXTURE_PATH = path.join(process.cwd(), STREAKS_FILE)

beforeEach(() => {
  try { fs.unlinkSync(FIXTURE_PATH) } catch {}
})

afterEach(() => {
  try { fs.unlinkSync(FIXTURE_PATH) } catch {}
})

/**
 * Helper: write fixture, then return fresh imports so in-memory state comes from file.
 */
async function importWithFixture(data) {
  jest.resetModules()
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(data))
  return await import('../src/services/streakService.js')
}

describe('recordCompletion', () => {
  test('creates new streak on first completion', async () => {
    const { recordCompletion } = await importWithFixture({})
    const result = recordCompletion('user1')
    expect(result.current).toBe(1)
    expect(result.best).toBe(1)
    expect(result.isNewMilestone).toBe(false)
  })

  test('increments streak when called on consecutive days', async () => {
    const realToday = new Date()
    const yesterday = new Date(realToday)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    const { recordCompletion } = await importWithFixture({
      user1: { current: 5, best: 10, lastDate: yesterdayStr }
    })
    const result = recordCompletion('user1')
    expect(result.current).toBe(6)
    expect(result.best).toBe(10)
    expect(result.isNewMilestone).toBe(false)
  })

  test('resets streak to 1 if gap > 1 day', async () => {
    const { recordCompletion } = await importWithFixture({
      user1: { current: 10, best: 15, lastDate: '2020-01-01' }
    })
    const result = recordCompletion('user1')
    expect(result.current).toBe(1)
    expect(result.best).toBe(15)
    expect(result.isNewMilestone).toBe(false)
  })

  test('does nothing if already completed today', async () => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const { recordCompletion } = await importWithFixture({
      user1: { current: 7, best: 7, lastDate: todayStr }
    })
    const result = recordCompletion('user1')
    expect(result.current).toBe(7)
    expect(result.best).toBe(7)
    expect(result.isNewMilestone).toBe(false)
  })

  test('returns isNewMilestone=true at milestone days 3,7,14,30,60,100,365', async () => {
    const milestoneDays = [3, 7, 14, 30, 60, 100, 365]
    for (const days of milestoneDays) {
      jest.resetModules()
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().slice(0, 10)

      const data = { user1: { current: days - 1, best: days, lastDate: yesterdayStr } }
      fs.writeFileSync(FIXTURE_PATH, JSON.stringify(data))
      const { recordCompletion } = await import('../src/services/streakService.js')
      const result = recordCompletion('user1')
      expect(result.current).toBe(days)
      expect(result.isNewMilestone).toBe(true)
    }
  })

  test('handles undefined userId gracefully', async () => {
    const { recordCompletion } = await importWithFixture({})
    const result = recordCompletion(undefined)
    expect(result.current).toBe(1)
    expect(result.best).toBe(1)
  })

  test('handles number userId', async () => {
    const { recordCompletion, flushStreaks } = await importWithFixture({})
    const result = recordCompletion(12345)
    expect(result.current).toBe(1)
    await expect(flushStreaks()).resolves.toBeUndefined()
  })

  test('does not exceed MAX_ENTRIES', async () => {
    const entries = {}
    for (let i = 0; i < 10000; i++) {
      entries[`user${i}`] = { current: 0, best: 0, lastDate: null }
    }
    fs.writeFileSync(FIXTURE_PATH, JSON.stringify(entries))
    jest.resetModules()
    const mod = await import('../src/services/streakService.js')

    mod.recordCompletion('nework')
    const loaded = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
    expect(Object.keys(loaded).length).toBeLessThanOrEqual(10000)
  })
})

describe('getStreak', () => {
  test('returns zeros for unknown user', async () => {
    const { getStreak } = await importWithFixture({})
    const result = getStreak('nonexistent')
    expect(result).toEqual({ current: 0, best: 0, lastDate: null })
  })

  test('returns correct streak for existing user', async () => {
    const { getStreak } = await importWithFixture({
      user1: { current: 15, best: 30, lastDate: '2026-05-28' }
    })
    const result = getStreak('user1')
    expect(result.current).toBe(15)
    expect(result.best).toBe(30)
    expect(result.lastDate).toBe('2026-05-28')
  })

  test('handles number userId', async () => {
    const { getStreak } = await importWithFixture({
      '999': { current: 3, best: 5, lastDate: '2026-05-28' }
    })
    const result = getStreak(999)
    expect(result.current).toBe(3)
  })
})

describe('getNextMilestone', () => {
  test('returns 3 for current=0', async () => {
    const { getNextMilestone } = await importWithFixture({})
    expect(getNextMilestone(0)).toBe(3)
  })

  test('returns 7 for current=5', async () => {
    const { getNextMilestone } = await importWithFixture({})
    expect(getNextMilestone(5)).toBe(7)
  })

  test('returns null for current >= 365', async () => {
    const { getNextMilestone } = await importWithFixture({})
    expect(getNextMilestone(365)).toBeNull()
    expect(getNextMilestone(1000)).toBeNull()
  })

  test('returns next milestone for any intermediate value', async () => {
    const { getNextMilestone } = await importWithFixture({})
    expect(getNextMilestone(1)).toBe(3)
    expect(getNextMilestone(3)).toBe(7)
    expect(getNextMilestone(13)).toBe(14)
    expect(getNextMilestone(29)).toBe(30)
    expect(getNextMilestone(59)).toBe(60)
    expect(getNextMilestone(99)).toBe(100)
    expect(getNextMilestone(364)).toBe(365)
  })
})

describe('getStreakCalendar', () => {
  test('returns empty array for unknown user', async () => {
    const { getStreakCalendar } = await importWithFixture({})
    expect(getStreakCalendar('nonexistent')).toEqual([])
  })

  test('returns calendar for user with streak', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { getStreakCalendar } = await importWithFixture({
      user1: { current: 5, best: 5, lastDate: today }
    })
    const calendar = getStreakCalendar('user1')
    expect(calendar.length).toBe(7)
    const todayEntry = calendar.find(c => c.date === today)
    expect(todayEntry.done).toBe(true)
  })

  test('calendar shows entries for all 7 days', async () => {
    const { getStreakCalendar } = await importWithFixture({
      user1: { current: 3, best: 5, lastDate: '2026-05-28' }
    })
    const calendar = getStreakCalendar('user1')
    expect(calendar.length).toBe(7)
    calendar.forEach(c => {
      expect(c).toHaveProperty('date')
      expect(c).toHaveProperty('done')
      expect(typeof c.done).toBe('boolean')
    })
  })
})

describe('flushStreaks', () => {
  test('resolves when no pending writes', async () => {
    const { flushStreaks } = await importWithFixture({})
    await expect(flushStreaks()).resolves.toBeUndefined()
  })
})
