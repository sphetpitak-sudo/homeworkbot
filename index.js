import "dotenv/config";
process.env.TZ = "Asia/Bangkok";
import { Telegraf }    from "telegraf";
import cron            from "node-cron";
import { validateEnv } from "./src/utils/validateEnv.js";
import { logger }      from "./src/utils/logger.js";
import { initAI }              from "./src/services/aiService.js";
import { fetchActive, fetchUpcoming, fetchDone, archivePage, updatePriority } from "./src/services/notionService.js";
import { cacheCleanup } from "./src/services/cache.js";
import { formatDate, formatDueDisplay } from "./src/utils/dateParser.js";
import { recalcPriority } from "./src/utils/priority.js";
import { STATUS } from "./src/utils/constants.js";
import { escapeMarkdown }      from "./src/utils/telegramFormat.js";
import { registerCommandHandlers } from "./src/handlers/commandHandlers.js";
import { registerActionHandlers, cleanupPomoTimers }  from "./src/handlers/actionHandlers.js";
import { startWebServer, setBotReady } from "./src/web/server.js";
import { flushCorrections }    from "./src/services/aiCache.js";
import { flushBadges }         from "./src/services/badgeService.js";
import { flushPomodoros, recoverInterruptedSessions }       from "./src/services/pomodoroService.js";
import { flushShareTokens, pruneShareTokens }    from "./src/services/shareTokenService.js";

/* ── validate env + Notion schema ── */
validateEnv();
/* M15: schema check now runs synchronously at boot with a 3s
   timeout. If the database is misconfigured, the bot starts up
   knowing about it (logged warning + /api endpoints return clear
   errors) instead of discovering the problem in the first 200ms
   of user traffic. Failure is non-fatal: the bot still starts. */
await Promise.race([
    import("./src/services/notionService.js").then((m) => m.validateNotionSchema()),
    new Promise((resolve) => setTimeout(resolve, 3000)),
]).catch((err) => logger.warn("Notion schema check skipped:", err?.message || err));

/* ── startup banner ── */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let version = "unknown";
try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf-8"));
    version = pkg.version;
} catch { /* keep "unknown" */ }
logger.info(`🏠 Homework Bot v${version} starting (node ${process.version}, TZ ${process.env.TZ || "system"})`);

/* ── web server (dashboard + health check) ── */
const PORT = process.env.PORT || 8080;
const server = startWebServer(PORT);

/* ── H1: recover pomodoro sessions that were interrupted by the
   previous process exit. Runs synchronously at boot, before the bot
   starts accepting updates, so notifications can be sent on the
   next incoming message. ── */
try {
    const recovered = recoverInterruptedSessions()
    if (recovered.length) {
        logger.info(`Recovered ${recovered.length} interrupted pomodoro session(s)`)
    }
} catch (err) {
    logger.warn("Pomodore recovery failed:", err?.message || err)
}

/* ── M4: prune expired share tokens at boot so the JSON file
   doesn't grow unbounded when tokens are never read. ── */
try {
    pruneShareTokens()
} catch (err) {
    logger.warn("Share token prune failed:", err?.message || err)
}

/* ── init ── */
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const userState = new Map();

initAI();

/* ── bot commands (Telegram menu) ── */
/* L15: register Thai descriptions with language_code so users with
   a Thai Telegram UI see the localized list, and an English
   fallback for everyone else. */
