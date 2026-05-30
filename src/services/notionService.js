import { Client } from "@notionhq/client";
import { logger } from "../utils/logger.js";
import { STATUS, PRIORITY_DEFAULT, NOTION_PAGE_SIZE, URGENT_DAYS } from "../utils/constants.js";
import { cacheGet, cacheSet, cacheInvalidate } from "./cache.js";
import { cleanTitle } from "../utils/subjectDetector.js";

const notion = new Client({ auth: process.env.NOTION_TOKEN?.trim() });
const DB = process.env.DATABASE_ID;

const NOTION_MAX_RETRIES = 3;
const NOTION_RETRY_BASE_MS = 1000;

async function notionWithRetry(fn, retries = NOTION_MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const status = err?.status || err?.code;
            const isRetryable = status === 429 || status >= 500;
            if (!isRetryable || attempt === retries) throw err;
            const delay = NOTION_RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 200;
            logger.warn(`Notion retry ${attempt + 1}/${retries} after ${Math.round(delay)}ms`);
            await new Promise(r => setTimeout(r, delay).unref());
        }
    }
}

const MAX_QUERY_PAGES = 50; // safety limit (~5000 items)

/* ── pagination helper ── */
async function queryAll(params) {
    const results = [];
    let cursor = undefined;
    let pages = 0;

    do {
        const res = await notionWithRetry(() => notion.databases.query({
            ...params,
            start_cursor: cursor,
            page_size: NOTION_PAGE_SIZE,
        }));
        results.push(...res.results);
        cursor = res.has_more ? res.next_cursor : undefined;
        pages++;
    } while (cursor && pages < MAX_QUERY_PAGES);

    return results;
}

/* ── helpers ── */
export function getPageProps(page) {
    return {
        title: page.properties.Name?.title?.[0]?.plain_text || "ไม่มีชื่อ",
        status: page.properties.Status?.select?.name || STATUS.TODO,
        due: page.properties.Due?.date?.start || null,
        subject:
            page.properties.Subject?.rich_text?.[0]?.plain_text || "ทั่วไป",
        eventId: page.properties.EventId?.rich_text?.[0]?.plain_text || null,
        priority: page.properties.Priority?.select?.name || PRIORITY_DEFAULT,
        completed: page.properties.Completed?.date?.start || null,
        tags: page.properties.Tags?.multi_select?.map(t => t.name) || [],
    };
}

/* ── queries ── */
export async function getHomeworkStats() {
    const cached = cacheGet("notion:stats")
    if (cached) return cached
    const [activePages, donePages] = await Promise.all([fetchActive(), fetchDone()])
    let todo = 0, prog = 0, urgent = 0, overdue = 0
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const urgentLimit = new Date(today)
    urgentLimit.setDate(today.getDate() + URGENT_DAYS)

    for (const p of activePages) {
        const status = p.properties.Status?.select?.name
        if (status === STATUS.TODO) todo++
        else if (status === STATUS.IN_PROGRESS) prog++

        const d = p.properties.Due?.date?.start
        if (d) {
            const dt = new Date(d + "T00:00:00")
            if (dt >= today && dt <= urgentLimit) urgent++
            if (dt < today) overdue++
        }
    }

    const done = donePages.length
    const total = todo + prog + done
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    const result = { todo, prog, done, total, pct, urgent, overdue }
    cacheSet("notion:stats", result, 120_000)
    return result
}

export async function fetchActive() {
    const cached = cacheGet("notion:active");
    if (cached) return cached;
    const data = await queryAll({
        database_id: DB,
        filter: {
            property: "Status",
            select: { does_not_equal: STATUS.DONE },
        },
        sorts: [{ property: "Due", direction: "ascending" }],
    });
    cacheSet("notion:active", data, 15_000);
    return data;
}

export async function fetchDone() {
    const cached = cacheGet("notion:done");
    if (cached) return cached;
    const data = await queryAll({
        database_id: DB,
        filter: {
            property: "Status",
            select: { equals: STATUS.DONE },
        },
        sorts: [{ property: "Due", direction: "descending" }],
    });
    cacheSet("notion:done", data, 30_000);
    return data;
}

