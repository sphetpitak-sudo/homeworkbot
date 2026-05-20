import { parseTags, inferTags, inferAndParseTags, VALID_TAGS } from '../src/utils/tagDetector.js';

describe('VALID_TAGS', () => {
    test('contains all expected tags', () => {
        expect(VALID_TAGS).toEqual(expect.arrayContaining(['สอบ', 'โครงการ', 'กลุ่ม', 'ด่วน', 'อ่าน', 'ใบงาน']));
    });

    test('has no duplicates', () => {
        expect(new Set(VALID_TAGS).size).toBe(VALID_TAGS.length);
    });
});

describe('parseTags (hashtag extraction)', () => {
    describe('single hashtag', () => {
        test.each([
            [' วันที่ urgent มาก', ['ด่วน']],
            ['asap', ['ด่วน']],
            ['ภายในวันนี้', ['ด่วน']],
            ['เรื่องด่วน', ['ด่วน']],
            ['ด่วนมาก', ['ด่วน']],
            ['เร่งด่วน', ['ด่วน']],
        ])('infers "ด่วน" from "%s"', (input, expected) => {
            expect(inferTags(input)).toEqual(expected);
        });
    });

    describe('multiple hashtags', () => {
        test('parses multiple tags', () => {
            expect(parseTags('#สอบ #ด่วน #โครงการ')).toEqual(['สอบ', 'ด่วน', 'โครงการ']);
        });

        test('parses tags with underscores', () => {
            expect(parseTags('#สอบ_ปลายภาค #งาน_กลุ่ม')).toEqual(['สอบ_ปลายภาค', 'งาน_กลุ่ม']);
        });

        test('parses tags with hyphens', () => {
            expect(parseTags('#สอบ-final')).toEqual(['สอบ-final']);
        });
    });

    describe('no hashtags', () => {
        test.each([
            [''],
            ['ข้อความยาวๆไม่มีแฮชแท็ก'],
            ['สอบพรุ่งนี้ด่วนมาก'],
            ['12345'],
            ['!@#$%'],
        ])('returns empty for "%s"', (input) => {
            expect(parseTags(input)).toEqual([]);
        });
    });

    describe('edge cases', () => {
        test('hashtag at end of text', () => {
            expect(parseTags('ส่งงานวันนี้ #ด่วน')).toEqual(['ด่วน']);
        });

        test('hashtag at start of text', () => {
            expect(parseTags('#สอบ ส่งวันจันทร์')).toEqual(['สอบ']);
        });

        test('hashtags separated by non-space', () => {
            expect(parseTags('#สอบ#ด่วน#อ่าน')).toEqual(['สอบด่วนอ่าน']);
        });

        test('hashtag with numbers', () => {
            expect(parseTags('#ม4 #เทอม2')).toEqual(['ม4', 'เทอม2']);
        });

        test('hashtag with mixed Thai and English', () => {
            expect(parseTags('#สอบfinal #งานgroup')).toEqual(['สอบfinal', 'งานgroup']);
        });
    });
});

