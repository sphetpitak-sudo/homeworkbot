import OpenAI from "openai"
import { logger } from "../utils/logger.js"

export interface ProviderConfig {
    name: string
    apiKey: string | undefined
    baseURL: string | undefined
    models: string[]
    defaultBaseURL: string
}

const PROVIDERS: Record<string, ProviderConfig> = {
    typhoon: {
        name: "Typhoon",
        apiKey: process.env.TYPHOON_API_KEY,
        baseURL: process.env.TYPHOON_BASE_URL,
        models: ["typhoon-v2.5-30b-a3b-instruct", "typhoon-v2.1-12b-instruct"],
        defaultBaseURL: "https://api.opentyphoon.ai/v1",
    },
    openai: {
        name: "OpenAI",
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
        models: ["gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
        defaultBaseURL: "https://api.openai.com/v1",
    },
    anthropic: {
        name: "Anthropic",
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: process.env.ANTHROPIC_BASE_URL,
        models: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-sonnet-20240229"],
        defaultBaseURL: "https://api.anthropic.com/v1",
    },
    google: {
        name: "Google",
        apiKey: process.env.GOOGLE_API_KEY,
        baseURL: process.env.GOOGLE_BASE_URL,
        models: ["gemini-pro", "gemini-flash-1.5"],
        defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    },
}

const PROVIDER_ORDER = (process.env.AI_PROVIDERS || "typhoon,openai,anthropic,google")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => PROVIDERS[p])

let clients: Record<string, OpenAI | null> = {}
let lastRequestTime = 0
const MIN_INTERVAL_MS = 500

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms).unref?.())
}

export function getClient(provider?: string): OpenAI | null {
    const name = provider || PROVIDER_ORDER[0]
    if (!name || !PROVIDERS[name]) return null
    if (clients[name]) return clients[name]!

    const cfg = PROVIDERS[name]
    const key = cfg.apiKey?.trim()
    if (!key) return null

    clients[name] = new OpenAI({
        apiKey: key,
        baseURL: cfg.baseURL || cfg.defaultBaseURL,
    })
    return clients[name]
}

export function initAI() {
    const available = PROVIDER_ORDER.filter((name) => {
        const cfg = PROVIDERS[name]
        return !!cfg.apiKey?.trim()
    })
    if (available.length) {
        const modelList = available.map((n) => `${PROVIDERS[n].name} (${PROVIDERS[n].models.length} models)`).join(" → ")
        logger.info(`AI service ready ✅ providers: ${modelList}`)
    } else {
        logger.warn("No AI provider API keys set — AI parsing disabled, using regex fallback")
    }
    return available.length > 0
}

export function isAIReady() {
    return Object.values(PROVIDERS).some((cfg) => !!cfg.apiKey?.trim())
}

function getAvailableProviders() {
    return PROVIDER_ORDER.filter((name) => !!PROVIDERS[name].apiKey?.trim())
}

export async function callWithModelFallback({
    systemMsg,
    userMsg,
    temperature = 0.1,
    maxTokens = 200,
    provider: forceProvider,
}: {
    systemMsg: string
    userMsg: string
    temperature?: number
    maxTokens?: number
    provider?: string
}): Promise<{ resp: any; model: string; provider: string } | null> {
    const providers = forceProvider ? [forceProvider] : getAvailableProviders()
    if (!providers.length) return null

    for (const providerName of providers) {
        const cfg = PROVIDERS[providerName]
        if (!cfg) continue

        const c = getClient(providerName)
        if (!c) continue

        for (let attempt = 0; attempt < cfg.models.length; attempt++) {
            const model = cfg.models[attempt]
            try {
                const now = Date.now()
                const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestTime))
                if (wait > 0) await sleep(wait)

                lastRequestTime = Date.now()
                const resp = await c.chat.completions.create({
                    model,
                    messages: [
                        { role: "system", content: systemMsg },
                        { role: "user", content: userMsg },
                    ],
                    temperature,
                    max_tokens: maxTokens,
                })
                return { resp, model, provider: providerName }
            } catch (err: any) {
                const status = err.status || err.statusCode
                const isRetryable = status === 429 || status >= 500 || (err.message && /^429\b/.test(String(err.message)))

                if (isRetryable && attempt < cfg.models.length - 1) {
                    logger.warn(`${providerName}/${model} quota hit, trying ${cfg.models[attempt + 1]}...`)
                    continue
                }
                if (isRetryable && providers.indexOf(providerName) < providers.length - 1) {
                    logger.warn(`${providerName} exhausted, switching provider...`)
                    break
                }
                throw err
            }
        }
    }
    return null
}