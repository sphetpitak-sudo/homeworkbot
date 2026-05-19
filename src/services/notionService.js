import { Client } from "@notionhq/client";
import { logger } from "../utils/logger.js";
import { STATUS, PRIORITY_DEFAULT, NOTION_PAGE_SIZE } from "../utils/constants.js";
import { cacheGet, cacheSet, cacheInvalidate } from "./cache.js";

const notion = new Client({ auth: process.env.NOTION_TOKEN?.trim() });
const DB = process.env.DATABASE_ID;

/* ── pagination helper ── */
async function queryAll(params) {
    const results = [];
    let cursor = undefined;

    do {
        const res = await notion.databases.query({
            ...params,
            start_cursor: cursor,
            page_size: NOTION_PAGE_SIZE,
        });
        results.push(...res.results);
        cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

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
    eventId,
    priority,
    tags,
}) {
    const props = {
        Name: { title: [{ text: { content: title } }] },
        Subject: { rich_text: [{ text: { content: subject } }] },
        Status: { select: { name: STATUS.TODO } },
        Note: { rich_text: [{ text: { content: rawText || noteProp || "" } }] },
    };

    if (due) props.Due = { date: { start: due } };
    if (eventId)
        props.EventId = { rich_text: [{ text: { content: eventId } }] };
    if (priority)
        props.Priority = { select: { name: priority } };
    if (tags?.length)
        props.Tags = { multi_select: tags.map(name => ({ name })) };

    await notion.pages.create({
        parent: { database_id: DB },
        properties: props,
    });
    cacheInvalidate("notion:");
    logger.info(`Created: "${title}" [${subject}] due=${due || "none"} priority=${priority || "none"}${tags?.length ? ` tags=${tags.join(",")}` : ""}`);
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
    await notion.pages.update({
        page_id: pageId,
        properties: props,
    });
    cacheInvalidate("notion:");
    logger.info(`Status updated: ${pageId} → ${status}`);
}

export async function updateHomework(pageId, { title, subject, due, priority, note, tags }) {
    const props = {};
    if (title !== undefined) props.Name = { title: [{ text: [{ content: title }] }] };
    if (subject !== undefined) props.Subject = { rich_text: [{ text: [{ content: subject }] }] };
    if (due !== undefined) props.Due = due ? { date: { start: due } } : { date: null };
    if (priority !== undefined) props.Priority = { select: { name: priority } };
    if (note !== undefined) props.Note = { rich_text: [{ text: { content: note || "" } }] };
    if (tags !== undefined) props.Tags = { multi_select: tags.map(name => ({ name })) };
    await notion.pages.update({ page_id: pageId, properties: props });
    cacheInvalidate("notion:");
    logger.info(`Homework updated: ${pageId}`);
}

export async function updatePriority(pageId, priority) {
    await notion.pages.update({
        page_id: pageId,
        properties: { Priority: { select: { name: priority } } },
    });
    cacheInvalidate("notion:");
    logger.info(`Priority updated: ${pageId} → ${priority}`);
}

export async function getPageStatus(pageId) {
    const page = await notion.pages.retrieve({ page_id: pageId });
    return page.properties.Status?.select?.name || STATUS.TODO;
}

export async function getPageTitle(pageId) {
    const page = await notion.pages.retrieve({ page_id: pageId });
    return page.properties.Name?.title?.[0]?.plain_text || "งานนี้";
}

export async function archivePage(pageId) {
    await notion.pages.update({ page_id: pageId, archived: true });
    cacheInvalidate("notion:");
    logger.info(`Archived: ${pageId}`);
}

export async function restorePage(pageId) {
    await notion.pages.update({ page_id: pageId, archived: false });
    cacheInvalidate("notion:");
    logger.info(`Restored: ${pageId}`);
}
