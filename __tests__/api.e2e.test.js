process.env.DASHBOARD_TOKEN = 'e2e-test-token-abc123';
process.env.TZ = 'Asia/Bangkok';

import { jest } from '@jest/globals';

/* ── mock notionService ── */

const mockFetchActive = jest.fn();
const mockFetchDone = jest.fn();
const mockCreateHomework = jest.fn();
const mockUpdateStatus = jest.fn();
const mockUpdateHomework = jest.fn();
const mockArchivePage = jest.fn();

const mockGetPageProps = jest.fn((page) => ({
  title: page.properties?.Name?.title?.[0]?.plain_text || 'ไม่มีชื่อ',
  status: page.properties?.Status?.select?.name || 'Todo',
  due: page.properties?.Due?.date?.start || null,
  subject: page.properties?.Subject?.rich_text?.[0]?.plain_text || 'ทั่วไป',
  eventId: page.properties?.EventId?.rich_text?.[0]?.plain_text || null,
  priority: page.properties?.Priority?.select?.name || '🟢 ต่ำ',
  completed: page.properties?.Completed?.date?.start || null,
  tags: page.properties?.Tags?.multi_select?.map(t => t.name) || [],
}));

jest.unstable_mockModule('../src/services/notionService.js', () => ({
  fetchActive: mockFetchActive,
  fetchDone: mockFetchDone,
  getPageProps: mockGetPageProps,
  createHomework: mockCreateHomework,
  updateStatus: mockUpdateStatus,
  updateHomework: mockUpdateHomework,
  archivePage: mockArchivePage,
}));

/* ── helpers ── */

function makePage(id, overrides = {}) {
  return {
    id,
    url: `https://notion.so/${id}`,
    properties: {
      Name: { title: [{ plain_text: overrides.title || 'Untitled' }] },
      Status: { select: { name: overrides.status || 'To Do' } },
      Due: overrides.due ? { date: { start: overrides.due } } : { date: null },
      Subject: { rich_text: [{ plain_text: overrides.subject || 'ทั่วไป' }] },
      Priority: { select: { name: overrides.priority || '🟢 ต่ำ' } },
      Completed: overrides.completed ? { date: { start: overrides.completed } } : { date: null },
      Tags: { multi_select: (overrides.tags || []).map(t => ({ name: t })) },
      Note: { rich_text: [{ plain_text: overrides.note || '' }] },
      EventId: { rich_text: [{ plain_text: overrides.eventId || '' }] },
    },
  };
}

const TOKEN = 'e2e-test-token-abc123';

const MOCK_ACTIVE = [
  makePage('page-1', { title: 'การบ้านคณิต', subject: 'คณิต', due: '2026-05-25', priority: '🔴 สูง', status: 'Todo', tags: ['สอบ'] }),
  makePage('page-2', { title: 'รายงานสังคม', subject: 'สังคม', due: '2026-06-01', priority: '🟡 กลาง', status: 'In Progress' }),
  makePage('page-3', { title: 'แบบฝึกหัดฟิสิกส์', subject: 'ฟิสิกส์', due: '2026-05-20', priority: '🔴 สูง', status: 'Todo' }),
];

const MOCK_DONE = [
  makePage('page-4', { title: 'ส่งการบ้านอังกฤษ', subject: 'อังกฤษ', due: '2026-05-15', status: 'Done', priority: '🟡 กลาง', completed: '2026-05-15' }),
  makePage('page-5', { title: 'งานภาษาไทย', subject: 'ไทย', due: '2026-05-10', status: 'Done', priority: '🟢 ต่ำ', completed: '2026-05-11' }),
];

const { startWebServer } = await import('../src/web/server.js');

/* ── tests ── */

