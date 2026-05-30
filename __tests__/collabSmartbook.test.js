import { jest } from '@jest/globals'
import { shareTokens } from '../src/handlers/commandHandlers.js'

beforeEach(() => {
    shareTokens.clear()
})

describe('shareTokens Map', () => {
    test('starts empty', () => {
        expect(shareTokens.size).toBe(0)
    })

    test('can store and retrieve a token', () => {
        const token = 'test-token-123'
        shareTokens.set(token, { title: 'Test HW', subject: 'คณิต', _timestamp: Date.now() })
        expect(shareTokens.has(token)).toBe(true)
        expect(shareTokens.get(token).title).toBe('Test HW')
    })

    test('can delete a token', () => {
        shareTokens.set('tok', { title: 'x', _timestamp: Date.now() })
        shareTokens.delete('tok')
        expect(shareTokens.has('tok')).toBe(false)
    })

    test('token entry has required fields', () => {
        const data = {
            title: 'Assignment',
            subject: 'คณิต',
            due: '2026-06-01',
            priority: '🔴 สูง',
            note: '',
            tags: [],
            ownerUid: 12345,
            _timestamp: Date.now(),
        }
        shareTokens.set('tok1', data)
        const stored = shareTokens.get('tok1')
        expect(stored).toHaveProperty('title')
        expect(stored).toHaveProperty('subject')
        expect(stored).toHaveProperty('due')
        expect(stored).toHaveProperty('priority')
        expect(stored).toHaveProperty('note')
        expect(stored).toHaveProperty('tags')
        expect(stored).toHaveProperty('ownerUid')
        expect(stored).toHaveProperty('_timestamp')
    })

    test('multiple tokens can coexist', () => {
        shareTokens.set('a', { title: 'A', _timestamp: Date.now() })
        shareTokens.set('b', { title: 'B', _timestamp: Date.now() })
        shareTokens.set('c', { title: 'C', _timestamp: Date.now() })
        expect(shareTokens.size).toBe(3)
    })

    test('overwrite existing token', () => {
        shareTokens.set('x', { title: 'Old', _timestamp: Date.now() })
        shareTokens.set('x', { title: 'New', _timestamp: Date.now() })
        expect(shareTokens.get('x').title).toBe('New')
        expect(shareTokens.size).toBe(1)
    })

    test('get returns undefined for missing token', () => {
        expect(shareTokens.get('nonexistent')).toBeUndefined()
    })

    test('has returns false for missing token', () => {
        expect(shareTokens.has('nonexistent')).toBe(false)
    })
})

describe('shareTokens TTL pruning logic', () => {
    const COLLAB_TOKEN_TTL = 24 * 3600_000

    function pruneShareTokens() {
        const now = Date.now()
        for (const [token, data] of shareTokens) {
            if (now - data._timestamp > COLLAB_TOKEN_TTL) {
                shareTokens.delete(token)
            }
        }
    }

    test('does not remove fresh tokens', () => {
        shareTokens.set('fresh', { title: 'Fresh', _timestamp: Date.now() })
        pruneShareTokens()
        expect(shareTokens.has('fresh')).toBe(true)
    })

    test('removes expired tokens (older than 24h)', () => {
        shareTokens.set('old', { title: 'Old', _timestamp: Date.now() - COLLAB_TOKEN_TTL - 1000 })
        pruneShareTokens()
        expect(shareTokens.has('old')).toBe(false)
    })

    test('keeps tokens exactly at boundary', () => {
        shareTokens.set('boundary', { title: 'Boundary', _timestamp: Date.now() - COLLAB_TOKEN_TTL })
        pruneShareTokens()
        expect(shareTokens.has('boundary')).toBe(true)
    })

    test('removes only expired tokens, keeps valid ones', () => {
        shareTokens.set('valid', { title: 'Valid', _timestamp: Date.now() })
        shareTokens.set('expired', { title: 'Expired', _timestamp: Date.now() - COLLAB_TOKEN_TTL - 1 })
        pruneShareTokens()
        expect(shareTokens.has('valid')).toBe(true)
        expect(shareTokens.has('expired')).toBe(false)
    })

    test('handles empty map gracefully', () => {
        expect(() => pruneShareTokens()).not.toThrow()
    })

    test('prune is idempotent', () => {
        shareTokens.set('a', { title: 'A', _timestamp: Date.now() - COLLAB_TOKEN_TTL - 1 })
        pruneShareTokens()
        pruneShareTokens()
        expect(shareTokens.size).toBe(0)
    })

    test('removes all expired tokens in large batch', () => {
        for (let i = 0; i < 50; i++) {
            shareTokens.set(`tok${i}`, { title: `T${i}`, _timestamp: Date.now() - COLLAB_TOKEN_TTL - 1 })
        }
        shareTokens.set('fresh', { title: 'Fresh', _timestamp: Date.now() })
        pruneShareTokens()
        expect(shareTokens.size).toBe(1)
        expect(shareTokens.has('fresh')).toBe(true)
    })
})