const BOT_COMMANDS_TH = [
    { command: "menu", description: "📋 เปิดเมนูหลัก" },
    { command: "stats", description: "📊 สถิติการบ้าน" },
    { command: "panic", description: "🚨 โหมดฉุกเฉิน — 3 งานด่วนที่สุด" },
    { command: "tomorrow", description: "📅 งานที่ต้องส่งพรุ่งนี้" },
    { command: "week", description: "📅 ตารางการบ้านประจำสัปดาห์" },
    { command: "deadline", description: "⏰ นับถอยหลังงานด่วนที่สุด" },
    { command: "progress", description: "📊 ความคืบหน้าแยกตามวิชา" },
    { command: "hint", description: "🧠 คำแนะนำการเริ่มทำการบ้าน" },
    { command: "search", description: "🔍 ค้นหาการบ้าน" },
    { command: "quote", description: "💬 คำคมกำลังใจ" },
    { command: "export", description: "📋 ส่งออกรายการการบ้าน" },
    { command: "noted", description: "📝 แนบโน๊ตให้การบ้าน" },
    { command: "focus", description: "🎯 โฟกัสงานทีละชิ้น" },
    { command: "badges", description: "🏅 เหรียญตราความสำเร็จ" },
    { command: "review", description: "📋 สรุปการบ้านที่ทำเสร็จแล้ว" },
    { command: "collab", description: "👥 แชร์การบ้านกับเพื่อน" },
    { command: "smartbook", description: "📚 AI จัดตารางอ่านหนังสือ" },
    { command: "pomodoro", description: "🍅 ตัวจับเวลา Pomodoro" },
    { command: "suggest", description: "💡 AI แนะนำว่าควรทำอะไรก่อน" },
    { command: "ask", description: "🤖 ถามเกี่ยวกับการบ้าน" },
    { command: "undo", description: "↩️ ยกเลิกการกระทำล่าสุด" },
    { command: "help", description: "🆘 วิธีใช้งาน" },
]
const BOT_COMMANDS_EN = [
    { command: "menu", description: "📋 Main menu" },
    { command: "stats", description: "📊 Stats" },
    { command: "panic", description: "🚨 Panic mode — top 3 urgent tasks" },
    { command: "tomorrow", description: "📅 Tomorrow's tasks" },
    { command: "week", description: "📅 Weekly schedule" },
    { command: "deadline", description: "⏰ Countdown to nearest deadline" },
    { command: "progress", description: "📊 Progress by subject" },
    { command: "hint", description: "🧠 Tip for getting started" },
    { command: "search", description: "🔍 Search homework" },
    { command: "quote", description: "💬 Motivational quote" },
    { command: "export", description: "📋 Export list" },
    { command: "noted", description: "📝 Attach a note" },
    { command: "focus", description: "🎯 Focus on one task" },
    { command: "badges", description: "🏅 Achievement badges" },
    { command: "review", description: "📋 Review completed tasks" },
    { command: "collab", description: "👥 Share with friends" },
    { command: "smartbook", description: "📚 AI study schedule" },
    { command: "pomodoro", description: "🍅 Pomodoro timer" },
    { command: "suggest", description: "💡 AI suggestion" },
    { command: "ask", description: "🤖 Ask the bot" },
    { command: "undo", description: "↩️ Undo last action" },
    { command: "help", description: "🆘 How to use" },
]
Promise.all([
    bot.telegram.setMyCommands(BOT_COMMANDS_TH, { language_code: "th" }),
    bot.telegram.setMyCommands(BOT_COMMANDS_EN),
]).catch((err) => logger.error("Failed to set bot commands:", err?.message));

/* ── register handlers ── */
registerCommandHandlers(bot, userState);
registerActionHandlers(bot, userState);

/* ── global error handler (prevents crash on polling conflicts) ── */
bot.catch((err) => {
    const desc = err?.response?.description || err?.message || err?.code || err;
    logger.error(`Bot error: ${desc}`);
});

/* ── cron overlap guards ── */
const cronRunning = { priority: false, archive: false, reminder: false, weekly: false };

/* ── reminder ── */
async function sendReminders() {
    if (cronRunning.reminder) return;
    cronRunning.reminder = true;
    const chatId = process.env.REMINDER_CHAT_ID;
    if (!chatId) { cronRunning.reminder = false; return; }

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);

        const past = new Date(today);
        past.setDate(today.getDate() - 3);

        const pages = await fetchUpcoming(
            formatDate(past),
            formatDate(nextWeek),
        );
        if (!pages.length) {
            logger.info("Reminder: no upcoming homework found");
            return;
        }

        let msg = "⏰ *แจ้งเตือนการบ้าน*\n━━━━━━━━━━━━━━━━━━\n";

        for (const p of pages) {
            const title =
                p.properties.Name?.title?.[0]?.plain_text || "ไม่มีชื่อ";
            const due = p.properties.Due?.date?.start || null;
            const status = p.properties.Status?.select?.name || "";
            const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "-";

            const sEmoji =
                status === "Done"
                    ? "✅"
                    : status === "In Progress"
                      ? "🔄"
                      : "📌";

            msg += `${sEmoji} *${escapeMarkdown(title)}* _${escapeMarkdown(sub)}_ — ${escapeMarkdown(formatDueDisplay(due))}\n`;
        }

        msg += "\n💪 สู้ๆ นะ!";

        await bot.telegram.sendMessage(chatId, msg, { parse_mode: "Markdown" });
        logger.info(`Reminder sent to ${chatId} (${pages.length} items)`);
    } catch (err) {
        const desc = err?.response?.description || err?.message || err;
        logger.error(`Reminder failed to ${chatId}: ${desc}`);
    } finally {
        cronRunning.reminder = false;
    }
}