describe('Web Dashboard API E2E', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    mockFetchActive.mockResolvedValue(MOCK_ACTIVE);
    mockFetchDone.mockResolvedValue(MOCK_DONE);
    mockCreateHomework.mockResolvedValue(undefined);
    mockUpdateStatus.mockResolvedValue(undefined);
    mockUpdateHomework.mockResolvedValue(undefined);
    mockArchivePage.mockResolvedValue(undefined);

    server = startWebServer(0);
    await new Promise((resolve) => server.on('listening', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => {
    server.close();
  });

  function authHeaders() {
    return { Authorization: `Bearer ${TOKEN}` };
  }

  /* ── auth ── */

  describe('Auth', () => {
    test('401 without auth header', async () => {
      const res = await fetch(`${baseUrl}/api/all`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    test('401 with wrong token', async () => {
      const res = await fetch(`${baseUrl}/api/all`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(401);
    });

    test('200 with correct Bearer token', async () => {
      const res = await fetch(`${baseUrl}/api/all`, { headers: authHeaders() });
      expect(res.status).toBe(200);
    });

    test('rejects query param token (no CSRF)', async () => {
      const res = await fetch(`${baseUrl}/api/all?token=${TOKEN}`);
      expect(res.status).toBe(401);
    });
  });

  /* ── GET /api/all ── */

  describe('GET /api/all', () => {
    test('returns stats + homework + trend + weeklyDone', async () => {
      const res = await fetch(`${baseUrl}/api/all`, { headers: authHeaders() });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toHaveProperty('stats');
      expect(data).toHaveProperty('homework');
      expect(data).toHaveProperty('trend');
      expect(data).toHaveProperty('weeklyDone');

      expect(data.stats.todo).toBe(2);
      expect(data.stats.prog).toBe(1);
      expect(data.stats.done).toBe(2);
      expect(data.stats.total).toBe(5);
      expect(data.stats.pct).toBe(40);
      expect(data.stats).toHaveProperty('urgent');
      expect(data.stats).toHaveProperty('overdue');
      expect(data.stats).toHaveProperty('bySubject');
      expect(data.stats).toHaveProperty('byPriority');
      expect(data.stats).toHaveProperty('byTags');

      expect(data.homework).toHaveLength(5);
      expect(data.trend).toHaveLength(30);
      expect(data.weeklyDone).toHaveLength(7);
    });

    test('homework sorted by due date ascending', async () => {
      const res = await fetch(`${baseUrl}/api/all`, { headers: authHeaders() });
      const data = await res.json();
      const items = data.homework;
      for (let i = 1; i < items.length; i++) {
        if (items[i - 1].due && items[i].due) {
          expect(items[i - 1].due <= items[i].due).toBe(true);
        }
      }
    });

    test('homework items have required fields', async () => {
      const res = await fetch(`${baseUrl}/api/all`, { headers: authHeaders() });
      const data = await res.json();
      for (const item of data.homework) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('title');
        expect(item).toHaveProperty('status');
        expect(item).toHaveProperty('subject');
        expect(item).toHaveProperty('priority');
        expect(item).toHaveProperty('tags');
        expect(item).toHaveProperty('url');
      }
    });
  });

  /* ── legacy endpoints ── */

  describe('Legacy endpoints', () => {
    test('GET /api/stats returns stats only', async () => {
      const res = await fetch(`${baseUrl}/api/stats`, { headers: authHeaders() });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('todo');
      expect(data).toHaveProperty('done');
      expect(data).toHaveProperty('bySubject');
      expect(data).not.toHaveProperty('homework');
    });

    test('GET /api/homework returns list only', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, { headers: authHeaders() });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(5);
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('status');
      expect(data[0]).toHaveProperty('subject');
    });
  });

  /* ── POST /api/homework (create) ── */

  describe('POST /api/homework (create)', () => {
    test('creates homework with title + subject + due', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: 'ทดสอบสร้างการบ้าน', subject: 'คณิต', due: '2026-06-10' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mockCreateHomework).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'ทดสอบสร้างการบ้าน', subject: 'คณิต', due: '2026-06-10' }),
      );
    });

    test('creates homework with defaults (subject=ทั่วไป, due=null)', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: 'งานไม่ระบุวิชา' }),
      });
      expect(res.status).toBe(200);
      expect(mockCreateHomework).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'งานไม่ระบุวิชา', subject: 'ทั่วไป', due: null }),
      );
    });

    test('400 when title is missing', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ subject: 'คณิต', due: '2026-06-10' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Title required');
    });

    test('400 when title is whitespace only', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: '   ' }),
      });
      expect(res.status).toBe(400);
    });

    test('creates homework with tags', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: 'งานมีแท็ก', tags: ['สอบ', 'ด่วน'] }),
      });
      expect(res.status).toBe(200);
      expect(mockCreateHomework).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['สอบ', 'ด่วน'] }),
      );
    });

    test('creates homework with priority auto-calculated from due', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: 'งานใกล้ถึงกำหนด', due: '2026-05-20' }),
      });
      expect(res.status).toBe(200);
      expect(mockCreateHomework).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'งานใกล้ถึงกำหนด',
          priority: expect.stringMatching(/🔴|🟡|🟢/),
        }),
      );
    });
  });

  /* ── POST /api/status ── */

  describe('POST /api/status', () => {
    test('updates single item status', async () => {
      const res = await fetch(`${baseUrl}/api/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: 'page-1', status: 'Done' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mockUpdateStatus).toHaveBeenCalledWith('page-1', 'Done');
    });

    test('400 when id is missing', async () => {
      const res = await fetch(`${baseUrl}/api/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: 'Done' }),
      });
      expect(res.status).toBe(400);
    });

    test('400 when status is missing', async () => {
      const res = await fetch(`${baseUrl}/api/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: 'page-1' }),
      });
      expect(res.status).toBe(400);
    });

    test('handles server error gracefully', async () => {
      mockUpdateStatus.mockRejectedValueOnce(new Error('Notion API error'));
      const res = await fetch(`${baseUrl}/api/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: 'page-999', status: 'Done' }),
      });
      expect(res.status).toBe(500);
    });
  });

  /* ── POST /api/bulk-status ── */

  describe('POST /api/bulk-status', () => {
    test('updates all items successfully', async () => {
      const res = await fetch(`${baseUrl}/api/bulk-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids: ['page-1', 'page-2', 'page-3'], status: 'Done' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toBe(3);
      expect(data.failed).toBe(0);
      expect(data.success).toBe(true);
    });

    test('400 when ids is missing', async () => {
      const res = await fetch(`${baseUrl}/api/bulk-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: 'Done' }),
      });
      expect(res.status).toBe(400);
    });

    test('400 when ids is empty array', async () => {
      const res = await fetch(`${baseUrl}/api/bulk-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids: [], status: 'Done' }),
      });
      expect(res.status).toBe(400);
    });

    test('400 when status is missing', async () => {
      const res = await fetch(`${baseUrl}/api/bulk-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids: ['page-1'] }),
      });
      expect(res.status).toBe(400);
    });

    test('reports partial failures', async () => {
      mockUpdateStatus
        .mockReset()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Not found'));
      const res = await fetch(`${baseUrl}/api/bulk-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids: ['page-ok', 'page-missing'], status: 'Done' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toBe(1);
      expect(data.failed).toBe(1);
      expect(data.success).toBe(false);
    });
  });

  /* ── POST /api/homework/update ── */

  describe('POST /api/homework/update', () => {
    test('updates title and priority', async () => {
      const res = await fetch(`${baseUrl}/api/homework/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: 'page-1', title: 'ชื่อใหม่', priority: '🔴 สูง' }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdateHomework).toHaveBeenCalledWith('page-1',
        expect.objectContaining({ title: 'ชื่อใหม่', priority: '🔴 สูง' }),
      );
    });

    test('updates tags (sends empty array to clear)', async () => {
      const res = await fetch(`${baseUrl}/api/homework/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: 'page-2', tags: [] }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdateHomework).toHaveBeenCalledWith('page-2',
        expect.objectContaining({ tags: [] }),
      );
    });

    test('400 when id is missing', async () => {
      const res = await fetch(`${baseUrl}/api/homework/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: 'ชื่อใหม่' }),
      });
      expect(res.status).toBe(400);
    });

    test('handles server error', async () => {
      mockUpdateHomework.mockRejectedValueOnce(new Error('Update failed'));
      const res = await fetch(`${baseUrl}/api/homework/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: 'page-999', title: 'ไม่เจอ' }),
      });
      expect(res.status).toBe(500);
    });
  });

  /* ── POST /api/homework/delete ── */

  describe('POST /api/homework/delete', () => {
    test('archives homework', async () => {
      const res = await fetch(`${baseUrl}/api/homework/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: 'page-3' }),
      });
      expect(res.status).toBe(200);
      expect(mockArchivePage).toHaveBeenCalledWith('page-3');
    });

    test('400 when id is missing', async () => {
      const res = await fetch(`${baseUrl}/api/homework/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  /* ── POST /api/homework validation ── */

  describe('POST /api/homework validation', () => {
    test('400 when body is empty', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test('400 when title is empty string', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: '' }),
      });
      expect(res.status).toBe(400);
    });

    test('accepts note field', async () => {
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: 'งานมีโน๊ต', note: 'รายละเอียดเพิ่มเติม' }),
      });
      expect(res.status).toBe(200);
      expect(mockCreateHomework).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'รายละเอียดเพิ่มเติม' }),
      );
    });

    test('priority auto-calculated when not provided', async () => {
      mockCreateHomework.mockClear();
      const res = await fetch(`${baseUrl}/api/homework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: 'งาน', due: '2026-05-20' }),
      });
      expect(res.status).toBe(200);
      expect(mockCreateHomework).toHaveBeenCalledWith(
        expect.objectContaining({ priority: '🔴 สูง' }),
      );
    });
  });

  /* ── GET /api/all edge cases ── */

  describe('GET /api/all edge cases', () => {
    test('empty active list', async () => {
      mockFetchActive.mockResolvedValueOnce([]);
      const res = await fetch(`${baseUrl}/api/all`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.stats.todo).toBe(0);
      expect(data.stats.prog).toBe(0);
      expect(data.stats.done).toBe(2);
    });

    test('empty done list', async () => {
      mockFetchDone.mockResolvedValueOnce([]);
      const res = await fetch(`${baseUrl}/api/all`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.stats.done).toBe(0);
    });

    test('both lists empty', async () => {
      mockFetchActive.mockResolvedValueOnce([]);
      mockFetchDone.mockResolvedValueOnce([]);
      const res = await fetch(`${baseUrl}/api/all`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.stats.total).toBe(0);
      expect(data.stats.pct).toBe(0);
    });

    test('stats has expected keys', async () => {
      const res = await fetch(`${baseUrl}/api/all`, { headers: authHeaders() });
      const data = await res.json();
      const stats = data.stats;
      expect(stats).toHaveProperty('todo');
      expect(stats).toHaveProperty('prog');
      expect(stats).toHaveProperty('done');
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('pct');
      expect(stats).toHaveProperty('urgent');
      expect(stats).toHaveProperty('overdue');
      expect(stats).toHaveProperty('bySubject');
      expect(stats).toHaveProperty('byPriority');
      expect(stats).toHaveProperty('byTags');
    });
  });

  /* ── POST /api/status validation ── */

  describe('POST /api/status validation', () => {
    test('400 for invalid status value', async () => {
      const res = await fetch(`${baseUrl}/api/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: 'page-1', status: 'InvalidStatus' }),
      });
      expect(res.status).toBe(400);
    });

    test('400 for empty id', async () => {
      const res = await fetch(`${baseUrl}/api/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: '', status: 'Done' }),
      });
      expect(res.status).toBe(400);
    });
  });

  /* ── Rate limiting ── */

  describe('Rate limiting', () => {
    test('returns 429 after many requests', async () => {
      const promises = [];
      for (let i = 0; i < 70; i++) {
        promises.push(
          fetch(`${baseUrl}/api/all`, { headers: authHeaders() }),
        );
      }
      const results = await Promise.all(promises);
      const tooMany = results.filter(r => r.status === 429);
      expect(tooMany.length).toBeGreaterThan(0);
    });
  });

  /* ── Health check ── */

  describe('Health check', () => {
    test('GET /health returns ok', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    test('GET /health does not require auth', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
    });
  });
});
