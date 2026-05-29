import { jest } from '@jest/globals'

jest.unstable_mockModule('../src/services/cache.js', () => ({
  cacheGet: jest.fn(() => undefined),
  cacheSet: jest.fn(),
  cacheInvalidate: jest.fn(),
  cacheCleanup: jest.fn(),
}))

jest.unstable_mockModule('../src/utils/constants.js', () => ({
  STATUS: { TODO: 'Todo', IN_PROGRESS: 'In Progress', DONE: 'Done' },
  PRIORITY_DEFAULT: '🟡 กลาง',
  NOTION_PAGE_SIZE: 100,
  URGENT_DAYS: 3,
  PRIORITY: { HIGH: '🔴 สูง', MEDIUM: '🟡 กลาง', LOW: '🟢 ต่ำ' },
  PRIORITY_ORDER: ['🔴 สูง', '🟡 กลาง', '🟢 ต่ำ'],
  URGENT_DISPLAY_MAX: 5,
  SUBJECT_BAR_MAX: 6,
  SUBJECT_DISPLAY_MAX: 6,
  PROGRESS_BAR_SLOTS: 10,
  priorityWeight: jest.fn((p) => {
    const order = ['🔴 สูง', '🟡 กลาง', '🟢 ต่ำ']
    const idx = order.indexOf(p)
    return idx === -1 ? 1 : order.length - idx
  }),
  statusLabel: jest.fn((s) => s === 'Done' ? 'เสร็จแล้ว' : s === 'In Progress' ? 'กำลังทำ' : 'ยังไม่ทำ'),
}))

const mockQuery = jest.fn()
jest.unstable_mockModule('@notionhq/client', () => ({
  Client: jest.fn(() => ({
    databases: { query: mockQuery },
    pages: {
      create: jest.fn(),
      update: jest.fn(),
      retrieve: jest.fn(),
    },
  })),
}))

process.env.DATABASE_ID = 'test-db-id'
process.env.NOTION_TOKEN = 'test-token'

const { getHomeworkStats } = await import('../src/services/notionService.js')

function makePage({ id, status, due } = {}) {
  return {
    id: id || `page-${Math.random()}`,
    properties: {
      Name: { title: [{ plain_text: 'Test' }] },
      Status: { select: { name: status || 'Todo' } },
      Due: { date: { start: due || null } },
      Subject: { rich_text: [{ plain_text: 'คณิต' }] },
      Priority: { select: { name: '🟡 กลาง' } },
      Tags: { multi_select: [] },
      Completed: { date: { start: null } },
      EventId: { rich_text: [{ plain_text: '' }] },
    },
  }
}

function daysFromNow(n) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
})

describe('getHomeworkStats', () => {
  test('returns correct todo/prog/done counts', async () => {
    mockQuery
      .mockResolvedValueOnce({
        results: [
          makePage({ status: 'Todo', due: daysFromNow(10) }),
          makePage({ status: 'Todo', due: daysFromNow(5) }),
          makePage({ status: 'In Progress', due: daysFromNow(3) }),
        ],
        has_more: false,
      })
      .mockResolvedValueOnce({
        results: [makePage({ status: 'Done' }), makePage({ status: 'Done' })],
        has_more: false,
      })

    const stats = await getHomeworkStats()
    expect(stats.todo).toBe(2)
    expect(stats.prog).toBe(1)
    expect(stats.done).toBe(2)
    expect(stats.total).toBe(5)
    expect(stats.pct).toBe(40)
  })

  test('returns correct urgent and overdue counts', async () => {
    mockQuery
      .mockResolvedValueOnce({
        results: [
          makePage({ status: 'Todo', due: daysFromNow(-2) }),
          makePage({ status: 'Todo', due: daysFromNow(1) }),
          makePage({ status: 'Todo', due: daysFromNow(3) }),
          makePage({ status: 'Todo', due: daysFromNow(10) }),
        ],
        has_more: false,
      })
      .mockResolvedValueOnce({
        results: [],
        has_more: false,
      })

    const stats = await getHomeworkStats()
    expect(stats.overdue).toBe(1)
    expect(stats.urgent).toBe(2)
  })

  test('returns zeros for empty database', async () => {
    mockQuery
      .mockResolvedValueOnce({ results: [], has_more: false })
      .mockResolvedValueOnce({ results: [], has_more: false })

    const stats = await getHomeworkStats()
    expect(stats.todo).toBe(0)
    expect(stats.prog).toBe(0)
    expect(stats.done).toBe(0)
    expect(stats.total).toBe(0)
    expect(stats.pct).toBe(0)
    expect(stats.urgent).toBe(0)
    expect(stats.overdue).toBe(0)
  })

  test('handles pages with no due date', async () => {
    mockQuery
      .mockResolvedValueOnce({
        results: [
          makePage({ status: 'Todo', due: null }),
          makePage({ status: 'In Progress', due: null }),
        ],
        has_more: false,
      })
      .mockResolvedValueOnce({ results: [], has_more: false })

    const stats = await getHomeworkStats()
    expect(stats.todo).toBe(1)
    expect(stats.prog).toBe(1)
    expect(stats.urgent).toBe(0)
    expect(stats.overdue).toBe(0)
  })

  test('pct is 100 when all done', async () => {
    mockQuery
      .mockResolvedValueOnce({ results: [], has_more: false })
      .mockResolvedValueOnce({
        results: [makePage({}), makePage({})],
        has_more: false,
      })

    const stats = await getHomeworkStats()
    expect(stats.pct).toBe(100)
  })

  test('pct rounds correctly', async () => {
    mockQuery
      .mockResolvedValueOnce({
        results: [
          makePage({ status: 'Todo', due: daysFromNow(5) }),
          makePage({ status: 'Todo', due: daysFromNow(3) }),
          makePage({ status: 'Todo', due: daysFromNow(1) }),
        ],
        has_more: false,
      })
      .mockResolvedValueOnce({
        results: [makePage({})],
        has_more: false,
      })

    const stats = await getHomeworkStats()
    expect(stats.pct).toBe(25)
  })
})
