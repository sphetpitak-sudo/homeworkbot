import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { fetchActive, fetchDone, getPageProps } from "../services/notionService.js";
import { STATUS } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startWebServer(port = 8080) {
    const app = express();
    const TOKEN = process.env.TELEGRAM_TOKEN || "";

    app.use(express.static(path.join(__dirname, "public")));

    function requireAuth(req, res, next) {
        const t = req.query.token || req.headers["x-token"];
        if (t !== TOKEN) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        next();
    }

    app.get("/api/stats", requireAuth, async (req, res) => {
        try {
            const [activePages, donePages] = await Promise.all([
                fetchActive(),
                fetchDone(),
            ]);

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

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const urgentLimit = new Date(today);
            urgentLimit.setDate(today.getDate() + 3);

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

            res.json({ todo, prog, done, total, pct, bySubject, urgent, overdue });
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

            const items = [...activePages, ...donePages].map((p) => ({
                id: p.id,
                ...getPageProps(p),
                url: p.url,
            }));

            items.sort((a, b) => {
                if (!a.due) return 1;
                if (!b.due) return -1;
                return a.due.localeCompare(b.due);
            });

            res.json(items);
        } catch (err) {
            logger.error("API /api/homework:", err);
            res.status(500).json({ error: err.message });
        }
    });

    app.listen(port, () => logger.info(`Web Dashboard on http://0.0.0.0:${port}`));
}