/* ── auto-priority (adjust priority based on proximity) ── */
async function autoUpdatePriority() {
    if (cronRunning.priority) return;
    cronRunning.priority = true;
    try {
        const pages = await fetchActive();
        const needsUpdate = [];
        for (const p of pages) {
            const current = p.properties.Priority?.select?.name || "🟡 กลาง";
            const dueStr = p.properties.Due?.date?.start;
            const target = recalcPriority(dueStr);
            if (current !== target) needsUpdate.push({ id: p.id, target });
        }
        if (!needsUpdate.length) return;
        const CONCURRENCY = 5;
        for (let i = 0; i < needsUpdate.length; i += CONCURRENCY) {
            const results = await Promise.allSettled(needsUpdate.slice(i, i + CONCURRENCY).map(p => updatePriority(p.id, p.target)));
            const failed = results.filter(r => r.status === "rejected");
            if (failed.length) logger.warn(`Priority batch ${i / CONCURRENCY}: ${failed.length} failed`);
            if (i + CONCURRENCY < needsUpdate.length) await new Promise(r => setTimeout(r, 100 + Math.random() * 200).unref());
        }
        logger.info(`Auto-priority updated ${needsUpdate.length} items`);
    } catch (err) {
        logger.error("autoUpdatePriority:", err);
    } finally {
        cronRunning.priority = false;
    }
}

/* ── auto-archive ── */
async function autoArchive() {
    if (cronRunning.archive) return;
    cronRunning.archive = true;
    try {
        const pages = await fetchDone();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        cutoff.setHours(0, 0, 0, 0);
        const toArchive = [];

        for (const p of pages) {
            const completed = p.properties.Completed?.date?.start || p.properties.Due?.date?.start;
            if (!completed) continue;
            const dt = new Date(completed + "T00:00:00");
            if (isNaN(dt.getTime())) continue;
            if (dt >= cutoff) continue;
            toArchive.push(p.id);
        }

        if (!toArchive.length) return;
        const CONCURRENCY = 5;
        for (let i = 0; i < toArchive.length; i += CONCURRENCY) {
            const results = await Promise.allSettled(toArchive.slice(i, i + CONCURRENCY).map(id => archivePage(id)));
            const failed = results.filter(r => r.status === "rejected");
            if (failed.length) logger.warn(`Archive batch ${i / CONCURRENCY}: ${failed.length} failed`);
            if (i + CONCURRENCY < toArchive.length) await new Promise(r => setTimeout(r, 100 + Math.random() * 200).unref());
        }
        logger.info(`Auto-archived ${toArchive.length} items`);
    } catch (err) {
        logger.error("autoArchive:", err);
    } finally {
        cronRunning.archive = false;
    }
}

/* ── weekly summary ── */
async function sendWeeklySummary() {
    if (cronRunning.weekly) return;
    cronRunning.weekly = true;
    const chatId = process.env.REMINDER_CHAT_ID;
    if (!chatId) { cronRunning.weekly = false; return; }

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [activePages, donePages] = await Promise.all([fetchActive(), fetchDone()]);

        const todo = activePages.filter(p => p.properties.Status?.select?.name === STATUS.TODO).length;
        const prog = activePages.filter(p => p.properties.Status?.select?.name === STATUS.IN_PROGRESS).length;
        const done = donePages.length;
        const total = todo + prog + done;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        const overdue = activePages.filter(p => {
            const d = p.properties.Due?.date?.start;
            if (!d) return false;
            return new Date(d + "T00:00:00") < today;
        }).length;

        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - 7);
        const weekDone = donePages.filter(p => {
            const d = p.properties.Completed?.date?.start || p.properties.Due?.date?.start;
            if (!d) return false;
            return new Date(d + "T00:00:00") >= weekStart;
        }).length;

        let msg = `📊 *สรุปประจำสัปดาห์*\n━━━━━━━━━━━━━━━━━━\n`;
        msg += `✅ ทำเสร็จสัปดาห์นี้: *${weekDone}* อัน\n`;
        msg += `📋 คงเหลือ: *${todo + prog}* อัน (${pct}% เสร็จแล้ว)\n`;
        if (overdue > 0) msg += `⚠️ Overdue: *${overdue}* อัน\n`;
        msg += `\n💪 สู้ๆ นะ!`;

        await bot.telegram.sendMessage(chatId, msg, { parse_mode: "Markdown" });
        logger.info(`Weekly summary sent to ${chatId}`);
    } catch (err) {
        logger.error("Weekly summary:", err);
    } finally {
        cronRunning.weekly = false;
    }
}

