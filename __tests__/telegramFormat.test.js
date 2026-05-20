import { escapeMarkdown, safeBold, safeItalic, safeCode } from '../src/utils/telegramFormat.js';

describe('escapeMarkdown comprehensive', () => {
    describe('full ASCII range', () => {
        const safe = `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -=()[]{}|;:'",.<>!@#\$%^&/+~`;
        test('non-special chars pass through', () => {
            const result = escapeMarkdown(safe);
            // Only _ * ` [ are escaped
            expect(result).not.toContain('\\_');
            expect(result).not.toContain('\\*');
            expect(result).not.toContain('\\`');
        });
    });

    describe('Thai character safety', () => {
        test.each([
            ['กขคงจ', 'กขคงจ'],
            ['สวัสดีครับ', 'สวัสดีครับ'],
            ['ภาษาไทย123', 'ภาษาไทย123'],
            ['การบ้านคณิต', 'การบ้านคณิต'],
            ['สอบปลายภาค', 'สอบปลายภาค'],
            ['àéïôû', 'àéïôû'],
            ['日本語', '日本語'],
            ['한국어', '한국어'],
            ['中文', '中文'],
        ])('preserves "%s"', (input, expected) => {
            expect(escapeMarkdown(input)).toBe(expected);
        });
    });

    describe('multiple consecutive special chars', () => {
        test.each([
            ['___', '\\_\\_\\_'],
            ['***', '\\*\\*\\*'],
            ['```', '\\`\\`\\`'],
            ['[_]', '\\[\\_' + ']'],
            ['_*`', '\\_\\*\\`'],
            ['*_`', '\\*\\_\\`'],
            ['`_*', '\\`\\_\\*'],
        ])('escapes "%s" -> "%s"', (input, expected) => {
            expect(escapeMarkdown(input)).toBe(expected);
        });
    });

    describe('real-world homework text', () => {
        test.each([
            ['แบบฝึกหัดที่ 1 (หน้า 20-25)', 'แบบฝึกหัดที่ 1 (หน้า 20-25)'],
            ['คณิต: เรขาคณิต บทที่ 3', 'คณิต: เรขาคณิต บทที่ 3'],
            ['รายงาน วิทย์ ส่ง 15/06/2025', 'รายงาน วิทย์ ส่ง 15/06/2025'],
            ['ภาษาไทย_แต่งกลอน', 'ภาษาไทย\\_แต่งกลอน'],
            ['*ฟิสิกส์* บทที่ 5', '\\*ฟิสิกส์\\* บทที่ 5'],
            ['โค้ด: `console.log()`', 'โค้ด: \\`console.log()\\`'],
            ['urgent_task [final]', 'urgent\\_task \\[final]'],
            ['100% เสร็จแล้ว', '100% เสร็จแล้ว'],
            ['อุณหภูมิ 30°C', 'อุณหภูมิ 30°C'],
            ['น้ำหนัก 50±5 kg', 'น้ำหนัก 50±5 kg'],
        ])('handles "%s" correctly', (input, expected) => {
            expect(escapeMarkdown(input)).toBe(expected);
        });
    });

    describe('edge cases', () => {
        test('very long string', () => {
            const long = 'x'.repeat(10000);
            const result = escapeMarkdown(long);
            expect(result.length).toBe(10000);
        });
        test('string with only special chars', () => {
            expect(escapeMarkdown('_*`[')).toBe('\\_\\*\\`\\[');
        });
        test('string with only special chars repeated', () => {
            expect(escapeMarkdown('_'.repeat(100))).toBe('\\_'.repeat(100));
        });
        test('null input', () => {
            expect(escapeMarkdown(null)).toBe('');
        });
        test('undefined input', () => {
            expect(escapeMarkdown(undefined)).toBe('');
        });
        test('number input', () => {
            expect(escapeMarkdown(0)).toBe('0');
            expect(escapeMarkdown(123.45)).toBe('123.45');
        });
        test('boolean input', () => {
            expect(escapeMarkdown(true)).toBe('true');
            expect(escapeMarkdown(false)).toBe('false');
        });
        test('object input', () => {
            const obj = { toString: () => 'custom' };
            expect(escapeMarkdown(obj)).toBe('custom');
        });
    });
});