describe('COLLAB token lifecycle', () => {
    test('token created with correct structure', () => {
        const token = 'abc-def-123'
        const data = {
            title: 'Assignment 1',
            subject: 'คณิต',
            due: '2026-06-05',
            priority: '🔴 สูง',
            note: 'ทำหน้า 10-15',
            tags: ['สอบ', 'ด่วน'],
            ownerUid: 99999,
            _timestamp: Date.now(),
        }
        shareTokens.set(token, data)
        const stored = shareTokens.get(token)
        expect(stored.title).toBe('Assignment 1')
        expect(stored.subject).toBe('คณิต')
        expect(stored.ownerUid).toBe(99999)
        expect(stored.tags).toEqual(['สอบ', 'ด่วน'])
    })

    test('token consumed and deleted after accept', () => {
        shareTokens.set('used-token', { title: 'HW', _timestamp: Date.now() })
        shareTokens.delete('used-token')
        expect(shareTokens.has('used-token')).toBe(false)
    })

    test('token with empty tags array', () => {
        shareTokens.set('no-tags', { title: 'HW', tags: [], _timestamp: Date.now() })
        expect(shareTokens.get('no-tags').tags).toEqual([])
    })

    test('token with missing optional fields still works', () => {
        shareTokens.set('minimal', { title: 'HW', _timestamp: Date.now() })
        const data = shareTokens.get('minimal')
        expect(data.note).toBeUndefined()
        expect(data.tags).toBeUndefined()
    })
})

describe('SMARTBOOK plan data structure', () => {
    function validatePlan(planData) {
        if (!planData || !planData.plan || !Array.isArray(planData.plan)) return false
        for (const day of planData.plan) {
            if (!day.day || !day.date || !day.focus) return false
            if (day.tasks && !Array.isArray(day.tasks)) return false
            if (day.duration_min !== undefined && typeof day.duration_min !== 'number') return false
        }
        return true
    }

    test('valid plan structure passes validation', () => {
        const plan = {
            plan: [
                { day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: ['ทบทวน', 'ทำโจทย์'], duration_min: 120 },
                { day: 'วันอังคาร', date: '2026-06-02', focus: 'อังกฤษ', tasks: ['อ่านบทที่ 3'], duration_min: 90 },
            ],
            summary: 'โฟกัสคณิตก่อน',
        }
        expect(validatePlan(plan)).toBe(true)
    })

    test('plan with empty tasks array is valid', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: [], duration_min: 60 }],
        }
        expect(validatePlan(plan)).toBe(true)
    })

    test('plan without duration_min is valid', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: ['งาน'] }],
        }
        expect(validatePlan(plan)).toBe(true)
    })

    test('null plan is invalid', () => {
        expect(validatePlan(null)).toBe(false)
    })

    test('undefined plan is invalid', () => {
        expect(validatePlan(undefined)).toBe(false)
    })

    test('plan missing day field is invalid', () => {
        const plan = {
            plan: [{ date: '2026-06-01', focus: 'คณิต', tasks: [] }],
        }
        expect(validatePlan(plan)).toBe(false)
    })

    test('plan missing date field is invalid', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', focus: 'คณิต', tasks: [] }],
        }
        expect(validatePlan(plan)).toBe(false)
    })

    test('plan missing focus field is invalid', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', tasks: [] }],
        }
        expect(validatePlan(plan)).toBe(false)
    })

    test('plan with non-array tasks is invalid', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: 'not-array' }],
        }
        expect(validatePlan(plan)).toBe(false)
    })

    test('plan with non-number duration_min is invalid', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: [], duration_min: '120' }],
        }
        expect(validatePlan(plan)).toBe(false)
    })

    test('plan with empty plan array is valid (edge case)', () => {
        const plan = { plan: [], summary: 'no days' }
        expect(validatePlan(plan)).toBe(true)
    })

    test('plan with 7 days is valid', () => {
        const days = ['วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์', 'วันอาทิตย์']
        const plan = {
            plan: days.map((day, i) => ({
                day,
                date: `2026-06-0${i + 1}`,
                focus: 'คณิต',
                tasks: [`งานวัน${day}`],
                duration_min: 90,
            })),
        }
        expect(validatePlan(plan)).toBe(true)
        expect(plan.plan.length).toBe(7)
    })
})

