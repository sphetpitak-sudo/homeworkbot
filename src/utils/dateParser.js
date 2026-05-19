export const THAI_DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
export const THAI_MONTHS = [
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค.",
];

/** แปลง Date object เป็น YYYY-MM-DD โดยใช้ local timezone (ไม่ใช้ UTC) */
export function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
}

/** แปลง "YYYY-MM-DD" เป็น Date object ใน local timezone */
export function parseYMDToLocalDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function parseThaiDate(text) {
    if (!text) return null;

    const now = new Date();
    const t = text
        .toLowerCase()
        .replace(/สัปดาหน้า/g, "สัปดาห์หน้า")
        .replace(/อาทิตย์?(?=[^์]|$)/g, "อาทิตย์");

    if (t.includes("วันนี้")) return formatDate(now);
    if (t.includes("พรุ่งนี้")) {
        now.setDate(now.getDate() + 1);
        return formatDate(now);
    }
    if (t.includes("มะรืน")) {
        now.setDate(now.getDate() + 2);
        return formatDate(now);
    }

    let m;
    m = t.match(/อีก\s*(\d+)\s*วัน/);
    if (m) {
        now.setDate(now.getDate() + +m[1]);
        return formatDate(now);
    }

    m = t.match(/อีก\s*(\d+)\s*(สัปดาห์|อาทิตย์)/);
    if (m) {
        now.setDate(now.getDate() + +m[1] * 7);
        return formatDate(now);
    }

    if (t.includes("สัปดาห์หน้า")) {
        now.setDate(now.getDate() + 7);
        return formatDate(now);
    }

    m = t.match(/วันที่?\s*(\d{1,2})/);
    if (m) {
        const day = +m[1];
        if (day >= 1 && day <= 31) {
            const target = new Date(now.getFullYear(), now.getMonth(), day);
            if (target.getDate() !== day) {
                const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, day);
                return formatDate(nextMonth);
            }
            return formatDate(target);
        }
    }

    const days = {
        อาทิตย์: 0,
        จันทร์: 1,
        อังคาร: 2,
        พุธ: 3,
        พฤหัส: 4,
        ศุกร์: 5,
        เสาร์: 6,
    };
    for (const [name, num] of Object.entries(days)) {
        if (t.includes(name)) {
            const target = new Date();
            let diff = (num - target.getDay() + 7) % 7;
            if (t.includes("หน้า") && !t.includes("หน้าต่าง") && !t.includes("หน้าหนังสือ")) diff += 7;
            if (diff === 0) diff = 7;
            target.setDate(target.getDate() + diff);
            return formatDate(target);
        }
    }

    m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
        let [, d, mo, y] = m;
        d = +d; mo = +mo;
        if (y.length === 2) y = "20" + y;
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }

    return null;
}

export function formatDateLabel(dateStr, type = "due") {
    if (!dateStr) return type === "completed" ? "—" : "ไม่มีกำหนดส่ง 📅";
    const dt = parseYMDToLocalDate(dateStr);
    if (isNaN(dt.getTime())) return dateStr;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.floor((dt - today) / 86_400_000);
    const label = `${THAI_DAYS[dt.getDay()]}${dt.getDate()} ${THAI_MONTHS[dt.getMonth()]}`;

    if (type === "completed") {
        if (diff === 0) return `✅ เสร็จแล้ว ${label} (วันนี้)`;
        if (diff === -1) return `✅ เสร็จแล้ว ${label} (เมื่อวาน)`;
        return `✅ เสร็จแล้ว ${label} (${Math.abs(diff)} วันที่แล้ว)`;
    }

    if (diff < 0) return `📅 ${label} (⚠️ เกินกำหนด ${Math.abs(diff)} วัน)`;
    if (diff === 0) return `📅 ${label} (🔥 วันนี้!)`;
    if (diff === 1) return `📅 ${label} (⏰ พรุ่งนี้)`;
    return `📅 ${label} (อีก ${diff} วัน)`;
}

export function formatCompletedDisplay(completed) {
    return formatDateLabel(completed, "completed");
}

export function formatDueDisplay(due) {
    return formatDateLabel(due, "due");
}
