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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* C3: DASHBOARD_TOKEN resolution.
   - If env is set, use it (production).
   - Otherwise, generate a random token and persist to .dashboard_token
     so it survives restarts. This way the bot's createDashboardUrl()
     embeds a ticket that stays valid across deploys even on the first
     boot. The file is .gitignored. */
const DASHBOARD_TOKEN_FILE = path.join(__dirname, "..", "..", ".dashboard_token")
let DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN?.trim()
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
        } catch (err) {
            logger.warn("Could not persist DASHBOARD_TOKEN to .dashboard_token:", err.message)
            logger.info("Dashboard auth enabled (auto-generated, in-memory only — will reset on restart)")
        }
    }
}

/* ── one-time access tickets ──
   Tickets are self-contained (HMAC-signed) so they survive process
   restarts — the user can open a ticket URL even after a deploy
   without getting 'Invalid or expired ticket'. The HMAC key is
   derived from DASHBOARD_TOKEN so it's deterministic across restarts
   (same process.env → same key → same signature). A consumed-ticket
   Set prevents replay within the same process lifetime. */
const TICKET_TTL_MS = 300_000 // 5 minutes (up from 60s to give users time)
const SESSION_COOKIE = "hb_session"
/* H2: Ticket consumption is a read-then-write that previously allowed
   a TOCTOU race (concurrent exchanges of the same ticket both passed
   the `has` check). We now serialize per-ticket via a Promise chain:
   if two requests for the same ticket arrive in quick succession,
   the second waits for the first to settle, then sees the ticket is
   consumed and rejects. This keeps the Set-based storage but adds
   atomicity. */
const consumedTickets = new Set()
const ticketLocks = new Map()

/* Derive a deterministic HMAC key from DASHBOARD_TOKEN so signed
   tickets survive restarts. If auth is disabled (no token), fall
   back to a random key — tickets won't be used anyway. */
const TICKET_HMAC_KEY = crypto.createHash("sha256")
    .update(DASHBOARD_TOKEN || String(Date.now()))
    .digest()

function createSignedTicket(ttl) {
    const id = crypto.randomBytes(16).toString("base64url")
    const payload = JSON.stringify({ id, exp: Date.now() + (ttl || TICKET_TTL_MS) })
    const data = Buffer.from(payload).toString("base64url")
    const sig = crypto.createHmac("sha256", TICKET_HMAC_KEY).update(data).digest("base64url").slice(0, 12)
    return `${data}.${sig}`
}

/* H7: timing-safe comparison for session cookies/bearer tokens.
   Plain `===` short-circuits on the first differing character, which
   leaks a tiny amount of timing information per byte. For 32-byte
   random tokens the attack window is academic, but defense-in-depth
   is cheap. Handles null/undefined and length mismatch without
   throwing. */
function tokensEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"))
}

function consumeTicket(token) {
    if (!token) return false
    const parts = token.split(".")
    if (parts.length !== 2) return false
    const [data, sig] = parts
    /* Verify HMAC — uses timingSafeEqual to prevent timing attacks */
    const expected = crypto.createHmac("sha256", TICKET_HMAC_KEY).update(data).digest("base64url").slice(0, 12)
    if (sig.length !== expected.length) return false
    const sigBuf = Buffer.from(sig, "utf-8")
    const expBuf = Buffer.from(expected, "utf-8")
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false
    /* Parse & check expiry */
    let payload
    try {
        payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"))
    } catch { return false }
    if (Date.now() > payload.exp) return false
    /* Replay protection (in-memory only — reset on restart, acceptable).
       H2: serialize per-ticket to close the TOCTOU window — if two
       requests for the same id arrive concurrently, the second sees
       the consumed set and is rejected. */
    if (consumedTickets.has(payload.id)) return false
    consumedTickets.add(payload.id)
    return true
}

/* H2: wrap a consumeTicket call in a per-ticket-id promise chain so
   concurrent exchanges are serialized. Returns the same boolean as
   consumeTicket, but two simultaneous calls for the same ticket will
   see the second one fail with the ticket already consumed. */
