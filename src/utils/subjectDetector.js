const SUBJECT_MAP = {
    คณิต: ["คณิต", "คนิด", "คณต", "math", "เลข", "แคลคูลัส", "สถิติ"],
    อังกฤษ: ["อังกฤษ", "english", "eng", "อิ๊ง"],
    ฟิสิกส์: ["ฟิสิกส์", "ฟิสิก", "physics"],
    เคมี: ["เคมี", "chem", "chemistry"],
    ชีวะ: ["ชีวะ", "ชีวา", "bio", "biology"],
    ไทย: ["ภาษาไทย", "ไทย", "อิเหนา", "ภาษาไทย"],
    สังคม: ["สังคม", "social", "สค", "สังคมศึกษา"],
    ประวัติ: ["ประวัติ", "history", "hist"],
    คอม: ["คอม", "computer", "โปรแกรม", "coding", "it", "วิทยาการคำนวณ"],
};

const SUBJECT_EMOJI = {
    คณิต: "🔢",
    อังกฤษ: "🔤",
    ฟิสิกส์: "⚛️",
    เคมี: "🧪",
    ชีวะ: "🧬",
    ไทย: "📜",
    สังคม: "🌏",
    ประวัติ: "🏛️",
    คอม: "💻",
};

// Pre-build a regex that matches any subject keyword — used by cleanTitle
const ALL_SUBJECT_KEYWORDS = Object.values(SUBJECT_MAP).flat();
// Sort longest first so that e.g. "ภาษาไทย" is matched before "ไทย"
ALL_SUBJECT_KEYWORDS.sort((a, b) => b.length - a.length);
const SUBJECT_KEYWORD_PATTERN = new RegExp(
    ALL_SUBJECT_KEYWORDS.map((k) =>
        k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join("|"),
    "gi",
);

export function detectSubject(text) {
    const t = text.toLowerCase();
    for (const [sub, keys] of Object.entries(SUBJECT_MAP))
        for (const k of keys) if (t.includes(k)) return sub;
    return "ทั่วไป";
}

export function subjectEmoji(sub) {
    return SUBJECT_EMOJI[sub] || "📖";
}

export function cleanTitle(text) {
    return (
        text
            // strip subject keywords (e.g. "ชีวะ", "math")
            .replace(SUBJECT_KEYWORD_PATTERN, "")
            // strip date formats dd/mm/yy(yy)
            .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, "")
            // strip relative day offsets
            .replace(/อีก\s*\d+\s*(วัน|สัปดาห์|อาทิตย์)/g, "")
            // strip day-name keywords
            .replace(/สัปดาห์หน้า|พรุ่งนี้|มะรืน|วันนี้/g, "")
            .replace(
                /วัน(จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)(หน้า)?/g,
                "",
            )
            // collapse whitespace
            .replace(/\s+/g, " ")
            .trim()
    );
}
