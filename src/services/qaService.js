import OpenAI from "openai";
import { fetchActive, getPageProps } from "./notionService.js";
import { logger } from "../utils/logger.js";

const MODELS = [
    "llama-3.3-70b-versatile",
    "mixtral-8x7b-32768",
    "llama-3.1-8b-instant",
];

let client = null;
let modelIndex = 0;

function getClient() {
    if (client) return client;
    const key = process.env.GROQ_API_KEY?.trim();
    if (!key) return null;
    client = new OpenAI({
        apiKey: key,
        baseURL: "https://api.groq.com/openai/v1",
    });
    return client;
}

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
            const model = MODELS[(modelIndex + attempt) % MODELS.length];
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

                modelIndex = (modelIndex + attempt) % MODELS.length;
                const answer = res.choices?.[0]?.message?.content?.trim();
                if (answer) return answer;
            } catch (err) {
                lastErr = err;
                if (err.status !== 429) break;
            }
        }

        logger.error("askAI failed:", lastErr?.message || lastErr);
        return null;
    } catch (err) {
        logger.error("askAI:", err);
        return null;
    }
}

function statusLabel(status) {
    return status === "Done" ? "เสร็จแล้ว" : status === "In Progress" ? "กำลังทำ" : "ยังไม่ทำ";
}
