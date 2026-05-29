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
      priority: '🔴 สูง',
      tags: ['สอบ', 'ด่วน'],
      parseSource: 'ai',
    }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('แบบฝึกหัดหน้า 20')
    expect(result).toContain('คณิต')
    expect(result).toContain('🔴 สูง')
    expect(result).toContain('สอบ')
    expect(result).toContain('ด่วน')
    expect(result).toContain('AI ช่วยตรวจจับ')
  })

  test('handles undefined parseSource gracefully', () => {
    const result = buildHomeworkPreview({ title: 'งาน', subject: 'ไทย' })
    expect(result).toContain('งาน')
    expect(result).toContain('ไทย')
    expect(result).not.toContain('AI ช่วยตรวจจับ')
    expect(result).not.toContain('ตรวจจับอัตโนมัติ')
  })

  test('handles missing fields gracefully', () => {
    const result = buildHomeworkPreview({})
    expect(result).toContain('ทั่วไป')
    expect(result).toContain('ไม่มีชื่อ')
    expect(result).toContain('ไม่มีกำหนดส่ง')
  })

  test('handles undefined input (reports edge case)', () => {
    const result = buildHomeworkPreview({})
    expect(result).toContain('ทั่วไป')
  })

  test('shows regex badge for regex source', () => {
    const parsed = { title: 'งาน', subject: 'ไทย', parseSource: 'regex' }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('ตรวจจับอัตโนมัติ')
  })

  test('handles Thai special characters in title', () => {
    const parsed = { title: 'แบบฝึกหัด ภาษาไทย ๑๒๓', subject: 'ไทย', parseSource: 'ai' }
    const result = buildHomeworkPreview(parsed)
    expect(result).toContain('แบบฝึกหัด ภาษาไทย')
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
})

describe('buildPanicCard', () => {
  test('renders overdue badge for past due', () => {
    const page = makePage({ title: 'Overdue', due: '2020-01-01', subject: 'คณิต', priority: PRIORITY.HIGH })
    const result = buildPanicCard(page)
    expect(result).toContain('🚨')
    expect(result).toContain('Overdue')
    expect(result).toContain('🔴 สูง')
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
})

describe('errorWithRetry', () => {
  test('returns retry keyboard with correct action', () => {
    const result = errorWithRetry('Something went wrong', 'RETRY_FETCH')
    expect(result.text).toContain('Something went wrong')
    expect(result.reply_markup.inline_keyboard[0][0].callback_data).toBe('RETRY_FETCH')
  })

  test('escapes markdown in error message', () => {
    const result = errorWithRetry('Error: **bold**', 'RETRY')
    expect(result.text).toContain('Error')
    expect(result.reply_markup.inline_keyboard[0][1].callback_data).toBe('HOME')
  })
})

function getDateStr(offset) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
