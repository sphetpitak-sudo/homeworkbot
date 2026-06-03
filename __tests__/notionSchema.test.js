import { jest } from '@jest/globals'

const mockRetrieve = jest.fn()
const mockQuery = jest.fn()

jest.unstable_mockModule('@notionhq/client', () => ({
    Client: class {
        constructor() {}
        databases = { retrieve: mockRetrieve, query: mockQuery }
    },
}))

describe('validateNotionSchema', () => {
    beforeEach(() => {
        mockRetrieve.mockReset()
        mockQuery.mockReset()
        jest.resetModules()
        process.env.NOTION_TOKEN = 'test-token'
        process.env.DATABASE_ID = 'db-1'
    })

    test('returns ok when all required properties exist with correct types', async () => {
        mockRetrieve.mockResolvedValueOnce({
            properties: {
                Name: { type: 'title' },
                Status: { type: 'select' },
                Subject: { type: 'rich_text' },
                Due: { type: 'date' },
                Priority: { type: 'select' },
                Completed: { type: 'date' },
                Tags: { type: 'multi_select' },
                EventId: { type: 'rich_text' },
            },
        })
        const { validateNotionSchema } = await import('../src/services/notionService.js')
        const result = await validateNotionSchema()
        expect(result.ok).toBe(true)
        expect(result.missing).toEqual([])
    })

    test('reports missing properties', async () => {
        mockRetrieve.mockResolvedValueOnce({
            properties: {
                Name: { type: 'title' },
                Status: { type: 'select' },
                // Subject, Due, Priority, Completed, Tags, EventId all missing
            },
        })
        const { validateNotionSchema } = await import('../src/services/notionService.js')
        const result = await validateNotionSchema()
        expect(result.ok).toBe(false)
        expect(result.missing).toEqual(
            expect.arrayContaining(['Subject', 'Due', 'Priority', 'Completed', 'Tags', 'EventId'])
        )
    })

    test('reports properties with wrong type', async () => {
        mockRetrieve.mockResolvedValueOnce({
            properties: {
                Name: { type: 'title' },
                Status: { type: 'select' },
                Subject: { type: 'rich_text' },
                Due: { type: 'checkbox' }, // WRONG — should be date
                Priority: { type: 'select' },
                Completed: { type: 'date' },
                Tags: { type: 'multi_select' },
                EventId: { type: 'rich_text' },
            },
        })
        const { validateNotionSchema } = await import('../src/services/notionService.js')
        const result = await validateNotionSchema()
        expect(result.ok).toBe(false)
        expect(result.missing.some((m) => m.startsWith('Due (expected date'))).toBe(true)
    })

    test('handles unreachable Notion gracefully', async () => {
        mockRetrieve.mockRejectedValueOnce(new Error('ECONNREFUSED'))
        const { validateNotionSchema } = await import('../src/services/notionService.js')
        const result = await validateNotionSchema()
        expect(result.ok).toBe(false)
    })

    test('caches result (only calls API once even on multiple invocations)', async () => {
        mockRetrieve.mockResolvedValue({
            properties: {
                Name: { type: 'title' },
                Status: { type: 'select' },
                Subject: { type: 'rich_text' },
                Due: { type: 'date' },
                Priority: { type: 'select' },
                Completed: { type: 'date' },
                Tags: { type: 'multi_select' },
                EventId: { type: 'rich_text' },
            },
        })
        const { validateNotionSchema } = await import('../src/services/notionService.js')
        await validateNotionSchema()
        await validateNotionSchema()
        await validateNotionSchema()
        expect(mockRetrieve).toHaveBeenCalledTimes(1)
    })
})
