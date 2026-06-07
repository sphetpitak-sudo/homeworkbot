import { fetchActive, getPageProps } from "./notionService.js";
import { statusLabel } from "../utils/constants.js";
import { logger } from "../utils/logger.js";
import { MODELS, getClient } from "./modelClient.js";

export function isQaReady() {
    return !!getClient();
}

export async function askAI(question) {
    try {
        const pages = await fetchActive();
        if (!pages.length) {
            return "📭 ไม่มีการบ้านค้างอยู่เลย";
        }

        const homeworkLines = pages.map((p, i) => {
            const { title, status, due, subject, priority } = getPageProps(p);
            const emoji = status === "In Progress" ? "🔄" : "📌";
            return `${i + 1}. ${emoji} [${subject}] "${title}" — ส่ง: ${due || "ไม่กำหนด"} (${statusLabel(status)}) ความสำคัญ: ${priority}`;
        });

        const homeworkText = homeworkLines.join("\n");
        const c = getClient();
        if (!c) return null;

        let lastErr = null;

        for (let attempt = 0; attempt < MODELS.length; attempt++) {
            const model = MODELS[attempt];
            try {
                const res = await c.chat.completions.create({
                    model,
                    messages: [
                        {
                            role: "system",
                            content:
                                "คุณคือผู้ช่วยตอบคำถามเกี่ยวกับการบ้านของนักเรียน ตอบสั้น กระชับ เป็นกันเอง ใช้ภาษาไทย อ่านง่าย มีอีโมจิเล็กน้อย ตอบจากข้อมูลการบ้านที่ให้เท่านั้น",
                        },
                        {
                            role: "user",
                            content: `ข้อมูลการบ้าน:\n${homeworkText}\n\nคำถาม: ${question}\n\nตอบ:`,
                        },
                    ],
                    temperature: 0.3,
                    max_tokens: 300,
                });

                const answer = res.choices?.[0]?.message?.content?.trim();
                if (answer) return answer;
            } catch (err) {
                lastErr = err;
                const status = err.status || (err.message && /^429\b/.test(String(err.message)) ? 429 : 0);
                const isRetryable = status === 429 || status >= 500;
                if (!isRetryable || attempt >= MODELS.length - 1) break;
                logger.warn(`${model} quota hit, switching to ${MODELS[attempt + 1]}...`);
            }
        }

        if (lastErr) logger.error("askAI failed:", lastErr?.message || lastErr);
        return null;
    } catch (err) {
        logger.error("askAI:", err);
        return null;
    }
}