/* ── cron: 06:00, 08:00, 02:00 ทุกวัน ── */
cron.schedule("0 6 * * *", autoUpdatePriority, { timezone: "Asia/Bangkok" });
cron.schedule("0 8 * * *", sendReminders, { timezone: "Asia/Bangkok" });
cron.schedule("0 2 * * *", autoArchive, { timezone: "Asia/Bangkok" });
cron.schedule("0 7 * * 1", sendWeeklySummary, { timezone: "Asia/Bangkok" });

/* ── clean stale user states + expired cache every 30 min ── */
const STALE_TTL = 3_600_000 // 1h for idle/short flows
const ACTIVE_TTL = 12 * 3_600_000 // 12h for long-running flows (pomodoro, confirm, edit)
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [uid, state] of userState) {
        /* Preserve pomodoro sessions and confirmation flows for ACTIVE_TTL
           since they can legitimately span many hours. Only purge truly
           idle ephemeral state. */
        const ttl = (state.mode === "POMODORO" || state.mode === "CONFIRM" || state._pomodoro || state._confirming)
            ? ACTIVE_TTL
            : STALE_TTL
        if (now - (state._timestamp || 0) > ttl) {
            userState.delete(uid);
            cleaned++;
        }
    }
    cacheCleanup();
    if (cleaned) logger.debug(`Cleaned ${cleaned} stale user states`);
}, 30 * 60 * 1000)
cleanupInterval.unref()

/* ── launch with retry on 409 conflict ──
   Telegram long-polling is exclusive — only one process can hold the
   endpoint at a time. During a rolling deploy the previous instance
   may not have released its polling session by the time the new
   instance starts, so we retry with a short initial delay. On final
   409 we exit cleanly (code 0) so the deploy platform doesn't treat
   it as a crash — the next deploy attempt will succeed once the old
   instance is fully gone. */
async function launchBot(retries = 5, delay = 3_000) {
    for (let i = 0; i < retries; i++) {
        try {
            await bot.launch();
            setBotReady(true);
            logger.info("🤖 Homework Bot running...");
            return;
        } catch (err) {
            const is409 = err?.response?.error_code === 409 || err?.response?.status === 409 || String(err?.message ?? "").includes("409");
            if (is409 && i < retries - 1) {
                logger.warn(`409 Conflict (attempt ${i + 1}/${retries}), another instance still polling — retrying in ${delay}ms...`);
                await new Promise((r) => setTimeout(r, delay));
                delay = Math.min(delay * 2, 15_000);
            } else if (is409) {
                logger.warn(`409 Conflict: previous instance still holding the polling endpoint after ${retries} attempts. Exiting cleanly — the next deploy will succeed once it's gone.`);
                server.close(() => process.exit(0));
                return;
            } else {
                throw err;
            }
        }
    }
}
launchBot().catch((err) => {
    logger.error(`Failed to launch bot: ${err?.message || err}`);
    server.close(() => process.exit(1));
});

/* ── graceful shutdown ── */
const cronTasks = cron.getTasks()
const shutdown = async (sig) => {
    logger.info(`Received ${sig}, shutting down gracefully...`);
    cronTasks.forEach(t => t.stop())
    cleanupPomoTimers()
    bot.stop(sig);
    server.close(() => {})
    await Promise.allSettled([
        flushCorrections(),
        flushBadges(),
        flushPomodoros(),
        flushShareTokens(),
    ]).then((results) => {
        const labels = ["corrections", "badges", "pomodoros", "shareTokens"]
        let ok = 0, fail = 0
        results.forEach((r, i) => {
            if (r.status === "rejected") {
                logger.warn(`Flush ${labels[i]} failed:`, r.reason?.message || r.reason)
                fail++
            } else {
                ok++
            }
        })
        logger.info(`Shutdown complete (flushed ${ok}/${results.length}, ${fail} failed)`)
    })
    /* L17: 30s hard timeout (was 10s). The flushes are atomic
       (tmp + rename) but a slow disk or large JSON could push a
       flush past 10s on first boot. 30s still kills runaway
       processes without dropping pending writes. */
    setTimeout(() => process.exit(0), 30000).unref();
};
process.once("SIGINT",  () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
