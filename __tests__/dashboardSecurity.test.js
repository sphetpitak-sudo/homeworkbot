import { jest } from '@jest/globals'

const TOKEN = "test-dashboard-token"
const BASE_PORT = 18080

const mockFetchActive = jest.fn(() => Promise.resolve([]))
const mockFetchDone = jest.fn(() => Promise.resolve([]))
const mockCreateHomework = jest.fn()
const mockUpdateStatus = jest.fn()
const mockUpdateHomework = jest.fn()
const mockArchivePage = jest.fn()
const mockGetPageProps = jest.fn()

jest.unstable_mockModule('../src/services/notionService.js', () => ({
    fetchActive: mockFetchActive,
    fetchDone: mockFetchDone,
    getPageProps: mockGetPageProps,
    createHomework: mockCreateHomework,
    updateStatus: mockUpdateStatus,
    updateHomework: mockUpdateHomework,
    archivePage: mockArchivePage,
}))

async function bootServer() {
    jest.resetModules()
    process.env.DASHBOARD_TOKEN = TOKEN
    process.env.NOTION_TOKEN = "test-notion-token"
    const { startWebServer } = await import("../src/web/server.js")
    const port = BASE_PORT + Math.floor(Math.random() * 1000)
    const server = await new Promise((resolve) => {
        const s = startWebServer(port)
        s.once("listening", () => resolve(s))
    })
    return { server, port }
}

describe('dashboard security headers', () => {
    test('sets hardening headers on every response', async () => {
        const { server, port } = await bootServer()
        try {
            const res = await fetch(`http://127.0.0.1:${port}/health`, {
                headers: { Authorization: `Bearer ${TOKEN}` },
            })
            expect(res.status).toBe(200)
            expect(res.headers.get("x-content-type-options")).toBe("nosniff")
            expect(res.headers.get("x-frame-options")).toBe("DENY")
            expect(res.headers.get("referrer-policy")).toBe("no-referrer")
            expect(res.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/)
        } finally {
            server.close()
        }
    })

    test('CSP allows the Chart.js CDN origin used by the dashboard', async () => {
        const { server, port } = await bootServer()
        try {
            const res = await fetch(`http://127.0.0.1:${port}/health`, {
                headers: { Authorization: `Bearer ${TOKEN}` },
            })
            const csp = res.headers.get("content-security-policy") || ""
            expect(csp).toMatch(/script-src[^;]*cdn\.jsdelivr\.net/)
        } finally {
            server.close()
        }
    })
})

describe('dashboard cookie-based auth', () => {
    test('rejects requests with neither header nor cookie', async () => {
        const { server, port } = await bootServer()
        try {
            const res = await fetch(`http://127.0.0.1:${port}/api/homework`)
            expect(res.status).toBe(401)
        } finally {
            server.close()
        }
    })

    test('accepts a valid session cookie', async () => {
        const { server, port } = await bootServer()
        try {
            const res = await fetch(`http://127.0.0.1:${port}/api/homework`, {
                headers: { Cookie: `hb_session=${TOKEN}` },
            })
            // Will likely 500 because Notion is not reachable, but should pass auth.
            expect(res.status).not.toBe(401)
        } finally {
            server.close()
        }
    })

    test('one-time ticket cannot be reused', async () => {
        const { server, port } = await bootServer()
        try {
            const { createDashboardUrl } = await import("../src/web/server.js")
            const url = createDashboardUrl(`http://127.0.0.1:${port}`)
            expect(url).toMatch(/\/api\/exchange\?ticket=/)
            const first = await fetch(url, { redirect: "manual" })
            expect([302, 200]).toContain(first.status)
            const second = await fetch(url, { redirect: "manual" })
            expect(second.status).toBe(401)
        } finally {
            server.close()
        }
    })
})

describe('service worker versioning', () => {
    test('served sw.js embeds the package.json version', async () => {
        const { server, port } = await bootServer()
        try {
            const res = await fetch(`http://127.0.0.1:${port}/sw.js`)
            expect(res.status).toBe(200)
            const text = await res.text()
            const pkgVersion = (await import("../package.json", { with: { type: "json" } })).default.version
            expect(text).toContain(`"homework-bot-v${pkgVersion}"`)
        } finally {
            server.close()
        }
    })
})