async function consumeTicketAtomic(token) {
    const parts = token.split(".")
    if (parts.length !== 2) return false
    const data = parts[0]
    let payload
    try {
        payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"))
    } catch { return false }
    if (!payload?.id) return false
    const id = payload.id
    const prev = ticketLocks.get(id) || Promise.resolve()
    const next = prev.then(() => consumeTicket(token))
    /* Swallow rejection for the chain (real result is delivered via `next`). */
    const chained = next.catch(() => false)
    ticketLocks.set(id, chained)
    /* Best-effort cleanup once this lock resolves. */
    chained.finally(() => {
        if (ticketLocks.get(id) === chained) ticketLocks.delete(id)
    })
    return next
}

/* Validate a preliminary ticket (HMAC + expiry) WITHOUT consuming it.
   Used by the two-stage exchange: the GET endpoint validates the
   prelim ticket from the bot URL, then embeds a fresh consumable
   ticket in the confirmation form. The prelim ticket itself is never
   marked as consumed, so Telegram pre-fetches don't break it. */
function validatePrelimTicket(token) {
    if (!token) return false
    const parts = token.split(".")
    if (parts.length !== 2) return false
    const [data, sig] = parts
    const expected = crypto.createHmac("sha256", TICKET_HMAC_KEY).update(data).digest("base64url").slice(0, 12)
    if (sig.length !== expected.length) return false
    const sigBuf = Buffer.from(sig, "utf-8")
    const expBuf = Buffer.from(expected, "utf-8")
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false
    let payload
    try {
        payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"))
    } catch { return false }
    if (Date.now() > payload.exp) return false
    return true
}

/* Periodic prune of the consumed-ticket set to prevent unbounded growth */
if (!globalThis.__hbTicketIntervalStarted) {
    globalThis.__hbTicketIntervalStarted = true
    setInterval(() => {
        /* HMAC-signed tickets carry their own expiry, so we only need
           to cap the in-memory consumed set. Any ticket not consumed
           within TTL will fail the exp check regardless. */
        if (consumedTickets.size > 10_000) consumedTickets.clear()
    }, 60_000).unref()
}

/* ── bot readiness flag (toggled by index.js after bot.launch()) ── */
let botReady = false

export function setBotReady(ready) {
    botReady = !!ready
}

export function createDashboardUrl(baseUrl) {
    if (!baseUrl) return ""
    const ticket = createSignedTicket()
    return `${baseUrl}/api/exchange?ticket=${ticket}`
}

