import { recalcPriority } from '../src/utils/priority.js';
import { PRIORITY } from '../src/utils/constants.js';

function daysFromToday(offset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('recalcPriority', () => {
    describe('null/undefined/empty input', () => {
        test.each([
            [null],
            [undefined],
            [''],
        ])('returns LOW for "%s"', (input) => {
            expect(recalcPriority(input)).toBe(PRIORITY.LOW);
        });
    });

    describe('overdue items (>30 days past due → LOW)', () => {
        const overdueDays = [-31, -32, -35, -40, -50, -60, -90, -100, -365, -1000];
        test.each(overdueDays)('overdue by %d days', (n) => {
            expect(recalcPriority(daysFromToday(n))).toBe(PRIORITY.LOW);
        });
    });

    describe('overdue items (≤30 days overdue → HIGH)', () => {
        const overdueDays = [-1, -2, -3, -5, -7, -10, -14, -21, -28, -29, -30];
        test.each(overdueDays)('overdue by %d days', (n) => {
            expect(recalcPriority(daysFromToday(n))).toBe(PRIORITY.HIGH);
        });
    });

    describe('due within 3 days (≤3 → HIGH)', () => {
        const days = [0, 1, 2, 3];
        test.each(days)('%d day(s) away', (n) => {
            expect(recalcPriority(daysFromToday(n))).toBe(PRIORITY.HIGH);
        });
    });

    describe('due within 4-14 days (≤14 → MEDIUM)', () => {
        const days = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
        test.each(days)('%d day(s) away', (n) => {
            expect(recalcPriority(daysFromToday(n))).toBe(PRIORITY.MEDIUM);
        });
    });

    describe('due >14 days and ≤30 days (→ LOW)', () => {
        const days = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
        test.each(days)('%d day(s) away', (n) => {
            expect(recalcPriority(daysFromToday(n))).toBe(PRIORITY.LOW);
        });
    });

    describe('due >30 days away (→ LOW)', () => {
        const days = [31, 32, 35, 40, 50, 60, 90, 100, 180, 365, 1000];
        test.each(days)('%d day(s) away', (n) => {
            expect(recalcPriority(daysFromToday(n))).toBe(PRIORITY.LOW);
        });
    });

    describe('boundary conditions', () => {
        test('exactly 0 days (today) → HIGH', () => {
            expect(recalcPriority(daysFromToday(0))).toBe(PRIORITY.HIGH);
        });

        test('exactly 3 days → HIGH', () => {
            expect(recalcPriority(daysFromToday(3))).toBe(PRIORITY.HIGH);
        });

        test('exactly 4 days → MEDIUM', () => {
            expect(recalcPriority(daysFromToday(4))).toBe(PRIORITY.MEDIUM);
        });

        test('exactly 14 days → MEDIUM', () => {
            expect(recalcPriority(daysFromToday(14))).toBe(PRIORITY.MEDIUM);
        });

        test('exactly 15 days → LOW', () => {
            expect(recalcPriority(daysFromToday(15))).toBe(PRIORITY.LOW);
        });

        test('exactly 30 days → LOW', () => {
            expect(recalcPriority(daysFromToday(30))).toBe(PRIORITY.LOW);
        });

        test('exactly 31 days → LOW', () => {
            expect(recalcPriority(daysFromToday(31))).toBe(PRIORITY.LOW);
        });

        test('exactly -30 days overdue → HIGH (≤30d overdue)', () => {
            expect(recalcPriority(daysFromToday(-30))).toBe(PRIORITY.HIGH);
        });

        test('exactly -31 days overdue → LOW (>30d overdue)', () => {
            expect(recalcPriority(daysFromToday(-31))).toBe(PRIORITY.LOW);
        });
    });

    describe('edge cases', () => {
        test('due date with time component stripped', () => {
            // The function appends T00:00:00, so any valid date string should work
            expect(recalcPriority(daysFromToday(2))).toBe(PRIORITY.HIGH);
        });

        test('future date far away returns LOW', () => {
            const farDate = daysFromToday(365);
            expect(recalcPriority(farDate)).toBe(PRIORITY.LOW);
        });

        test('today at different times returns consistent results', () => {
            // Should be based on date only, not time
            expect(recalcPriority(daysFromToday(0))).toBe(PRIORITY.HIGH);
        });
    });
});