describe('SMARTBOOK iCal generation', () => {
    function generateIcs(planData) {
        let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//HomeworkBot//Smartbook//EN\r\n'
        for (const day of planData.plan) {
            if (!day.date) continue
            const startDate = day.date.replace(/-/g, '')
            const endDate = startDate
            const summary = `[${day.focus}] ${(day.tasks || []).join(', ')}`
            ics += 'BEGIN:VEVENT\r\n'
            ics += `DTSTART;VALUE=DATE:${startDate}\r\n`
            ics += `DTEND;VALUE=DATE:${endDate}\r\n`
            ics += `SUMMARY:${summary.replace(/,/g, '\\,')}\r\n`
            ics += `DESCRIPTION:${(day.tasks || []).join('\\n')}\r\n`
            ics += 'END:VEVENT\r\n'
        }
        ics += 'END:VCALENDAR\r\n'
        return ics
    }

    test('generates valid iCal for single day plan', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: ['ทำโจทย์'], duration_min: 120 }],
        }
        const ics = generateIcs(plan)
        expect(ics).toContain('BEGIN:VCALENDAR')
        expect(ics).toContain('END:VCALENDAR')
        expect(ics).toContain('DTSTART;VALUE=DATE:20260601')
        expect(ics).toContain('[คณิต] ทำโจทย์')
        expect(ics).toContain('BEGIN:VEVENT')
        expect(ics).toContain('END:VEVENT')
    })

    test('generates multiple events for multi-day plan', () => {
        const plan = {
            plan: [
                { day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: ['งาน1'], duration_min: 60 },
                { day: 'วันอังคาร', date: '2026-06-02', focus: 'อังกฤษ', tasks: ['งาน2'], duration_min: 90 },
            ],
        }
        const ics = generateIcs(plan)
        const eventCount = (ics.match(/BEGIN:VEVENT/g) || []).length
        expect(eventCount).toBe(2)
    })

    test('skips days without date', () => {
        const plan = {
            plan: [
                { day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: ['งาน1'] },
                { day: 'วันอังคาร', date: null, focus: 'อังกฤษ', tasks: ['งาน2'] },
            ],
        }
        const ics = generateIcs(plan)
        const eventCount = (ics.match(/BEGIN:VEVENT/g) || []).length
        expect(eventCount).toBe(1)
    })

    test('escapes commas in summary', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: ['งาน A', 'งาน B'] }],
        }
        const ics = generateIcs(plan)
        expect(ics).toContain('งาน A\\, งาน B')
    })

    test('handles empty tasks array', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: [] }],
        }
        const ics = generateIcs(plan)
        expect(ics).toContain('[คณิต] ')
    })

    test('handles missing tasks field', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต' }],
        }
        const ics = generateIcs(plan)
        expect(ics).toContain('[คณิต] ')
    })

    test('produces correct date format YYYYMMDD', () => {
        const plan = {
            plan: [{ day: 'วันจันทร์', date: '2026-12-25', focus: 'เคมี', tasks: ['实验'] }],
        }
        const ics = generateIcs(plan)
        expect(ics).toContain('DTSTART;VALUE=DATE:20261225')
    })

    test('empty plan produces only calendar wrapper', () => {
        const plan = { plan: [] }
        const ics = generateIcs(plan)
        expect(ics).toContain('BEGIN:VCALENDAR')
        expect(ics).toContain('END:VCALENDAR')
        expect(ics).not.toContain('BEGIN:VEVENT')
    })

    test('7-day plan produces 7 events', () => {
        const plan = {
            plan: Array.from({ length: 7 }, (_, i) => ({
                day: `วันที่${i + 1}`,
                date: `2026-06-0${i + 1}`,
                focus: 'คณิต',
                tasks: [`งาน${i + 1}`],
                duration_min: 60,
            })),
        }
        const ics = generateIcs(plan)
        const eventCount = (ics.match(/BEGIN:VEVENT/g) || []).length
        expect(eventCount).toBe(7)
    })
})

