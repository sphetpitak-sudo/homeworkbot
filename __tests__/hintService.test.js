import { getStudyTip, getFallbackTipForSubject } from '../src/services/hintService.js'

function makePage({ title, due, subject, priority } = {}) {
  return {
    properties: {
      Name: { title: [{ plain_text: title || 'Test' }] },
      Due: { date: { start: due || '2026-06-01' } },
      Subject: { rich_text: [{ plain_text: subject || 'คณิต' }] },
      Priority: { select: { name: priority || '🟡 กลาง' } },
    },
  }
}

describe('getStudyTip', () => {
  test('returns null for empty homeworkItems', async () => {
    const result = await getStudyTip('คณิต', [])
    expect(result).toBeNull()
  })

  test('returns null for null homeworkItems', async () => {
    const result = await getStudyTip('คณิต', null)
    expect(result).toBeNull()
  })

  test('returns hint message with homework list', async () => {
    const items = [
      makePage({ title: 'แบบฝึกหัดหน้า 20', due: '2026-05-30', subject: 'คณิต' }),
      makePage({ title: 'ใบงานบทที่ 5', due: '2026-06-05', subject: 'คณิต' }),
    ]
    const result = await getStudyTip('คณิต', items)
    expect(result).toContain('งาน คณิต ที่ค้าง')
    expect(result).toContain('แบบฝึกหัดหน้า 20')
    expect(result).toContain('ใบงานบทที่ 5')
    expect(result).toContain('คำแนะนำ')
    expect(result).toContain('เริ่มจากโจทย์ที่ง่ายที่สุด')
  })

  test('uses correct fallback tip for each subject', async () => {
    const tests = [
      { subject: 'คณิต', keyword: 'เริ่มจากโจทย์' },
      { subject: 'ไทย', keyword: 'วางโครงเรื่อง' },
      { subject: 'อังกฤษ', keyword: 'หาคำศัพท์' },
      { subject: 'ฟิสิกส์', keyword: 'เขียนสูตร' },
      { subject: 'เคมี', keyword: 'ดุลสมการ' },
      { subject: 'ชีวะ', keyword: 'สรุปเป็น' },
      { subject: 'สังคม', keyword: 'หลายแหล่ง' },
      { subject: 'ประวัติ', keyword: 'ลำดับเหตุการณ์' },
      { subject: 'คอม', keyword: 'ปัญหาออกเป็นส่วนย่อย' },
      { subject: 'สุขศึกษา', keyword: 'ชีวิตประจำวัน' },
    ]
    for (const { subject, keyword } of tests) {
      const items = [makePage({ subject })]
      const result = await getStudyTip(subject, items)
      expect(result).toContain(keyword)
    }
  })

  test('falls back to "ทั่วไป" tip for unknown subject', async () => {
    const items = [makePage({ subject: 'ดาราศาสตร์' })]
    const result = await getStudyTip('ดาราศาสตร์', items)
    expect(result).toContain('เริ่มจากสิ่งที่รู้ก่อน')
  })

  test('handles single homework item', async () => {
    const items = [makePage({ title: 'รายงาน', due: '2026-06-10' })]
    const result = await getStudyTip('ไทย', items)
    expect(result).toContain('1. รายงาน')
    expect(result).toContain('ไทย ที่ค้าง')
  })

  test('handles page with missing properties', async () => {
    const items = [{ properties: {} }]
    const result = await getStudyTip('ทั่วไป', items)
    expect(result).toContain('ไม่มีชื่อ')
    expect(result).toContain('ไม่มีกำหนด')
  })
})

describe('getFallbackTipForSubject', () => {
  test('returns tip for known subject', () => {
    const tip = getFallbackTipForSubject('คณิต')
    expect(tip).toContain('เริ่มจากโจทย์')
  })

  test('returns general tip for unknown subject', () => {
    const tip = getFallbackTipForSubject('notexist')
    expect(tip).toContain('เริ่มจากสิ่งที่รู้ก่อน')
  })

  test('returns general tip for null', () => {
    const tip = getFallbackTipForSubject(null)
    expect(tip).toContain('เริ่มจากสิ่งที่รู้ก่อน')
  })
})
