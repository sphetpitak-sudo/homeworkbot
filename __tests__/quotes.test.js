import { QUOTES } from '../src/utils/quotes.js'

describe('QUOTES', () => {
  test('has at least 30 quotes', () => {
    expect(QUOTES.length).toBeGreaterThanOrEqual(30)
  })

  test('all quotes have text and author fields', () => {
    QUOTES.forEach((q, i) => {
      expect(q).toHaveProperty('text')
      expect(q).toHaveProperty('author')
      expect(typeof q.text).toBe('string')
      expect(typeof q.author).toBe('string')
      expect(q.text.length).toBeGreaterThan(0)
      expect(q.author.length).toBeGreaterThan(0)
    })
  })

  test('no duplicate quotes', () => {
    const texts = QUOTES.map(q => q.text)
    const unique = new Set(texts)
    expect(unique.size).toBe(texts.length)
  })

  test('all quotes contain Thai characters', () => {
    QUOTES.forEach((q) => {
      expect(q.text).toMatch(/[\u0E00-\u0E7F]/)
    })
  })

  test('quote length is reasonable (between 10 and 200 chars)', () => {
    QUOTES.forEach((q) => {
      expect(q.text.length).toBeGreaterThanOrEqual(10)
      expect(q.text.length).toBeLessThanOrEqual(200)
    })
  })

  test('all authors are non-empty strings', () => {
    QUOTES.forEach((q) => {
      expect(q.author.trim().length).toBeGreaterThan(0)
    })
  })

  test('hardcoded count equals QUOTES.length', () => {
    expect(QUOTES.length).toBe(35)
  })
})