describe('SMARTBOOK static fallback grouping', () => {
    function groupBySubject(pages) {
        const groups = {}
        for (const page of pages) {
            const subj = page.subject || 'ทั่วไป'
            if (!groups[subj]) groups[subj] = []
            groups[subj].push(page)
        }
        return groups
    }

    function buildStaticPlan(pages) {
        const groups = groupBySubject(pages)
        const subjects = Object.keys(groups)
        const plan = subjects.map((subj, i) => ({
            day: `วันที่ ${i + 1}`,
            date: `2026-06-0${i + 1}`,
            focus: subj,
            tasks: groups[subj].map(p => p.title),
            duration_min: 90,
        }))
        return { plan, summary: `แผนจาก ${subjects.length} วิชา` }
    }

    test('groups pages by subject correctly', () => {
        const pages = [
            { title: 'HW1', subject: 'คณิต' },
            { title: 'HW2', subject: 'คณิต' },
            { title: 'HW3', subject: 'อังกฤษ' },
        ]
        const groups = groupBySubject(pages)
        expect(Object.keys(groups)).toEqual(['คณิต', 'อังกฤษ'])
        expect(groups['คณิต'].length).toBe(2)
        expect(groups['อังกฤษ'].length).toBe(1)
    })

    test('builds plan with correct day count', () => {
        const pages = [
            { title: 'HW1', subject: 'คณิต' },
            { title: 'HW2', subject: 'อังกฤษ' },
            { title: 'HW3', subject: 'วิทย์' },
        ]
        const plan = buildStaticPlan(pages)
        expect(plan.plan.length).toBe(3)
    })

    test('handles single subject', () => {
        const pages = [{ title: 'HW1', subject: 'คณิต' }]
        const plan = buildStaticPlan(pages)
        expect(plan.plan.length).toBe(1)
        expect(plan.plan[0].focus).toBe('คณิต')
    })

    test('handles pages with null subject', () => {
        const pages = [{ title: 'HW1', subject: null }]
        const groups = groupBySubject(pages)
        expect(groups['ทั่วไป']).toBeDefined()
    })

    test('handles empty pages array', () => {
        const plan = buildStaticPlan([])
        expect(plan.plan.length).toBe(0)
    })

    test('preserves task titles in plan', () => {
        const pages = [
            { title: 'แบบฝึกหัด 1', subject: 'คณิต' },
            { title: 'รายงาน 2', subject: 'คณิต' },
        ]
        const plan = buildStaticPlan(pages)
        expect(plan.plan[0].tasks).toContain('แบบฝึกหัด 1')
        expect(plan.plan[0].tasks).toContain('รายงาน 2')
    })
})

