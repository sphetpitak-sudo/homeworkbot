import fs from 'fs'
import path from 'path'
import { jest } from '@jest/globals'

const BADGES_FILE = '.badges.json'
const BADGES_TMP = '.badges.json.tmp'
const BADGES_PATH = path.join(process.cwd(), BADGES_FILE)
const BADGES_TMP_PATH = path.join(process.cwd(), BADGES_TMP)

function cleanup() {
  try { fs.unlinkSync(BADGES_PATH) } catch {}
  try { fs.unlinkSync(BADGES_TMP_PATH) } catch {}
}

async function importWithFixtures(badgeData) {
  jest.resetModules()
  cleanup()
  if (badgeData) fs.writeFileSync(BADGES_PATH, JSON.stringify(badgeData))
  return await import('../src/services/badgeService.js')
}

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  cleanup()
})

describe('checkTaskBadges', () => {
  test('returns empty for 0 totalDone', async () => {
    const { checkTaskBadges } = await importWithFixtures({})
    const result = checkTaskBadges('user1', 0)
    expect(result).toEqual([])
  })

  test('returns FIRST_TASK at totalDone=1', async () => {
    const { checkTaskBadges } = await importWithFixtures({})
    const result = checkTaskBadges('user1', 1)
    expect(result).toContain('FIRST_TASK')
    expect(result.length).toBe(1)
  })

  test('returns TEN_TASKS at totalDone=10', async () => {
    const { checkTaskBadges } = await importWithFixtures({})
    const result = checkTaskBadges('user1', 10)
    expect(result).toContain('TEN_TASKS')
  })

  test('returns FIFTY_TASKS at totalDone=50', async () => {
    const { checkTaskBadges } = await importWithFixtures({})
    const result = checkTaskBadges('user1', 50)
    expect(result).toContain('FIFTY_TASKS')
  })

  test('returns HUNDRED_TASKS at totalDone=100', async () => {
    const { checkTaskBadges } = await importWithFixtures({})
    const result = checkTaskBadges('user1', 100)
    expect(result).toContain('HUNDRED_TASKS')
  })

  test('returns multiple milestones when crossing thresholds', async () => {
    const { checkTaskBadges } = await importWithFixtures({})
    const result = checkTaskBadges('user1', 100)
    expect(result).toContain('FIRST_TASK')
    expect(result).toContain('TEN_TASKS')
    expect(result).toContain('FIFTY_TASKS')
    expect(result).toContain('HUNDRED_TASKS')
    expect(result.length).toBe(4)
  })

  test('does not return already earned badges', async () => {
    const badgeData = { user1: ['FIRST_TASK', 'TEN_TASKS'] }
    const { checkTaskBadges } = await importWithFixtures(badgeData)
    const result = checkTaskBadges('user1', 50)
    expect(result).toContain('FIFTY_TASKS')
    expect(result).not.toContain('FIRST_TASK')
    expect(result).not.toContain('TEN_TASKS')
  })

  test('returns empty if all badges for thresholds already earned', async () => {
    const earnedAll = ['FIRST_TASK', 'TEN_TASKS', 'FIFTY_TASKS', 'HUNDRED_TASKS']
    const badgeData = { user1: earnedAll }
    const { checkTaskBadges } = await importWithFixtures(badgeData)
    const result = checkTaskBadges('user1', 100)
    expect(result).toEqual([])
  })

  test('handles number userId', async () => {
    const { checkTaskBadges } = await importWithFixtures({})
    const result = checkTaskBadges(12345, 1)
    expect(result).toContain('FIRST_TASK')
  })
})

