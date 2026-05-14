import { parseThaiDate, formatDueDisplay, formatDate, parseYMDToLocalDate } from '../src/utils/dateParser.js';

function daysFromToday(offset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr() {
    return daysFromToday(0);
}

function ymd(y, m, d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const THAI_DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

describe('formatDate', () => {
    test.each([
        [new Date(2025, 0, 1), '2025-01-01'],
        [new Date(2025, 11, 31), '2025-12-31'],
        [new Date(2025, 5, 15), '2025-06-15'],
        [new Date(2024, 1, 29), '2024-02-29'],
        [new Date(2026, 3, 10), '2026-04-10'],
        [new Date(2025, 9, 5), '2025-10-05'],
    ])('formats %s -> %s', (date, expected) => {
        expect(formatDate(date)).toBe(expected);
    });
});

describe('parseYMDToLocalDate', () => {
    test.each([
        ['2025-01-15', 2025, 0, 15],
        ['2024-02-29', 2024, 1, 29],
        ['2026-12-01', 2026, 11, 1],
        ['2025-06-30', 2025, 5, 30],
        ['2025-03-03', 2025, 2, 3],
        ['2026-10-25', 2026, 9, 25],
    ])('parses %s into Date(%d, %d, %d)', (str, y, m, d) => {
        const dt = parseYMDToLocalDate(str);
        expect(dt.getFullYear()).toBe(y);
        expect(dt.getMonth()).toBe(m);
        expect(dt.getDate()).toBe(d);
    });
});

describe('parseThaiDate', () => {
    describe('relative day keywords', () => {
        test('parses "วันนี้"', () => {
            expect(parseThaiDate('วันนี้')).toBe(todayStr());
        });
        test('parses "วันนี้" with surrounding text', () => {
            expect(parseThaiDate('ส่งวันนี้')).toBe(todayStr());
        });
        test('parses "พรุ่งนี้"', () => {
            expect(parseThaiDate('พรุ่งนี้')).toBe(daysFromToday(1));
        });
        test('parses "พรุ่งนี้" with space', () => {
            expect(parseThaiDate('ส่ง พรุ่งนี้')).toBe(daysFromToday(1));
        });
        test('parses "มะรืน"', () => {
            expect(parseThaiDate('มะรืน')).toBe(daysFromToday(2));
        });
        test('parses "มะรืนนี้"', () => {
            expect(parseThaiDate('มะรืนนี้')).toBe(daysFromToday(2));
        });
    });

    describe('"อีก X วัน" patterns', () => {
        test.each([1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30])('parses "อีก %d วัน"', (n) => {
            expect(parseThaiDate(`อีก ${n} วัน`)).toBe(daysFromToday(n));
        });
        test('parses without space "อีก3วัน"', () => {
            expect(parseThaiDate('อีก3วัน')).toBe(daysFromToday(3));
        });
        test('parses "อีก 1 วัน"', () => {
            expect(parseThaiDate('อีก 1 วัน')).toBe(daysFromToday(1));
        });
    });

    describe('"อีก X สัปดาห์" patterns', () => {
        test.each([1, 2, 3, 4, 5])('parses "อีก %d สัปดาห์"', (n) => {
            expect(parseThaiDate(`อีก ${n} สัปดาห์`)).toBe(daysFromToday(n * 7));
        });
    });

    describe('"อีก X อาทิตย์" patterns', () => {
        test.each([1, 2, 3, 4])('parses "อีก %d อาทิตย์"', (n) => {
            expect(parseThaiDate(`อีก ${n} อาทิตย์`)).toBe(daysFromToday(n * 7));
        });
    });

    describe('"สัปดาห์หน้า"', () => {
        test('parses "สัปดาห์หน้า"', () => {
            expect(parseThaiDate('สัปดาห์หน้า')).toBe(daysFromToday(7));
        });
        test('parses with typo "สัปดาหน้า"', () => {
            const result = parseThaiDate('สัปดาหน้า');
            expect(result).toBe(daysFromToday(7));
        });
    });

    describe('day name patterns', () => {
        const days = [
            ['จันทร์', 1], ['อังคาร', 2], ['พุธ', 3],
            ['พฤหัส', 4], ['ศุกร์', 5], ['เสาร์', 6], ['อาทิตย์', 0],
        ];
        for (const [name, dayNum] of days) {
            test(`parses "วัน${name}"`, () => {
                const today = new Date().getDay();
                let diff = (dayNum - today + 7) % 7;
                if (diff === 0) diff = 7;
                const result = parseThaiDate(`ส่งวัน${name}`);
                expect(result).toBe(daysFromToday(diff));
            });
            test(`parses "วัน${name}หน้า"`, () => {
                const today = new Date().getDay();
                let diff = (dayNum - today + 7) % 7 + 7;
                const result = parseThaiDate(`ส่งวัน${name}หน้า`);
                expect(result).toBe(daysFromToday(diff));
            });
        }
    });

    describe('"วันที่ X" patterns', () => {
        test.each([1, 5, 10, 15, 20, 25, 31])('parses "วันที่ %d"', (day) => {
            expect(parseThaiDate(`วันที่ ${day}`)).not.toBeNull();
        });
        test('parses "วันที่1" without space', () => {
            expect(parseThaiDate('วันที่1')).not.toBeNull();
        });
    });

    describe('dd/mm/yyyy format', () => {
        test.each([
            ['15/01/2025', '2025-01-15'],
            ['31/12/2026', '2026-12-31'],
            ['01/06/2025', '2025-06-01'],
            ['29/02/2024', '2024-02-29'],
            ['10/10/2025', '2025-10-10'],
            ['05/05/2025', '2025-05-05'],
        ])('parses "%s" -> %s', (input, expected) => {
            expect(parseThaiDate(input)).toBe(expected);
        });
    });

    describe('dd/mm/yy format', () => {
        test.each([
            ['15/01/25', '2025-01-15'],
            ['31/12/26', '2026-12-31'],
            ['01/01/30', '2030-01-01'],
            ['29/02/24', '2024-02-29'],
        ])('parses "%s" -> %s', (input, expected) => {
            expect(parseThaiDate(input)).toBe(expected);
        });
    });

    describe('edge cases', () => {
        test('returns null for empty string', () => {
            expect(parseThaiDate('')).toBeNull();
        });
        test('returns null for null', () => {
            expect(parseThaiDate(null)).toBeNull();
        });
        test('returns null for undefined', () => {
            expect(parseThaiDate(undefined)).toBeNull();
        });
        test('returns null for unrelated text', () => {
            expect(parseThaiDate('hello world')).toBeNull();
        });
        test('returns null for numbers only', () => {
            expect(parseThaiDate('12345')).toBeNull();
        });
        test('returns null for special characters', () => {
            expect(parseThaiDate('!@#$%')).toBeNull();
        });
    });
});

describe('formatDueDisplay', () => {
    describe('returns fallback for null', () => {
        test('null input', () => expect(formatDueDisplay(null)).toBe('ไม่กำหนดวัน'));
        test('undefined input', () => expect(formatDueDisplay(undefined)).toBe('ไม่กำหนดวัน'));
        test('empty string input', () => expect(formatDueDisplay('')).toBe('ไม่กำหนดวัน'));
    });

    describe('overdue dates', () => {
        const overdueDays = Array.from({ length: 100 }, (_, i) => i + 1);
        test.each(overdueDays)('overdue by %d days', (n) => {
            const result = formatDueDisplay(daysFromToday(-n));
            expect(result).toContain('เกินกำหนด');
            expect(result).toContain(String(n));
        });
    });

    describe('today', () => {
        test('shows today marker', () => {
            const result = formatDueDisplay(daysFromToday(0));
            expect(result).toContain('วันนี้');
        });
    });

    describe('tomorrow', () => {
        test('shows tomorrow', () => {
            const result = formatDueDisplay(daysFromToday(1));
            expect(result).toContain('พรุ่งนี้');
        });
    });

    describe('within 3 days', () => {
        test.each([2, 3])('shows countdown for %d days', (n) => {
            const result = formatDueDisplay(daysFromToday(n));
            expect(result).toContain('อีก');
            expect(result).toContain(String(n));
            expect(result).toContain('วัน');
        });
    });

    describe('within 7 days', () => {
        test.each([4, 5, 6, 7])('shows countdown for %d days', (n) => {
            const result = formatDueDisplay(daysFromToday(n));
            expect(result).toContain('อีก');
            expect(result).toContain(String(n));
            expect(result).toContain('วัน');
        });
    });

    describe('beyond 7 days', () => {
        const futureDays = Array.from({ length: 93 }, (_, i) => i + 8);
        test.each(futureDays)('shows countdown for %d days', (n) => {
            const result = formatDueDisplay(daysFromToday(n));
            expect(result).toContain('อีก');
            expect(result).toContain(String(n));
            expect(result).toContain('วัน');
        });
    });

    describe('includes Thai date format', () => {
        test.each([0, 1, -1, 7, 30])('contains Thai day and month for offset %d', (n) => {
            const d = new Date();
            d.setDate(d.getDate() + n);
            const dayLabel = THAI_DAYS[d.getDay()];
            const monthLabel = THAI_MONTHS[d.getMonth()];
            const result = formatDueDisplay(daysFromToday(n));
            expect(result).toContain(dayLabel);
            expect(result).toContain(monthLabel);
        });
    });
});
