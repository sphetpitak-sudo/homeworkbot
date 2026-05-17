import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { fetchActive, fetchDone, getPageProps } from "../services/notionService.js";
import { STATUS, PRIORITY_ORDER, PRIORITY_DEFAULT, URGENT_DAYS } from "../utils/constants.js";
import { logger } from "../utils/logger.js";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── separate dashboard token (never expose TELEGRAM_TOKEN) ── */
let DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN?.trim();
if (!DASHBOARD_TOKEN) {
    DASHBOARD_TOKEN = crypto.randomBytes(24).toString("base64url");
    logger.info(`Dashboard token auto-generated: ${DASHBOARD_TOKEN.slice(0, 8)}...`);
}

export function getDashboardToken() {
    return DASHBOARD_TOKEN;
}

function computeStats(activePages, donePages) {
    const todo = activePages.filter(
        (p) => p.properties.Status?.select?.name === STATUS.TODO,
    ).length;
    const prog = activePages.filter(
        (p) => p.properties.Status?.select?.name === STATUS.IN_PROGRESS,
    ).length;
    const done = donePages.length;
    const total = todo + prog + done;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const bySubject = {};
    for (const p of activePages) {
        const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป";
        bySubject[sub] = (bySubject[sub] || 0) + 1;
    }

    const byPriority = {};
    for (const p of activePages) {
        const pri = p.properties.Priority?.select?.name || PRIORITY_DEFAULT;
        byPriority[pri] = (byPriority[pri] || 0) + 1;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const urgentLimit = new Date(today);
    urgentLimit.setDate(today.getDate() + URGENT_DAYS);

    const urgent = activePages.filter((p) => {
        const d = p.properties.Due?.date?.start;
        if (!d) return false;
        const dt = new Date(d + "T00:00:00");
        return dt >= today && dt <= urgentLimit;
    }).length;

    const overdue = activePages.filter((p) => {
        const d = p.properties.Due?.date?.start;
        if (!d) return false;
        const dt = new Date(d + "T00:00:00");
        return dt < today;
    }).length;

    return { todo, prog, done, total, pct, bySubject, byPriority, urgent, overdue };
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
        const key = d.toISOString().slice(0, 10);
        dayMap[key] = { date: key, label: `${d.getDate()}/${d.getMonth() + 1}`, count: 0 };
    }
    for (const p of donePages) {
        const due = p.properties.Due?.date?.start;
        if (!due) continue;
        if (dayMap[due]) dayMap[due].count++;
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
        const due = p.properties.Due?.date?.start;
        if (!due) continue;
        const dt = new Date(due + "T00:00:00");
        const diff = Math.floor((dt - mon) / 86400000);
        if (diff >= 0 && diff < 7) counts[diff]++;
    }
    return counts;
}

export function startWebServer(port = 8080) {
    const app = express();
    const TOKEN = process.env.TELEGRAM_TOKEN || "";

    app.use(express.static(path.join(__dirname, "public")));

    function requireAuth(req, res, next) {
        const t = req.query.token || req.headers["x-token"];
        if (t !== DASHBOARD_TOKEN) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        next();
    }

    /* single endpoint: returns stats + homework + trend in one call */
    app.get("/api/all", requireAuth, async (req, res) => {
        try {
            const [activePages, donePages] = await Promise.all([
                fetchActive(),
                fetchDone(),
            ]);
            res.json({
                stats: computeStats(activePages, donePages),
                homework: buildHomeworkList(activePages, donePages),
                trend: computeTrend(donePages),
                weeklyDone: computeWeeklyDone(donePages),
            });
        } catch (err) {
            logger.error("API /api/all:", err);
            res.status(500).json({ error: err.message });
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
            res.status(500).json({ error: err.message });
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
            res.status(500).json({ error: err.message });
        }
    });

    app.listen(port, () => logger.info(`Web Dashboard on http://0.0.0.0:${port}`));
}