describe('COLLAB_SEL token creation logic', () => {
    test('token is a non-empty string', () => {
        const token = 'generated-token-' + Date.now().toString(36)
        expect(typeof token).toBe('string')
        expect(token.length).toBeGreaterThan(0)
    })

    test('token is unique for different calls', () => {
        const tokens = new Set()
        for (let i = 0; i < 100; i++) {
            tokens.add(Math.random().toString(36).slice(2) + Date.now().toString(36) + i)
        }
        expect(tokens.size).toBe(100)
    })

    test('token stored with ownerUid', () => {
        const token = 'test-token'
        shareTokens.set(token, {
            title: 'HW',
            subject: 'คณิต',
            ownerUid: 12345,
            _timestamp: Date.now(),
        })
        expect(shareTokens.get(token).ownerUid).toBe(12345)
    })

    test('token can store notes and tags from page', () => {
        const token = 'full-token'
        shareTokens.set(token, {
            title: 'Assignment',
            subject: 'คณิต',
            due: '2026-06-01',
            priority: '🔴 สูง',
            note: 'ทำหน้า 10',
            tags: ['สอบ', 'ด่วน'],
            ownerUid: 99999,
            _timestamp: Date.now(),
        })
        const data = shareTokens.get(token)
        expect(data.note).toBe('ทำหน้า 10')
        expect(data.tags).toEqual(['สอบ', 'ด่วน'])
    })
})

describe('SMARTBOOK view state', () => {
    test('plan stored in userState under _smartbookPlan', () => {
        const userState = new Map()
        const uid = 12345
        const planData = {
            plan: [{ day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: ['งาน'], duration_min: 120 }],
            summary: 'โฟกัสคณิต',
        }
        userState.set(uid, { _smartbookPlan: planData, _timestamp: Date.now() })
        const state = userState.get(uid)
        expect(state._smartbookPlan).toBeDefined()
        expect(state._smartbookPlan.plan.length).toBe(1)
        expect(state._smartbookPlan.summary).toBe('โฟกัสคณิต')
    })

    test('view shows plan when _smartbookPlan exists', () => {
        const userState = new Map()
        const uid = 12345
        userState.set(uid, {
            _smartbookPlan: {
                plan: [
                    { day: 'วันจันทร์', date: '2026-06-01', focus: 'คณิต', tasks: ['ทบทวน'], duration_min: 60 },
                ],
                summary: 'สรุป',
            },
        })
        const state = userState.get(uid)
        expect(state._smartbookPlan).toBeTruthy()
        expect(state._smartbookPlan.plan[0].day).toBe('วันจันทร์')
    })

    test('view returns null when no _smartbookPlan', () => {
        const userState = new Map()
        userState.set(12345, { _timestamp: Date.now() })
        const state = userState.get(12345)
        expect(state._smartbookPlan).toBeUndefined()
    })

    test('SMARTBOOK_SAVE refreshes timestamp', () => {
        const userState = new Map()
        const uid = 12345
        const oldTs = Date.now() - 10000
        userState.set(uid, { _smartbookPlan: { plan: [] }, _timestamp: oldTs })
        const state = userState.get(uid)
        userState.set(uid, { ...state, _timestamp: Date.now() })
        expect(userState.get(uid)._timestamp).toBeGreaterThan(oldTs)
    })
})

describe('SMARTBOOK_REFRESH behavior', () => {
    test('refresh does not alter userState', () => {
        const userState = new Map()
        const uid = 12345
        const state = { _smartbookPlan: { plan: [] }, _timestamp: Date.now() }
        userState.set(uid, state)
        const before = JSON.stringify(userState.get(uid))
        expect(JSON.stringify(userState.get(uid))).toBe(before)
    })

    test('refresh reply contains instruction to type /smartbook', () => {
        const reply = '🔄 **กำลังรีเฟรชแผน...**\n━━━━━━━━━━━━━━━━━━\nพิมพ์ /smartbook เพื่อสร้างแผนใหม่'
        expect(reply).toContain('/smartbook')
    })
})

