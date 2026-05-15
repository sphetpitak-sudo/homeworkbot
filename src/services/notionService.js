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
    eventId,
    priority,
}) {
    const props = {
        Name: { title: [{ text: { content: title } }] },
        Subject: { rich_text: [{ text: { content: subject } }] },
        Status: { select: { name: STATUS.TODO } },
        Note: { rich_text: [{ text: { content: rawText } }] },
    };

    if (due) props.Due = { date: { start: due } };
    if (eventId)
        props.EventId = { rich_text: [{ text: { content: eventId } }] };
    if (priority)
        props.Priority = { select: { name: priority } };

    await notion.pages.create({
        parent: { database_id: DB },
        properties: props,
    });
    cacheInvalidate("notion:");
    logger.info(`Created: "${title}" [${subject}] due=${due || "none"} priority=${priority || "none"}`);
}

export async function updateStatus(pageId, status) {
    await notion.pages.update({
        page_id: pageId,
        properties: { Status: { select: { name: status } } },
    });
    cacheInvalidate("notion:");
    logger.info(`Status updated: ${pageId} → ${status}`);
}

export async function updatePriority(pageId, priority) {
    await notion.pages.update({
        page_id: pageId,
        properties: { Priority: { select: { name: priority } } },
    });
    cacheInvalidate("notion:");
    logger.info(`Priority updated: ${pageId} → ${priority}`);
}

export async function archivePage(pageId) {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const eventId = page.properties.EventId?.rich_text?.[0]?.plain_text || null;
    await notion.pages.update({ page_id: pageId, archived: true });
    cacheInvalidate("notion:");
    logger.info(`Archived: ${pageId}`);
    return eventId;
}
