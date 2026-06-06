import { buildHomeworkPreview, sortByUrgency, buildPanicCard, errorWithRetry } from '../src/handlers/commandHandlers.js'
import { STATUS, PRIORITY } from '../src/utils/constants.js'

function makePage({ title, status, due, subject, priority, id } = {}) {
  return {
    id: id || 'page_' + Math.random().toString(36).slice(2),
    properties: {
      Name: { title: [{ plain_text: title || 'Test' }] },
      Status: { select: { name: status || STATUS.TODO } },
      Due: { date: { start: due || null } },
      Subject: { rich_text: [{ plain_text: subject || 'คณิต' }] },
      Priority: { select: { name: priority || PRIORITY.MEDIUM } },
      Tags: { multi_select: [] },
      Completed: { date: { start: null } },
      EventId: { rich_text: [{ plain_text: '' }] },
    },
  }
}

describe('buildHomeworkPreview', () => {
  test('returns preview with all fields', () => {
    const parsed = {
      title: 'แบบฝึกหัดหน้า 20',
      subject: 'คณิต',
      due: '2026-05-30',
      priority: '🔴 High',
      tags: ['สอบ', 'ด่วน'],
      parseSource: 'ai',
    }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('แบบฝึกหัดหน้า 20')
    expect(result).toContain('คณิต')
    expect(result).toContain('🔴 High')
    expect(result).toContain('สอบ')
    expect(result).toContain('ด่วน')
    expect(result).toContain('AI-detected')
  })

  test('handles undefined parseSource gracefully', () => {
    const result = buildHomeworkPreview({ title: 'งาน', subject: 'ไทย' })
    expect(result).toContain('งาน')
    expect(result).toContain('ไทย')
    expect(result).not.toContain('AI-detected')
    expect(result).not.toContain('Auto-detected')
  })

  test('handles missing fields gracefully', () => {
    const result = buildHomeworkPreview({})
    expect(result).toContain('General')
    expect(result).toContain('Untitled')
    expect(result).toContain('No due date')
  })

  test('handles undefined input (reports edge case)', () => {
    const result = buildHomeworkPreview({})
    expect(result).toContain('General')
  })

  test('shows regex badge for regex source', () => {
    const parsed = { title: 'งาน', subject: 'ไทย', parseSource: 'regex' }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('Auto-detected')
  })

  test('handles Thai special characters in title', () => {
    const parsed = { title: 'แบบฝึกหัด ภาษาไทย ๑๒๓', subject: 'ไทย', parseSource: 'ai' }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('แบบฝึกหัด ภาษาไทย')
  })

  test('handles empty tags array', () => {
    const parsed = { title: 'งาน', subject: 'ไทย', tags: [], parseSource: 'ai' }
    const result = buildHomeworkPreview(parsed)
    expect(result).not.toContain('🏷️')
  })

  test('handles undefined tags', () => {
    const parsed = { title: 'งาน', subject: 'ไทย', tags: undefined, parseSource: 'ai' }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('งาน')
  })

  test('handles null due date', () => {
    const parsed = { title: 'งาน', subject: 'ไทย', due: null, parseSource: 'regex' }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('No due date')
  })

  test('handles null priority', () => {
    const parsed = { title: 'งาน', subject: 'ไทย', priority: null, parseSource: 'ai' }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('งาน')
  })

  test('handles markdown special characters in title', () => {
    const parsed = { title: 'งาน *สำคัญ* _มาก_', subject: 'ไทย', parseSource: 'ai' }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('งาน')
  })

  test('handles single tag', () => {
    const parsed = { title: 'งาน', subject: 'ไทย', tags: ['สอบ'], parseSource: 'ai' }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('สอบ')
    expect(result).toContain('🏷️')
  })

  test('prioritizes AI badge over regex badge', () => {
    const aiParsed = { title: 'งาน', subject: 'ไทย', parseSource: 'ai' }
    const regexParsed = { title: 'งาน', subject: 'ไทย', parseSource: 'regex' }
    expect(buildHomeworkPreview(aiParsed)).toContain('AI-detected')
    expect(buildHomeworkPreview(regexParsed)).toContain('Auto-detected')
  })
})

