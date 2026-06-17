import express from "express";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { fetchActive, fetchDone, getPageProps, createHomework, updateStatus, updateHomework, archivePage } from "../services/notionService.js";
import { STATUS, PRIORITY_ORDER, PRIORITY_DEFAULT, URGENT_DAYS } from "../utils/constants.js";
import { recalcPriority } from "../utils/priority.js";
import { formatDate } from "../utils/dateParser.js";
import { logger } from "../utils/logger.js";
import { buildBadgeGrid, getBadgeCount, getRarestBadge } from "../services/badgeService.js";
import { QUOTES } from "../utils/quotes.js";
import crypto from "crypto";
import type { Server } from "http";
import {
  validateHomeworkInput,
  validateStatusUpdate,
  validateBulkStatusUpdate,
  validateHomeworkUpdate,
  validateDeleteRequest,
} from "../utils/validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DASHBOARD_TOKEN_FILE = path.join(__dirname, "..", "..", ".dashboard_token")
let DASHBOARD_TOKEN: string | undefined = process.env.DASHBOARD_TOKEN?.trim()
if (DASHBOARD_TOKEN) {
    logger.info("Dashboard auth enabled (DASHBOARD_TOKEN from env)")
} else {
    try {
        if (fs.existsSync(DASHBOARD_TOKEN_FILE)) {
            const persisted = fs.readFileSync(DASHBOARD_TOKEN_FILE, "utf-8").trim()
            if (persisted && persisted.length >= 32) {
                DASHBOARD_TOKEN = persisted
                logger.info("Dashboard auth enabled (DASHBOARD_TOKEN from .dashboard_token)")
            }
        }
    } catch { /* fall through to generate */ }
    if (!DASHBOARD_TOKEN) {
        DASHBOARD_TOKEN = crypto.randomBytes(32).toString("hex")
        try {
            fs.writeFileSync(DASHBOARD_TOKEN_FILE, DASHBOARD_TOKEN, { mode: 0o600 })
            logger.info("Dashboard auth enabled (auto-generated, persisted to .dashboard_token)")
        } catch (err: any) {
            logger.warn("Could not persist DASHBOARD_TOKEN to .dashboard_token:", err.message)
            logger.info("Dashboard auth enabled (auto-generated, in-memory only — will reset on restart)")
        }
    }
}

const TICKET_TTL_MS = 3600_000
const SESSION_COOKIE = "hb_session"
const consumedTickets = new Set<string>()
const ticketLocks = new Map<string, Promise<boolean>>()

const TICKET_HMAC_KEY = crypto.createHash("sha256")
    .update(DASHBOARD_TOKEN || String(Date.now()))
    .digest()

function createSignedTicket(ttl?: number) {
    const id = crypto.randomBytes(16).toString("base64url")
    const payload = JSON.stringify({ id, exp: Date.now() + (ttl || TICKET_TTL_MS) })
    const data = Buffer.from(payload).toString("base64url")
    const sig = crypto.createHmac("sha256", TICKET_HMAC_KEY).update(data).digest("base64url").slice(0, 12)
    return `${data}.${sig}`
}

function tokensEqual(a: unknown, b: unknown): boolean {
    if (typeof a !== "string" || typeof b !== "string") return false
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"))
}

function consumeTicket(token: string): boolean {
    const parts = token.split(".")
    if (parts.length !== 2) return false
    const [data, sig] = parts
    const expected = crypto.createHmac("sha256", TICKET_HMAC_KEY).update(data).digest("base64url").slice(0, 12)
    if (sig.length !== expected.length) return false
    const sigBuf = Buffer.from(sig, "utf-8")
    const expBuf = Buffer.from(expected, "utf-8")
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false
    let payload: any
    try {
        payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"))
    } catch { return false }
    if (Date.now() > payload.exp) return false
    if (consumedTickets.has(payload.id)) return false
    consumedTickets.add(payload.id)
    return true
}

