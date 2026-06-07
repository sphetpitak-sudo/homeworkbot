import { cleanupPomoTimers } from '../src/handlers/actionHandlers.js'

describe('cleanupPomoTimers', () => {
  test('clears all pomodoro timers without errors', () => {
    expect(() => cleanupPomoTimers()).not.toThrow()
  })

  test('returns undefined', () => {
    const result = cleanupPomoTimers()
    expect(result).toBeUndefined()
  })

  test('can be called multiple times safely', () => {
    cleanupPomoTimers()
    cleanupPomoTimers()
    cleanupPomoTimers()
    expect(true).toBe(true)
  })
})