export async function fetchUpcoming(dateStart, dateEnd) {
    const cacheKey = `notion:upcoming:${dateStart}:${dateEnd}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const data = await queryAll({
        database_id: DB,
        filter: {
            and: [
                {
                    property: "Status",
                    select: { does_not_equal: STATUS.DONE },
                },
                {
                    property: "Due",
                    date: {
                        on_or_after: dateStart,
                        on_or_before: dateEnd,
                    },
                },
            ],
        },
        sorts: [{ property: "Due", direction: "ascending" }],
    });
    cacheSet(cacheKey, data, 60_000);
    return data;
}

/* ── mutations ── */
export async function createHomework({
    title,
    subject,
    due,
    rawText,
    note: noteProp,
    priority,
    tags,
}) {
    const cleanNote = rawText ? cleanTitle(rawText).trim() : "";
    const noteToStore = cleanNote.length > 3 ? cleanNote : (noteProp || "");
    const props = {
        Name: { title: [{ text: { content: title } }] },
        Subject: { rich_text: [{ text: { content: subject } }] },
        Status: { select: { name: STATUS.TODO } },
        Note: { rich_text: [{ text: { content: noteToStore } }] },
    };

    if (due) props.Due = { date: { start: due } };
    if (priority)
        props.Priority = { select: { name: priority } };
    if (tags?.length)
        props.Tags = { multi_select: tags.map(name => ({ name })) };

    const page = await notionWithRetry(() => notion.pages.create({
        parent: { database_id: DB },
        properties: props,
    }));
    cacheInvalidate("notion:");
    logger.info(`Created: "${title}" [${subject}] due=${due || "none"} priority=${priority || "none"}${tags?.length ? ` tags=${tags.join(",")}` : ""}`);
    return page.id;
}

export async function updateStatus(pageId, status) {
    const props = { Status: { select: { name: status } } };
    if (status === STATUS.DONE) {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, "0");
        const d = String(today.getDate()).padStart(2, "0");
        props.Completed = { date: { start: `${y}-${m}-${d}` } };
    } else {
        props.Completed = { date: null };
    }
    await notionWithRetry(() => notion.pages.update({
        page_id: pageId,
        properties: props,
    }));
    cacheInvalidate("notion:");
    logger.info(`Status updated: ${pageId} → ${status}`);
}

export async function updateHomework(pageId, { title, subject, due, priority, note, tags }) {
    const props = {};
    if (title !== undefined) props.Name = { title: [{ text: { content: title } }] };
    if (subject !== undefined) props.Subject = { rich_text: [{ text: { content: subject } }] };
    if (due !== undefined) props.Due = due ? { date: { start: due } } : { date: null };
    if (priority !== undefined) props.Priority = { select: { name: priority } };
    if (note !== undefined) props.Note = { rich_text: [{ text: { content: note || "" } }] };
    if (tags !== undefined) props.Tags = { multi_select: tags.map(name => ({ name })) };
    await notionWithRetry(() => notion.pages.update({ page_id: pageId, properties: props }));
    cacheInvalidate("notion:");
    logger.info(`Homework updated: ${pageId}`);
}

export async function updatePriority(pageId, priority) {
    await notionWithRetry(() => notion.pages.update({
        page_id: pageId,
        properties: { Priority: { select: { name: priority } } },
    }));
    cacheInvalidate("notion:");
    logger.info(`Priority updated: ${pageId} → ${priority}`);
}

const pageCache = new Map();
const PAGE_CACHE_TTL = 5000;

function getCachedPage(pageId) {
    const entry = pageCache.get(pageId);
    if (entry && Date.now() < entry.expires) return entry.page;
    return null;
}

function setCachedPage(pageId, page) {
    pageCache.set(pageId, { page, expires: Date.now() + PAGE_CACHE_TTL });
}

export async function getPageStatus(pageId) {
    let page = getCachedPage(pageId);
    if (!page) {
        page = await notion.pages.retrieve({ page_id: pageId });
        setCachedPage(pageId, page);
    }
    return page.properties.Status?.select?.name || STATUS.TODO;
}

export async function getPageTitle(pageId) {
    let page = getCachedPage(pageId);
    if (!page) {
        page = await notion.pages.retrieve({ page_id: pageId });
        setCachedPage(pageId, page);
    }
    return page.properties.Name?.title?.[0]?.plain_text || "งานนี้";
}

export async function archivePage(pageId) {
    await notionWithRetry(() => notion.pages.update({ page_id: pageId, archived: true }));
    cacheInvalidate("notion:");
    logger.info(`Archived: ${pageId}`);
}

export async function restorePage(pageId) {
    await notionWithRetry(() => notion.pages.update({ page_id: pageId, archived: false }));
    cacheInvalidate("notion:");
    logger.info(`Restored: ${pageId}`);
}
