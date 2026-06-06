/* ── Migrate Notion DB from Thai to English ────────────────────────
   Translates three fields on every page in the homework database:
     • Subject    (rich_text) — e.g. "คณิต" → "Math"
     • Priority   (select)    — e.g. "🔴 สูง" → "🔴 High"
     • Tags       (multi_select) — exact-match tag dictionary

   Behavior:
     • Default: dry-run — print a diff report and exit. NOTHING is mutated.
     • --apply: prompt for confirmation, write a backup, then update.
     • --yes:  skip the interactive confirmation (for CI/scripts).
     • --limit N: only process the first N changes (smoke test).
     • --verbose / -v: show every page considered, not just the changes.

   Safety:
     • A full backup of the DB (every page + every translated field) is
       written to backups/notion_backup_<timestamp>.json BEFORE any
       mutation. Use that file to roll back manually if needed.
     • Pages whose Subject/Priority/Tag has no mapping are LEFT ALONE
       and reported in the "unmapped" section — you can decide what
       to do with them.
     • The script refuses to run if NOTION_TOKEN or DATABASE_ID is
       missing, or if the database is unreachable.

   Usage:
     node scripts/migrate_notion_to_english.js            # dry run
     node scripts/migrate_notion_to_english.js --apply    # apply
     node scripts/migrate_notion_to_english.js --apply --yes
     node scripts/migrate_notion_to_english.js --limit 10  # only first 10
*/

import { Client } from "@notionhq/client";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { logger } from "../src/utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKUPS = path.join(ROOT, "backups");

const NOTION_PAGE_SIZE = 100;
const NOTION_MAX_PAGES = 50; // safety cap (~5000 items)

/* ── Translation tables (mirror src/web/src/main.js SUBJ_LABEL/PRI_LEGACY) ── */

const SUBJECT_MAP = {
    "คณิต": "Math", "คณิตศาสตร์": "Math",
    "อังกฤษ": "English", "อิ้ง": "English", "ENG": "English",
    "ฟิสิกส์": "Physics", "ฟิสิก": "Physics",
    "เคมี": "Chemistry",
    "ชีวะ": "Biology", "ชีววิทยา": "Biology",
    "ไทย": "Thai", "ภาษาไทย": "Thai",
    "สังคม": "Social Studies", "สังคมศึกษา": "Social Studies",
    "ประวัติ": "History", "ประวัติศาสตร์": "History",
    "คอม": "Computer", "คอมพิวเตอร์": "Computer", "CS": "Computer",
    "สุขศึกษา": "Health", "พละ": "PE",
    "ทั่วไป": "General",
};

const PRIORITY_MAP = {
    "🔴 สูง": "🔴 High",
    "🟡 กลาง": "🟡 Medium",
    "🟢 ต่ำ": "🟢 Low",
    "สูง": "🔴 High",
    "กลาง": "🟡 Medium",
    "ต่ำ": "🟢 Low",
    "High": "🔴 High",
    "Medium": "🟡 Medium",
    "Low": "🟢 Low",
};

/* Tag dictionary is conservative — only exact-match translations.
   Compound or novel tags (e.g. "สอบกลางภาค") are LEFT ALONE. */
const TAG_MAP = {
    "สอบ": "Exam",
    "โครงการ": "Project",
    "กลุ่ม": "Group",
    "ด่วน": "Urgent",
    "อ่าน": "Reading",
    "ใบงาน": "Worksheet",
};

/* ── CLI parsing ── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const YES = args.includes("--yes");
const VERBOSE = args.includes("--verbose") || args.includes("-v");
const LIMIT = (() => {
    const i = args.indexOf("--limit");
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : Infinity;
})();

/* ── Env validation ── */

