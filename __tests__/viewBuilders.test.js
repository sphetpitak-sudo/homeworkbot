import { buildPanic, buildTomorrow, buildWeek, buildDeadline, buildProgress } from '../src/handlers/viewBuilders.js'
import { STATUS, PRIORITY } from '../src/utils/constants.js'

function makePage({ title, status, due, subject, priority, id } = {}) {
  return {
    id: id || 'page_' + Math.random().toString(36).slice(2),
    properties: {
      Name: { title: [{ plain_text: title || 'Test' }] },
      Status: { select: { name: status || STATUS.TODO } },
      Due: { date: { start: due || null } },
      Subject: { rich_text: [{ plain_text: subject || 'Math' }] },
      Priority: { select: { name: priority || PRIORITY.MEDIUM } },
      Tags: { multi_select: [] },
      Completed: { date: { start: null } },
      EventId: { rich_text: [{ plain_text: '' }] },
    },
  }
}

function getDateStr(offset) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

describe('buildPanic', () => {
  test('returns top N urgent items', () => {
    const pages = [
      makePage({ title: 'Task1', due: getDateStr(1), priority: PRIORITY.HIGH }),
      makePage({ title: 'Task2', due: getDateStr(2), priority: PRIORITY.HIGH }),
      makePage({ title: 'Task3', due: getDateStr(3), priority: PRIORITY.MEDIUM }),
      makePage({ title: 'Task4', due: getDateStr(10), priority: PRIORITY.LOW }),
    ]
    const result = buildPanic(pages, 3)
    expect(result.msg).toContain('Task1')
    expect(result.msg).toContain('Task2')
    expect(result.msg).toContain('Task3')
    expect(result.msg).not.toContain('Task4')
    expect(result.keyboard.length).toBeGreaterThan(1)
  })

  test('handles empty list', () => {
    const result = buildPanic([], 3)
    expect(result.msg).toContain('Emergency')
    expect(result.keyboard).toBeDefined()
  })

  test('handles overdue items', () => {
    const pages = [makePage({ title: 'Overdue', due: getDateStr(-1), priority: PRIORITY.HIGH })]
    const result = buildPanic(pages, 3)
    expect(result.msg).toContain('Overdue')
    expect(result.msg).toMatch(/overdue|🚨/i)
  })
})

describe('buildTomorrow', () => {
  test('lists items due tomorrow', () => {
    const pages = [makePage({ title: 'TomorrowTask', due: getDateStr(1) })]
    const result = buildTomorrow(pages)
    expect(result.msg).toContain('TomorrowTask')
    expect(result.keyboard).toBeDefined()
  })

  test('handles empty list', () => {
    const result = buildTomorrow([])
    expect(result.msg).toContain('0')
  })

  test('includes status emoji for each item', () => {
    const pages = [
      makePage({ title: 'Active', due: getDateStr(1), status: STATUS.TODO }),
      makePage({ title: 'Prog', due: getDateStr(1), status: STATUS.IN_PROGRESS }),
    ]
    const result = buildTomorrow(pages)
    expect(result.msg).toContain('📌')
    expect(result.msg).toContain('🔄')
  })

  test('renders due badge for items due today', () => {
    const pages = [makePage({ title: 'Today', due: getDateStr(0) })]
    const result = buildTomorrow(pages)
    expect(result.msg).toContain('Today')
  })
})

describe('buildDeadline', () => {
  test('returns null for empty list', () => {
    const result = buildDeadline([])
    expect(result).toBeNull()
  })

  test('returns closest deadline item', () => {
    const pages = [
      makePage({ title: 'Far', due: getDateStr(10), priority: PRIORITY.LOW }),
      makePage({ title: 'Soon', due: getDateStr(2), priority: PRIORITY.HIGH }),
    ]
    const result = buildDeadline(pages)
    expect(result).not.toBeNull()
    expect(result.msg).toContain('Soon')
    expect(result.pageId).toBeDefined()
  })

  test('handles overdue items as closest', () => {
    const pages = [makePage({ title: 'Overdue', due: getDateStr(-2), priority: PRIORITY.HIGH })]
    const result = buildDeadline(pages)
    expect(result).not.toBeNull()
    expect(result.msg).toContain('Overdue')
    expect(result.msg).toMatch(/overdue|🚨/i)
  })

  test('includes urgency bar in output', () => {
    const pages = [makePage({ title: 'Urgent', due: getDateStr(1), priority: PRIORITY.HIGH })]
    const result = buildDeadline(pages)
    expect(result.msg).toContain('░')
    expect(result.msg).toContain('█')
  })
})

describe('buildProgress', () => {
  test('returns null for empty input', () => {
    const result = buildProgress([], [])
    expect(result).toBeNull()
  })

  test('shows progress for active items only', () => {
    const active = [
      makePage({ title: 'Task1', subject: 'Math' }),
      makePage({ title: 'Task2', subject: 'Math' }),
      makePage({ title: 'Task3', subject: 'English' }),
    ]
    const result = buildProgress(active, [])
    expect(result).not.toBeNull()
    expect(result.msg).toContain('Math')
    expect(result.msg).toContain('English')
    expect(result.keyboard).toBeDefined()
  })

  test('shows 100% for completed subject', () => {
    const active = []
    const done = [
      makePage({ title: 'Done1', subject: 'Math' }),
      makePage({ title: 'Done2', subject: 'Math' }),
    ]
    const result = buildProgress(active, done)
    expect(result).not.toBeNull()
    expect(result.msg).toContain('🎉')
  })

  test('calculates mixed progress correctly', () => {
    const active = [makePage({ title: 'Active1', subject: 'Math' })]
    const done = [makePage({ title: 'Done1', subject: 'Math' })]
    const result = buildProgress(active, done)
    expect(result).not.toBeNull()
    expect(result.msg).toContain('50%')
  })
})

describe('buildWeek', () => {
  test('returns week structure for empty input', () => {
    const result = buildWeek([])
    expect(result.msg).toContain('Week')
    expect(result.totalCount).toBe(0)
    expect(result.hasAny).toBe(false)
  })

  test('shows items grouped by day', () => {
    const pages = [makePage({ title: 'DueToday', due: getDateStr(0) })]
    const result = buildWeek(pages)
    expect(result.totalCount).toBe(1)
    expect(result.hasAny).toBe(true)
  })

  test('handles items with no due date', () => {
    const pages = [makePage({ title: 'NoDue', due: null })]
    const result = buildWeek(pages)
    expect(result.msg).toContain('NoDue')
    expect(result.msg).toContain('no due')
  })
})