describe('inferTags (keyword-based inference)', () => {
    describe('สอบ tag', () => {
        test.each([
            ['สอบปลายภาค', ['สอบ']],
            ['สอบกลางภาคคณิต', ['สอบ']],
            ['final exam ฟิสิกส์', ['สอบ']],
            ['midterm สังคม', ['สอบ']],
            ['ข้อสอบเก่าชีวะ', ['สอบ']],
            ['สอบไฟนอล', ['สอบ']],
            ['สอบปลายเทอม', ['สอบ']],
        ])('infers "สอบ" from "%s"', (input, expected) => {
            expect(inferTags(input)).toEqual(expected);
        });
    });

    describe('โครงการ tag', () => {
        test.each([
            ['โครงการจบ', ['โครงการ']],
            ['โปรเจกต์วิทยาศาสตร์', ['โครงการ']],
            ['โปรเจคสังคม', ['โครงการ']],
            ['โครงงานคณิต', ['โครงการ']],
            ['mini project', ['โครงการ']],
            ['มินิโปรเจกต์', ['โครงการ']],
        ])('infers "โครงการ" from "%s"', (input, expected) => {
            expect(inferTags(input)).toEqual(expected);
        });
    });

    describe('กลุ่ม tag', () => {
        test.each([
            ['งานกลุ่มคณิต', ['กลุ่ม']],
            ['นำเสนองาน', ['กลุ่ม']],
            ['พรีเซนต์หน้าชั้น', ['กลุ่ม']],
            ['presentation ฟิสิกส์', ['กลุ่ม']],
            ['ทำงานกลุ่มชีวะ', ['กลุ่ม']],
            ['แบ่งกลุ่มทำรายงาน', ['กลุ่ม']],
        ])('infers "กลุ่ม" from "%s"', (input, expected) => {
            expect(inferTags(input)).toEqual(expected);
        });
    });

    describe('ด่วน tag', () => {
        test.each([
            ['การบ้านด่วน', ['ด่วน']],
            ['เร่งด่วน', ['ด่วน']],
            ['รีบส่ง', ['ด่วน']],
            ['ส่งวันนี้', ['ด่วน']],
            ['ส่งพรุ่งนี้', ['ด่วน']],
            [' ต้อง urgent มาก', ['ด่วน']],
            ['asap', ['ด่วน']],
            ['ภายในวันนี้', ['ด่วน']],
        ])('infers "ด่วน" from "%s"', (input, expected) => {
            expect(inferTags(input)).toEqual(expected);
        });
    });

    describe('อ่าน tag', () => {
        test.each([
            ['อ่านหนังสือ', ['อ่าน']],
            ['ท่องอาขยาน', ['อ่าน']],
            ['อาขยานบทที่ 5', ['อ่าน']],
            ['ท่องจำศัพท์', ['อ่าน']],
            ['reading comprehension', ['อ่าน']],
            ['แต่งกลอน', ['อ่าน']],
            ['บทกลอน', ['อ่าน']],
            ['เรื่องสั้น', ['อ่าน']],
        ])('infers "อ่าน" from "%s"', (input, expected) => {
            expect(inferTags(input)).toEqual(expected);
        });
    });

    describe('ใบงาน tag', () => {
        test.each([
            ['ใบงานที่ 1', ['ใบงาน']],
            ['แบบฝึกหัดหน้า 20', ['ใบงาน']],
            ['ทำโจทย์คณิต', ['ใบงาน']],
            ['worksheet วิทย์', ['ใบงาน']],
            ['ใบกิจกรรม', ['ใบงาน']],
            ['แบบฝึกหัดที่ 3', ['ใบงาน']],
        ])('infers "ใบงาน" from "%s"', (input, expected) => {
            expect(inferTags(input)).toEqual(expected);
        });
    });

    describe('multiple tags', () => {
        test('infers สอบ + ด่วน', () => {
            const result = inferTags('สอบปลายภาคคณิต ด่วนมาก');
            expect(result).toContain('สอบ');
            expect(result).toContain('ด่วน');
        });

        test('infers กลุ่ม + ใบงาน', () => {
            const result = inferTags('งานกลุ่มทำแบบฝึกหัด');
            expect(result).toContain('กลุ่ม');
            expect(result).toContain('ใบงาน');
        });

        test('infers โครงการ + กลุ่ม + นำเสนอ', () => {
            const tags = inferTags('โปรเจคกลุ่มนำเสนอ');
            expect(tags).toContain('โครงการ');
            expect(tags).toContain('กลุ่ม');
        });

        test('infers all matching tags', () => {
            const tags = inferTags('สอบด่วนโปรเจคกลุ่มนำเสนออ่านหนังสือใบงาน');
            const expectedTags = ['สอบ', 'โครงการ', 'กลุ่ม', 'ด่วน', 'อ่าน', 'ใบงาน'];
            for (const tag of expectedTags) {
                expect(tags).toContain(tag);
            }
        });
    });

    describe('no matching tags', () => {
        test.each([
            [''],
            ['ทำรายงานทั่วไป'],
            ['hello world'],
            ['12345'],
            ['!@#$%'],
        ])('returns empty for "%s"', (input) => {
            expect(inferTags(input)).toEqual([]);
        });
    });

    describe('edge cases', () => {
        test('case insensitive for English keywords', () => {
            expect(inferTags('FINAL EXAM MATH')).toContain('สอบ');
        });

        test('case insensitive for "urgent"', () => {
            expect(inferTags(' URGENT')).toContain('ด่วน');
        });

        test('partial word match "สอบ" in longer text', () => {
            expect(inferTags('การสอบคณิตครั้งที่1')).toContain('สอบ');
        });

        test('keyword at start of text', () => {
            expect(inferTags('สอบปลายภาค')).toContain('สอบ');
        });

        test('keyword at end of text', () => {
            expect(inferTags('ส่งงานวันนี้ด่วน')).toContain('ด่วน');
        });

        test('keyword embedded in Thai text', () => {
            expect(inferTags('พรุ่งนี้สอบคณิต')).toContain('สอบ');
        });
    });
});

describe('inferAndParseTags (combined)', () => {
    describe('hashtags only', () => {
        test('extracts #hashtags', () => {
            expect(inferAndParseTags('#สอบ #ด่วน')).toEqual(['สอบ', 'ด่วน']);
        });
    });

    describe('inferred tags only', () => {
        test('infers from keywords', () => {
            expect(inferAndParseTags('สอบปลายภาคคณิต ด่วนมาก')).toEqual(expect.arrayContaining(['สอบ', 'ด่วน']));
        });
    });

    describe('combined hashtags + inferred', () => {
        test('merges without duplicates', () => {
            const result = inferAndParseTags('#สอบ สอบปลายภาคคณิต');
            // "สอบ" should appear only once
            expect(result.filter(t => t === 'สอบ').length).toBe(1);
        });

        test('hashtag + inferred different tags', () => {
            const result = inferAndParseTags('#โครงการ ใบงานคณิต');
            expect(result).toContain('โครงการ');
            expect(result).toContain('ใบงาน');
        });
    });

    describe('no tags', () => {
        test.each([
            [''],
            ['hello world'],
            ['ทำรายงานส่งวันจันทร์'],
        ])('returns undefined for "%s"', (input) => {
            expect(inferAndParseTags(input)).toBeUndefined();
        });
    });

    describe('edge cases', () => {
        test('only whitespace', () => {
            expect(inferAndParseTags('   ')).toBeUndefined();
        });

        test('only special characters', () => {
            expect(inferAndParseTags('!@#$%^')).toBeUndefined();
        });

        test('mixed types', () => {
            const result = inferAndParseTags('#การบ้าน ทำแบบฝึกหัดคณิต #ด่วน  สอบปลายภาค');
            expect(result).toContain('การบ้าน');
            expect(result).toContain('ใบงาน');
            expect(result).toContain('ด่วน');
            expect(result).toContain('สอบ');
        });

        test('no duplicate tags from hashtag and inference', () => {
            const result = inferAndParseTags('#สอบ สอบปลายภาค');
            const count = result.filter(t => t === 'สอบ').length;
            expect(count).toBe(1);
        });
    });
});
