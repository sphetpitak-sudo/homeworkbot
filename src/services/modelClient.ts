import OpenAI from "openai";
import { logger } from "../utils/logger.js";

export const MODELS = [
    "typhoon-v2.5-30b-a3b-instruct",
    "typhoon-v2.1-12b-instruct",
];

let client = null;
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 500;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms).unref());
}

export function getClient() {
    if (client) return client;
    const key = process.env.TYPHOON_API_KEY?.trim();
    if (!key) return null;
    client = new OpenAI({
        apiKey: key,
        baseURL: "https://api.opentyphoon.ai/v1",
    });
    return client;
}

export function initAI() {
    const c = getClient();
    if (c) {
        logger.info(`AI service ready ✅ (${MODELS.length} models, primary: ${MODELS[0]})`);
    } else {
        logger.warn("TYPHOON_API_KEY not set — AI parsing disabled, using regex fallback");
    }
    return !!c;
}

export function isAIReady() {
    return !!getClient();
}

export async function callWithModelFallback({ systemMsg, userMsg, temperature = 0.1, maxTokens = 200 }) {
    const c = getClient();
    if (!c) return null;

    for (let attempt = 0; attempt < MODELS.length; attempt++) {
        const model = MODELS[attempt];
        const now = Date.now();
        const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestTime));
        if (wait > 0) await sleep(wait);

        try {
            lastRequestTime = Date.now();
            const resp = await c.chat.completions.create({
                model,
                messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: userMsg },
                ],
                temperature,
                max_tokens: maxTokens,
            });
            return { resp, model };
        } catch (err) {
            const status = err.status;
            const isRetryable = status === 429 || status >= 500 || (err.message && /^429\b/.test(String(err.message)));
            if (isRetryable && attempt < MODELS.length - 1) {
                logger.warn(`${model} quota hit, switching to ${MODELS[attempt + 1]}...`);
                continue;
            }
            if (isRetryable) {
                logger.warn("All models exhausted");
            }
            throw err;
        }
    }
    return null;
}