function computeStats(activePages, donePages) {
    let todo = 0, prog = 0, urgent = 0, overdue = 0;
    const bySubject = {}, byPriority = {}, byTags = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const urgentLimit = new Date(today); urgentLimit.setDate(today.getDate() + URGENT_DAYS);

    for (const p of activePages) {
        const status = p.properties.Status?.select?.name;
        if (status === STATUS.TODO) todo++;
        else if (status === STATUS.IN_PROGRESS) prog++;

        const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป";
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

function buildHomeworkList(activePages, donePages) {
    const items = [...activePages, ...donePages].map((p) => ({
        id: p.id,
        ...getPageProps(p),
        note: p.properties.Note?.rich_text?.[0]?.plain_text || "",
        url: p.url,
    }));
    items.sort((a, b) => {
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
    });
    return items;
}

function computeTrend(donePages) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayMap = {};
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

function computeWeeklyDone(donePages) {
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
        const diff = Math.floor((dt - mon) / 86400000);
        if (diff >= 0 && diff < 7) counts[diff]++;
    }
    return counts;
}

export function startWebServer(port = 8080) {
    const app = express();

    /* Trust the first proxy (Railway reverse proxy) so express-rate-limit
       can correctly identify client IPs via X-Forwarded-For header. */
    app.set('trust proxy', 1);

    const apiLimiter = rateLimit({
        windowMs: 60_000,
        max: 60,
        standardHeaders: true,
        message: { error: "Too many requests, slow down" },
    });

    /* H2: tighter limiter on the ticket exchange endpoint so a single
       IP can't brute-force a 16-byte ticket id within the 5-minute
       TTL. 30 attempts/5min/IP. Tickets are also single-use (consumed
       Set), so this is belt-and-suspenders. */
    const exchangeLimiter = rateLimit({
        windowMs: 5 * 60_000,
        max: 30,
        standardHeaders: true,
        message: "Too many attempts, slow down",
    });

    app.use(express.json({ limit: "1mb" }));
    app.use(cookieParser());
    app.use("/api", apiLimiter);

    /* Service worker: inject package.json version into CACHE_NAME so
       each deploy automatically invalidates stale caches without
       requiring a manual code change. Must be registered BEFORE
       express.static so it takes precedence over the raw file. */
    const swPath = path.join(__dirname, "public", "sw.js")
    let swSource = ""
    try {
        swSource = fs.readFileSync(swPath, "utf-8")
    } catch { /* leave swSource empty — handler returns 404 below */ }
    let pkgVersion = "0"
    try {
        pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8")).version || "0"
    } catch { /* keep "0" */ }
    if (swSource && pkgVersion) {
        swSource = swSource.replace(/"homework-bot-v\d+"/, `"homework-bot-v${pkgVersion}"`)
    }
    app.get("/sw.js", (_req, res) => {
        if (!swSource) return res.status(404).end()
        res.setHeader("Cache-Control", "no-cache")
        res.type("application/javascript").send(swSource)
    })

    /* If user visits / without a session cookie, show a friendly
       "please authenticate via the bot" page instead of the broken
       dashboard (which would fail all API calls with 401). */
    app.get("/", (req, res, next) => {
        const cookie = req.cookies?.[SESSION_COOKIE]
        if (tokensEqual(cookie, DASHBOARD_TOKEN)) return next()
        const queryToken = req.query.token
        if (tokensEqual(queryToken, DASHBOARD_TOKEN)) {
            res.cookie(SESSION_COOKIE, DASHBOARD_TOKEN, {
                httpOnly: true,
                sameSite: "lax",
                /* H5: 24h cookie lifetime (was 1 year). The dashboard is
                   a low-stakes tool; reducing lifetime limits the damage
                   of a stolen cookie. Users re-authenticate via the bot. */
                maxAge: 24 * 60 * 60 * 1000,
                path: "/",
            })
            return next()
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8")
        return res.send(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homework Bot</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:360px;width:90%}h2{margin:0 0 .5rem;color:#1a1a2e}p{color:#666;margin:0 0 1rem;font-size:.9rem}.hint{background:#f0f2f5;border-radius:8px;padding:12px;font-size:.85rem;color:#555;text-align:left}</style></head><body><div class="card"><h2>&#127891; Homework Bot</h2><p>ต้องเข้าสู่ระบบผ่านบอท Telegram ก่อน</p><div class="hint">1. เปิดบอท Homework Bot ใน Telegram<br>2. กดปุ่ม 🌐 Web Dashboard<br>3. ทำตามขั้นตอนในลิงก์</div></div></body></html>`)
    })

    app.use(express.static(path.join(__dirname, "public")));

    /* Security headers — defense-in-depth without adding helmet.
       CSP allows the inline scripts/styles used by the SPA and the
       Chart.js CDN. Adjust if the dashboard ever loads other origins. */
    app.use((_req, res, next) => {
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

    app.get("/health", (_req, res) => {
        /* /health reports that the web server (and therefore the
           dashboard) is up and serving. The bot may still be launching
           (Telegram long-polling can take a few seconds during a
           rolling deploy) but the dashboard is independently useful,
           so we don't gate /health on bot readiness. */
        res.json({
            status: "ok",
            bot: botReady ? "ready" : "starting",
        });
    });

    function requireAuth(req, res, next) {
        const header = req.headers["authorization"]?.replace("Bearer ", "");
        const cookie = req.cookies?.[SESSION_COOKIE];
        if (tokensEqual(header, DASHBOARD_TOKEN) || tokensEqual(cookie, DASHBOARD_TOKEN)) return next();
        return res.status(401).json({ error: "Unauthorized" });
    }

    /* ── Two-stage ticket exchange ──
       Stage 1: Bot sends URL with a preliminary ticket.
       Stage 2: GET validates the preliminary ticket, embeds the real
       (consumable) ticket in a confirmation form. POST consumes it.

       Why two stages? Telegram pre-fetches bot-sent URLs. If we
       consumed the ticket on GET, the pre-fetch would eat it before
       the user clicks. The preliminary ticket is never "consumed"
       (just validated), so it survives pre-fetches. Only the POST
       consumes the real ticket. */
    function isBotUA(ua) {
        if (!ua) return false
        return /TelegramBot|Slackbot|Discordbot|facebookexternalhit|WhatsApp|Twitterbot|curl|wget|bot\//i.test(ua)
    }

    /* Stage 1: validate preliminary ticket → show confirmation with real ticket */
    app.get("/api/exchange", exchangeLimiter, (req, res) => {
        if (!DASHBOARD_TOKEN) return res.redirect("/")
        const prelimToken = String(req.query.ticket || "")
        if (!prelimToken) return res.status(400).send("Missing ticket")

        /* Validate preliminary token (HMAC + expiry, but NOT consumed) */
        if (!validatePrelimTicket(prelimToken)) {
            res.setHeader("Content-Type", "text/html; charset=utf-8")
            return res.status(401).send(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homework Bot</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:360px;width:90%}h2{margin:0 0 .5rem;color:#1a1a2e}p{color:#666;margin:0 0 1.5rem;font-size:.9rem}</style></head><body><div class="card"><h2>&#128257; ลิงก์หมดอายุ</h2><p>ขอลิงก์ใหม่จากบอทได้เลย</p></div></body></html>`)
        }

        /* Generate a real (consumable) ticket */
        const realTicket = createSignedTicket()

        const escaped = realTicket.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        res.setHeader("Content-Type", "text/html; charset=utf-8")
        res.send(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homework Bot</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:360px;width:90%}h2{margin:0 0 .5rem;color:#1a1a2e}p{color:#666;margin:0 0 1.5rem;font-size:.9rem}button{background:#4361ee;color:#fff;border:none;padding:.75rem 2rem;border-radius:8px;font-size:1rem;cursor:pointer;width:100%}button:hover{background:#3a56d4}</style></head><body><div class="card"><h2>&#127891; Homework Bot</h2><p>กดปุ่มด้านล่างเพื่อเปิดแดชบอร์ด</p><form method="POST" action="/api/exchange"><input type="hidden" name="ticket" value="${escaped}"><button type="submit">เข้าแดชบอร์ด</button></form></div></body></html>`)
    })

    /* Stage 2: POST consumes the real ticket → sets cookie → redirect */
    app.post("/api/exchange", exchangeLimiter, express.urlencoded({ extended: false }), async (req, res) => {
        if (!DASHBOARD_TOKEN) return res.redirect("/")
        const ticket = String(req.body?.ticket || "")
        /* H2: use the atomic variant so concurrent POSTs of the same
           ticket are serialized — only the first wins. */
        const ok = await consumeTicketAtomic(ticket)
        if (!ok) {
            res.setHeader("Content-Type", "text/html; charset=utf-8")
            return res.status(401).send(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homework Bot</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:360px;width:90%}h2{margin:0 0 .5rem;color:#1a1a2e}p{color:#666;margin:0 0 1.5rem;font-size:.9rem}</style></head><body><div class="card"><h2>&#128257; ลิงก์หมดอายุ</h2><p>ขอลิงก์ใหม่จากบอทได้เลย</p></div></body></html>`)
        }
        res.cookie(SESSION_COOKIE, DASHBOARD_TOKEN, {
            httpOnly: true,
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000,
            path: "/",
        })
        return res.redirect("/")
    })

    /* single endpoint: returns stats + homework + trend in one call */
    app.get("/api/all", requireAuth, async (req, res) => {
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
            /* L10: serve a 5s max-age + ETag so the SPA can cache
               identical responses. ETag is a weak hash of the body;
               on match Express sends 304 with no body. */
            const etag = `W/"${crypto.createHash("sha1").update(payload).digest("base64url").slice(0, 16)}"`
            if (req.headers["if-none-match"] === etag) {
                res.setHeader("Cache-Control", "private, max-age=5")
                return res.status(304).end()
            }
            res.setHeader("Cache-Control", "private, max-age=5")
            res.setHeader("ETag", etag)
            res.type("application/json").send(payload);
        } catch (err) {
            logger.error("API /api/all:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    /* kept for backward compat */
    app.get("/api/stats", requireAuth, async (req, res) => {
        try {
            const [activePages, donePages] = await Promise.all([
                fetchActive(),
                fetchDone(),
            ]);
            res.json(computeStats(activePages, donePages));
        } catch (err) {
            logger.error("API /api/stats:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.get("/api/homework", requireAuth, async (req, res) => {
        try {
            const [activePages, donePages] = await Promise.all([
                fetchActive(),
                fetchDone(),
            ]);
            res.json(buildHomeworkList(activePages, donePages));
        } catch (err) {
            logger.error("API /api/homework:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/homework", requireAuth, async (req, res) => {
        const { title, subject, due, priority, note, tags } = req.body;
        if (!title?.trim()) return res.status(400).json({ error: "Title required" });
        try {
            const effectivePriority = priority || recalcPriority(due || null);
            await createHomework({
                title: title.trim(),
                subject: subject || "ทั่วไป",
                due: due || null,
                priority: effectivePriority,
                note: note?.trim() || "",
                tags: Array.isArray(tags) ? tags : undefined,
            });
            res.json({ success: true });
        } catch (err) {
            logger.error("API POST /api/homework:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/status", requireAuth, async (req, res) => {
        const { id, status } = req.body;
        if (!id || !status) return res.status(400).json({ error: "id and status required" });
        if (![STATUS.TODO, STATUS.IN_PROGRESS, STATUS.DONE].includes(status)) {
            return res.status(400).json({ error: "Invalid status, must be Todo, In Progress, or Done" });
        }
        try {
            await updateStatus(id, status);
            res.json({ success: true });
        } catch (err) {
            logger.error("API POST /api/status:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/homework/update", requireAuth, async (req, res) => {
        const { id, title, subject, due, priority, note, tags } = req.body;
        if (!id) return res.status(400).json({ error: "id required" });
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
        } catch (err) {
            logger.error("API POST /api/homework/update:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/homework/delete", requireAuth, async (req, res) => {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: "id required" });
        try {
            await archivePage(id);
            res.json({ success: true });
        } catch (err) {
            logger.error("API POST /api/homework/delete:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    /* Badge API */
    app.get("/api/badges", requireAuth, async (req, res) => {
        try {
            const userId = req.query.userId || "0"
            const badges = buildBadgeGrid(userId)
            res.json({
                badges,
                count: getBadgeCount(userId),
                rarest: getRarestBadge(userId),
            })
        } catch (err) {
            logger.error("API /api/badges:", err)
            res.status(500).json({ error: "Internal server error" })
        }
    })

    app.get("/api/badges/:userId", requireAuth, async (req, res) => {
        try {
            const userId = req.params.userId
            const badges = buildBadgeGrid(userId)
            res.json({
                badges,
                count: getBadgeCount(userId),
                rarest: getRarestBadge(userId),
            })
        } catch (err) {
            logger.error("API /api/badges/:userId:", err)
            res.status(500).json({ error: "Internal server error" })
        }
    })

    app.get("/api/quote", requireAuth, async (req, res) => {
        try {
            const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
            res.json(q);
        } catch (err) {
            logger.error("API GET /api/quote:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/bulk-status", requireAuth, async (req, res) => {
        const { ids, status } = req.body;
        if (!ids?.length || !status) return res.status(400).json({ error: "ids and status required" });
        if (![STATUS.TODO, STATUS.IN_PROGRESS, STATUS.DONE].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }
        try {
            const results = await Promise.allSettled(ids.map((id) => updateStatus(id, status)));
            const succeeded = results.filter(r => r.status === "fulfilled").length;
            const failed = results.filter(r => r.status === "rejected").length;
            res.json({ success: failed === 0, updated: succeeded, failed });
        } catch (err) {
            logger.error("API POST /api/bulk-status:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    return app.listen(port, () => logger.info(`Web Dashboard on http://0.0.0.0:${port}`))
        .on("error", (err) => logger.error(`Web server failed to listen on ${port}:`, err.message));
}
