import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const TOKEN = "test123";

const MOCK_DATA = {
  stats: {
    todo: 4,
    prog: 2,
    done: 3,
    total: 9,
    pct: 33,
    bySubject: {
      คณิต: 2,
      ไทย: 1,
      อังกฤษ: 2,
      ฟิสิกส์: 1,
      เคมี: 1,
      สังคม: 1,
    },
    byPriority: {
      "🔴 สูง": 2,
      "🟡 กลาง": 4,
      "🟢 ต่ำ": 3,
    },
    urgent: 3,
    overdue: 1,
  },
  homework: [
    {
      id: "mock-1",
      title: "แบบฝึกหัดเลข exponentials",
      status: "Todo",
      due: "2026-05-20",
      subject: "คณิต",
      priority: "🔴 สูง",
      note: "ทำข้อ 1-15 ในหนังสือ",
      url: "#",
    },
    {
      id: "mock-2",
      title: "รายงานสังคม ประเทศในอาเซียน",
      status: "In Progress",
      due: "2026-05-25",
      subject: "สังคม",
      priority: "🟡 กลาง",
      note: "ส่งเป็น PDF ขั้นต่ำ 10 หน้า",
      url: "#",
    },
    {
      id: "mock-3",
      title: "ท่องอาขยานบทที่ 5",
      status: "Todo",
      due: "2026-05-18",
      subject: "ไทย",
      priority: "🟡 กลาง",
      note: "",
      url: "#",
    },
    {
      id: "mock-4",
      title: "การทดลอง pH สารต่างๆ",
      status: "Done",
      due: "2026-05-10",
      subject: "เคมี",
      priority: "🟢 ต่ำ",
      note: "บันทึกผลการทดลองลงตาราง",
      url: "#",
    },
    {
      id: "mock-5",
      title: "ปริศนาคำศัพท์บทที่ 3",
      status: "Todo",
      due: "2026-05-22",
      subject: "อังกฤษ",
      priority: "🟡 กลาง",
      note: "",
      url: "#",
    },
    {
      id: "mock-6",
      title: "ฟิสิกส์การเคลื่อนที่แนวตรง",
      status: "In Progress",
      due: "2026-05-19",
      subject: "ฟิสิกส์",
      priority: "🔴 สูง",
      note: "ส่งพรุ่งนี้ก่อนเที่ยง!",
      url: "#",
    },
    {
      id: "mock-7",
      title: "งานนำเสนอกลุ่ม ม.3/2",
      status: "Done",
      due: "2026-05-08",
      subject: "อังกฤษ",
      priority: "🟢 ต่ำ",
      note: "Present หน้าชั้นเรียน 5 นาที",
      url: "#",
    },
    {
      id: "mock-8",
      title: "แยกตัวประกอบพหุนาม",
      status: "Todo",
      due: null,
      subject: "คณิต",
      priority: "🟢 ต่ำ",
      note: "ส่งเมื่อไหร่ก็ได้",
      url: "#",
    },
    {
      id: "mock-9",
      title: "ทำโจทย์เพิ่มเติมความน่าจะเป็น",
      status: "Done",
      due: "2026-05-12",
      subject: "คณิต",
      priority: "🟡 กลาง",
      note: "ตรวจคำตอบจากเฉลย",
      url: "#",
    },
  ],
  trend: [
    { date: "2026-04-18", label: "18/4", count: 0 },
    { date: "2026-04-19", label: "19/4", count: 1 },
    { date: "2026-04-20", label: "20/4", count: 0 },
    { date: "2026-04-21", label: "21/4", count: 0 },
    { date: "2026-04-22", label: "22/4", count: 2 },
    { date: "2026-04-23", label: "23/4", count: 0 },
    { date: "2026-04-24", label: "24/4", count: 1 },
    { date: "2026-04-25", label: "25/4", count: 0 },
    { date: "2026-04-26", label: "26/4", count: 0 },
    { date: "2026-04-27", label: "27/4", count: 1 },
    { date: "2026-04-28", label: "28/4", count: 0 },
    { date: "2026-04-29", label: "29/4", count: 0 },
    { date: "2026-04-30", label: "30/4", count: 0 },
    { date: "2026-05-01", label: "1/5", count: 1 },
    { date: "2026-05-02", label: "2/5", count: 0 },
    { date: "2026-05-03", label: "3/5", count: 0 },
    { date: "2026-05-04", label: "4/5", count: 0 },
    { date: "2026-05-05", label: "5/5", count: 0 },
    { date: "2026-05-06", label: "6/5", count: 0 },
    { date: "2026-05-07", label: "7/5", count: 0 },
    { date: "2026-05-08", label: "8/5", count: 2 },
    { date: "2026-05-09", label: "9/5", count: 0 },
    { date: "2026-05-10", label: "10/5", count: 0 },
    { date: "2026-05-11", label: "11/5", count: 1 },
    { date: "2026-05-12", label: "12/5", count: 0 },
    { date: "2026-05-13", label: "13/5", count: 0 },
    { date: "2026-05-14", label: "14/5", count: 1 },
    { date: "2026-05-15", label: "15/5", count: 0 },
    { date: "2026-05-16", label: "16/5", count: 0 },
    { date: "2026-05-17", label: "17/5", count: 0 },
  ],
};

const app = express();

app.use(express.static(path.join(__dirname, "src/web/public")));

function requireAuth(req, res, next) {
  const token = req.query.token || req.headers["x-token"];
  if (token !== TOKEN) {
    return res.status(401).json({ error: 'Unauthorized — use ?token=test123' });
  }
  next();
}

app.get("/api/all", requireAuth, (_, res) => {
  res.json(MOCK_DATA);
});

app.get("/api/stats", requireAuth, (_, res) => {
  res.json(MOCK_DATA.stats);
});

app.get("/api/homework", requireAuth, (_, res) => {
  res.json(MOCK_DATA.homework);
});

app.listen(PORT, () => {
  console.log(`📊 Mock dashboard at http://localhost:${PORT}/?token=${TOKEN}`);
});
