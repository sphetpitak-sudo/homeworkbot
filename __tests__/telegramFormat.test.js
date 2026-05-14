import { escapeMarkdown, safeBold, safeItalic, safeCode } from '../src/utils/telegramFormat.js';

describe('escapeMarkdown', () => {
    describe('escapes special characters', () => {
        test.each([
            ['_', '\\_'],
            ['*', '\\*'],
            ['`', '\\`'],
            ['[', '\\['],
            ['~', '\\~'],
            ['(', '\\('],
            [')', '\\)'],
            ['|', '\\|'],
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
            ['(parentheses)', '\\(parentheses\\)'],
            ['[bracket]', '\\[bracket]'],
            ['pipe|symbol', 'pipe\\|symbol'],
            ['tilde~test', 'tilde\\~test'],
            ['combo_*test*_(ok)', 'combo\\_\\*test\\*\\_\\(ok\\)'],
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
            ['(paren)', '*\\(paren\\)*'],
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
            ['(paren)', '_\\(paren\\)_'],
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
            ['`code`', '`\\`code\\``'],
            ['a`b', '`a\\`b`'],
            ['```', '`\\`\\`\\``'],
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
        expect(result).toBe('*hello\\_world* normal _italic\\_\\(test\\)_');
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
