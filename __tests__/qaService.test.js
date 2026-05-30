process.env.TYPHOON_API_KEY = 'test-key-12345'
import { jest } from '@jest/globals'

jest.unstable_mockModule('openai', () => ({
    default: class MockOpenAI {
        constructor() { this.chat = { completions: { create: mockCreate } } }
    },
}))

const mockCreate = jest.fn()
const mockFetchActive = jest.fn()
const mockGetPageProps = jest.fn()

jest.unstable_mockModule('../src/services/notionService.js', () => ({
    fetchActive: mockFetchActive,
    getPageProps: mockGetPageProps,
}))

const MOCK_PAGES = [
    {
        id: 'p1',
        properties: {
            Name: { title: [{ plain_text: 'การบ้านคณิต' }] },
            Status: { select: { name: 'Todo' } },
            Due: { date: { start: '2026-06-01' } },
            Subject: { rich_text: [{ plain_text: 'คณิต' }] },
            Priority: { select: { name: '🔴 สูง' } },
        },
    },
    {
        id: 'p2',
        properties: {
            Name: { title: [{ plain_text: 'รายงานสังคม' }] },
            Status: { select: { name: 'In Progress' } },
            Due: { date: { start: '2026-06-05' } },
            Subject: { rich_text: [{ plain_text: 'สังคม' }] },
            Priority: { select: { name: '🟡 กลาง' } },
        },
    },
]

mockGetPageProps.mockImplementation((p) => ({
    title: p.properties.Name.title[0].plain_text,
    status: p.properties.Status.select.name,
    due: p.properties.Due.date.start,
    subject: p.properties.Subject.rich_text[0].plain_text,
    priority: p.properties.Priority.select.name,
}))

describe('qaService', () => {
    let isQaReady, askAI

    beforeAll(async () => {
        const mod = await import('../src/services/qaService.js')
        isQaReady = mod.isQaReady
        askAI = mod.askAI
    })

    describe('isQaReady', () => {
        test('returns true when API key is set', () => {
            expect(isQaReady()).toBe(true)
        })

        test('returns false when API key is missing', async () => {
            const key = process.env.TYPHOON_API_KEY
            delete process.env.TYPHOON_API_KEY
            jest.resetModules()
            const mod = await import('../src/services/qaService.js')
            expect(mod.isQaReady()).toBe(false)
            process.env.TYPHOON_API_KEY = key
        })
    })

    describe('askAI', () => {
        beforeEach(() => {
            mockCreate.mockReset()
            mockFetchActive.mockReset()
        })

        test('returns no-homework message when active list empty', async () => {
            mockFetchActive.mockResolvedValueOnce([])
            const result = await askAI('การบ้านที่ต้องส่งพรุ่งนี้มีอะไรบ้าง')
            expect(result).toBe('📭 ไม่มีการบ้านค้างอยู่เลย')
        })

        test('calls OpenAI with correct model and returns answer', async () => {
            mockFetchActive.mockResolvedValueOnce(MOCK_PAGES)
            mockCreate.mockResolvedValueOnce({
                choices: [{ message: { content: 'มีการบ้านคณิต 1 ชิ้น due 1 มิ.ย.' } }],
            })

            const result = await askAI('การบ้านที่ต้องส่งพรุ่งนี้มีอะไรบ้าง')
            expect(result).toBe('มีการบ้านคณิต 1 ชิ้น due 1 มิ.ย.')
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'typhoon-v2.5-30b-a3b-instruct',
                    messages: expect.arrayContaining([
                        expect.objectContaining({ role: 'system' }),
                        expect.objectContaining({ role: 'user' }),
                    ]),
                }),
            )
        })

        test('falls back to second model on 429', async () => {
            mockFetchActive.mockResolvedValueOnce(MOCK_PAGES)
            mockCreate
                .mockRejectedValueOnce({ status: 429 })
                .mockResolvedValueOnce({
                    choices: [{ message: { content: 'ตอบจาก model 2' } }],
                })

            const result = await askAI('การบ้านที่ต้องส่งพรุ่งนี้มีอะไรบ้าง')
            expect(result).toBe('ตอบจาก model 2')
            expect(mockCreate).toHaveBeenCalledTimes(2)
        })

        test('falls back to second model on 5xx', async () => {
            mockFetchActive.mockResolvedValueOnce(MOCK_PAGES)
            mockCreate
                .mockRejectedValueOnce({ status: 503 })
                .mockResolvedValueOnce({
                    choices: [{ message: { content: 'ตอบจาก model 2' } }],
                })

            const result = await askAI('การบ้านที่ต้องส่งพรุ่งนี้มีอะไรบ้าง')
            expect(result).toBe('ตอบจาก model 2')
        })

        test('does not retry on 4xx non-429 error', async () => {
            mockFetchActive.mockResolvedValueOnce(MOCK_PAGES)
            mockCreate.mockRejectedValueOnce({ status: 400 })

            const result = await askAI('การบ้านที่ต้องส่งพรุ่งนี้มีอะไรบ้าง')
            expect(result).toBeNull()
            expect(mockCreate).toHaveBeenCalledTimes(1)
        })

        test('returns null when both models fail', async () => {
            mockFetchActive.mockResolvedValueOnce(MOCK_PAGES)
            mockCreate.mockRejectedValue({ status: 429 })

            const result = await askAI('การบ้านที่ต้องส่งพรุ่งนี้มีอะไรบ้าง')
            expect(result).toBeNull()
        })

        test('handles empty AI response gracefully', async () => {
            mockFetchActive.mockResolvedValueOnce(MOCK_PAGES)
            mockCreate.mockResolvedValueOnce({
                choices: [{ message: { content: '' } }],
            })

            const result = await askAI('การบ้านที่ต้องส่งพรุ่งนี้มีอะไรบ้าง')
            expect(result).toBeNull()
        })

        test('handles AI response with no choices', async () => {
            mockFetchActive.mockResolvedValueOnce(MOCK_PAGES)
            mockCreate.mockResolvedValueOnce({ choices: [] })

            const result = await askAI('การบ้านที่ต้องส่งพรุ่งนี้มีอะไรบ้าง')
            expect(result).toBeNull()
        })

        test('returns null when fetchActive throws', async () => {
            mockFetchActive.mockRejectedValueOnce(new Error('Notion down'))

            const result = await askAI('การบ้านที่ต้องส่งพรุ่งนี้มีอะไรบ้าง')
            expect(result).toBeNull()
        })

        test('builds homework context from active pages', async () => {
            mockFetchActive.mockResolvedValueOnce(MOCK_PAGES)
            mockCreate.mockResolvedValueOnce({
                choices: [{ message: { content: 'answer' } }],
            })

            await askAI('test question')
            const callArgs = mockCreate.mock.calls[0][0]
            const userMsg = callArgs.messages.find(m => m.role === 'user').content
            expect(userMsg).toContain('การบ้านคณิต')
            expect(userMsg).toContain('คณิต')
            expect(userMsg).toContain('รายงานสังคม')
            expect(userMsg).toContain('test question')
        })
    })
})