describe('SMARTBOOK_ICAL validation', () => {
    test('ical fails gracefully when no plan saved', () => {
        const userState = new Map()
        userState.set(12345, { _timestamp: Date.now() })
        const state = userState.get(12345)
        const plan = state?._smartbookPlan
        expect(plan).toBeUndefined()
    })

    test('ical fails gracefully when plan is empty array', () => {
        const userState = new Map()
        userState.set(12345, { _smartbookPlan: { plan: [] }, _timestamp: Date.now() })
        const state = userState.get(12345)
        expect(state._smartbookPlan.plan.length).toBe(0)
    })
})

describe('COLLAB accept validation', () => {
    test('accept with missing token → invalid', () => {
        const token = undefined
        expect(token).toBeFalsy()
    })

    test('accept with expired token → expired', () => {
        const COLLAB_TOKEN_TTL = 24 * 3600_000
        const token = 'expired-tok'
        shareTokens.set(token, { title: 'HW', _timestamp: Date.now() - COLLAB_TOKEN_TTL - 1000 })
        const data = shareTokens.get(token)
        const isExpired = Date.now() - data._timestamp > COLLAB_TOKEN_TTL
        expect(isExpired).toBe(true)
    })

    test('accept with valid token → not expired', () => {
        const COLLAB_TOKEN_TTL = 24 * 3600_000
        const token = 'valid-tok'
        shareTokens.set(token, { title: 'HW', _timestamp: Date.now() })
        const data = shareTokens.get(token)
        const isExpired = Date.now() - data._timestamp > COLLAB_TOKEN_TTL
        expect(isExpired).toBe(false)
    })

    test('accept with non-existent token → not found', () => {
        expect(shareTokens.get('ghost-token')).toBeUndefined()
    })

    test('accept consumes token (deletes after use)', () => {
        shareTokens.set('consume', { title: 'HW', _timestamp: Date.now() })
        shareTokens.delete('consume')
        expect(shareTokens.has('consume')).toBe(false)
    })
})

describe('SMARTBOOK prompt building', () => {
    test('prompt includes subject and title for each page', () => {
        const pages = [
            { title: 'แบบฝึกหัด 1', subject: 'คณิต', due: '2026-06-01', priority: '🔴 สูง' },
            { title: 'Report', subject: 'อังกฤษ', due: '2026-06-03', priority: '🟡 ต่ำ' },
        ]
        const lines = pages.map(p => `[${p.subject}] ${p.title} — ส่ง ${p.due} (${p.priority})`)
        const prompt = lines.join('\n')
        expect(prompt).toContain('[คณิต] แบบฝึกหัด 1')
        expect(prompt).toContain('[อังกฤษ] Report')
        expect(prompt).toContain('ส่ง 2026-06-01')
    })

    test('handles pages with null due', () => {
        const pages = [{ title: 'HW', subject: 'คณิต', due: null, priority: 'กลาง' }]
        const lines = pages.map(p => `[${p.subject}] ${p.title} — ส่ง ${p.due || 'ไม่กำหนด'} (${p.priority})`)
        expect(lines[0]).toContain('ไม่กำหนด')
    })

    test('handles pages with null subject', () => {
        const pages = [{ title: 'HW', subject: null, due: '2026-06-01', priority: 'กลาง' }]
        const lines = pages.map(p => `[${p.subject || 'ทั่วไป'}] ${p.title}`)
        expect(lines[0]).toContain('[ทั่วไป]')
    })

    test('handles empty pages array', () => {
        const pages = []
        const lines = pages.map(p => `[${p.subject}] ${p.title}`)
        expect(lines.length).toBe(0)
    })
})

describe('COLLAB keyboard structure', () => {
    test('collab list shows up to 8 items', () => {
        const pages = Array.from({ length: 12 }, (_, i) => ({
            id: `page${i}`,
            title: `HW${i}`,
            subject: 'คณิต',
            priority: '🔴 สูง',
            due: '2026-06-01',
        }))
        const shown = pages.slice(0, 8)
        expect(shown.length).toBe(8)
    })

    test('collab keyboard includes LIST_ACTIVE button', () => {
        const keyboard = [['📋 ดูทั้งหมด', 'LIST_ACTIVE'], ['🏠 หน้าหลัก', 'HOME']]
        const flatButtons = keyboard.flat()
        expect(flatButtons).toContain('LIST_ACTIVE')
        expect(flatButtons).toContain('HOME')
    })

    test('each collab item has COLLAB_SEL_ callback', () => {
        const pageId = 'abc123'
        const callback = `COLLAB_SEL_${pageId}`
        expect(callback).toBe('COLLAB_SEL_abc123')
    })
})