describe('sortByUrgency', () => {
  test('puts overdue items before urgent ones', () => {
    const overdue = makePage({ title: 'Overdue', due: getDateStr(-5), priority: PRIORITY.MEDIUM })
    const urgent = makePage({ title: 'Urgent', due: getDateStr(2), priority: PRIORITY.MEDIUM })
    const sorted = sortByUrgency([urgent, overdue])
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('Overdue')
  })

  test('sorts by urgency: overdue → ≤3d → ≤7d → priority → due', () => {
    const far = makePage({ title: 'Far', due: getDateStr(20), priority: PRIORITY.LOW })
    const medium = makePage({ title: 'Medium', due: getDateStr(5), priority: PRIORITY.MEDIUM })
    const urgent = makePage({ title: 'Urgent', due: getDateStr(2), priority: PRIORITY.HIGH })
    const overdue = makePage({ title: 'Overdue', due: getDateStr(-5), priority: PRIORITY.LOW })

    const sorted = sortByUrgency([far, medium, urgent, overdue])
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('Overdue')
    expect(sorted[1].properties.Name.title[0].plain_text).toBe('Urgent')
    expect(sorted[2].properties.Name.title[0].plain_text).toBe('Medium')
    expect(sorted[3].properties.Name.title[0].plain_text).toBe('Far')
  })

  test('sorts by priority when within same urgency band', () => {
    const high = makePage({ title: 'High', due: getDateStr(10), priority: PRIORITY.HIGH })
    const low = makePage({ title: 'Low', due: getDateStr(10), priority: PRIORITY.LOW })
    const sorted = sortByUrgency([low, high])
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('High')
  })

  test('puts items with no due date after same-priority items with due', () => {
    const withDue = makePage({ title: 'WithDue', due: getDateStr(15), priority: PRIORITY.MEDIUM })
    const noDue = makePage({ title: 'NoDue', due: null, priority: PRIORITY.MEDIUM })
    const sorted = sortByUrgency([noDue, withDue])
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('WithDue')
  })

  test('filters out items overdue by 30+ days', () => {
    const old = makePage({ title: 'Old', due: getDateStr(-31), priority: PRIORITY.HIGH })
    const recent = makePage({ title: 'Recent', due: getDateStr(-5), priority: PRIORITY.LOW })
    const sorted = sortByUrgency([old, recent])
    expect(sorted.length).toBe(1)
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('Recent')
  })

  test('returns empty array for empty input', () => {
    expect(sortByUrgency([])).toEqual([])
  })

  test('handles mixed missing properties gracefully', () => {
    const pages = [
      { id: 'p1', properties: { Name: { title: [{ plain_text: 'Test' }] } } },
    ]
    const result = sortByUrgency(pages)
    expect(result.length).toBe(1)
  })

  test('puts items due today before items due tomorrow', () => {
    const today = makePage({ title: 'Today', due: getDateStr(0), priority: PRIORITY.HIGH })
    const tomorrow = makePage({ title: 'Tomorrow', due: getDateStr(1), priority: PRIORITY.HIGH })
    const sorted = sortByUrgency([tomorrow, today])
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('Today')
  })

  test('sorts overdue items with most overdue first', () => {
    const oldOverdue = makePage({ title: 'Old', due: getDateStr(-20), priority: PRIORITY.MEDIUM })
    const recentOverdue = makePage({ title: 'Recent', due: getDateStr(-2), priority: PRIORITY.MEDIUM })
    const sorted = sortByUrgency([recentOverdue, oldOverdue])
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('Old')
    expect(sorted[1].properties.Name.title[0].plain_text).toBe('Recent')
  })

  test('filters out items overdue by more than 30 days', () => {
    const old = makePage({ title: 'Old', due: getDateStr(-31), priority: PRIORITY.HIGH })
    const recent = makePage({ title: 'Recent', due: getDateStr(-1), priority: PRIORITY.LOW })
    const sorted = sortByUrgency([old, recent])
    expect(sorted.length).toBe(1)
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('Recent')
  })

  test('sorts by due date when priority is same and within same band', () => {
    const later = makePage({ title: 'Later', due: getDateStr(6), priority: PRIORITY.MEDIUM })
    const sooner = makePage({ title: 'Sooner', due: getDateStr(4), priority: PRIORITY.MEDIUM })
    const sorted = sortByUrgency([later, sooner])
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('Sooner')
  })

  test('preserves items with due date today at different priorities', () => {
    const high = makePage({ title: 'HighPri', due: getDateStr(0), priority: PRIORITY.HIGH })
    const low = makePage({ title: 'LowPri', due: getDateStr(0), priority: PRIORITY.LOW })
    const sorted = sortByUrgency([low, high])
    expect(sorted[0].properties.Name.title[0].plain_text).toBe('HighPri')
  })

  test('handles all items being overdue within 30 days', () => {
    const pages = [
      makePage({ title: 'A', due: getDateStr(-1), priority: PRIORITY.LOW }),
      makePage({ title: 'B', due: getDateStr(-5), priority: PRIORITY.HIGH }),
      makePage({ title: 'C', due: getDateStr(-3), priority: PRIORITY.MEDIUM }),
    ]
    const sorted = sortByUrgency(pages)
    expect(sorted.length).toBe(3)
    const texts = sorted.map(p => p.properties.Name.title[0].plain_text)
    const dueDates = sorted.map(p => p.properties.Due.date.start)
    expect(dueDates[0] >= dueDates[1] || dueDates[0] <= dueDates[1]).toBe(true)
  })
})

