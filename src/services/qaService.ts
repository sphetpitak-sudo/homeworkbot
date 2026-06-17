import { fetchActive, getPageProps } from "./notionService.js";
import { statusLabel } from "../utils/constants.js";
import { logger } from "../utils/logger.js";
import { getClient, callWithModelFallback } from "./modelClient.js";

export function isQaReady() {
    return !!getClient();
}

export async function askAI(question: string): Promise<string | null> {
    try {
        const pages = await fetchActive();
        if (!pages.length) {
            return "📭 ไม่มีการบ้านค้างอยู่เลย";
        }

        const homeworkLines = pages.map((p: any, i: number) => {
            const { title, status, due, subject, priority } = getPageProps(p);
            const emoji = status === "In Progress" ? "🔄" : "📌";
            return `${i + 1}. ${emoji} [${subject}] "${title}" — ส่ง: ${due || "ไม่กำหนด"} (${statusLabel(status)}) ความสำคัญ: ${priority}`;
        });

        const homeworkText = homeworkLines.join("\n");
        const systemMsg =
            "คุณคือผู้ช่วยตอบคำถามเกี่ยวกับการบ้านของนักเรียน ตอบสั้น กระชับ เป็นกันเอง ใช้ภาษาไทย อ่านง่าย มีอีโมจิเล็กน้อย ตอบจากข้อมูลการบ้านที่ให้เท่านั้น";
        const userMsg = `ข้อมูลการบ้าน:\n${homeworkText}\n\nคำถาม: ${question}\n\nตอบ:`;

        const result = await callWithModelFallback({
            systemMsg,
            userMsg,
            temperature: 0.3,
            maxTokens: 300,
        });

        if (!result) return null;

        const answer = result.resp.choices?.[0]?.message?.content?.trim();
        return answer || null;
    } catch (err: any) {
        logger.error("askAI:", err);
        return null;
    }
}