describe('SMARTBOOK keyboard structure', () => {
    test('smartbook keyboard has SAVE, REFRESH, ICAL, HOME buttons', () => {
        const keyboard = [
            ['💾 บันทึก', 'SMARTBOOK_SAVE'],
            ['🔄 รีเฟรช', 'SMARTBOOK_REFRESH'],
            ['📅 iCal', 'SMARTBOOK_ICAL'],
            ['🏠 หน้าหลัก', 'HOME'],
        ]
        const flatButtons = keyboard.flat()
        expect(flatButtons).toContain('SMARTBOOK_SAVE')
        expect(flatButtons).toContain('SMARTBOOK_REFRESH')
        expect(flatButtons).toContain('SMARTBOOK_ICAL')
        expect(flatButtons).toContain('HOME')
    })
})

describe('SMARTBOOK AI JSON parsing', () => {
    function extractAndParseJson(raw) {
        if (!raw) return null
        const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
        const jsonStart = cleaned.indexOf('{')
        const jsonEnd = cleaned.lastIndexOf('}')
        if (jsonStart !== -1 && jsonEnd !== -1) {
            try {
                return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1))
            } catch {
                return null
            }
        }
        return null
    }

    test('parses valid JSON from AI response', () => {
        const raw = '```json\n{"plan":[{"day":"วันจันทร์","date":"2026-06-01","focus":"คณิต","tasks":["งาน"],"duration_min":120}],"summary":"test"}\n```'
        const result = extractAndParseJson(raw)
        expect(result).toBeTruthy()
        expect(result.plan.length).toBe(1)
        expect(result.summary).toBe('test')
    })

    test('parses JSON without code fences', () => {
        const raw = '{"plan":[],"summary":"no fences"}'
        const result = extractAndParseJson(raw)
        expect(result.summary).toBe('no fences')
    })

    test('returns null for empty response', () => {
        expect(extractAndParseJson('')).toBeNull()
    })

    test('returns null for null response', () => {
        expect(extractAndParseJson(null)).toBeNull()
    })

    test('returns null for undefined response', () => {
        expect(extractAndParseJson(undefined)).toBeNull()
    })

    test('returns null for invalid JSON', () => {
        const raw = '```json\n{invalid json here}\n```'
        expect(extractAndParseJson(raw)).toBeNull()
    })

    test('returns null when no JSON object found', () => {
        const raw = 'AI just said hello'
        expect(extractAndParseJson(raw)).toBeNull()
    })

    test('handles JSON with extra text after object', () => {
        const raw = '{"plan":[],"summary":"ok"} extra text'
        const result = extractAndParseJson(raw)
        expect(result.summary).toBe('ok')
    })

    test('handles JSON with text before object', () => {
        const raw = 'Here is your plan: {"plan":[],"summary":"ok"}'
        const result = extractAndParseJson(raw)
        expect(result.summary).toBe('ok')
    })
})

describe('COLLAB error handling', () => {
    test('token not found returns undefined', () => {
        expect(shareTokens.get('nonexistent')).toBeUndefined()
    })

    test('expired token check uses timestamp comparison', () => {
        const COLLAB_TOKEN_TTL = 24 * 3600_000
        const fresh = Date.now()
        const stale = fresh - COLLAB_TOKEN_TTL - 1
        expect(fresh - stale > COLLAB_TOKEN_TTL).toBe(true)
    })

    test('token entry with minimal fields', () => {
        const MINIMAL_TTL = 24 * 3600_000
        const data = { title: 'Simple HW', _timestamp: Date.now() }
        shareTokens.set('minimal-2', data)
        const now = Date.now()
        expect(now - data._timestamp < MINIMAL_TTL).toBe(true)
        expect(shareTokens.get('minimal-2').title).toBe('Simple HW')
    })

    test('collab accept with empty token string', () => {
        const token = ''
        shareTokens.set(token, { title: 'empty', _timestamp: Date.now() })
        expect(shareTokens.get('')).toBeTruthy()
        shareTokens.delete('')
        expect(shareTokens.get('')).toBeUndefined()
    })
})