const NOTION_TOKEN = process.env.NOTION_TOKEN?.trim();
const DB = process.env.DATABASE_ID?.trim();
if (!NOTION_TOKEN || !DB) {
    console.error("ERROR: NOTION_TOKEN and DATABASE_ID must be set in .env");
    process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

/* ── Notion fetch helpers (copied locally to keep the script runnable
   outside the main app) ── */

async function notionWithRetry(fn, retries = 3) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try { return await fn(); }
        catch (err) {
            const status = err?.status || err?.code;
            if (status !== 429 && status < 500) throw err;
            if (attempt === retries) throw err;
            const delay = 1000 * Math.pow(2, attempt) + Math.random() * 200;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

async function queryAll(params) {
    const results = [];
    let cursor;
    let pages = 0;
    do {
        const res = await notionWithRetry(() => notion.databases.query({
            ...params, start_cursor: cursor, page_size: NOTION_PAGE_SIZE,
        }));
        results.push(...res.results);
        cursor = res.has_more ? res.next_cursor : undefined;
        pages++;
    } while (cursor && pages < NOTION_MAX_PAGES);
    if (cursor) console.warn(`WARN: hit page cap (${NOTION_MAX_PAGES}); ${results.length} items may be truncated`);
    return results;
}

async function fetchAll() {
    console.log("Fetching all pages from Notion...");
    const [active, done] = await Promise.all([
        queryAll({ database_id: DB, filter: { property: "Status", select: { does_not_equal: "Done" } } }),
        queryAll({ database_id: DB, filter: { property: "Status", select: { equals: "Done" } } }),
    ]);
    console.log(`  Found ${active.length} active + ${done.length} done = ${active.length + done.length} pages\n`);
    return [...active, ...done];
}

function getSubject(page) { return page.properties.Subject?.rich_text?.[0]?.plain_text || null; }
function getPriority(page) { return page.properties.Priority?.select?.name || null; }
function getTags(page) { return (page.properties.Tags?.multi_select || []).map(t => t.name); }
function getTitle(page) { return page.properties.Name?.title?.[0]?.plain_text || "(untitled)"; }

/* ── Diff computation ── */

function buildPlan(pages) {
    const plan = [];
    const unmapped = { subjects: new Set(), priorities: new Set(), tags: new Set() };

    for (const p of pages) {
        const subject = getSubject(p);
        const priority = getPriority(p);
        const tags = getTags(p);
        const title = getTitle(p);

        const newSubject = subject && SUBJECT_MAP[subject];
        const newPriority = priority && PRIORITY_MAP[priority];
        const newTags = tags.map(t => TAG_MAP[t] || t);
        const tagsChanged = newTags.some((t, i) => t !== tags[i]);

        if (newSubject || newPriority || tagsChanged) {
            if (subject && !newSubject) unmapped.subjects.add(subject);
            if (priority && !newPriority) unmapped.priorities.add(priority);
            for (const t of tags) if (!TAG_MAP[t] && !t.match(/^[A-Za-z\s]+$/)) unmapped.tags.add(t);

            plan.push({
                id: p.id,
                title,
                before: { subject, priority, tags },
                after: {
                    subject: newSubject || subject,
                    priority: newPriority || priority,
                    tags: newTags,
                },
            });
        }
    }
    return { plan, unmapped };
}

function buildBackup(pages) {
    return {
        timestamp: new Date().toISOString(),
        totalPages: pages.length,
        pages: pages.map(p => ({
            id: p.id,
            title: getTitle(p),
            subject: getSubject(p),
            priority: getPriority(p),
            tags: getTags(p),
            status: p.properties.Status?.select?.name,
            due: p.properties.Due?.date?.start,
        })),
    };
}

/* ── Report printing ── */

function printReport(pages, plan, unmapped) {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  Notion Thai → English Migration Report");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`  Total pages scanned : ${pages.length}`);
    console.log(`  Pages to update     : ${plan.length}`);
    console.log(`  Unmapped subjects   : ${unmapped.subjects.size} (${[...unmapped.subjects].join(", ") || "none"})`);
    console.log(`  Unmapped priorities : ${unmapped.priorities.size} (${[...unmapped.priorities].join(", ") || "none"})`);
    console.log(`  Unmapped tags       : ${unmapped.tags.size} (${[...unmapped.tags].slice(0, 5).join(", ")}${unmapped.tags.size > 5 ? "…" : ""})`);
    console.log("");

    if (plan.length === 0) {
        console.log("✓ No pages need migration. Done.\n");
        return;
    }

    console.log("Changes by field:");
    const subjChanges = plan.filter(p => p.before.subject !== p.after.subject).length;
    const priChanges = plan.filter(p => p.before.priority !== p.after.priority).length;
    const tagChanges = plan.filter(p => JSON.stringify(p.before.tags) !== JSON.stringify(p.after.tags)).length;
    console.log(`  Subject  : ${subjChanges} pages`);
    console.log(`  Priority : ${priChanges} pages`);
    console.log(`  Tags     : ${tagChanges} pages`);

    if (VERBOSE) {
        console.log("\nFirst 20 changes:");
        for (const p of plan.slice(0, 20)) {
            console.log(`  • [${p.title.slice(0, 30)}]`);
            if (p.before.subject !== p.after.subject) console.log(`      Subject:  ${p.before.subject || "(empty)"} → ${p.after.subject}`);
            if (p.before.priority !== p.after.priority) console.log(`      Priority: ${p.before.priority || "(empty)"} → ${p.after.priority}`);
            if (JSON.stringify(p.before.tags) !== JSON.stringify(p.after.tags)) console.log(`      Tags:     ${p.before.tags.join(",") || "(none)"} → ${p.after.tags.join(",")}`);
        }
    }
    console.log("");
}

/* ── Apply ── */

async function applyChanges(plan) {
    const limited = plan.slice(0, LIMIT);
    console.log(`Applying ${limited.length} changes (${APPLY ? "LIVE" : "DRY-RUN"}${LIMIT < plan.length ? `, limited from ${plan.length}` : ""})...\n`);

    let ok = 0, fail = 0;
    for (const change of limited) {
        const props = {};
        const before = change.before;
        const after = change.after;
        if (before.subject !== after.subject) {
            props.Subject = { rich_text: [{ text: { content: after.subject || " " } }] };
        }
        if (before.priority !== after.priority) {
            props.Priority = { select: { name: after.priority } };
        }
        if (JSON.stringify(before.tags) !== JSON.stringify(after.tags)) {
            props.Tags = { multi_select: after.tags.map(name => ({ name })) };
        }
        if (Object.keys(props).length === 0) continue;

        if (!APPLY) {
            ok++;
            continue;
        }

        try {
            await notionWithRetry(() => notion.pages.update({ page_id: change.id, properties: props }));
            ok++;
            if (VERBOSE) console.log(`  ✓ ${change.title.slice(0, 50)}`);
        } catch (err) {
            fail++;
            console.error(`  ✗ ${change.id} (${change.title.slice(0, 30)}): ${err.message}`);
        }
    }
    console.log(`\n${ok} ${APPLY ? "updated" : "would update"}, ${fail} failed.`);
}

async function writeBackup(pages) {
    fs.mkdirSync(BACKUPS, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(BACKUPS, `notion_backup_${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(buildBackup(pages), null, 2));
    console.log(`Backup written: ${file}`);
    return file;
}

async function writeMigrationReport(plan, unmapped) {
    fs.mkdirSync(BACKUPS, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(BACKUPS, `migration_report_${ts}.json`);
    fs.writeFileSync(file, JSON.stringify({
        timestamp: new Date().toISOString(),
        totalPages: plan.length,
        subjects: { changed: plan.filter(p => p.before.subject !== p.after.subject).length },
        priorities: { changed: plan.filter(p => p.before.priority !== p.after.priority).length },
        tags: { changed: plan.filter(p => JSON.stringify(p.before.tags) !== JSON.stringify(p.after.tags)).length },
        unmapped: {
            subjects: [...unmapped.subjects],
            priorities: [...unmapped.priorities],
            tags: [...unmapped.tags],
        },
    }, null, 2));
    return file;
}

async function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

/* ── Main ── */

async function main() {
    console.log(`\nMode: ${APPLY ? "APPLY (LIVE)" : "DRY-RUN (no mutations)"}\n`);

    const pages = await fetchAll();
    const { plan, unmapped } = buildPlan(pages);
    printReport(pages, plan, unmapped);

    if (plan.length === 0) return;

    if (APPLY) {
        await writeBackup(pages);
        if (!YES) {
            const ans = await prompt(`\nAbout to update ${Math.min(plan.length, LIMIT)} pages. Type YES to continue: `);
            if (ans.trim() !== "YES") {
                console.log("Aborted.");
                return;
            }
        }
    }
    await applyChanges(plan);
    await writeMigrationReport(plan, unmapped);

    if (!APPLY) {
        console.log("\n(This was a dry-run. Use --apply to make changes.)\n");
    }
}

main().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});
