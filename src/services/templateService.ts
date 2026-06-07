import { createJsonStore } from "../utils/jsonStore.js"
import { logger } from "../utils/logger.js"

const TEMPLATES_FILE = ".templates.json"

const store = createJsonStore(TEMPLATES_FILE, { templates: [], nextId: 1 })

function newId() {
    return String(store.data.nextId++)
}

export function getTemplates() {
    return store.data.templates
}

export function addTemplate({ name, title, subject, dueOffset, priority, note, tags }) {
    const tmpl = {
        id: newId(),
        name,
        title,
        subject,
        dueOffset,
        priority,
        note: note || "",
        tags: tags || [],
        createdAt: new Date().toISOString(),
    }
    store.data.templates.push(tmpl)
    store.scheduleWrite()
    return tmpl
}

export function deleteTemplate(id) {
    const idx = store.data.templates.findIndex((t) => t.id === id)
    if (idx === -1) return false
    store.data.templates.splice(idx, 1)
    store.scheduleWrite()
    return true
}

export function flushTemplates() {
    return store.flush()
}