describe('awardBadges', () => {
  test('awards new badges and persists to file', async () => {
    const { awardBadges, flushBadges } = await importWithFixtures({})
    const awarded = awardBadges('user1', ['FIRST_TASK'])
    expect(awarded.length).toBe(1)
    expect(awarded[0].id).toBe('FIRST_TASK')
    await flushBadges()
    const saved = JSON.parse(fs.readFileSync(BADGES_PATH, 'utf-8'))
    expect(saved.user1).toContain('FIRST_TASK')
  })

  test('skips already earned badges', async () => {
    const badgeData = { user1: ['FIRST_TASK'] }
    const { awardBadges } = await importWithFixtures(badgeData)
    const awarded = awardBadges('user1', ['FIRST_TASK', 'TEN_TASKS'])
    expect(awarded.length).toBe(1)
    expect(awarded[0].id).toBe('TEN_TASKS')
  })

  test('returns empty array for empty input', async () => {
    const { awardBadges } = await importWithFixtures({})
    const awarded = awardBadges('user1', [])
    expect(awarded).toEqual([])
  })

  test('returns empty array for already earned badges only', async () => {
    const badgeData = { user1: ['FIRST_TASK'] }
    const { awardBadges } = await importWithFixtures(badgeData)
    const awarded = awardBadges('user1', ['FIRST_TASK'])
    expect(awarded).toEqual([])
  })

  test('awards multiple badges at once', async () => {
    const { awardBadges, flushBadges } = await importWithFixtures({})
    const awarded = awardBadges('user1', ['FIRST_TASK', 'TEN_TASKS', 'PANIC_5'])
    expect(awarded.length).toBe(3)
    await flushBadges()
    const saved = JSON.parse(fs.readFileSync(BADGES_PATH, 'utf-8'))
    expect(saved.user1.length).toBe(3)
  })

  test('handles multiple users independently', async () => {
    const { awardBadges, flushBadges } = await importWithFixtures({})
    awardBadges('user1', ['FIRST_TASK'])
    awardBadges('user2', ['TEN_TASKS'])
    await flushBadges()
    const saved = JSON.parse(fs.readFileSync(BADGES_PATH, 'utf-8'))
    expect(saved.user1).toContain('FIRST_TASK')
    expect(saved.user2).toContain('TEN_TASKS')
    expect(saved.user1.length).toBe(1)
    expect(saved.user2.length).toBe(1)
  })

  test('returns badge object with icon, name, desc for each awarded', async () => {
    const { awardBadges } = await importWithFixtures({})
    const awarded = awardBadges('user1', ['FIRST_TASK'])
    expect(awarded[0]).toHaveProperty('id', 'FIRST_TASK')
    expect(awarded[0]).toHaveProperty('icon', '🎯')
    expect(awarded[0]).toHaveProperty('name', 'ก้าวแรก')
    expect(awarded[0]).toHaveProperty('desc')
  })

  test('filters unknown badge IDs gracefully', async () => {
    const { awardBadges } = await importWithFixtures({})
    const awarded = awardBadges('user1', ['NONEXISTENT'])
    expect(awarded).toEqual([])
  })
})

describe('getAllBadges', () => {
  test('returns all badges with earned=false for new user', async () => {
    const { getAllBadges } = await importWithFixtures({})
    const all = getAllBadges('user1')
    expect(all.length).toBeGreaterThanOrEqual(11)
    all.forEach(b => {
      expect(b).toHaveProperty('id')
      expect(b).toHaveProperty('icon')
      expect(b).toHaveProperty('name')
      expect(b).toHaveProperty('desc')
      expect(b.earned).toBe(false)
    })
  })

  test('marks earned badges correctly', async () => {
    const badgeData = { user1: ['FIRST_TASK', 'TEN_TASKS'] }
    const { getAllBadges } = await importWithFixtures(badgeData)
    const all = getAllBadges('user1')
    const firstTask = all.find(b => b.id === 'FIRST_TASK')
    const tenTasks = all.find(b => b.id === 'TEN_TASKS')
    const panic5 = all.find(b => b.id === 'PANIC_5')
    expect(firstTask.earned).toBe(true)
    expect(tenTasks.earned).toBe(true)
    expect(panic5.earned).toBe(false)
  })

  test('returns 12 badges total', async () => {
    const { getAllBadges } = await importWithFixtures({})
    const all = getAllBadges('user1')
    expect(all.length).toBe(12)
  })
})

describe('buildBadgeMessage', () => {
  test('shows locked state when no badges earned', async () => {
    const { buildBadgeMessage } = await importWithFixtures({})
    const msg = buildBadgeMessage('user1')
    expect(msg).toContain('เหรียญตราความสำเร็จ')
    expect(msg).toContain('ยังไม่มีเหรียญ')
  })

  test('shows earned badges when badges exist', async () => {
    const badgeData = { user1: ['PANIC_5', 'FIRST_TASK'] }
    const { buildBadgeMessage } = await importWithFixtures(badgeData)
    const msg = buildBadgeMessage('user1')
    expect(msg).toContain('ปลดล็อกแล้ว')
    expect(msg).toContain('ก้าวแรก')
    expect(msg).toContain('5 ครั้ง')
    expect(msg).toContain('ยังไม่ได้ปลดล็อก')
  })

  test('shows correct count of earned vs total', async () => {
    const badgeData = { user1: ['FIRST_TASK'] }
    const { buildBadgeMessage } = await importWithFixtures(badgeData)
    const msg = buildBadgeMessage('user1')
    expect(msg).toContain('1/12')
  })

  test('shows locked badges section even when some earned', async () => {
    const badgeData = { user1: ['FIRST_TASK'] }
    const { buildBadgeMessage } = await importWithFixtures(badgeData)
    const msg = buildBadgeMessage('user1')
    expect(msg).toContain('ยังไม่ได้ปลดล็อก')
  })
})

