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

    describe('more keyword variants (matching actual keyword lists)', () => {
    // ไทย
    test.each([
        ['ภาษาไทย', 'ภาษาไทยพื้นฐาน'],
        ['ไทย', 'การบ้านไทย'],
        ['อิเหนา', 'อิเหนาศึกกะหมังกุหนิง'],
        ['กลอน', 'แต่งกลอนส่งครู'],
        ['วรรณคดี', 'วรรณคดีไทย'],
        ['นิราศ', 'นิราศภูเขาทอง'],
        ['สุภาษิต', 'สุภาษิตสอนหญิง'],
        ['คำราชาศัพท์', 'คำราชาศัพท์ ม.3'],
        ['เรียงความ', 'เรียงความเรื่องแม่'],
        ['ขุนช้างขุนแผน', 'ขุนช้างขุนแผนตอนกำเนิดพลายงาม'],
        ['โคลง', 'โคลงสี่สุภาพ'],
        ['กาพย์', 'กาพย์เห่เรือ'],
        ['ฉันท์', 'ฉันท์วรรณพฤติ'],
        ['ร่าย', 'ร่ายยาว'],
        ['สำนวน', 'สำนวนไทย'],
    ])('ไทย: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('ไทย');
    });

    // อังกฤษ
    test.each([
        ['ภาษาอังกฤษ', 'ภาษาอังกฤษเพื่อการสื่อสาร'],
        ['อังกฤษ', 'การบ้านอังกฤษ'],
        ['english', 'english grammar'],
        ['eng', 'eng reading'],
        ['อิ๊ง', 'ข้อสอบอิ๊ง'],
        ['grammar', 'grammar exercises'],
        ['vocabulary', 'vocabulary quiz'],
        ['tense', 'tense exercises'],
        ['essay', 'essay writing'],
        ['passive voice', 'passive voice exercises'],
        ['conditional', 'conditional sentences'],
        ['relative clause', 'relative clause worksheet'],
        ['reported speech', 'reported speech exercises'],
        ['paragraph', 'paragraph writing'],
        ['conversation', 'conversation practice'],
    ])('อังกฤษ: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('อังกฤษ');
    });

    // ฟิสิกส์
    test.each([
        ['ฟิสิกส์นิวเคลียร์', 'ฟิสิกส์นิวเคลียร์'],
        ['ฟิสิก', 'ฟิสิก ม.6'],
        ['physics', 'physics lab report'],
        ['แรง', 'แรงและการเคลื่อนที่'],
        ['การเคลื่อนที่', 'การเคลื่อนที่แนวตรง'],
        ['ความเร็ว', 'ความเร็วและความเร่ง'],
        ['โมเมนตัม', 'โมเมนตัมและการชน'],
        ['พลังงาน', 'พลังงานกล'],
        ['โพรเจกไทล์', 'โพรเจกไทล์'],
        ['ไฟฟ้า', 'ไฟฟ้าสถิต'],
        ['วงจรไฟฟ้า', 'วงจรไฟฟ้าอย่างง่าย'],
        ['สนามแม่เหล็ก', 'สนามแม่เหล็กโลก'],
        ['คลื่น', 'คลื่นเสียง'],
        ['แสง', 'แสงและการมองเห็น'],
        ['เลนส์', 'เลนส์บาง'],
        ['เสียง', 'เสียงและการได้ยิน'],
        ['การสะท้อน', 'การสะท้อนแสง'],
        ['การหักเห', 'การหักเหแสง'],
        ['นิวเคลียร์', 'นิวเคลียร์ฟิชชัน'],
        ['กัมมันตภาพรังสี', 'กัมมันตภาพรังสี'],
    ])('ฟิสิกส์: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('ฟิสิกส์');
    });

    // เคมี
    test.each([
        ['เคมีวิเคราะห์', 'เคมีวิเคราะห์'],
        ['เคมีอินทรีย์', 'เคมีอินทรีย์'],
        ['chem', 'chem lab'],
        ['chemistry', 'chemistry report'],
        ['แก๊ส', 'แก๊สในชีวิตประจำวัน'],
        ['โมล', 'โมลและสูตรเคมี'],
        ['STP', 'STP แก๊ส'],
        ['ออกซิเจน', 'สมบัติของออกซิเจน'],
        ['ไฮโดรเจน', 'ไฮโดรเจน'],
        ['ธาตุ', 'ธาตุและสารประกอบ'],
        ['ตารางธาตุ', 'ตารางธาตุ'],
        ['พันธะเคมี', 'พันธะเคมี'],
        ['สารละลาย', 'สารละลายกรด-เบส'],
        ['กรด-เบส', 'กรด-เบส'],
        ['กรดเบส', 'กรดเบส'],
        ['ปฏิกิริยาเคมี', 'ปฏิกิริยาเคมี'],
        ['สมการเคมี', 'สมการเคมี'],
        ['พอลิเมอร์', 'พอลิเมอร์'],
        ['จลนศาสตร์', 'จลนศาสตร์เคมี'],
        ['อะตอม', 'โครงสร้างอะตอม'],
        ['จุดเดือด', 'จุดเดือดและจุดหลอมเหลว'],
        ['จุดหลอมเหลว', 'จุดหลอมเหลว'],
    ])('เคมี: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('เคมี');
    });

    test('ไฟฟ้าเคมี matches ฟิสิกส์ (ไฟฟ้า keyword), not เคมี', () => {
        expect(detectSubject('ไฟฟ้าเคมี')).toBe('ฟิสิกส์');
    });

    // ชีวะ
    test.each([
        ['ชีวะ', 'ชีวะเซลล์'],
        ['ชีวา', 'ชีวาระบบนิเวศ'],
        ['ชีว', 'ชีววิทยา'],
        ['bio', 'bio class'],
        ['biology', 'biology report'],
        ['เซลล์', 'เซลล์พืช'],
        ['DNA', 'DNA replication'],
        ['RNA', 'RNA transcription'],
        ['ยีน', 'ยีนและโครโมโซม'],
        ['พันธุกรรม', 'พันธุกรรม'],
        ['วิวัฒนาการ', 'วิวัฒนาการมนุษย์'],
        ['ระบบนิเวศ', 'ระบบนิเวศ'],
        ['ห่วงโซ่อาหาร', 'ห่วงโซ่อาหาร'],
        ['เนื้อเยื่อพืช', 'เนื้อเยื่อพืช'],
        ['การสืบพันธุ์', 'การสืบพันธุ์ของพืช'],
        ['ระบบประสาท', 'ระบบประสาท'],
        ['ระบบหมุนเวียนเลือด', 'ระบบหมุนเวียนเลือด'],
        ['ระบบหายใจ', 'ระบบหายใจ'],
        ['ระบบย่อยอาหาร', 'ระบบย่อยอาหาร'],
        ['ระบบขับถ่าย', 'ระบบขับถ่าย'],
        ['พืช', 'พืชดอก'],
        ['สัตว์', 'สัตว์มีกระดูกสันหลัง'],
        ['ไมโทซิส', 'ไมโทซิส'],
        ['ไมโอซิส', 'ไมโอซิส'],
        ['โครโมโซม', 'โครโมโซม'],
    ])('ชีวะ: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('ชีวะ');
    });

    // คณิต
    test.each([
        ['คณิตศาสตร์', 'ทำการบ้านคณิตศาสตร์'],
        ['คณิต', 'แบบฝึกหัดคณิต'],
        ['คนิด', 'ข้อสอบคนิด'],
        ['แคลคูลัส', 'แคลคูลัสเบื้องต้น'],
        ['ตรีโกณ', 'ตรีโกณมิติ'],
        ['เลข', 'เลขบทที่ 5'],
        ['math', 'math problems'],
        ['สถิติ', 'สถิติและความน่าจะเป็น'],
        ['เลขยกกำลัง', 'เลขยกกำลัง ม.5'],
        ['พหุนาม', 'พหุนามและเศษส่วน'],
        ['อสมการ', 'อสมการเชิงเส้น'],
        ['เรขาคณิต', 'เรขาคณิตวิเคราะห์'],
        ['ฟังก์ชัน', 'ฟังก์ชัน'],
        ['เมทริกซ์', 'เมทริกซ์'],
        ['เซต', 'เซตและการดำเนินการ'],
        ['ตรรกศาสตร์', 'ตรรกศาสตร์เบื้องต้น'],
        ['อนุพันธ์', 'อนุพันธ์ของฟังก์ชัน'],
        ['ปริพันธ์', 'ปริพันธ์'],
        ['ความน่าจะเป็น', 'ความน่าจะเป็น'],
        ['พีทาโกรัส', 'ทฤษฎีบทพีทาโกรัส'],
        ['ร้อยละ', 'ร้อยละและอัตราส่วน'],
        ['อัตราส่วน', 'อัตราส่วน'],
        ['แผนภูมิ', 'แผนภูมิแท่ง'],
        ['กราฟ', 'กราฟของฟังก์ชัน'],
        ['แยกตัวประกอบ', 'การแยกตัวประกอบ'],
        ['จำนวนเชิงซ้อน', 'จำนวนเชิงซ้อน'],
        ['เอกซ์โปเนนเชียล', 'เอกซ์โปเนนเชียล'],
        ['ลอการิทึม', 'ลอการิทึม'],
    ])('คณิต: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('คณิต');
    });

    // สังคม
    test.each([
        ['สังคม', 'สังคมศึกษาภูมิศาสตร์'],
        ['social', 'social studies'],
        ['สค', 'สค ม.2'],
        ['สังคมศึกษา', 'สังคมศึกษาเศรษฐกิจ'],
        ['ศาสนา', 'ศาสนาพุทธ'],
        ['ศีลธรรม', 'ศีลธรรม'],
        ['จริยธรรม', 'จริยธรรม'],
        ['หน้าที่พลเมือง', 'หน้าที่พลเมืองดี'],
        ['กฎหมาย', 'กฎหมายแพ่ง'],
        ['รัฐธรรมนูญ', 'รัฐธรรมนูญ'],
        ['เศรษฐกิจ', 'เศรษฐกิจพอเพียง'],
        ['ภูมิศาสตร์', 'ภูมิศาสตร์ทวีปเอเชีย'],
        ['ทรัพยากร', 'ทรัพยากรธรรมชาติ'],
        ['สิ่งแวดล้อม', 'สิ่งแวดล้อม'],
        ['ASEAN', 'ASEAN community'],
        ['อาเซียน', 'อาเซียน'],
        ['เศรษฐศาสตร์', 'เศรษฐศาสตร์เบื้องต้น'],
        ['อุปสงค์', 'อุปสงค์และอุปทาน'],
        ['อุปทาน', 'อุปทาน'],
        ['โลกาภิวัตน์', 'โลกาภิวัตน์'],
        ['สิทธิมนุษยชน', 'สิทธิมนุษยชน'],
    ])('สังคม: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('สังคม');
    });

    // ประวัติ (but note: "ไทย" keyword may match first!)
    test.each([
        ['ประวัติศาสตร์อยุธยา', 'ประวัติศาสตร์อยุธยา'],
        ['history', 'history class'],
        ['hist', 'hist 101'],
        ['อาณาจักร', 'อาณาจักรสุโขทัย'],
        ['อารยธรรม', 'อารยธรรมโบราณ'],
        ['สุโขทัย', 'สุโขทัย'],
        ['อยุธยา', 'กรุงศรีอยุธยา'],
        ['ธนบุรี', 'ธนบุรี'],
        ['รัตนโกสินทร์', 'รัตนโกสินทร์'],
        ['สงครามโลก', 'สงครามโลกครั้งที่ 2'],
        ['ปฏิวัติ', 'ปฏิวัติฝรั่งเศส'],
        ['สนธิสัญญา', 'สนธิสัญญาเบาว์ริง'],
        ['โบราณ', 'โบราณคดี'],
        ['ยุคสมัย', 'ยุคสมัยก่อนประวัติศาสตร์'],
    ])('ประวัติ: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('ประวัติ');
    });

    test('ประวัติศาสตร์ไทย returns ไทย (ไทย keyword match first)', () => {
        expect(detectSubject('ประวัติศาสตร์ไทย')).toBe('ไทย');
    });

    // คอม
    test.each([
        ['คอมพิวเตอร์', 'คอมพิวเตอร์เบื้องต้น'],
        ['computer', 'computer science'],
        ['โปรแกรม', 'เขียนโปรแกรม'],
        ['coding', 'coding homework'],
        ['it', 'it fundamentals'],
        ['วิทยาการคำนวณ', 'วิทยาการคำนวณ'],
        ['วิทยาการคอมพิวเตอร์', 'วิทยาการคอมพิวเตอร์'],
        ['Scratch', 'Scratch programming'],
        ['Python', 'Python programming'],
        ['HTML', 'HTML CSS'],
        ['Algorithm', 'Algorithm design'],
        ['ข้อมูล', 'ข้อมูลและสารสนเทศ'],
        ['สารสนเทศ', 'ระบบสารสนเทศ'],
        ['Database', 'Database design'],
        ['Network', 'Network security'],
        ['AI', 'AI and machine learning'],
        ['ปัญญาประดิษฐ์', 'ปัญญาประดิษฐ์'],
        ['Cybersecurity', 'Cybersecurity'],
        ['Cloud', 'Cloud computing'],
    ])('คอม: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('คอม');
    });

    // สุขศึกษา
    test.each([
        ['สุขศึกษา', 'สุขศึกษาพลศึกษา'],
        ['พลศึกษา', 'พลศึกษากีฬา'],
        ['พละ', 'พละวันศุกร์'],
        ['กีฬา', 'กีฬาสีโรงเรียน'],
        ['ฟุตบอล', 'ฟุตบอล'],
        ['บาสเกตบอล', 'บาสเกตบอล'],
        ['วอลเลย์บอล', 'วอลเลย์บอล'],
        ['วิ่ง', 'วิ่งระยะสั้น'],
        ['กรีฑา', 'กรีฑา'],
        ['ว่ายน้ำ', 'ว่ายน้ำ'],
        ['แบดมินตัน', 'แบดมินตัน'],
        ['อนามัย', 'อนามัยส่วนบุคคล'],
        ['โภชนาการ', 'โภชนาการอาหาร 5 หมู่'],
        ['สารอาหาร', 'สารอาหาร'],
        ['เพศศึกษา', 'เพศศึกษา'],
        ['สารเสพติด', 'สารเสพติด'],
        ['ปฐมพยาบาล', 'ปฐมพยาบาล'],
        ['ความปลอดภัย', 'ความปลอดภัยในการเล่นกีฬา'],
        ['โรค', 'โรคติดต่อ'],
        ['ภูมิคุ้มกัน', 'ภูมิคุ้มกัน'],
        ['ออกกำลังกาย', 'ประโยชน์ของการออกกำลังกาย'],
        ['สมรรถภาพ', 'สมรรถภาพทางกาย'],
    ])('สุขศึกษา: "%s" detected from "%s"', (_, input) => {
        expect(detectSubject(input)).toBe('สุขศึกษา');
    });
    });

