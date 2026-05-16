import { detectSubject, subjectEmoji, cleanTitle } from '../src/utils/subjectDetector.js';

describe('detectSubject', () => {
    describe('คณิต keyword variants', () => {
        test.each([
            ['คณิต', 'ทำการบ้านคณิต'],
            ['คนิด', 'แบบฝึกหัดคนิด'],
            ['คณต', 'ส่งคณต'],
            ['math', 'math homework'],
            ['Math', 'Math test'],
            ['MATH', 'MATH EXAM'],
            ['เลข', 'เลขบทที่ 2'],
            ['แคลคูลัส', 'แคลคูลัส 1'],
            ['สถิติ', 'สถิติเบื้องต้น'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('คณิต');
        });
    });

    describe('อังกฤษ keyword variants', () => {
        test.each([
            ['อังกฤษ', 'การบ้านอังกฤษ'],
            ['english', 'english essay'],
            ['English', 'English speaking'],
            ['eng', 'eng test'],
            ['ENG', 'ENG EXAM'],
            ['อิ๊ง', 'ส่งอิ๊ง'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('อังกฤษ');
        });
    });

    describe('ฟิสิกส์ keyword variants', () => {
        test.each([
            ['ฟิสิกส์', 'ฟิสิกส์บทที่ 5'],
            ['ฟิสิก', 'ฟิสิก มอ 5'],
            ['physics', 'physics lab'],
            ['Physics', 'Physics report'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('ฟิสิกส์');
        });
    });

    describe('เคมี keyword variants', () => {
        test.each([
            ['เคมี', 'เคมีอินทรีย์'],
            ['chem', 'chem lab'],
            ['Chem', 'Chem test'],
            ['chemistry', 'organic chemistry'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('เคมี');
        });
    });

    describe('ชีวะ keyword variants', () => {
        test.each([
            ['ชีวะ', 'ชีวะระบบหายใจ'],
            ['ชีวา', 'ชีวาการเจริญเติบโต'],
            ['bio', 'bio class'],
            ['Bio', 'Bio exam'],
            ['biology', 'biology report'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('ชีวะ');
        });
    });

    describe('ไทย keyword variants', () => {
        test.each([
            ['ภาษาไทย', 'ภาษาไทยแต่งกลอน'],
            ['ไทย', 'การบ้านไทย'],
            ['อิเหนา', 'อิเหนาตอนศึกกะหมังกุหนิง'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('ไทย');
        });
    });

    describe('สังคม keyword variants', () => {
        test.each([
            ['สังคม', 'สังคมภูมิศาสตร์'],
            ['social', 'social studies'],
            ['สค', 'สค มอ 3'],
            ['สังคมศึกษา', 'สังคมศึกษาเศรษฐกิจ'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('สังคม');
        });
    });

    describe('ประวัติ keyword variants', () => {
        test.each([
            ['ประวัติ', 'ประวัติอยุธยา'],
            ['history', 'history class'],
            ['hist', 'hist 101'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('ประวัติ');
        });
    });

    describe('คอม keyword variants', () => {
        test.each([
            ['คอม', 'คอมพิวเตอร์'],
            ['computer', 'computer science'],
            ['Computer', 'Computer programming'],
            ['โปรแกรม', 'เขียนโปรแกรม'],
            ['coding', 'coding homework'],
            ['it', 'it fundamentals'],
            ['IT', 'IT support'],
            ['วิทยาการคำนวณ', 'วิทยาการคำนวณ ม 4'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('คอม');
        });
    });

    describe('mixed content', () => {
        test('detects subject in long text', () => {
            expect(detectSubject('พรุ่งนี้สอบคณิตศาสตร์บทที่ 5 เรื่องแคลคูลัส')).toBe('คณิต');
        });
        test('detects subject with special chars', () => {
            expect(detectSubject('ฟิสิกส์! บทที่ 2 (จลนศาสตร์)')).toBe('ฟิสิกส์');
        });
        test('detects subject with numbers', () => {
            expect(detectSubject('เคมี บทที่ 3.2 ตารางธาตุ')).toBe('เคมี');
        });
    });

    describe('สุขศึกษา keyword variants', () => {
        test.each([
            ['สุขศึกษา', 'ใบงานสุขศึกษา'],
            ['พลศึกษา', 'สอบพลศึกษา'],
            ['พละ', 'พละวันนี้'],
            ['กีฬา', 'กีฬาสี'],
            ['อนามัย', 'อนามัยส่วนบุคคล'],
            ['โภชนาการ', 'โภชนาการอาหาร'],
            ['ออกกำลังกาย', 'ประโยชน์ของการออกกำลังกาย'],
        ])('detects "%s" from "%s"', (_, input) => {
            expect(detectSubject(input)).toBe('สุขศึกษา');
        });
    });

    describe('unknown input', () => {
        test.each([
            ['ทำรายงาน'],
            ['ดาราศาสตร์'],
            ['จิตวิทยา'],
            ['ปรัชญา'],
            ['ศิลปะ'],
            ['ดนตรี'],
            ['การงานอาชีพ'],
            ['hello world'],
            [''],
        ])('returns "ทั่วไป" for "%s"', (input) => {
            expect(detectSubject(input)).toBe('ทั่วไป');
        });
    });
});

describe('subjectEmoji', () => {
    test.each([
        ['คณิต', '🔢'],
        ['อังกฤษ', '🔤'],
        ['ฟิสิกส์', '⚛️'],
        ['เคมี', '🧪'],
        ['ชีวะ', '🧬'],
        ['ไทย', '📜'],
        ['สังคม', '🌏'],
        ['ประวัติ', '🏛️'],
        ['คอม', '💻'],
        ['สุขศึกษา', '🏃'],
    ])('returns %s for subject "%s"', (subject, emoji) => {
        expect(subjectEmoji(subject)).toBe(emoji);
    });

    describe('unknown subjects return fallback', () => {
        test.each([
            ['ดาราศาสตร์'],
            ['ทั่วไป'],
            ['ศิลปะ'],
            ['ดนตรี'],
            [''],
        ])('subject "%s"', (subject) => {
            expect(subjectEmoji(subject)).toBe('📖');
        });
    });
});

describe('cleanTitle', () => {
    describe('removes subject keywords', () => {
        test.each([
            ['คณิต แบบฝึกหัดหน้า 20', 'แบบฝึกหัดหน้า 20'],
            ['ชีวะ บทที่ 3', 'บทที่ 3'],
            ['อังกฤษ เขียนเรียงความ', 'เขียนเรียงความ'],
            ['ฟิสิกส์ ทำโจทย์', 'ทำโจทย์'],
            ['เคมี ทดลอง', 'ทดลอง'],
            ['ไทย แต่งกลอน', 'แต่งกลอน'],
            ['สังคม เศรษฐกิจ', 'เศรษฐกิจ'],
            ['ประวัติ อยุธยา', 'อยุธยา'],
            ['คอม งานเขียน', 'งานเขียน'],
        ])('in "%s" -> "%s"', (input, expected) => {
            expect(cleanTitle(input)).toBe(expected);
        });
    });

    describe('removes date references', () => {
        test.each([
            ['รายงานส่ง 15/06/2025', 'รายงานส่ง'],
            ['งาน 31/12/26', 'งาน'],
            ['แบบฝึกหัด 01/01/2025', 'แบบฝึกหัด'],
            ['โปรเจค 29/02/2024', 'โปรเจค'],
            ['ส่ง 10/10/25', 'ส่ง'],
        ])('in "%s" -> "%s"', (input, expected) => {
            expect(cleanTitle(input)).toBe(expected);
        });
    });

    describe('removes relative day offsets', () => {
        test.each([
            ['ชีวะบทที่ 3 อีก 3 วัน', 'บทที่ 3'],
            ['งาน อีก 5 วัน', 'งาน'],
            ['แบบฝึกหัด อีก 1 อาทิตย์', 'แบบฝึกหัด'],
            ['โปรเจค อีก 2 สัปดาห์', 'โปรเจค'],
        ])('in "%s" -> "%s"', (input, expected) => {
            expect(cleanTitle(input)).toBe(expected);
        });
    });

    describe('removes day-name keywords', () => {
        test.each([
            ['งานส่งพรุ่งนี้', 'งานส่ง'],
            ['งานส่งมะรืน', 'งานส่ง'],
            ['กำหนดส่งวันนี้', 'กำหนดส่ง'],
            ['การบ้านสัปดาห์หน้า', 'การบ้าน'],
            ['สอบวันจันทร์', 'สอบ'],
            ['สอบวันจันทร์หน้า', 'สอบ'],
            ['สอบวันอังคาร', 'สอบ'],
            ['สอบวันพุธ', 'สอบ'],
            ['สอบวันพฤหัสหน้า', 'สอบ'],
            ['สอบวันศุกร์', 'สอบ'],
            ['สอบวันเสาร์', 'สอบ'],
            ['สอบวันอาทิตย์หน้า', 'สอบ'],
        ])('in "%s" -> "%s"', (input, expected) => {
            expect(cleanTitle(input)).toBe(expected);
        });
    });

    describe('collapses whitespace', () => {
        test.each([
            ['  ฟิสิกส์   งาน   กลุ่ม  ', 'งาน กลุ่ม'],
            ['คณิต    หน้า 20', 'หน้า 20'],
            ['   ชีวะ   บทที่ 5   ', 'บทที่ 5'],
            ['a   b   c', 'a b c'],
        ])('in "%s" -> "%s"', (input, expected) => {
            expect(cleanTitle(input)).toBe(expected);
        });
    });

    describe('removes multiple patterns', () => {
        test.each([
            ['คณิต แบบฝึกหัด 15/06/2025 พรุ่งนี้', 'แบบฝึกหัด'],
            ['ชีวะ บทที่ 3 อีก 3 วัน', 'บทที่ 3'],
            ['ฟิสิกส์ ทำโจทย์ 20/01/2026 สัปดาห์หน้า', 'ทำโจทย์'],
        ])('in "%s" -> "%s"', (input, expected) => {
            expect(cleanTitle(input)).toBe(expected);
        });
    });

    describe('edge cases', () => {
        test('returns empty when everything stripped', () => {
            expect(cleanTitle('คณิต พรุ่งนี้')).toBe('');
        });
        test('handles empty string', () => {
            expect(cleanTitle('')).toBe('');
        });
        test('handles only subject', () => {
            expect(cleanTitle('คณิต')).toBe('');
        });
        test('handles only date', () => {
            expect(cleanTitle('15/06/2025')).toBe('');
        });
        test('preserves non-matching text', () => {
            expect(cleanTitle('hello world')).toBe('hello world');
        });
        test('handles special characters', () => {
            expect(cleanTitle('คณิต (งานกลุ่ม) 15/06/25')).toBe('(งานกลุ่ม)');
        });
    });
});
