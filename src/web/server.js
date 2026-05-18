import express from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { fetchActive, fetchDone, getPageProps, createHomework, updateStatus, updateHomework, archivePage } from "../services/notionService.js";
import { STATUS, PRIORITY_ORDER, PRIORITY_DEFAULT, URGENT_DAYS } from "../utils/constants.js";
import { recalcPriority } from "../utils/priority.js";
import { formatDate } from "../utils/dateParser.js";
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

    const byTags = {};
    for (const p of activePages) {
        const tags = p.properties.Tags?.multi_select?.map(t => t.name) || [];
        for (const tag of tags) {
            byTags[tag] = (byTags[tag] || 0) + 1;
        }
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

    const apiLimiter = rateLimit({
        windowMs: 60_000,
        max: 60,
        standardHeaders: true,
        message: { error: "Too many requests, slow down" },
    });

    app.use(express.static(path.join(__dirname, "public")));
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", apiLimiter);

    app.get("/health", (req, res) => res.json({ status: "ok" }));

    function requireAuth(req, res, next) {
        const t = req.headers["authorization"]?.replace("Bearer ", "");
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

    app.post("/api/homework", requireAuth, async (req, res) => {
        const { title, subject, due, note, tags } = req.body;
        if (!title?.trim()) return res.status(400).json({ error: "Title required" });
        try {
            const priority = recalcPriority(due || null);
            await createHomework({
                title: title.trim(),
                subject: subject || "ทั่วไป",
                due: due || null,
                priority,
                note: note?.trim() || "",
                tags: Array.isArray(tags) ? tags : undefined,
            });
            res.json({ success: true });
        } catch (err) {
            logger.error("API POST /api/homework:", err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post("/api/status", requireAuth, async (req, res) => {
        const { id, status } = req.body;
        if (!id || !status) return res.status(400).json({ error: "id and status required" });
        try {
            await updateStatus(id, status);
            res.json({ success: true });
        } catch (err) {
            logger.error("API POST /api/status:", err);
            res.status(500).json({ error: err.message });
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
            res.status(500).json({ error: err.message });
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
            res.status(500).json({ error: err.message });
        }
    });

    app.post("/api/bulk-status", requireAuth, async (req, res) => {
        const { ids, status } = req.body;
        if (!ids?.length || !status) return res.status(400).json({ error: "ids and status required" });
        try {
            const results = await Promise.allSettled(ids.map((id) => updateStatus(id, status)));
            const succeeded = results.filter(r => r.status === "fulfilled").length;
            const failed = results.filter(r => r.status === "rejected").length;
            res.json({ success: failed === 0, updated: succeeded, failed });
        } catch (err) {
            logger.error("API POST /api/bulk-status:", err);
            res.status(500).json({ error: err.message });
        }
    });

    app.listen(port, () => logger.info(`Web Dashboard on http://0.0.0.0:${port}`))
        .on("error", (err) => logger.error(`Web server failed to listen on ${port}:`, err.message));
}