describe('more subject edge cases', () => {
    test('subject in English sentence', () => {
        expect(detectSubject('I have math homework')).toBe('คณิต');
    });
    test('subject with Thai level suffix', () => {
        expect(detectSubject('คณิต ม.3 เทอม 2')).toBe('คณิต');
    });
    test('subject with grade prefix', () => {
        expect(detectSubject('ม.4 ฟิสิกส์ บทที่ 1')).toBe('ฟิสิกส์');
    });
    test('subject inside parentheses', () => {
        expect(detectSubject('การบ้าน(คณิต)หน้า20')).toBe('คณิต');
    });
    test('subject with colon separator', () => {
        expect(detectSubject('วิชา:ชีวะ เรื่องเซลล์')).toBe('ชีวะ');
    });
    test('mixed Thai-English subject', () => {
        expect(detectSubject('Mathคณิต')).toBe('คณิต');
    });
    test('subject as first word', () => {
        expect(detectSubject('คณิตแบบฝึกหัดหน้า20พรุ่งนี้')).toBe('คณิต');
    });
    test('subject as last word', () => {
        expect(detectSubject('ทำรายงานส่งวันศุกร์สังคม')).toBe('สังคม');
    });
    test('only subject keyword', () => {
        expect(detectSubject('ฟิสิกส์')).toBe('ฟิสิกส์');
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
