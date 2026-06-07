import crypto from "crypto"

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET

export function validateSignature(body: string, signature: string): boolean {
    if (!CHANNEL_SECRET || !signature) return false
    const expected = crypto
        .createHmac("sha256", CHANNEL_SECRET)
        .update(body, "utf8")
        .digest("base64")
    return expected === signature
}

export function isLineEnabled(): boolean {
    return !!CHANNEL_ACCESS_TOKEN && !!CHANNEL_SECRET
}

export interface LineMessageEvent {
    type: "message"
    replyToken: string
    timestamp: number
    source: { type: "user" | "group" | "room"; userId?: string; groupId?: string }
    webhookEventId: string
    deliveryContext: { isRedelivery: boolean }
    replyContext?: { status: number; reason?: string }
    mode: "active" | "standby"
    message: {
        type: "text"
        id: string
        text: string
    }
}

export async function sendLineReply(replyToken: string, text: string): Promise<void> {
    if (!CHANNEL_ACCESS_TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN not configured")
    const url = "https://api.line.me/v2/bot/message/reply"
    const body = {
        replyToken,
        messages: [{ type: "text", text }],
    }
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(body),
    })
    if (!res.ok) {
        const err = await res.text()
        throw new Error(`LINE reply failed: ${res.status} ${err}`)
    }
}

export async function sendLinePush(userId: string, text: string): Promise<void> {
    if (!CHANNEL_ACCESS_TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN not configured")
    const url = "https://api.line.me/v2/bot/message/push"
    const body = { to: userId, messages: [{ type: "text", text }] }
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(body),
    })
    if (!res.ok) {
        const err = await res.text()
        throw new Error(`LINE push failed: ${res.status} ${err}`)
    }
}