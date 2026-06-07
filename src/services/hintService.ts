import { fetchActive } from "./notionService.js"
import { logger } from "../utils/logger.js"

const FALLBACK_TIPS = {
    คณิต: "เริ่มจากโจทย์ที่ง่ายที่สุดก่อน แล้วค่อยไปข้อที่ยาก\n• เขียนสูตรที่ต้องใช้ก่อนเริ่มทำ\n• ถ้าติดตรงไหน ให้ข้ามไปก่อน แล้วกลับมาทำทีหลัง",
    ไทย: "อ่านหัวข้อที่ต้องทำก่อน แล้ววางโครงเรื่อง\n• หาคำสำคัญในโจทย์\n• แบ่งเนื้อหาออกเป็นส่วนๆ แล้วค่อยเขียนทีละส่วน",
    อังกฤษ: "หาคำศัพท์ที่ไม่เข้าใจก่อน แล้วค่อยเริ่มเขียน\n• เปิด dictionary ช่วยได้\n• เขียน draft คร่าวๆ ก่อน แล้วค่อยแก้ไข",
    ฟิสิกส์: "เขียนสูตรที่ต้องใช้ก่อน แล้วค่อยแทนค่า\n• วาดรูปประกอบเพื่อให้เข้าใจโจทย์\n• ตรวจสอบหน่วยให้ถูกต้องทุกครั้ง",
    เคมี: "ดูโจทย์ว่าต้องใช้สูตรอะไร เขียนสิ่งที่โจทย์ให้มาก่อน\n• ดุลสมการก่อนคำนวณ\n• ตรวจสอบเลขอะตอมและมวลอะตอมให้ถูกต้อง",
    ชีวะ: "อ่านเนื้อหาก่อน แล้วทำความเข้าใจทีละหัวข้อ\n• สรุปเป็น diagram หรือ mind map\n• ท่องศัพท์เฉพาะทางก่อนเริ่มทำ",
    สังคม: "หาประเด็นหลักก่อน แล้วค่อยขยายรายละเอียด\n• ใช้ข้อมูลจากหลายแหล่ง\n• อ้างอิงแหล่งที่มาให้ถูกต้อง",
    ประวัติ: "ลำดับเหตุการณ์ก่อน แล้วใส่รายละเอียด\n• ตรวจสอบปี พ.ศ. ให้ถูกต้อง\n• ใช้ timeline ช่วยในการจำ",
    คอม: "แบ่งปัญหาออกเป็นส่วนย่อยๆ แล้วเขียนทีละส่วน\n• ทดสอบแต่ละส่วนก่อนรวมกัน\n• ใช้ pseudocode วางแผนก่อนเขียนจริง",
    สุขศึกษา: "อ่านเนื้อหาก่อน แล้วจับประเด็นสำคัญ\n• ใช้ตัวอย่างจากชีวิตประจำวัน\n• ทบทวนศัพท์เฉพาะทาง",
    ทั่วไป: "เริ่มจากสิ่งที่รู้ก่อน แล้วค่อยหาข้อมูลเพิ่ม\n• แบ่งงานเป็นส่วนย่อยๆ\n• ตั้งเป้าหมายเล็กๆ เพื่อให้รู้สึกว่าก้าวหน้า",
}

function getFallbackTip(subject) {
    return FALLBACK_TIPS[subject] || FALLBACK_TIPS["ทั่วไป"]
}

function buildHomeworkList(items) {
    return items.map((p, i) => {
        const title = p.properties.Name?.title?.[0]?.plain_text || "ไม่มีชื่อ"
        const due = p.properties.Due?.date?.start || "ไม่มีกำหนด"
        const priority = p.properties.Priority?.select?.name || "🟡 กลาง"
        return `${i + 1}. ${title} (${priority} — ส่ง ${due})`
    }).join("\n")
}

export async function getStudyTip(subject, homeworkItems) {
    if (!homeworkItems || !homeworkItems.length) {
        return null
    }

    const list = buildHomeworkList(homeworkItems)
    const fallback = getFallbackTip(subject)

    const msg =
        `📚 งาน ${subject} ที่ค้าง (${homeworkItems.length} ชิ้น):\n` +
        `${list}\n\n` +
        `✨ คำแนะนำ:\n${fallback}\n\n` +
        `💪 สู้ๆ!`

    return msg
}

export function getFallbackTipForSubject(subject) {
    return getFallbackTip(subject)
}
