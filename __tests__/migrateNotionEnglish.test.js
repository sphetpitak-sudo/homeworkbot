import { jest } from "@jest/globals";

/* We can't import the script directly (it runs main() on load), so we
   re-derive the translation logic in the test. Keep these tables in
   sync with scripts/migrate_notion_to_english.js — if you change
   them there, mirror here. */

const SUBJECT_MAP = {
    "คณิต": "Math", "คณิตศาสตร์": "Math",
    "อังกฤษ": "English", "อิ้ง": "English",
    "ฟิสิกส์": "Physics", "ฟิสิก": "Physics",
    "เคมี": "Chemistry",
    "ชีวะ": "Biology", "ชีววิทยา": "Biology",
    "ไทย": "Thai", "ภาษาไทย": "Thai",
    "สังคม": "Social Studies", "สังคมศึกษา": "Social Studies",
    "ประวัติ": "History", "ประวัติศาสตร์": "History",
    "คอม": "Computer", "คอมพิวเตอร์": "Computer",
    "สุขศึกษา": "Health", "พละ": "PE",
    "ทั่วไป": "General",
};

const PRIORITY_MAP = {
    "🔴 สูง": "🔴 High",
    "🟡 กลาง": "🟡 Medium",
    "🟢 ต่ำ": "🟢 Low",
    "High": "🔴 High",
    "Medium": "🟡 Medium",
    "Low": "🔴 High".replace("High", "Low"),
};

const TAG_MAP = {
    "สอบ": "Exam",
    "โครงการ": "Project",
    "กลุ่ม": "Group",
    "ด่วน": "Urgent",
    "อ่าน": "Reading",
    "ใบงาน": "Worksheet",
};

function translateSubject(s) { return SUBJECT_MAP[s] || s; }
function translatePriority(p) { return PRIORITY_MAP[p] || p; }
function translateTags(tags) { return tags.map(t => TAG_MAP[t] || t); }

describe("Notion migration translation tables", () => {
    test("translates all known Thai subjects", () => {
        expect(translateSubject("คณิต")).toBe("Math");
        expect(translateSubject("คณิตศาสตร์")).toBe("Math");
        expect(translateSubject("อังกฤษ")).toBe("English");
        expect(translateSubject("ฟิสิกส์")).toBe("Physics");
        expect(translateSubject("เคมี")).toBe("Chemistry");
        expect(translateSubject("ชีวะ")).toBe("Biology");
        expect(translateSubject("ไทย")).toBe("Thai");
        expect(translateSubject("สังคม")).toBe("Social Studies");
        expect(translateSubject("ประวัติ")).toBe("History");
        expect(translateSubject("คอม")).toBe("Computer");
        expect(translateSubject("สุขศึกษา")).toBe("Health");
        expect(translateSubject("พละ")).toBe("PE");
        expect(translateSubject("ทั่วไป")).toBe("General");
    });

    test("passes through English subjects unchanged", () => {
        expect(translateSubject("Math")).toBe("Math");
        expect(translateSubject("English")).toBe("English");
        expect(translateSubject("Physics")).toBe("Physics");
        expect(translateSubject("Computer Science")).toBe("Computer Science"); // novel EN
    });

    test("leaves unknown Thai subjects alone (returns input)", () => {
        expect(translateSubject("ดนตรี")).toBe("ดนตรี");
        expect(translateSubject("ศิลปะ")).toBe("ศิลปะ");
        expect(translateSubject("")).toBe("");
    });

    test("translates priority values", () => {
        expect(translatePriority("🔴 สูง")).toBe("🔴 High");
        expect(translatePriority("🟡 กลาง")).toBe("🟡 Medium");
        expect(translatePriority("🟢 ต่ำ")).toBe("🟢 Low");
    });

    test("passes through English priority values", () => {
        expect(translatePriority("🔴 High")).toBe("🔴 High");
        expect(translatePriority("🟡 Medium")).toBe("🟡 Medium");
        expect(translatePriority("🟢 Low")).toBe("🟢 Low");
    });

    test("translates known tags exactly", () => {
        expect(translateTags(["สอบ", "ด่วน"])).toEqual(["Exam", "Urgent"]);
        expect(translateTags(["โครงการ", "กลุ่ม"])).toEqual(["Project", "Group"]);
        expect(translateTags(["อ่าน", "ใบงาน"])).toEqual(["Reading", "Worksheet"]);
    });

    test("leaves novel or compound tags alone", () => {
        expect(translateTags(["สอบกลางภาค"])).toEqual(["สอบกลางภาค"]);
        expect(translateTags(["myCustomTag"])).toEqual(["myCustomTag"]);
        expect(translateTags([])).toEqual([]);
    });

    test("mixes known and novel tags in one list", () => {
        expect(translateTags(["สอบ", "midterm", "ด่วน"])).toEqual(["Exam", "midterm", "Urgent"]);
    });
});