describe('getBadgeById', () => {
  test('returns badge object for valid id', async () => {
    const { getBadgeById } = await importWithFixtures({})
    const badge = getBadgeById('FIRST_TASK')
    expect(badge).not.toBeNull()
    expect(badge.id).toBe('FIRST_TASK')
    expect(badge.icon).toBe('🎯')
    expect(badge.name).toBe('ก้าวแรก')
  })

  test('returns null for invalid id', async () => {
    const { getBadgeById } = await importWithFixtures({})
    const badge = getBadgeById('NONEXISTENT')
    expect(badge).toBeNull()
  })

  test('returns null for removed streak milestone id', async () => {
    const { getBadgeById } = await importWithFixtures({})
    const badge = getBadgeById('STREAK_7')
    expect(badge).toBeNull()
  })

  test('returns null for empty string', async () => {
    const { getBadgeById } = await importWithFixtures({})
    expect(getBadgeById('')).toBeNull()
  })
})

describe('flushBadges', () => {
  test('resolves when no pending writes', async () => {
    const { flushBadges } = await importWithFixtures({})
    await expect(flushBadges()).resolves.toBeUndefined()
  })

  test('resolves after awardBadges triggers write', async () => {
    const { awardBadges, flushBadges } = await importWithFixtures({})
    awardBadges('user1', ['FIRST_TASK'])
    await expect(flushBadges()).resolves.toBeUndefined()
    const saved = JSON.parse(fs.readFileSync(BADGES_PATH, 'utf-8'))
    expect(saved.user1).toContain('FIRST_TASK')
  })
})

describe('badgeService persistent file', () => {
  test('loads existing badges from file on import', async () => {
    const badgeData = { user1: ['PANIC_5'], user2: ['FIRST_TASK', 'TEN_TASKS'] }
    fs.writeFileSync(BADGES_PATH, JSON.stringify(badgeData))
    jest.resetModules()
    const { getAllBadges } = await import('../src/services/badgeService.js')
    const user1Badges = getAllBadges('user1')
    const user2Badges = getAllBadges('user2')
    expect(user1Badges.find(b => b.id === 'PANIC_5').earned).toBe(true)
    expect(user2Badges.find(b => b.id === 'TEN_TASKS').earned).toBe(true)
  })

  test('starts fresh when file is missing', async () => {
    jest.resetModules()
    const { getAllBadges } = await import('../src/services/badgeService.js')
    const all = getAllBadges('user1')
    all.forEach(b => expect(b.earned).toBe(false))
  })

  test('starts fresh when file contains invalid JSON', async () => {
    fs.writeFileSync(BADGES_PATH, 'invalid json{{{')
    jest.resetModules()
    const { getAllBadges } = await import('../src/services/badgeService.js')
    const all = getAllBadges('user1')
    expect(all.length).toBeGreaterThanOrEqual(11)
  })

  test('starts fresh when file contains array instead of object', async () => {
    fs.writeFileSync(BADGES_PATH, JSON.stringify(['a', 'b']))
    jest.resetModules()
    const { getAllBadges } = await import('../src/services/badgeService.js')
    const all = getAllBadges('user1')
    all.forEach(b => expect(b.earned).toBe(false))
  })

  test('atomic write: temp file is removed after successful write', async () => {
    const { awardBadges, flushBadges } = await importWithFixtures({})
    awardBadges('user1', ['FIRST_TASK'])
    await flushBadges()
    const tmpPath = BADGES_PATH + '.tmp'
    expect(fs.existsSync(tmpPath)).toBe(false)
    expect(fs.existsSync(BADGES_PATH)).toBe(true)
  })
})