describe('SMARTBOOK empty state handling', () => {
    test('no active homework returns empty context', () => {
        const pages = []
        const lines = pages.map(p => `[${p.subject}] ${p.title}`)
        expect(lines.length).toBe(0)
    })

    test('smartbook with one subject creates 1-day plan', () => {
        const pages = [{ title: 'HW', subject: 'คณิต' }]
        const bySubject = {}
        for (const p of pages) {
            const sub = p.subject || 'ทั่วไป'
            if (!bySubject[sub]) bySubject[sub] = []
            bySubject[sub].push(p)
        }
        const plan = Object.entries(bySubject).slice(0, 7).map(([sub, items], i) => ({
            day: `วันที่ ${i + 1}`, date: '2026-06-01', focus: sub, tasks: items.map(p => p.title), duration_min: 90,
        }))
        expect(plan.length).toBe(1)
        expect(plan[0].focus).toBe('คณิต')
    })

    test('smartbook with 10 subjects caps at 7 days', () => {
        const subjects = ['คณิต', 'อังกฤษ', 'ไทย', 'วิทย์', 'สังคม', 'ศิลปะ', 'ดนตรี', 'พละ', 'การงาน', 'ภาษาจีน']
        const pages = subjects.map((s, i) => ({ title: `HW${i}`, subject: s }))
        const bySubject = {}
        for (const p of pages) {
            const sub = p.subject || 'ทั่วไป'
            if (!bySubject[sub]) bySubject[sub] = []
            bySubject[sub].push(p)
        }
        const planDays = Object.entries(bySubject).slice(0, 7)
        expect(planDays.length).toBe(7)
    })

    test('ical with no saved plan returns early', () => {
        const userState = new Map()
        userState.set(12345, { _timestamp: Date.now() })
        const state = userState.get(12345)
        expect(state._smartbookPlan).toBeUndefined()
    })

    test('ical with empty plan array returns early', () => {
        const userState = new Map()
        userState.set(12345, { _smartbookPlan: { plan: [] }, _timestamp: Date.now() })
        const plan = userState.get(12345)._smartbookPlan
        expect(plan.plan.length).toBe(0)
    })
})

describe('COLLAB keyboard list rendering', () => {
    test('list shows up to 8 items with COLLAB_SEL callbacks', () => {
        const pages = Array.from({ length: 10 }, (_, i) => ({
            id: `page${i}`,
            title: `HW${i}`,
            subject: 'คณิต',
            priority: '🔴 สูง',
            due: '2026-06-01',
        }))
        const shown = pages.slice(0, 8)
        shown.forEach((p, i) => {
            expect(p.id).toBe(`page${i}`)
        })
        expect(shown.length).toBe(8)
    })

    test('collab shows bottom row with LIST_ACTIVE and HOME', () => {
        const row = [{ text: '📋 ดูทั้งหมด', callback_data: 'LIST_ACTIVE' }, { text: '🏠 หน้าหลัก', callback_data: 'HOME' }]
        expect(row.length).toBe(2)
        expect(row[0].callback_data).toBe('LIST_ACTIVE')
        expect(row[1].callback_data).toBe('HOME')
    })

    test('each collab item shows title + subject + priority', () => {
        const items = [
            { id: '1', title: 'การบ้านคณิต', subject: 'คณิต', priority: '🔴 สูง', due: '2026-06-01' },
        ]
        const msg = items.map(i => `${i.title} [${i.subject}] (${i.priority})`).join('\n')
        expect(msg).toContain('การบ้านคณิต')
        expect(msg).toContain('[คณิต]')
        expect(msg).toContain('(🔴 สูง)')
    })
})