async function consumeTicketAtomic(token: string): Promise<boolean> {
    const parts = token.split(".")
    if (parts.length !== 2) return false
    const data = parts[0]
    let payload: any
    try {
        payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"))
    } catch { return false }
    if (!payload?.id) return false
    const id = payload.id
    const prev = ticketLocks.get(id) || Promise.resolve() as Promise<boolean>
    const next = prev.then(() => consumeTicket(token))
    const chained = next.catch(() => false)
    ticketLocks.set(id, chained)
    chained.finally(() => {
        if (ticketLocks.get(id) === chained) ticketLocks.delete(id)
    })
    return next
}

function validatePrelimTicket(token: string): boolean {
    const parts = token.split(".")
    if (parts.length !== 2) return false
    const [data, sig] = parts
    const expected = crypto.createHmac("sha256", TICKET_HMAC_KEY).update(data).digest("base64url").slice(0, 12)
    if (sig.length !== expected.length) return false
    const sigBuf = Buffer.from(sig, "utf-8")
    const expBuf = Buffer.from(expected, "utf-8")
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false
    let payload: any
    try {
        payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"))
    } catch { return false }
    if (Date.now() > payload.exp) return false
    return true
}

if (!(globalThis as any).__hbTicketIntervalStarted) {
    (globalThis as any).__hbTicketIntervalStarted = true
    setInterval(() => {
        if (consumedTickets.size > 10_000) consumedTickets.clear()
    }, 60_000).unref()
}

let botReady = false

export function setBotReady(ready: boolean) {
    botReady = !!ready
}

export function createDashboardUrl(baseUrl: string) {
    if (!baseUrl) return ""
    const ticket = createSignedTicket()
    return `${baseUrl}/api/exchange?ticket=${ticket}`
}

function computeStats(activePages: any[], donePages: any[]) {
    let todo = 0, prog = 0, urgent = 0, overdue = 0;
    const bySubject: Record<string, number> = {}, byPriority: Record<string, number> = {}, byTags: Record<string, number> = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const urgentLimit = new Date(today); urgentLimit.setDate(today.getDate() + URGENT_DAYS);

    for (const p of activePages) {
        const status = p.properties.Status?.select?.name;
        if (status === STATUS.TODO) todo++;
        else if (status === STATUS.IN_PROGRESS) prog++;

        const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "General";
        bySubject[sub] = (bySubject[sub] || 0) + 1;

        const pri = p.properties.Priority?.select?.name || PRIORITY_DEFAULT;
        byPriority[pri] = (byPriority[pri] || 0) + 1;

        const tags = p.properties.Tags?.multi_select;
        if (tags) for (const t of tags) byTags[t.name] = (byTags[t.name] || 0) + 1;

        const d = p.properties.Due?.date?.start;
        if (d) {
            const dt = new Date(d + "T00:00:00");
            if (dt >= today && dt <= urgentLimit) urgent++;
            if (dt < today) overdue++;
        }
    }

    const done = donePages.length;
    const total = todo + prog + done;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { todo, prog, done, total, pct, bySubject, byPriority, byTags, urgent, overdue };
}

function buildHomeworkList(activePages: any[], donePages: any[]) {
    const items = [...activePages, ...donePages].map((p) => ({
        id: p.id,
        ...getPageProps(p),
        note: p.properties.Note?.rich_text?.[0]?.plain_text || "",
        url: p.url,
    }));
    items.sort((a: any, b: any) => {
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
    });
    return items;
}

function computeTrend(donePages: any[]) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayMap: Record<string, any> = {};
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = formatDate(d);
        dayMap[key] = { date: key, label: `${d.getDate()}/${d.getMonth() + 1}`, count: 0 };
    }
    for (const p of donePages) {
        const completed = p.properties.Completed?.date?.start || p.properties.Due?.date?.start;
        if (!completed) continue;
        if (dayMap[completed]) dayMap[completed].count++;
    }
    return Object.values(dayMap);
}

function computeWeeklyDone(donePages: any[]) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay();
    const mon = new Date(today);
    mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const p of donePages) {
        const completed = p.properties.Completed?.date?.start || p.properties.Due?.date?.start;
        if (!completed) continue;
        const dt = new Date(completed + "T00:00:00");
        const diff = Math.floor((dt.getTime() - mon.getTime()) / 86400000);
        if (diff >= 0 && diff < 7) counts[diff]++;
    }
    return counts;
}