describe('getBadgeCount', () => {
  test('returns 0 for user with no badges', async () => {
    const { getBadgeCount } = await importWithFixtures({})
    expect(getBadgeCount('user1')).toBe(0)
  })

  test('returns correct count for user with badges', async () => {
    const badgeData = { user1: ['FIRST_TASK', 'HINT_10', 'EXPORT_3'] }
    const { getBadgeCount } = await importWithFixtures(badgeData)
    expect(getBadgeCount('user1')).toBe(3)
  })

  test('handles number userId', async () => {
    const badgeData = { '12345': ['PANIC_5'] }
    const { getBadgeCount } = await importWithFixtures(badgeData)
    expect(getBadgeCount(12345)).toBe(1)
  })
})

describe('getRarestBadge', () => {
  test('returns null for user with no badges', async () => {
    const { getRarestBadge } = await importWithFixtures({})
    expect(getRarestBadge('user1')).toBeNull()
  })

  test('returns the rarest badge by rarity level', async () => {
    const badgeData = { user1: ['FIRST_TASK', 'ZERO_OVERDUE_30', 'HINT_10'] }
    const { getRarestBadge } = await importWithFixtures(badgeData)
    const rarest = getRarestBadge('user1')
    expect(rarest).not.toBeNull()
    expect(rarest.id).toBe('ZERO_OVERDUE_30')
  })

  test('returns common badge when only common badges earned', async () => {
    const badgeData = { user1: ['FIRST_TASK', 'PANIC_5'] }
    const { getRarestBadge } = await importWithFixtures(badgeData)
    const rarest = getRarestBadge('user1')
    expect(rarest).not.toBeNull()
    expect(rarest.rarity.level).toBe(0)
  })
})

describe('buildBadgeGrid', () => {
  test('returns array of badge objects with all fields', async () => {
    const { buildBadgeGrid } = await importWithFixtures({})
    const grid = buildBadgeGrid('user1')
    expect(Array.isArray(grid)).toBe(true)
    expect(grid.length).toBe(12)
    for (const b of grid) {
      expect(b).toHaveProperty('id')
      expect(b).toHaveProperty('icon')
      expect(b).toHaveProperty('name')
      expect(b).toHaveProperty('desc')
      expect(b).toHaveProperty('rarity')
      expect(b).toHaveProperty('rarityEmoji')
      expect(b).toHaveProperty('earned')
    }
  })

  test('marks earned badges correctly in grid', async () => {
    const badgeData = { user1: ['PANIC_5'] }
    const { buildBadgeGrid } = await importWithFixtures(badgeData)
    const grid = buildBadgeGrid('user1')
    const panic5 = grid.find(b => b.id === 'PANIC_5')
    const firstTask = grid.find(b => b.id === 'FIRST_TASK')
    expect(panic5.earned).toBe(true)
    expect(firstTask.earned).toBe(false)
  })
})

describe('checkUsageBadge', () => {
  test('returns badge id when not yet earned', async () => {
    const { checkUsageBadge } = await importWithFixtures({})
    const result = checkUsageBadge('user1', 'HINT_10')
    expect(result).toEqual(['HINT_10'])
  })

  test('returns empty array when badge already earned', async () => {
    const badgeData = { user1: ['HINT_10'] }
    const { checkUsageBadge } = await importWithFixtures(badgeData)
    const result = checkUsageBadge('user1', 'HINT_10')
    expect(result).toEqual([])
  })

  test('returns badge id for different unearned badges', async () => {
    const badgeData = { user1: ['HINT_10'] }
    const { checkUsageBadge } = await importWithFixtures(badgeData)
    expect(checkUsageBadge('user1', 'PANIC_5')).toEqual(['PANIC_5'])
    expect(checkUsageBadge('user1', 'EXPORT_3')).toEqual(['EXPORT_3'])
  })
})

describe('checkZeroOverdue', () => {
  test('returns ZERO_OVERDUE_30 when overdueCount is 0 and not earned', async () => {
    const { checkZeroOverdue } = await importWithFixtures({})
    const result = checkZeroOverdue('user1', 0)
    expect(result).toEqual(['ZERO_OVERDUE_30'])
  })

  test('returns empty array when overdueCount > 0', async () => {
    const { checkZeroOverdue } = await importWithFixtures({})
    const result = checkZeroOverdue('user1', 1)
    expect(result).toEqual([])
  })

  test('returns empty array when already earned', async () => {
    const badgeData = { user1: ['ZERO_OVERDUE_30'] }
    const { checkZeroOverdue } = await importWithFixtures(badgeData)
    const result = checkZeroOverdue('user1', 0)
    expect(result).toEqual([])
  })
})