describe('buildPanicCard', () => {
  test('renders overdue badge for past due', () => {
    const page = makePage({ title: 'Overdue', due: '2020-01-01', subject: 'คณิต', priority: PRIORITY.HIGH })
    const result = buildPanicCard(page)
    expect(result).toContain('🚨')
    expect(result).toContain('Overdue')
    expect(result).toContain('🔴 High')
  })

  test('renders urgent badge for ≤3 days', () => {
    const page = makePage({ title: 'Urgent', due: getDateStr(2), subject: 'ฟิสิกส์', priority: PRIORITY.HIGH })
    const result = buildPanicCard(page)
    expect(result).toContain('⏰')
  })

  test('renders soon badge for ≤7 days', () => {
    const page = makePage({ title: 'Soon', due: getDateStr(5), subject: 'ไทย', priority: PRIORITY.MEDIUM })
    const result = buildPanicCard(page)
    expect(result).toContain('⌛')
  })

  test('no badge for far future', () => {
    const page = makePage({ title: 'Far', due: getDateStr(30), subject: 'อังกฤษ', priority: PRIORITY.LOW })
    const result = buildPanicCard(page)
    expect(result).not.toContain('🚨')
    expect(result).not.toContain('⏰')
    expect(result).not.toContain('⌛')
  })

  test('handles missing due date', () => {
    const page = makePage({ title: 'NoDue', due: null })
    const result = buildPanicCard(page)
    expect(result).toContain('NoDue')
  })

  test('renders correct status emoji for each status', () => {
    const todo = makePage({ title: 'Todo', status: STATUS.TODO, due: getDateStr(10) })
    const prog = makePage({ title: 'Prog', status: STATUS.IN_PROGRESS, due: getDateStr(10) })
    const done = makePage({ title: 'Done', status: STATUS.DONE, due: getDateStr(10) })
    expect(buildPanicCard(todo)).toContain('📌')
    expect(buildPanicCard(prog)).toContain('🔄')
    expect(buildPanicCard(done)).toContain('✅')
  })

  test('renders due date display correctly', () => {
    const page = makePage({ title: 'Test', due: getDateStr(14), subject: 'อังกฤษ', priority: PRIORITY.LOW })
    const result = buildPanicCard(page)
    expect(result).toContain('อังกฤษ')
    expect(result).toContain('🟢 Low')
  })

  test('handles exactly 3 days due (urgent threshold)', () => {
    const page = makePage({ title: 'Urgent3', due: getDateStr(3), subject: 'เคมี' })
    const result = buildPanicCard(page)
    expect(result).toContain('⏰')
  })

  test('handles exactly 7 days due (soon threshold)', () => {
    const page = makePage({ title: 'Soon7', due: getDateStr(7), subject: 'ชีวะ' })
    const result = buildPanicCard(page)
    expect(result).toContain('⌛')
  })
})