export function startWebServer(port: number = 8080): Server {
    const app = express();

    app.set('trust proxy', 1);

    const apiLimiter = rateLimit({
        windowMs: 60_000,
        max: 60,
        standardHeaders: true,
        message: { error: "Too many requests, slow down" },
    });

    const exchangeLimiter = rateLimit({
        windowMs: 5 * 60_000,
        max: 30,
        standardHeaders: true,
        message: "Too many attempts, slow down",
    });

    app.use(express.json({ limit: "1mb" }));
    app.use(cookieParser());
    app.use("/api", apiLimiter);

    const swCandidates = [
        path.join(__dirname, "dist", "sw.js"),
        path.join(__dirname, "public", "sw.js"),
    ]
    const swPath = swCandidates.find((p) => { try { fs.accessSync(p); return true } catch { return false } }) || swCandidates[0]
    let swSource = ""
    try {
        swSource = fs.readFileSync(swPath, "utf-8")
    } catch { /* leave swSource empty */ }
    let pkgVersion = "0"
    try {
        pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8")).version || "0"
    } catch { /* keep "0" */ }
    if (swSource && pkgVersion) {
        swSource = swSource.replace(/"homework-bot-v\d+"/, `"homework-bot-v${pkgVersion}"`)
    }
    app.get("/sw.js", (_req: any, res: any) => {
        if (!swSource) return res.status(404).end()
        res.setHeader("Cache-Control", "no-cache")
        res.type("application/javascript").send(swSource)
    })

    app.get("/", (req: any, res: any, next: any) => {
        const cookie = req.cookies?.[SESSION_COOKIE]
        if (tokensEqual(cookie, DASHBOARD_TOKEN)) return next()
        const queryToken = req.query.token
        if (tokensEqual(queryToken, DASHBOARD_TOKEN)) {
            res.cookie(SESSION_COOKIE, DASHBOARD_TOKEN, {
                httpOnly: true,
                sameSite: "lax",
                maxAge: 24 * 60 * 60 * 1000,
                path: "/",
            })
            return next()
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8")
        return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homework Bot</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:360px;width:90%}h2{margin:0 0 .5rem;color:#1a1a2e}p{color:#666;margin:0 0 1rem;font-size:.9rem}.hint{background:#f0f2f5;border-radius:8px;padding:12px;font-size:.85rem;color:#555;text-align:left;line-height:1.6}</style></head><body><div class="card"><h2>&#127891; Homework Bot</h2><p>Please sign in via the Telegram bot first</p><div class="hint">1. Open the Homework Bot in Telegram<br>2. Tap the 🌐 Web Dashboard button<br>3. Follow the link the bot sends</div></div></body></html>`)
    })

    const staticCandidates = [
        path.join(__dirname, "dist"),
        path.join(__dirname, "public"),
    ]
    const staticDir = staticCandidates.find((p) => { try { fs.accessSync(p); return true } catch { return false } }) || staticCandidates[0]
    app.use(express.static(staticDir));

    app.use((_req: any, res: any, next: any) => {
        res.setHeader("X-Content-Type-Options", "nosniff")
        res.setHeader("X-Frame-Options", "DENY")
        res.setHeader("Referrer-Policy", "no-referrer")
        res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        res.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; " +
            "connect-src 'self'; " +
            "frame-ancestors 'none'",
        )
        next()
    })

    app.get("/health", (_req: any, res: any) => {
        res.json({
            status: "ok",
            bot: botReady ? "ready" : "starting",
        });
    });

    function requireAuth(req: any, res: any, next: any) {
        const header = req.headers["authorization"]?.replace("Bearer ", "");
        const cookie = req.cookies?.[SESSION_COOKIE];
        if (tokensEqual(header, DASHBOARD_TOKEN) || tokensEqual(cookie, DASHBOARD_TOKEN)) return next();
        return res.status(401).json({ error: "Unauthorized" });
    }

    function isBotUA(ua: string) {
        if (!ua) return false
        return /TelegramBot|Slackbot|Discordbot|facebookexternalhit|WhatsApp|Twitterbot|curl|wget|bot\//i.test(ua)
    }

    app.get("/api/exchange", exchangeLimiter, (req: any, res: any) => {
        if (!DASHBOARD_TOKEN) return res.redirect("/")
        const prelimToken = String(req.query.ticket || "")
        if (!prelimToken) return res.status(400).send("Missing ticket")

        if (!validatePrelimTicket(prelimToken)) {
            res.setHeader("Content-Type", "text/html; charset=utf-8")
            return res.status(401).send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homework Bot</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:360px;width:90%}h2{margin:0 0 .5rem;color:#1a1a2e}p{color:#666;margin:0 0 1.5rem;font-size:.9rem}</style></head><body><div class="card"><h2>&#128257; Link expired</h2><p>Request a new link from the bot</p></div></body></html>`)
        }

        const realTicket = createSignedTicket()

        const escaped = realTicket.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        res.setHeader("Content-Type", "text/html; charset=utf-8")
        res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homework Bot</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:360px;width:90%}h2{margin:0 0 .5rem;color:#1a1a2e}p{color:#666;margin:0 0 1.5rem;font-size:.9rem}button{background:#4361ee;color:#fff;border:none;padding:.75rem 2rem;border-radius:8px;font-size:1rem;cursor:pointer;width:100%}button:hover{background:#3a56d4}</style></head><body><div class="card"><h2>&#127891; Homework Bot</h2><p>Click the button below to open your dashboard</p><form method="POST" action="/api/exchange"><input type="hidden" name="ticket" value="${escaped}"><button type="submit">Open Dashboard</button></form></div></body></html>`)
    })

    app.post("/api/exchange", exchangeLimiter, express.urlencoded({ extended: false }) as any, async (req: any, res: any) => {
        if (!DASHBOARD_TOKEN) return res.redirect("/")
        const ticket = String(req.body?.ticket || "")
        const ok = await consumeTicketAtomic(ticket)
        if (!ok) {
            res.setHeader("Content-Type", "text/html; charset=utf-8")
            return res.status(401).send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homework Bot</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:360px;width:90%}h2{margin:0 0 .5rem;color:#1a1a2e}p{color:#666;margin:0 0 1.5rem;font-size:.9rem}</style></head><body><div class="card"><h2>&#128257; Link expired</h2><p>Request a new link from the bot</p></div></body></html>`)
        }
        res.cookie(SESSION_COOKIE, DASHBOARD_TOKEN, {
            httpOnly: true,
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000,
            path: "/",
        })
        return res.redirect("/")
    })

    app.get("/api/all", requireAuth, async (req: any, res: any) => {
        try {
            const [activePages, donePages] = await Promise.all([
                fetchActive(),
                fetchDone(),
            ]);
            const payload = JSON.stringify({
                stats: computeStats(activePages, donePages),
                homework: buildHomeworkList(activePages, donePages),
                trend: computeTrend(donePages),
                weeklyDone: computeWeeklyDone(donePages),
            });
            const etag = `W/"${crypto.createHash("sha1").update(payload).digest("base64url").slice(0, 16)}"`
            if (req.headers["if-none-match"] === etag) {
                res.setHeader("Cache-Control", "private, max-age=5")
                return res.status(304).end()
            }
            res.setHeader("Cache-Control", "private, max-age=5")
            res.setHeader("ETag", etag)
            res.type("application/json").send(payload);
        } catch (err: any) {
            logger.error("API /api/all:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.get("/api/stats", requireAuth, async (req: any, res: any) => {
        try {
            const [activePages, donePages] = await Promise.all([
                fetchActive(),
                fetchDone(),
            ]);
            res.json(computeStats(activePages, donePages));
        } catch (err: any) {
            logger.error("API /api/stats:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.get("/api/homework", requireAuth, async (req: any, res: any) => {
        try {
            const [activePages, donePages] = await Promise.all([
                fetchActive(),
                fetchDone(),
            ]);
            res.json(buildHomeworkList(activePages, donePages));
        } catch (err: any) {
            logger.error("API /api/homework:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/homework", requireAuth, async (req: any, res: any) => {
        const validation = validateHomeworkInput(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const { title, subject, due, priority, note, tags } = req.body;
        try {
            const effectivePriority = priority || recalcPriority(due || null);
            await createHomework({
                title: title.trim(),
                subject: subject || "General",
                due: due || null,
                priority: effectivePriority,
                note: note?.trim() || "",
                tags: Array.isArray(tags) ? tags : undefined,
            });
            res.json({ success: true });
        } catch (err: any) {
            logger.error("API POST /api/homework:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/status", requireAuth, async (req: any, res: any) => {
        const validation = validateStatusUpdate(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const { id, status } = req.body;
        try {
            await updateStatus(id, status);
            res.json({ success: true });
        } catch (err: any) {
            logger.error("API POST /api/status:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/homework/update", requireAuth, async (req: any, res: any) => {
        const validation = validateHomeworkUpdate(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const { id, title, subject, due, priority, note, tags } = req.body;
        try {
            await updateHomework(id, {
                title,
                subject,
                due,
                priority,
                note,
                tags: tags !== undefined ? (Array.isArray(tags) ? tags : []) : undefined,
            });
            res.json({ success: true });
        } catch (err: any) {
            logger.error("API POST /api/homework/update:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/homework/delete", requireAuth, async (req: any, res: any) => {
        const validation = validateDeleteRequest(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const { id } = req.body;
        try {
            await archivePage(id);
            res.json({ success: true });
        } catch (err: any) {
            logger.error("API POST /api/homework/delete:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.get("/api/badges", requireAuth, async (req: any, res: any) => {
        try {
            const userId = req.query.userId || "0"
            const badges = buildBadgeGrid(userId)
            res.json({
                badges,
                count: getBadgeCount(userId),
                rarest: getRarestBadge(userId),
            })
        } catch (err: any) {
            logger.error("API /api/badges:", err)
            res.status(500).json({ error: "Internal server error" })
        }
    })

    app.get("/api/badges/:userId", requireAuth, async (req: any, res: any) => {
        try {
            const userId = req.params.userId
            const badges = buildBadgeGrid(userId)
            res.json({
                badges,
                count: getBadgeCount(userId),
                rarest: getRarestBadge(userId),
            })
        } catch (err: any) {
            logger.error("API /api/badges/:userId:", err)
            res.status(500).json({ error: "Internal server error" })
        }
    })

    app.get("/api/quote", requireAuth, async (req: any, res: any) => {
        try {
            const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
            res.json(q);
        } catch (err: any) {
            logger.error("API GET /api/quote:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/bulk-status", requireAuth, async (req: any, res: any) => {
        const validation = validateBulkStatusUpdate(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const { ids, status } = req.body;
        try {
            const results = await Promise.allSettled(ids.map((id: string) => updateStatus(id, status)));
            const succeeded = results.filter(r => r.status === "fulfilled").length;
            const failed = results.filter(r => r.status === "rejected").length;
            res.json({ success: failed === 0, updated: succeeded, failed });
        } catch (err: any) {
            logger.error("API POST /api/bulk-status:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/webhook/line", express.raw({ type: "application/json" }) as any, async (req: any, res: any) => {
        const signature = req.headers["x-line-signature"];
        const body = req.body.toString("utf-8");
        const { validateSignature, isLineEnabled } = await import("../platforms/lineAdapter.js");

        if (!isLineEnabled()) {
            return res.status(503).send("LINE not configured");
        }
        if (!validateSignature(body, signature)) {
            logger.warn("Invalid LINE signature");
            return res.status(401).send("Unauthorized");
        }

        try {
            const events = JSON.parse(body).events;
            for (const event of events) {
                if (event.type === "message" && event.message?.type === "text") {
                    const { message: msg, replyToken, source } = event;
                    const userId = source.userId;
                    const { parseHomework } = await import("../services/aiService.js");
                    const parsed = await parseHomework(`[${userId}] ${msg.text}`);
                    if (parsed?.title) {
                        const { sendLineReply } = await import("../platforms/lineAdapter.js");
                        await sendLineReply(replyToken, `✅ Saved: ${parsed.title}`);
                    }
                }
            }
            res.send("OK");
        } catch (err: any) {
            logger.error("LINE webhook error:", err.message);
            res.status(500).send("Error");
        }
    });

    app.use((err: any, req: any, res: any, next: any) => {
        logger.error("Unhandled error:", err);
        res.status(500).json({ error: "Internal server error" });
    });

    return app.listen(port, () => logger.info(`Web Dashboard on http://0.0.0.0:${port}`))
        .on("error", (err: any) => logger.error(`Web server failed to listen on ${port}:`, err.message));
}
