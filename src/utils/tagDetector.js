const TAG_RULES = [
    {
        tag: "สอบ",
        keywords: [
            "สอบ", "ข้อสอบ", "สอบปลายภาค", "สอบกลางภาค", "สอบเก็บคะแนน",
            "สอบย่อย", "สอบปลายปี", "สอบกลางปี", "สอบครั้ง", "สอบไฟนอล",
            "final", "midterm", "สอบกลางภาค", "สอบเก็บ", "สอบบท",
            "สอบครั้งที่", "สอบที", "สอบขอ", "สอบปลายเทอม",
            "สอบไฟนอล", "ไฟนอล", "final exam", "ข้อสอบเก่า",
        ],
    },
    {
        tag: "โครงการ",
        keywords: [
            "โครงการ", "โปรเจกต์", "โปรเจค", "โปรเจ็ค", "project",
            "โครงงาน", "งานใหญ่", "มินิโปรเจกต์", "มินิโปรเจค",
            "โปรเจคจบ", "โปรเจกต์จบ",
        ],
    },
    {
        tag: "กลุ่ม",
        keywords: [
            "กลุ่ม", "งานกลุ่ม", "นำเสนอ", "พรีเซนต์", "present",
            "presentation", "พรีเซน", "พรีเซนท์", "presentation",
            "ทำงานกลุ่ม", "แบ่งกลุ่ม", "กลุ่มย่อย", "work group",
        ],
    },
    {
        tag: "ด่วน",
        keywords: [
            "ด่วน", "ด่วนที่สุด", "เร่งด่วน", "รีบ", "เร็ว",
            "ส่งวันนี้", "ส่งพรุ่งนี้", "ภายในวันนี้", "พรุ่งนี้เช้า",
            " urgent", "asap", "ด่วนมาก",
        ],
    },
    {
        tag: "อ่าน",
        keywords: [
            "อ่าน", "ท่อง", "อาขยาน", "บทอ่าน", "อ่านหนังสือ",
            "ท่องจำ", "อ่านบทความ", "เรื่องสั้น", "กลอน", "บทกลอน",
            "อ่านจับใจความ", "reading", "หนังสืออ่าน", "บทที่",
            "นิทาน", "วรรณคดี", "บทอาขยาน", "อาขยานบท",
        ],
    },
    {
        tag: "ใบงาน",
        keywords: [
            "ใบงาน", "แบบฝึกหัด", "ใบกิจกรรม", "ใบความรู้",
            "ใบงานที่", "แบบฝึกหัดที่", "ทำโจทย์", "โจทย์",
            "worksheet", "ใบงานวิชา", "work sheet",
            "ใบงานส่ง", "แบบฝึกหัดส่ง", "ทำแบบฝึกหัด",
        ],
    },
];

const TAG_ALIASES = {
    "สอบ": ["สอบ", "สอบปลายภาค", "สอบกลางภาค", "ข้อสอบ"],
    "โครงการ": ["โปรเจค", "project", "โครงงาน"],
    "กลุ่ม": ["กลุ่ม", "นำเสนอ", "present"],
    "ด่วน": ["ด่วน", "เร่งด่วน", " urgent"],
    "อ่าน": ["อ่าน", "ท่อง", "อาขยาน"],
    "ใบงาน": ["ใบงาน", "แบบฝึกหัด", "worksheet"],
};

export const VALID_TAGS = TAG_RULES.map(r => r.tag);

export function parseTags(text) {
    const matches = text.match(/#(\S+)/g);
    if (!matches) return [];
    return matches
        .map(t => t.slice(1).replace(/[^a-zA-Zก-๙0-9_\-]/g, ""))
        .filter(Boolean);
}

export function inferTags(text) {
    const tags = new Set();
    const lower = text.toLowerCase();

    for (const { tag, keywords } of TAG_RULES) {
        for (const kw of keywords) {
            if (lower.includes(kw.toLowerCase())) {
                tags.add(tag);
                break;
            }
        }
    }

    return [...tags];
}

export function inferAndParseTags(text) {
    const hashtags = parseTags(text);
    const inferred = inferTags(text);
    const merged = [...new Set([...inferred, ...hashtags])];
    return merged.length ? merged : undefined;
}