describe('escapeMarkdown', () => {
    describe('escapes special characters', () => {
        test.each([
            ['_', '\\_'],
            ['*', '\\*'],
            ['`', '\\`'],
            ['[', '\\['],
            ['~', '~'],
            ['(', '('],
            [')', ')'],
            ['|', '|'],
        ])('escapes "%s" -> "%s"', (char, expected) => {
            expect(escapeMarkdown(char)).toBe(expected);
        });
    });

    describe('does not affect normal text', () => {
        test.each([
            ['hello', 'hello'],
            ['สวัสดี', 'สวัสดี'],
            ['12345', '12345'],
            ['abc ABC', 'abc ABC'],
            ['a=b+c', 'a=b+c'],
            ['email@test.com', 'email@test.com'],
        ])('"%s" -> "%s"', (input, expected) => {
            expect(escapeMarkdown(input)).toBe(expected);
        });
    });

    describe('handles mixed content', () => {
        test.each([
            ['hello_world', 'hello\\_world'],
            ['*bold*', '\\*bold\\*'],
            ['text_with_underscores', 'text\\_with\\_underscores'],
            ['(parentheses)', '(parentheses)'],
            ['[bracket]', '\\[bracket]'],
            ['pipe|symbol', 'pipe|symbol'],
            ['tilde~test', 'tilde~test'],
            ['combo_*test*_(ok)', 'combo\\_\\*test\\*\\_(ok)'],
        ])('escapes "%s" -> "%s"', (input, expected) => {
            expect(escapeMarkdown(input)).toBe(expected);
        });
    });

    describe('edge cases', () => {
        test('returns empty string for null', () => {
            expect(escapeMarkdown(null)).toBe('');
        });
        test('returns empty string for undefined', () => {
            expect(escapeMarkdown(undefined)).toBe('');
        });
        test('returns empty string for empty string', () => {
            expect(escapeMarkdown('')).toBe('');
        });
        test('handles numbers', () => {
            expect(escapeMarkdown(0)).toBe('0');
        });
        test('handles number with special chars in string', () => {
            expect(escapeMarkdown('3*4=12')).toBe('3\\*4=12');
        });
        test('escapes consecutive special chars', () => {
            expect(escapeMarkdown('_*`')).toBe('\\_\\*\\`');
        });
    });
});

describe('safeBold', () => {
    describe('wraps text with asterisks', () => {
        test.each([
            ['hello', '*hello*'],
            ['สวัสดี', '*สวัสดี*'],
            ['123', '*123*'],
            ['a b', '*a b*'],
        ])('bold "%s" -> "%s"', (input, expected) => {
            expect(safeBold(input)).toBe(expected);
        });
    });

    describe('escapes internal special chars', () => {
        test.each([
            ['hello_world', '*hello\\_world*'],
            ['*bold*', '*\\*bold\\**'],
            ['(paren)', '*(paren)*'],
            ['test_123*', '*test\\_123\\**'],
        ])('bold "%s" -> "%s"', (input, expected) => {
            expect(safeBold(input)).toBe(expected);
        });
    });

    describe('edge cases', () => {
        test('handles null', () => {
            expect(safeBold(null)).toBe('**');
        });
        test('handles undefined', () => {
            expect(safeBold(undefined)).toBe('**');
        });
        test('handles empty string', () => {
            expect(safeBold('')).toBe('**');
        });
    });
});

describe('safeItalic', () => {
    describe('wraps text with underscores', () => {
        test.each([
            ['hello', '_hello_'],
            ['สวัสดี', '_สวัสดี_'],
            ['123', '_123_'],
            ['a b', '_a b_'],
        ])('italic "%s" -> "%s"', (input, expected) => {
            expect(safeItalic(input)).toBe(expected);
        });
    });

    describe('escapes internal special chars', () => {
        test.each([
            ['hello*world', '_hello\\*world_'],
            ['_italic_', '_\\_italic\\__'],
            ['(paren)', '_(paren)_'],
            ['test*123_', '_test\\*123\\__'],
        ])('italic "%s" -> "%s"', (input, expected) => {
            expect(safeItalic(input)).toBe(expected);
        });
    });

    describe('edge cases', () => {
        test('handles null', () => {
            expect(safeItalic(null)).toBe('__');
        });
        test('handles undefined', () => {
            expect(safeItalic(undefined)).toBe('__');
        });
        test('handles empty string', () => {
            expect(safeItalic('')).toBe('__');
        });
    });
});

describe('safeCode', () => {
    describe('wraps text with backticks', () => {
        test.each([
            ['hello', '`hello`'],
            ['สวัสดี', '`สวัสดี`'],
            ['123', '`123`'],
            ['a b', '`a b`'],
            ['x=1', '`x=1`'],
        ])('code "%s" -> "%s"', (input, expected) => {
            expect(safeCode(input)).toBe(expected);
        });
    });

    describe('escapes backticks inside', () => {
        test.each([
            ['`code`', "`'code'`"],
            ['a`b', "`a'b`"],
            ['```', "`'''`"],
        ])('code "%s" -> "%s"', (input, expected) => {
            expect(safeCode(input)).toBe(expected);
        });
    });

    describe('does not escape other special chars inside code', () => {
        test.each([
            ['*bold*', '`*bold*`'],
            ['_italic_', '`_italic_`'],
            ['(paren)', '`(paren)`'],
        ])('code "%s" -> "%s"', (input, expected) => {
            expect(safeCode(input)).toBe(expected);
        });
    });

    describe('edge cases', () => {
        test('handles null', () => {
            expect(safeCode(null)).toBe('``');
        });
        test('handles undefined', () => {
            expect(safeCode(undefined)).toBe('``');
        });
        test('handles empty string', () => {
            expect(safeCode('')).toBe('``');
        });
    });
});

describe('combined formatting', () => {
    test('bold inside text with special chars', () => {
        const result = safeBold('hello_world') + ' normal ' + safeItalic('italic_(test)');
        expect(result).toBe('*hello\\_world* normal _italic\\_(test)_');
    });

    test('multiple formatting in sequence', () => {
        const result = safeBold('ชื่อ') + ' ' + safeItalic('วิชา') + ' ' + safeCode('code');
        expect(result).toBe('*ชื่อ* _วิชา_ `code`');
    });

    test('nested-like patterns', () => {
        const t = 'user_input_123';
        const result = safeBold(safeItalic(t));
        expect(result).toBe('*\\_user\\\\_input\\\\_123\\_*');
    });
});