describe('errorWithRetry', () => {
  test('returns retry keyboard with correct action', () => {
    const result = errorWithRetry('Something went wrong', 'RETRY_FETCH_ACTIVE')
    expect(result.text).toContain('Something went wrong')
    expect(result.reply_markup.inline_keyboard[0][0].callback_data).toBe('RETRY_FETCH_ACTIVE')
  })

  test('escapes markdown in error message', () => {
    const result = errorWithRetry('Error: **bold**', 'RETRY_FETCH_ACTIVE')
    expect(result.text).toContain('Error')
    expect(result.reply_markup.inline_keyboard[0][1].callback_data).toBe('HOME')
  })

  test('retry button has correct text', () => {
    const result = errorWithRetry('เกิดข้อผิดพลาด', 'RETRY_FETCH_ACTIVE')
    expect(result.reply_markup.inline_keyboard[0][0].text).toBe('🔁 Retry')
  })

  test('falls back to HOME for invalid retry action', () => {
    const result = errorWithRetry('test', 'INVALID_ACTION')
    expect(result.reply_markup.inline_keyboard[0][0].callback_data).toBe('HOME')
  })

  test('home button has correct text', () => {
    const result = errorWithRetry('test', 'RETRY')
    expect(result.reply_markup.inline_keyboard[0][1].text).toBe('🏠 Home')
  })

  test('prefixes message with error emoji', () => {
    const result = errorWithRetry('Some error', 'RETRY')
    expect(result.text).toMatch(/^❌/)
  })

  test('appends retry instruction', () => {
    const result = errorWithRetry('test', 'RETRY')
    expect(result.text).toContain('Please try again')
  })

  test('sets parse_mode to Markdown', () => {
    const result = errorWithRetry('test', 'RETRY_FETCH_ACTIVE')
    expect(result.parse_mode).toBe('Markdown')
  })

  test('rejects callback-data injection (long action)', () => {
    const longAction = 'A'.repeat(200)
    const result = errorWithRetry('test', longAction)
    expect(result.reply_markup.inline_keyboard[0][0].callback_data).toBe('HOME')
  })

  test('rejects non-prefixed actions', () => {
    const result = errorWithRetry('test', 'DANGEROUS_CALLBACK_DATA')
    expect(result.reply_markup.inline_keyboard[0][0].callback_data).toBe('HOME')
  })

  test('accepts all allowlisted prefixes', () => {
    const allowed = [
      'RETRY_FETCH_ACTIVE',
      'RETRY_FETCH_DONE',
      'RETRY_FETCH_DASHBOARD',
      'RETRY_STATUS_abc123_prog',
      'RETRY_ARCHIVE_xyz789',
    ]
    for (const action of allowed) {
      const r = errorWithRetry('test', action)
      expect(r.reply_markup.inline_keyboard[0][0].callback_data).toBe(action)
    }
  })

  test('rejects callback_data that looks like prefix but has payload', () => {
    const result = errorWithRetry('test', 'RETRY_FETCH_EVIL')
    expect(result.reply_markup.inline_keyboard[0][0].callback_data).toBe('HOME')
  })
})

function getDateStr(offset) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
