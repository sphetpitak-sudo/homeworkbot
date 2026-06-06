import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchActive, fetchDone } from "../src/services/notionService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "..", "backups");
const CORRECTIONS_FILE = path.join(__dirname, "..", ".corrections.json");
const RETENTION_DAYS = 30;

function timestamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

/* M19: delete backups older than RETENTION_DAYS so a daily cron
   doesn't fill the disk. The file name format is `<prefix>_<YYYY-MM-DD_HHMMSS>.json`
   so we parse the date portion to filter. */
function rotateOldBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return 0
    const cutoff = Date.now() - RETENTION_DAYS * 86400_000
    let removed = 0
    for (const name of fs.readdirSync(BACKUP_DIR)) {
        if (!name.endsWith(".json")) continue
        const m = name.match(/_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})\.json$/)
        if (!m) continue
        const [, date, hh, mm, ss] = m
        const ts = new Date(`${date}T${hh}:${mm}:${ss}`).getTime()
        if (isNaN(ts)) continue
        if (ts < cutoff) {
            try {
                fs.unlinkSync(path.join(BACKUP_DIR, name))
                removed++
            } catch (err) {
                console.warn(`[BACKUP] Failed to delete old ${name}:`, err.message)
            }
        }
    }
    return removed
}

async function main() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const ts = timestamp();

    /* ── 1. Backup Notion data ── */
    try {
        const [active, done] = await Promise.all([fetchActive(), fetchDone()]);
        const data = { exportedAt: new Date().toISOString(), active, done };
        const notionFile = path.join(BACKUP_DIR, `notion_${ts}.json`);
        fs.writeFileSync(notionFile, JSON.stringify(data, null, 2));
        console.log(`[BACKUP] Notion data saved: ${notionFile} (${active.length} active, ${done.length} done)`);
    } catch (err) {
        console.error(`[BACKUP] Notion export failed:`, err.message);
        process.exit(1);
    }

    /* ── 2. Backup .corrections.json ── */
    try {
        if (fs.existsSync(CORRECTIONS_FILE)) {
            const correctionsFile = path.join(BACKUP_DIR, `corrections_${ts}.json`);
            fs.copyFileSync(CORRECTIONS_FILE, correctionsFile);
            console.log(`[BACKUP] Corrections saved: ${correctionsFile}`);
        } else {
            console.log(`[BACKUP] No .corrections.json found, skipping`);
        }
    } catch (err) {
        console.error(`[BACKUP] Corrections backup failed:`, err.message);
        process.exit(1);
    }

    /* ── 3. M19: rotate old backups ── */
    try {
        const removed = rotateOldBackups()
        if (removed) console.log(`[BACKUP] Rotated ${removed} old backup(s) (>${RETENTION_DAYS} days)`)
    } catch (err) {
        console.warn(`[BACKUP] Rotation failed:`, err.message)
    }

    console.log(`[BACKUP] Done. Backups stored in: ${BACKUP_DIR}`);
}

main();
