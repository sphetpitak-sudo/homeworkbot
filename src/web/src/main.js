import "./style.css";

/* Token (legacy ?token= URL param) is only used as a fallback when no
   session cookie is present. The recommended path is /api/exchange?ticket=…
   which sets an httpOnly session cookie, after which the cookie alone
   authenticates subsequent requests. */
const TOKEN = new URLSearchParams(location.search).get("token");
function authHeaders(){
  const h = {"Content-Type": "application/json"};
  if (TOKEN) h["Authorization"] = `Bearer ${TOKEN}`;
  return h;
}
function authOpts(extra = {}){
  return { credentials: "same-origin", ...extra, headers: { ...authHeaders(), ...(extra.headers || {}) } };
}
const CACHE_TTL = 30000;
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const COLORS = {todo:"#e85d5d",prog:"#e8c84a",done:"#3db89e",amber:"#e8c84a",red:"#e85d5d",green:"#3db89e"};

const PRI_HIGH = "🔴 High";
const PRI_MED = "🟡 Medium";
const PRI_LOW = "🟢 Low";
const PRI_COLORS = {[PRI_HIGH]:"#e85d5d",[PRI_MED]:"#e8c84a",[PRI_LOW]:"#3db89e"};
const PRI_CLASS = {[PRI_HIGH]:"high",[PRI_MED]:"med",[PRI_LOW]:"low"};
const PRI_ORDER = [PRI_HIGH, PRI_MED, PRI_LOW];

/* Backward-compat: legacy Thai priority keys (stored in Notion before
   the English migration). We translate on the fly so the UI still
   recognizes them until the migration script runs. */
const PRI_LEGACY = {"🔴 สูง": PRI_HIGH, "🟡 กลาง": PRI_MED, "🟢 ต่ำ": PRI_LOW};
function priCanon(p) { return PRI_LEGACY[p] || p || PRI_MED; }

const STATUS = {TODO:"Todo",PROG:"In Progress",DONE:"Done"};
const STATUS_KEY = {[STATUS.TODO]:"todo",[STATUS.PROG]:"prog",[STATUS.DONE]:"done"};
const LABELS = {todo:"To Do",prog:"In Progress",done:"Done"};

/* Subject translation table: Thai legacy values → English labels.
   After the Notion migration, subjects are stored in English, but
   pre-migration data (and user-typed input) may still use Thai — we
   look up the emoji and display name through this map. */
const SUBJ_LABEL = {
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
  "Math": "Math", "English": "English", "Physics": "Physics",
  "Chemistry": "Chemistry", "Biology": "Biology", "Thai": "Thai",
  "Social Studies": "Social Studies", "History": "History",
  "Computer": "Computer", "Health": "Health", "PE": "PE",
  "General": "General",
};

const SUBJ_EMOJI = {
  "Math": "🔢", "คณิต": "🔢", "คณิตศาสตร์": "🔢",
  "English": "🔤", "อังกฤษ": "🔤", "อิ้ง": "🔤",
  "Physics": "⚛️", "ฟิสิกส์": "⚛️", "ฟิสิก": "⚛️",
  "Chemistry": "🧪", "เคมี": "🧪",
  "Biology": "🧬", "ชีวะ": "🧬", "ชีววิทยา": "🧬",
  "Thai": "📜", "ไทย": "📜", "ภาษาไทย": "📜",
  "Social Studies": "🌏", "สังคม": "🌏", "สังคมศึกษา": "🌏",
  "History": "🏛️", "ประวัติ": "🏛️", "ประวัติศาสตร์": "🏛️",
  "Computer": "💻", "คอม": "💻", "คอมพิวเตอร์": "💻",
  "Health": "🏃", "สุขศึกษา": "🏃", "PE": "🏃", "พละ": "🏃",
  "General": "📖", "ทั่วไป": "📖",
};

const TAGS = ["Exam", "Project", "Group", "Urgent", "Reading", "Worksheet"];

const SUBJ_OPTIONS = [
  "Math", "English", "Physics", "Chemistry", "Biology",
  "Thai", "Social Studies", "History", "Computer",
  "Health", "PE", "General",
];

const VIEWS = ["homeView","dashView","calView","listView","badgesView"];

const FAKE_TOKEN = "demo";
const FAKE_DATA = import.meta.env.PROD ? null : {
  stats: {todo:4,prog:2,done:3,total:9,pct:33,bySubject:{Math:2,English:1,Physics:1,Thai:1,"Social Studies":1},byPriority:{[PRI_HIGH]:2,[PRI_MED]:3,[PRI_LOW]:1},byTags:{Exam:2,Project:1,Group:2,Reading:1,Worksheet:2,Urgent:2},urgent:2,overdue:0},
  homework:[
    {id:"d1",title:"Math exercise: exponential",status:"Todo",due:"2026-05-20",subject:"Math",priority:PRI_HIGH,note:"Questions 1-15 in the textbook",tags:["Exam","Urgent"],url:"#"},
    {id:"d2",title:"Social Studies report: ASEAN countries",status:"In Progress",due:"2026-05-25",subject:"Social Studies",priority:PRI_MED,note:"Submit as PDF, minimum 10 pages",tags:["Project","Group"],url:"#"},
    {id:"d3",title:"Memorize Thai poem, chapter 5",status:"Todo",due:"2026-06-15",subject:"Thai",priority:PRI_MED,note:"",tags:["Reading"],url:"#"},
    {id:"d4",title:"Chemistry lab: pH of various substances",status:"Done",due:"2026-05-10",subject:"Chemistry",priority:PRI_LOW,note:"Record results in a table",tags:[],url:"#"},
    {id:"d5",title:"English vocabulary puzzle, ch. 3",status:"Todo",due:"2026-05-22",subject:"English",priority:PRI_MED,note:"",tags:["Worksheet"],url:"#"},
    {id:"d6",title:"Physics: linear motion",status:"In Progress",due:"2026-05-19",subject:"Physics",priority:PRI_HIGH,note:"Due tomorrow before noon!",tags:["Exam","Urgent"],url:"#"},
    {id:"d7",title:"Class group presentation",status:"Done",due:"2026-05-08",subject:"English",priority:PRI_LOW,note:"Present for 5 minutes",tags:["Group"],url:"#"},
    {id:"d8",title:"Factor polynomials",status:"Todo",due:null,subject:"Math",priority:PRI_LOW,note:"Submit any time",tags:[],url:"#"},
    {id:"d9",title:"Advanced probability",status:"Done",due:"2026-05-12",subject:"Math",priority:PRI_MED,note:"Check answers against the solution key",tags:["Worksheet"],url:"#"}
  ],
  trend: Array.from({length:30},(_,i)=>{const d=new Date();d.setDate(d.getDate()-29+i);return{label:`${d.getDate()}/${d.getMonth()+1}`,count:Math.floor(Math.random()*3)}})
};

const S = { items: [], stats: null, ts: 0, filter: "all", search: "", subject: "", charts: new Map(), calDate: new Date(), calSel: null, sortKey: "due", sortDir: 1, viewIdx: 0, trend: [], weeklyDone: [0,0,0,0,0,0,0], selected: new Set(), page: 0, pageSize: 20 };

function qs(id){return document.getElementById(id)}
function esc(t){const d=document.createElement("div");d.textContent=String(t??"");return d.innerHTML}
function safeUrl(u){const s=String(u||"").trim();if(s.startsWith("https://")||s.startsWith("/")||s.startsWith("#"))return s;return "#"}
function now(){return Date.now()}
function fmtTime(){return new Date().toLocaleString("en-US")}
function subjEmoji(s){return SUBJ_EMOJI[s]||SUBJ_EMOJI[SUBJ_LABEL[s]]||"📖"}
function subjLabel(s){return SUBJ_LABEL[s]||s||"General"}
function priColor(pri){return PRI_COLORS[priCanon(pri)]||"#9e9690"}
function priCls(pri){return PRI_CLASS[priCanon(pri)]||"med"}
function statusKey(st){return STATUS_KEY[st]||"todo"}
function daysDiff(dueStr){if(!dueStr)return null;const t=new Date();t.setHours(0,0,0,0);const d=new Date(dueStr+"T00:00:00");return Math.ceil((d-t)/86400000)}
function dueClass(due){const d=daysDiff(due);if(d===null)return"";if(d<0)return"overdue";if(d<=3)return"soon";return"safe"}
function dueLabel(due){const d=daysDiff(due);if(d===null)return"—";if(d<0)return `⚠ ${-d}d overdue`;if(d===0)return"Today";if(d===1)return"Tomorrow";return`${d}d left`}
function completedLabel(c){if(!c)return"—";const t=new Date();t.setHours(0,0,0,0);const dt=new Date(c+"T00:00:00");const d=Math.floor((t-dt)/86400000);if(d===0)return"✅ Today";if(d===1)return"✅ Yesterday";return`✅ ${d}d ago`}
function renderTagsPicker(elId,selected=[]){
  const container=qs(elId);if(!container)return;
  container.innerHTML=TAGS.map(t=>`<button type="button" class="tag-btn${selected.includes(t)?" selected":""}" data-tag="${t}" onclick="toggleTag('${elId}',this)">${t}</button>`).join("");
}
function toggleTag(elId,btn){
  btn.classList.toggle("selected");
}
function getSelectedTags(elId){
  const container=qs(elId);
  if(!container)return[];
  return[...container.querySelectorAll(".tag-btn.selected")].map(b=>b.dataset.tag);
}
function indexByDate(items){const m=new Map();for(const i of items){if(!i.due)continue;if(!m.has(i.due))m.set(i.due,[]);m.get(i.due).push(i)}return m}
function fmtLocalDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}

function showToast(msg, type){
  const t=document.createElement("div");
  if(type==="error"){
    t.innerHTML='<span style="flex:1">'+esc(msg)+'</span><span onclick="this.parentElement.remove()" style="cursor:pointer;margin-left:10px;opacity:.7;font-weight:600;">✕</span>';
    t.style.cssText="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:var(--coral);color:#fff;padding:8px 14px;border-radius:10px;font-size:12px;z-index:999;animation:fadeIn .3s;display:flex;align-items:center;gap:4px;max-width:90vw;box-shadow:0 4px 12px rgba(0,0,0,0.15);";
  }else{
    t.textContent=msg;
    t.style.cssText="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:var(--text);color:#fff;padding:8px 16px;border-radius:10px;font-size:12px;z-index:999;animation:fadeIn .3s";
    setTimeout(()=>t.remove(),1800)
  }
  document.body.appendChild(t);
}

const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const RARITY_COLORS = {
  Common: { bg: "rgba(144,204,120,0.15)", text: "#5a9e3e" },
  Uncommon: { bg: "rgba(74,144,226,0.15)", text: "#3b7dd8" },
  Rare: { bg: "rgba(162,89,255,0.15)", text: "#8a3ff0" },
  Epic: { bg: "rgba(255,149,0,0.15)", text: "#cc7a00" },
  Legendary: { bg: "rgba(255,204,0,0.15)", text: "#cca300" },
};
const RARITY_LABEL = ["🟢 Common", "🔵 Uncommon", "🟣 Rare", "🟠 Epic", "🟡 Legendary"];

async function loadBadges(){
  try{
    const data=await fetchJson("/api/badges?userId=0&_t="+now());
    if(data?.error){qs("badgesGrid").innerHTML=`<div class="empty">${esc(data.error)}</div>`;return}
    const badges=data.badges||[];
    const earned=badges.filter(b=>b.earned);
    const locked=badges.filter(b=>!b.earned);
    const total=badges.length;
    qs("badgesSub").textContent=`${earned.length}/${total} unlocked`;
    qs("badgesStats").innerHTML=`<div class="stat"><div class="stat-icon" style="background:rgba(232,133,74,0.1);"><svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--accent);fill:none;stroke-width:2;"><path d="M12 15l-5 3 1-5.5L4 8l5.5-.8L12 2l2.5 5.2L20 8l-4 4.5L17 18z"/></svg></div><div class="val" style="color:var(--accent)">${earned.length}</div><div class="lbl">Earned</div></div>
    <div class="stat"><div class="stat-icon" style="background:rgba(255,204,0,0.1);"><svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:#cca300;fill:none;stroke-width:2;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="val" style="color:#cca300">${locked.length}</div><div class="lbl">Locked</div></div>
    <div class="stat"><div class="stat-icon" style="background:rgba(144,204,120,0.1);"><svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:#5a9e3e;fill:none;stroke-width:2;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div><div class="val" style="color:#5a9e3e">${total}</div><div class="lbl">Total</div></div>
    <div class="stat"><div class="stat-icon" style="background:rgba(162,89,255,0.1);"><svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:#8a3ff0;fill:none;stroke-width:2;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div><div class="val" style="color:#8a3ff0">${data.rarest?.rarity||"N/A"}</div><div class="lbl">Rarest</div></div>`;
    function badgeCard(b,isEarned){
      const rc=RARITY_COLORS[b.rarity]||{bg:"rgba(0,0,0,0.05)",text:"#999"};
      return `<div style="background:${isEarned?rc.bg:"var(--surface2)"};border:1px solid ${isEarned?"transparent":"var(--border)"};border-radius:12px;padding:12px;text-align:center;opacity:${isEarned?1:0.4};transition:all .2s;">
        <div style="font-size:28px;margin-bottom:4px;">${b.icon}</div>
        <div style="font-weight:600;font-size:12px;color:${isEarned?"var(--text)":"var(--text3)"};">${esc(b.name)}</div>
        <div style="font-size:9px;color:${isEarned?rc.text:"var(--text3)"};margin-top:2px;">${RARITY_LABEL[RARITY_ORDER.indexOf(b.rarity)]}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px;">${esc(b.desc)}</div>
        ${isEarned?'<div style="font-size:9px;color:var(--green);margin-top:4px;">✅ Earned</div>':'<div style="font-size:9px;color:var(--text3);margin-top:4px;">🔒 Locked</div>'}
      </div>`;
    }
    qs("badgesGrid").innerHTML=earned.length?earned.map(b=>badgeCard(b,true)).join(""):'<div class="empty" style="grid-column:1/-1;">No badges earned yet</div>';
    qs("badgesAllGrid").innerHTML=badges.map(b=>badgeCard(b,b.earned)).join("");
  }catch(e){
    qs("badgesGrid").innerHTML=`<div class="empty">${esc(e.message)}</div>`;
  }
}

function showView(v){VIEWS.forEach(id=>qs(id).classList.add("hide"));qs(v).classList.remove("hide");S.viewIdx=VIEWS.indexOf(v);document.querySelectorAll(".sidebar-btn").forEach(el=>el.classList.remove("active"));const map={homeView:0,dashView:1,calView:2,listView:3,badgesView:4};const btns=document.querySelectorAll(".sidebar-btn");if(btns[map[v]])btns[map[v]].classList.add("active")}
function showHome(){showView("homeView");loadHome()}
function showDashboard(){showView("dashView");loadDash()}
function showCalendar(){showView("calView");loadCal()}
function showList(){showView("listView");loadList()}
function showBadges(){showView("badgesView");loadBadges()}

async function fetchJson(url,retries=2){const sep=url.includes('?')?'&':'?';const timeoutMs=8000;for(let attempt=0;attempt<=retries;attempt++){const ctrl=new AbortController();const tid=setTimeout(()=>ctrl.abort(),timeoutMs);try{const r=await fetch(url+sep+"_t="+now(),{signal:ctrl.signal,credentials:"same-origin",headers:authHeaders()});clearTimeout(tid);if(!r.ok){let msg=r.statusText;try{const b=await r.text();if(b)msg=b.slice(0,200)}catch{}throw new Error(msg)}return r.json()}catch(e){clearTimeout(tid);if(e.name==="AbortError")throw new Error("Timeout");if(attempt===retries)throw e;await new Promise(r=>setTimeout(r,500*(attempt+1)))}}}

async function loadAll(force){if(TOKEN===FAKE_TOKEN){S.items=FAKE_DATA.homework;S.stats=FAKE_DATA.stats;S.ts=now();S.trend=FAKE_DATA.trend;S.weeklyDone=[3,5,2,6,4,1,3];return FAKE_DATA}if(!force&&S.items.length&&now()-S.ts<CACHE_TTL)return {stats:S.stats,homework:S.items};try{const data=await fetchJson(`/api/all`);S.items=data.homework||[];S.stats=data.stats||null;S.ts=now();S.trend=data.trend||[];computeWeeklyDone();return data}catch(e){return {error:e.message}}}

function computeWeeklyDone(){
  const today=new Date();today.setHours(0,0,0,0);
  const dow=today.getDay();
  const mon=new Date(today);mon.setDate(today.getDate()-(dow===0?6:dow-1));
  const counts=[0,0,0,0,0,0,0];
  for(const i of S.items){
    if(i.status!==STATUS.DONE)continue;
    const completed=i.completed||i.due;
    if(!completed)continue;
    const dt=new Date(completed+"T00:00:00");
    const diff=Math.floor((dt-mon)/86400000);
    if(diff>=0&&diff<7)counts[diff]++;
  }
  S.weeklyDone=counts;
}

function destroyChart(id){const c=S.charts.get(id);if(c){c.destroy();S.charts.delete(id)}}
function saveChart(id,c){S.charts.set(id,c)}
function chartTooltip(){const d=document.body.classList.contains("dark");return{backgroundColor:d?"#1a1a24":"#fff",titleColor:d?"#e8e4df":"#1a1a2e",bodyColor:d?"#e8e4df":"#1a1a2e",titleFont:{size:11,weight:"600"},bodyFont:{size:11},padding:8,cornerRadius:6,displayColors:false}}

async function loadHome(){try{const d=await loadAll();if(d?.error){qs("homeStats").innerHTML=`<div class="empty">${esc(d.error)}</div>`;return}if(!d?.stats)return;const s=d.stats;
const iconSVG=(stroke,icon)=>`<svg viewBox="0 0 24 24" style="stroke:${stroke};fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">${icon}</svg>`;
const icons={todo:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',prog:'<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',done:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',total:'<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',urgent:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',overdue:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'};
qs("homeStats").innerHTML=`<div class="stat"><div class="stat-icon" style="background:${COLORS.todo}15;">${iconSVG(COLORS.todo,icons.todo)}</div><div class="val" style="color:${COLORS.todo}">${s.todo}</div><div class="lbl">To Do</div></div><div class="stat"><div class="stat-icon" style="background:${COLORS.prog}15;">${iconSVG(COLORS.prog,icons.prog)}</div><div class="val" style="color:${COLORS.prog}">${s.prog}</div><div class="lbl">In Progress</div></div><div class="stat"><div class="stat-icon" style="background:${COLORS.done}15;">${iconSVG(COLORS.done,icons.done)}</div><div class="val" style="color:${COLORS.done}">${s.done}</div><div class="lbl">Done</div></div><div class="stat"><div class="stat-icon" style="background:var(--accent-soft);">${iconSVG('var(--accent)',icons.total)}</div><div class="val" style="color:var(--accent)">${s.total}</div><div class="lbl">Total</div></div><div class="stat"><div class="stat-icon" style="background:rgba(232,133,74,0.1);">${iconSVG('var(--accent)',icons.urgent)}</div><div class="val" style="color:var(--accent)">${s.urgent}</div><div class="lbl">Urgent</div></div><div class="stat"><div class="stat-icon" style="background:rgba(232,93,93,0.1);">${iconSVG('var(--coral)',icons.overdue)}</div><div class="val" style="color:var(--coral)">${s.overdue||0}</div><div class="lbl">Overdue</div></div>`;
const byDate=indexByDate(S.items);const todayKey=fmtLocalDate(new Date());const todayItems=(byDate.get(todayKey)||[]).filter(i=>i.status!==STATUS.DONE);const tomorrowKey=fmtLocalDate(new Date(Date.now()+86400000));const tomorrowItems=(byDate.get(tomorrowKey)||[]).filter(i=>i.status!==STATUS.DONE);const nowDate=new Date();qs("homeTodayDate").textContent=`(${DOW[nowDate.getDay()]}. ${nowDate.getDate()} ${MONTH[nowDate.getMonth()]})`;
if(todayItems.length||tomorrowItems.length){let h="";if(todayItems.length){h+=`<div style="font-size:10px;color:var(--text3);margin-bottom:4px;">Today (${todayItems.length})</div>`;h+=todayItems.map(i=>{const pr=priCanon(i.priority);return`<div class="today-item" onclick="showDetail('${i.id}')"><span class="ti-pri" style="color:${priColor(pr)}">${pr}</span><span class="ti-title">${esc(i.title)}</span><span class="ti-sub">${subjEmoji(i.subject)} ${esc(subjLabel(i.subject))}</span></div>`}).join("")}if(tomorrowItems.length){h+=`<div style="font-size:10px;color:var(--text3);margin-bottom:4px;margin-top:8px;">Tomorrow (${tomorrowItems.length})</div>`;h+=tomorrowItems.map(i=>{const pr=priCanon(i.priority);return`<div class="today-item" onclick="showDetail('${i.id}')"><span class="ti-pri" style="color:${priColor(pr)}">${pr}</span><span class="ti-title">${esc(i.title)}</span><span class="ti-sub">${subjEmoji(i.subject)} ${esc(subjLabel(i.subject))}</span></div>`}).join("")}qs("homeTodayList").innerHTML=h}else{qs("homeTodayList").innerHTML='<div style="color:var(--text3);font-size:12px;text-align:center;padding:10px 0;"><svg viewBox="0 0 24 24" style="width:24px;height:24px;stroke:var(--text3);fill:none;stroke-width:1.5;margin-bottom:4px;display:block;margin-left:auto;margin-right:auto;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Nothing due today or tomorrow</div>'}
if(s.overdue>0){qs("homeOverdueCount").textContent=`${s.overdue} task${s.overdue>1?'s':''}`;qs("homeOverdueAlert").classList.remove("hide");qs("homeNoOverdue").style.display="none"}else{qs("homeOverdueAlert").classList.add("hide");qs("homeNoOverdue").style.display="flex"}qs("homeTs").textContent=fmtTime();loadQuote();renderPanic();renderSubjectProgress()}catch(e){qs("homeStats").innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
function refreshHome(){S.ts=0;loadHome();showToast("Updated!")}

/* ── Quote ─ */
async function loadQuote(){
  try{
    const q=await fetchJson("/api/quote");
    if(q&&q.text){
      qs("homeQuoteCard").style.display="block";
      qs("homeQuoteText").innerHTML=`"${esc(q.text)}"`;
      qs("homeQuoteAuthor").textContent=`— ${q.author}`;
    }
  }catch(e){qs("homeQuoteCard").style.display="none"}
}

/* ── Top 3 Urgent / Panic ─ */
function renderPanic(){
  const nonDone=S.items.filter(i=>i.status!==STATUS.DONE&&i.due);
  const sorted=nonDone.sort((a,b)=>new Date(a.due)-new Date(b.due));
  const top3=sorted.slice(0,3);
  const row=qs("homePanicRow");
  if(!top3.length){row.style.display="none";return}
  row.style.display="grid";
  qs("homePanicList").innerHTML=top3.map((i,idx)=>{
    const pr=priCanon(i.priority);
    const d=daysDiff(i.due);
    const urgent=d!==null&&d<=3;
    return`<div class="today-item" onclick="showDetail('${i.id}')">
      <span style="font-weight:700;font-size:12px;color:${urgent?"var(--coral)":"var(--accent)"};min-width:18px;">#${idx+1}</span>
      <span class="ti-title">${esc(i.title)}</span>
      <span class="ti-pri" style="color:${priColor(pr)}">${pr}</span>
      <span style="font-size:10px;color:var(--text3);">${dueLabel(i.due)}</span>
    </div>`
  }).join("");
}

/* ── Progress by Subject ─ */
function renderSubjectProgress(){
  const el=qs("homeSubjectProgress");
  const subs={};
  for(const i of S.items){
    if(!i.subject)continue;
    if(!subs[i.subject])subs[i.subject]={total:0,done:0};
    subs[i.subject].total++;
    if(i.status===STATUS.DONE)subs[i.subject].done++;
  }
  const entries=Object.entries(subs).sort((a,b)=>b[1].total-a[1].total);
  if(!entries.length){el.innerHTML='<div class="empty" style="padding:12px;">No tasks yet</div>';return}
  el.innerHTML=entries.map(([sub,{total,done}])=>{
    const pct=total>0?Math.round(done/total*100):0;
    const color=pct>=80?"var(--green)":pct>=50?"var(--accent)":"var(--coral)";
    return`<div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
        <span>${subjEmoji(sub)} ${esc(subjLabel(sub))}</span>
        <span style="color:var(--text3);">${done}/${total}</span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;border-radius:99px;background:${color};transition:width .6s;"></div>
      </div>
    </div>`
  }).join("");
}

async function loadDash(){try{const d=await loadAll(true);if(d?.error){qs("dashStats").innerHTML=`<div class="empty">${esc(d.error)}</div>`;return}const s=d.stats;if(!s)return;setGreeting();renderDashStats(s);renderDashCharts(s);renderDashPills(s);renderWeekGrid();renderHeatmap();qs("dashTs").textContent=fmtTime()}catch(e){qs("dashStats").innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
function refreshDash(){S.ts=0;loadDash();showToast("Updated!")}

function setGreeting(){const h=new Date().getHours();let g="Good Evening",sub="Review tomorrow's tasks";if(h<12){g="Good Morning";sub="Let's crush your goals today!"}else if(h<17){g="Good Afternoon";sub="Keep the momentum going!"}qs("dashGreeting").textContent=g;qs("dashSub").textContent=sub}

function renderDashStats(s){
  const iconSVG=(stroke,icon)=>`<svg viewBox="0 0 24 24" style="stroke:${stroke};fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">${icon}</svg>`;
  const icons={todo:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',prog:'<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',done:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',total:'<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',urgent:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',overdue:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'};
  qs("dashStats").innerHTML=`<div class="stat"><div class="stat-icon" style="background:${COLORS.todo}15;">${iconSVG(COLORS.todo,icons.todo)}</div><div class="val" style="color:${COLORS.todo}">${s.todo}</div><div class="lbl">To Do</div></div><div class="stat"><div class="stat-icon" style="background:${COLORS.prog}15;">${iconSVG(COLORS.prog,icons.prog)}</div><div class="val" style="color:${COLORS.prog}">${s.prog}</div><div class="lbl">In Progress</div></div><div class="stat"><div class="stat-icon" style="background:${COLORS.done}15;">${iconSVG(COLORS.done,icons.done)}</div><div class="val" style="color:${COLORS.done}">${s.done}</div><div class="lbl">Done</div></div><div class="stat"><div class="stat-icon" style="background:var(--accent-soft);">${iconSVG('var(--accent)',icons.total)}</div><div class="val" style="color:var(--accent)">${s.total}</div><div class="lbl">Total</div></div><div class="stat"><div class="stat-icon" style="background:rgba(232,133,74,0.1);">${iconSVG('var(--accent)',icons.urgent)}</div><div class="val" style="color:var(--accent)">${s.urgent}</div><div class="lbl">Urgent</div></div><div class="stat"><div class="stat-icon" style="background:rgba(232,93,93,0.1);">${iconSVG('var(--coral)',icons.overdue)}</div><div class="val" style="color:var(--coral)">${s.overdue||0}</div><div class="lbl">Overdue</div></div>`;
}

async function renderDashCharts(s){
  const { default: Chart } = await import("chart.js/auto");
  destroyChart("statusChart");const c1=qs("statusChart").getContext("2d");const stTotal=s.todo+s.prog+s.done;
  const ch1=new Chart(c1,{type:"doughnut",data:{labels:["To Do","In Progress","Done"],datasets:[{data:[s.todo,s.prog,s.done],backgroundColor:["#e85d5d","#e8c84a","#3db89e"],borderWidth:0,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:true,cutout:"72%",plugins:{legend:{display:false},tooltip:{...chartTooltip(),callbacks:{label:function(ctx){const val=ctx.parsed||0;const pct=stTotal>0?Math.round(val/stTotal*100):0;return`${ctx.label}: ${val} (${pct}%)`}}}}}});saveChart("statusChart",ch1);
  const legendHTML1=[["To Do","#e85d5d"],["In Progress","#e8c84a"],["Done","#3db89e"]].map(([l,c])=>`<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text2);margin:0 6px;"><span style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block;"></span>${l}</span>`).join("");
  qs("statusLegend").innerHTML=legendHTML1;

  destroyChart("priorityChart");const bp=s.byPriority||{};const PRI_LABELS={[PRI_HIGH]:"High",[PRI_MED]:"Medium",[PRI_LOW]:"Low"};const pLabels=Object.keys(bp).map(k=>PRI_LABELS[k]||k),pVals=Object.values(bp);const pTotal=pVals.reduce((a,b)=>a+b,0);const c2=qs("priorityChart").getContext("2d");
  const ch2=new Chart(c2,{type:"doughnut",data:{labels:pLabels,datasets:[{data:pVals.length?pVals:[0],backgroundColor:["#e85d5d","#e8c84a","#3db89e"],borderWidth:0,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:true,cutout:"72%",plugins:{legend:{display:false},tooltip:{...chartTooltip(),callbacks:{label:function(ctx){const val=ctx.parsed||0;const pct=pTotal>0?Math.round(val/pTotal*100):0;return`${ctx.label}: ${val} (${pct}%)`}}}}}});saveChart("priorityChart",ch2);
  const pColorMap={"High":"#e85d5d","Medium":"#e8c84a","Low":"#3db89e"};const legendHTML2=pLabels.map(l=>{const c=pColorMap[l]||"#9e9690";return`<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text2);margin:0 6px;"><span style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block;"></span>${l}</span>`}).join("");
  qs("priorityLegend").innerHTML=legendHTML2;

  destroyChart("weekChart");const wLabels=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];const wc=qs("weekChart").getContext("2d");
  const wGrd=wc.createLinearGradient(0,0,0,140);wGrd.addColorStop(0,"rgba(232,133,74,0.6)");wGrd.addColorStop(1,"rgba(232,133,74,0.1)");
  const wch=new Chart(wc,{type:"bar",data:{labels:wLabels,datasets:[{data:S.weeklyDone,backgroundColor:wGrd,borderRadius:6,borderSkipped:false,barPercentage:.55}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:chartTooltip()},scales:{x:{ticks:{color:"#9e9690",font:{size:9}},grid:{display:false}},y:{beginAtZero:true,ticks:{color:"#9e9690",font:{size:9},stepSize:1},grid:{color:"rgba(0,0,0,0.04)"}}}}});saveChart("weekChart",wch);

  await renderTrendChart();
}

async function renderTrendChart(){
  const { default: Chart } = await import("chart.js/auto");
  destroyChart("trendChart");
  const tc=qs("trendChart").getContext("2d");
  if(!S.trend||!S.trend.length){qs("trendChart").parentElement.innerHTML='<div class="empty"><svg viewBox="0 0 24 24" style="width:24px;height:24px;stroke:var(--text3);fill:none;stroke-width:1.5;margin-bottom:4px;display:block;margin-left:auto;margin-right:auto;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>No trend data yet</div>';return}
  const tGrd=tc.createLinearGradient(0,0,0,160);tGrd.addColorStop(0,"rgba(61,184,158,0.3)");tGrd.addColorStop(1,"rgba(61,184,158,0)");
  const labels=S.trend.map(t=>t.label);
  const data=S.trend.map(t=>t.count);
  const maxVal=Math.max(1,...data);
  const ch=new Chart(tc,{type:"line",data:{labels,datasets:[{data,borderColor:"#3db89e",backgroundColor:tGrd,fill:true,tension:.4,pointRadius:0,pointHoverRadius:4,pointHoverBackgroundColor:"#3db89e",borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{...chartTooltip(),callbacks:{label:ctx=>ctx.parsed.y?`${ctx.parsed.y} completed`:"None"}}},scales:{x:{ticks:{color:"#9e9690",font:{size:9},maxTicksLimit:10,maxRotation:0},grid:{display:false}},y:{beginAtZero:true,suggestedMax:maxVal<=1?1:undefined,ticks:{color:"#9e9690",font:{size:9},stepSize:maxVal<=3?1:undefined},grid:{color:"rgba(0,0,0,0.04)"}}}}});saveChart("trendChart",ch);
}

function renderDashPills(s){const subs=Object.entries(s.bySubject).sort((a,b)=>b[1]-a[1]);qs("dashSubjects").innerHTML=subs.length?subs.map(([n,c])=>`<div class="pill"><span>${subjEmoji(n)} ${esc(subjLabel(n))}</span><span class="ct">${c}</span></div>`).join(''):'<div style="text-align:center;padding:8px 0;"><svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:var(--text3);fill:none;stroke-width:1.5;margin-bottom:4px;display:block;margin-left:auto;margin-right:auto;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg><span style="color:var(--text3);font-size:12px;">No active tasks</span></div>';const tags=Object.entries(s.byTags||{}).sort((a,b)=>b[1]-a[1]);qs("dashTags").innerHTML=tags.length?tags.map(([n,c])=>`<div class="pill"><span>${esc(n)}</span><span class="ct">${c}</span></div>`).join(''):'<span style="font-size:11px;color:var(--text3);">No tags</span>';const today=new Date();today.setHours(0,0,0,0);const eow=new Date(today);eow.setDate(today.getDate()+(7-today.getDay()));const enw=new Date(eow);enw.setDate(eow.getDate()+7);const grp={overdue:0,thisW:0,nextW:0,later:0};for(const i of S.items){if(i.status===STATUS.DONE||!i.due)continue;const dt=new Date(i.due+"T00:00:00");if(dt<today)grp.overdue++;else if(dt<=eow)grp.thisW++;else if(dt<=enw)grp.nextW++;else grp.later++}const totalG=grp.overdue+grp.thisW+grp.nextW+grp.later;if(totalG>0){qs("urgencyBar").innerHTML=[[grp.overdue,"#e85d5d"],[grp.thisW,"#e8c84a"],[grp.nextW,"#4f8ef7"],[grp.later,"#9e9690"]].filter(([c])=>c).map(([c,cl])=>`<div style="height:100%;width:${(c/totalG*100).toFixed(1)}%;background:${cl};"></div>`).join("")}else{qs("urgencyBar").innerHTML=''}}

function renderWeekGrid(){const today=new Date();today.setHours(0,0,0,0);const eow=new Date(today);eow.setDate(today.getDate()+6);const byDate=indexByDate(S.items);let html='<div class="cal-grid cal-light">';for(let i=0;i<7;i++){const d=new Date(eow);d.setDate(eow.getDate()-6+i);html+=`<div class="cal-header">${DOW[d.getDay()].slice(0,3)}</div>`}for(let i=0;i<7;i++){const d=new Date(eow);d.setDate(eow.getDate()-6+i);const key=fmtLocalDate(d);const items=(byDate.get(key)||[]).filter(it=>it.status!==STATUS.DONE);const isToday=key===fmtLocalDate(today);const hasEvent=items.length>0;html+=`<div class="cal-cell${isToday?" today":""}${hasEvent?" has-event":""}" onclick="showCalDay('${key}');showCalendar()"><div class="day-num">${d.getDate()}</div>`;if(items.length)html+=`<div style="font-size:7px;color:var(--text3);margin-top:1px;">${items.length}</div>`;html+=`</div>`}html+='</div>';qs("dashWeekGrid").innerHTML=html}

function renderHeatmap(){const byDate=indexByDate(S.items);const today=new Date();today.setHours(0,0,0,0);const start=new Date(today);start.setDate(start.getDate()-364);const dayMs=86400000;const totalDays=365;const cellSize=11;const cellGap=2;const colW=cellSize+cellGap;const rowH=cellSize+cellGap;const weeks=Math.ceil(totalDays/7);const colors=["#ebedf0","#ffe4d6","#e8854a","#d4733a","#b85a2a"];const lvls=[0,1,3,6,Infinity];function getLevel(cnt){for(let i=0;i<lvls.length;i++)if(cnt<=lvls[i])return i;return lvls.length-1}let svg=`<svg viewBox="0 0 ${weeks*colW+8} ${7*rowH+24}" style="width:100%;max-width:${weeks*colW+8}px;height:auto;">`;const months=[];let lastMonth=-1;for(let w=0;w<weeks;w++){for(let d=0;d<7;d++){const idx=w*7+d;if(idx>=totalDays)continue;const dt=new Date(start.getTime()+idx*dayMs);const key=fmtLocalDate(dt);const cnt=(byDate.get(key)||[]).length;const lv=getLevel(cnt);const x=w*colW+4;const y=d*rowH+20;svg+=`<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${colors[lv]}" data-count="${cnt}" data-date="${key}"><title>${cnt} task${cnt!==1?"s":""} on ${key}</title></rect>`;if(d===0&&dt.getMonth()!==lastMonth){lastMonth=dt.getMonth();months.push({x,label:MONTH[lastMonth].slice(0,3)})}}}for(const m of months)svg+=`<text x="${m.x}" y="12" fill="#9e9690" font-size="8">${m.label}</text>`;const dowLabels=["Sun","Mon","","Wed","","Fri",""];for(let d=0;d<7;d++){if(dowLabels[d])svg+=`<text x="0" y="${d*rowH+20+cellSize-2}" fill="#9e9690" font-size="8">${dowLabels[d]}</text>`}const lColors=colors;const l=[1,2,3,4,5];svg+=`<g transform="translate(${weeks*colW-58}, ${7*rowH+2})"><text x="0" y="8" fill="#9e9690" font-size="8">Less</text>`;for(let i=0;i<5;i++)svg+=`<rect x="${32+i*12}" y="2" width="${cellSize}" height="${cellSize}" rx="2" fill="${lColors[i]}"/>`;svg+=`<text x="${32+5*12}" y="8" fill="#9e9690" font-size="8">More</text></g>`;svg+=`</svg>`;qs("dashHeatmap").innerHTML=svg}

function loadCal(){loadAll().then(d=>{if(!d?.error)renderCal();else{qs("calGrid").innerHTML='<div class="empty">'+esc(d.error)+'</div>'}})}
function renderCal(){const cy=S.calDate.getFullYear(),cm=S.calDate.getMonth();qs("calTitle").textContent=`${MONTH[cm]} ${cy}`;const first=new Date(cy,cm,1).getDay();const days=new Date(cy,cm+1,0).getDate();const prevDays=new Date(cy,cm,0).getDate();const todayKey=fmtLocalDate(new Date());const byDate=indexByDate(S.items);let html='';for(let i=0;i<7;i++)html+=`<div class="cal-header">${DOW[i].slice(0,3)}</div>`;for(let i=first-1;i>=0;i--)html+=`<div class="cal-cell other-month"><div class="day-num">${prevDays-i}</div></div>`;for(let d=1;d<=days;d++){const key=`${cy}-${String(cm+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;const items=byDate.get(key)||[];const isToday=key===todayKey;const isSel=key===S.calSel;const hasEvent=items.some(i=>i.status!==STATUS.DONE);html+=`<div class="cal-cell${isToday?" today":""}${hasEvent?" has-event":""}${isSel?" selected":""}" onclick="showCalDay('${key}')"><div class="day-num">${d}</div>`;if(items.length){const dots=[];const todo=items.filter(i=>i.status===STATUS.TODO).length;const prog=items.filter(i=>i.status===STATUS.PROG).length;if(todo)dots.push(`<span style="display:inline-block;width:3px;height:3px;border-radius:50%;background:${COLORS.todo};margin:0 1px;"></span>`.repeat(Math.min(todo,3)));if(prog)dots.push(`<span style="display:inline-block;width:3px;height:3px;border-radius:50%;background:${COLORS.prog};margin:0 1px;"></span>`.repeat(Math.min(prog,2)));if(dots.length)html+=`<div style="margin-top:1px;">${dots.join("")}</div>`}html+=`</div>`}const lastDay=new Date(cy,cm,days).getDay();for(let i=1;i<7-lastDay;i++)html+=`<div class="cal-cell other-month"><div class="day-num">${i}</div></div>`;qs("calGrid").innerHTML=html;if(!S.calSel)showCalDay(todayKey)}
function calMove(n){S.calDate.setMonth(S.calDate.getMonth()+n);renderCal()}
function calToday(){S.calDate=new Date();renderCal()}
function showCalDay(key){S.calSel=key;const byDate=indexByDate(S.items);const items=byDate.get(key)||[];const d=key?new Date(key+"T00:00:00"):new Date();qs("calDayLabel").textContent=key?`${DOW[d.getDay()]}. ${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}`:"-";if(!items.length){qs("calDayList").innerHTML='<div class="empty"><svg viewBox="0 0 24 24" style="width:32px;height:32px;stroke:var(--text3);fill:none;stroke-width:1.5;margin-bottom:6px;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><div>No tasks scheduled</div><span style="font-size:11px;color:var(--text3);">Enjoy the free time!</span></div>';return}qs("calDayList").innerHTML=items.map(i=>{const sc=statusKey(i.status);const sl=LABELS[sc];const pri=priCanon(i.priority);const pc=priColor(pri);const pcls=priCls(pri);return`<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="showDetail('${i.id}')"><span class="dot ${sc}"></span><span style="flex:1;font-size:12px;">${subjEmoji(i.subject)} ${esc(i.title)}</span><span class="pri-grad ${pcls}" style="font-size:9px;padding:2px 6px;">${pri}</span><span style="font-size:10px;color:var(--text3);">${sl}</span></div>`}).join("");renderCal()}

async function loadList(){try{const d=await loadAll();if(d?.error){qs("listTable").innerHTML=`<tr><td colspan="9" class="empty">${esc(d.error)}</td></tr>`;return}const subs=[...new Set(S.items.map(i=>i.subject))].sort();qs("subjectFilter").innerHTML='<option value="">All</option>'+subs.map(s=>`<option value="${esc(s)}">${subjEmoji(s)} ${esc(subjLabel(s))}</option>`).join("");const tags=[...new Set(S.items.flatMap(i=>i.tags||[]))].sort();qs("tagFilter").innerHTML='<option value="">All Tags</option>'+tags.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");listRenderFilters();listFilter();qs("listTs").textContent=fmtTime()}catch(e){qs("listTable").innerHTML=`<tr><td colspan="9" class="empty">${esc(e.message)}</td></tr>`}}
function listSort(key){if(S.sortKey===key)S.sortDir*=-1;else{S.sortKey=key;S.sortDir=1}document.querySelectorAll(".sort").forEach(el=>el.classList.remove("active"));const el=qs("sort-"+key);if(el)el.classList.add("active");listFilter()}
function listRenderFilters(){const counts={all:S.items.length,overdue:0};const today=new Date();today.setHours(0,0,0,0);for(const i of S.items){const sk=statusKey(i.status);counts[sk]=(counts[sk]||0)+1;if(i.status!==STATUS.DONE&&i.due&&new Date(i.due+"T00:00:00")<today)counts.overdue++}const tabs=[["all","All"],["overdue","Overdue"],["todo","To Do"],["prog","In Progress"],["done","Done"]];qs("listFilters").innerHTML=tabs.map(([k])=>`<button class="filter-btn${S.filter===k?" active":""}" onclick="setListFilter('${k}')">${tabs.find(t=>t[0]===k)[1]} ${counts[k]||0}</button>`).join("")}
function setListFilter(f){S.filter=f;listRenderFilters();listFilter()}
function getFilteredList(){
  const today=new Date();today.setHours(0,0,0,0);
  let filtered=S.items;
  if(S.filter==="overdue")filtered=filtered.filter(i=>i.status!==STATUS.DONE&&i.due&&new Date(i.due+"T00:00:00")<today);
  else if(S.filter==="todo")filtered=filtered.filter(i=>i.status===STATUS.TODO);
  else if(S.filter==="prog")filtered=filtered.filter(i=>i.status===STATUS.PROG);
  else if(S.filter==="done")filtered=filtered.filter(i=>i.status===STATUS.DONE);
  if(S.search)filtered=filtered.filter(i=>i.title.toLowerCase().includes(S.search)||i.subject.toLowerCase().includes(S.search)||(i.note||"").toLowerCase().includes(S.search));
  if(S.subject)filtered=filtered.filter(i=>i.subject===S.subject);
  if(S.tag)filtered=filtered.filter(i=>(i.tags||[]).includes(S.tag));
  const fromDate=qs("dateFrom")?.value,toDate=qs("dateTo")?.value;
  if(fromDate)filtered=filtered.filter(i=>!i.due||i.due>=fromDate);
  if(toDate)filtered=filtered.filter(i=>!i.due||i.due<=toDate);
  return filtered;
}
function applyListFilters(){
  let filtered=getFilteredList();
  filtered.sort((a,b)=>{let va=a[S.sortKey],vb=b[S.sortKey];if(S.sortKey==="priority"){va=PRI_ORDER.indexOf(va);vb=PRI_ORDER.indexOf(vb)}else if(S.sortKey==="status"){va=[STATUS.TODO,STATUS.PROG,STATUS.DONE].indexOf(a.status);vb=[STATUS.TODO,STATUS.PROG,STATUS.DONE].indexOf(b.status)}else if(S.sortKey==="due"){if(!va)return 1;if(!vb)return -1}else if(S.sortKey==="tags"){va=(va||[]).join(",").toLowerCase();vb=(vb||[]).join(",").toLowerCase()}else{va=String(va).toLowerCase();vb=String(vb).toLowerCase()}if(va<vb)return -1*S.sortDir;if(va>vb)return 1*S.sortDir;return 0});
  return filtered;
}
function listFilter(){
  S.search=qs("searchBox").value.toLowerCase().trim();
  S.subject=qs("subjectFilter").value;
  S.tag=qs("tagFilter").value;
  S.page=0;
  const filtered=applyListFilters();
  const total=S.items.length,done=S.items.filter(i=>i.status===STATUS.DONE).length;
  qs("listStatus").textContent=`${total} total · ${done} done · ${filtered.length} shown`;
  listRenderTable(filtered);
  renderFilterChips();
}
function tagsHtml(t){return(t||[]).map(v=>`<span class="tag-pill">${esc(v)}</span>`).join("")}
function listRenderTable(items){const today=new Date();today.setHours(0,0,0,0);const tbody=qs("listTable");const totalPages=Math.max(1,Math.ceil(items.length/S.pageSize));const pg=Math.min(S.page,totalPages-1);const start=pg*S.pageSize;const pageItems=items.slice(start,start+S.pageSize);if(!items.length){S.page=0;tbody.innerHTML='<tr><td colspan="9" class="empty"><svg viewBox="0 0 24 24" style="width:24px;height:24px;stroke:var(--text3);fill:none;stroke-width:1.5;margin-bottom:4px;display:block;margin-left:auto;margin-right:auto;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>No matching tasks<br><span style="font-size:11px;">Try adjusting your search or filters</span></td></tr>';renderPagination(0,0);return}const groups={overdue:[],thisWeek:[],nextWeek:[],later:[],noDate:[],done:[]};const eow=new Date(today);eow.setDate(today.getDate()+(7-today.getDay()));const enw=new Date(eow);enw.setDate(eow.getDate()+7);for(const i of pageItems){if(i.status===STATUS.DONE){groups.done.push(i);continue}if(!i.due){groups.noDate.push(i);continue}const dt=new Date(i.due+"T00:00:00");if(dt<today)groups.overdue.push(i);else if(dt<=eow)groups.thisWeek.push(i);else if(dt<=enw)groups.nextWeek.push(i);else groups.later.push(i)}const config=[["Overdue",groups.overdue],["This Week",groups.thisWeek],["Next Week",groups.nextWeek],["Later",groups.later],["No Date",groups.noDate],["Done",groups.done]];let html="";for(const [hdr,g] of config){if(!g.length)continue;html+=`<tr class="grp"><td colspan="9">${hdr} (${g.length})</td></tr>`;html+=g.map(i=>{const sc=statusKey(i.status);const sl=LABELS[sc];const pri=priCanon(i.priority);const pc=priColor(pri);const pcls=priCls(pri);const dr=dueClass(i.due);const checked=S.selected?.has(i.id)?"checked":"";const statusBtns=`<div class="status-btns"><button class="status-btn s-todo${i.status===STATUS.TODO?' active':''}" onclick="event.stopPropagation();changeStatus('${i.id}','${STATUS.TODO}')" title="To Do"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg></button><button class="status-btn s-prog${i.status===STATUS.PROG?' active':''}" onclick="event.stopPropagation();changeStatus('${i.id}','${STATUS.PROG}')" title="In Progress"><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button><button class="status-btn s-done${i.status===STATUS.DONE?' active':''}" onclick="event.stopPropagation();changeStatus('${i.id}','${STATUS.DONE}')" title="Done"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></button></div>`;return`<tr onclick="showDetail('${i.id}')"${i.status===STATUS.DONE?' class="done-row"':''}><td><input type="checkbox" ${checked} onclick="event.stopPropagation();toggleSelect('${i.id}')" style="cursor:pointer;"></td><td>${statusBtns}</td><td>${subjEmoji(i.subject)} ${esc(i.title)}</td><td><span class="tag">${esc(subjLabel(i.subject))}</span></td><td style="color:${pc};font-weight:600;" class="pri-${pcls}">${pri}</td><td class="${dr}">${i.due||"-"}</td><td class="${dr}">${i.due?dueLabel(i.due):"-"}</td><td>${completedLabel(i.completed)}</td><td>${tagsHtml(i.tags)}</td></tr>`}).join("")}tbody.innerHTML=html;renderPagination(items.length,totalPages)}
function renderPagination(total,totalPages){
  const info=qs("pageInfo");const btns=qs("pageBtns");
  if(total<=S.pageSize){info.textContent="";btns.innerHTML="";return}
  const pg=Math.min(S.page,totalPages-1);
  info.textContent=(pg*S.pageSize+1)+"\u2013"+Math.min((pg+1)*S.pageSize,total)+" of "+total;
  let b='<button class="page-btn" onclick="listGoPage(0)" '+(pg===0?'disabled':'')+'>\u00ab</button>';
  b+='<button class="page-btn" onclick="listGoPage('+(pg-1)+')" '+(pg===0?'disabled':'')+'>\u2039</button>';
  const r=2;const s=Math.max(0,pg-r);const e=Math.min(totalPages-1,pg+r);
  if(s>0)b+='<button class="page-btn" onclick="listGoPage('+(s-1)+')">\u2026</button>';
  for(let i=s;i<=e;i++)b+='<button class="page-btn'+(i===pg?' active':'')+'" onclick="listGoPage('+i+')">'+(i+1)+'</button>';
  if(e<totalPages-1)b+='<button class="page-btn" onclick="listGoPage('+(e+1)+')">\u2026</button>';
  b+='<button class="page-btn" onclick="listGoPage('+(pg+1)+')" '+(pg>=totalPages-1?'disabled':'')+'>\u203a</button>';
  b+='<button class="page-btn" onclick="listGoPage('+(totalPages-1)+')" '+(pg>=totalPages-1?'disabled':'')+'>\u00bb</button>';
  btns.innerHTML=b;
}
function listGoPage(n){
  S.page=n;
  const filtered=applyListFilters();
  listRenderTable(filtered);
}

function fmtDate(d){if(!d)return"";const dt=new Date(d+"T00:00:00");return dt.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"})}
function showDetail(id){const item=S.items.find(i=>i.id===id);if(!item)return;const sc=statusKey(item.status);const sl=LABELS[sc];const pri=priCanon(item.priority);const pc=PRI_COLORS[priCanon(pri)]||"#9e9690";const pcls=PRI_CLASS[priCanon(pri)]||"med";const dd=daysDiff(item.due);let remainStr,remainCl,remainPct;if(dd===null){remainStr="No due date";remainCl="safe";remainPct=null}else if(dd<0){remainStr=`Overdue ${-dd}d`;remainCl="overdue";remainPct=0}else if(dd===0){remainStr="Due Today";remainCl="overdue";remainPct=100}else if(dd===1){remainStr="Due Tomorrow";remainCl="soon";remainPct=90}else if(dd<=3){remainStr=`${dd}d left`;remainCl="soon";remainPct=dd<=2?80:60}else{remainStr=`${dd}d left`;remainCl="safe";remainPct=Math.max(5,100-dd*3)}const statusIcon=sc==="todo"?"📌":sc==="prog"?"🔄":"✅";qs("detailContent").innerHTML=`<div style="margin-bottom:16px;"><div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><span class="pri-grad ${pcls}" style="color:${pc};">${pri}</span><span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:2px 8px;border-radius:99px;">${subjEmoji(item.subject)} ${esc(subjLabel(item.subject))}</span></div><div style="font-size:18px;font-weight:700;line-height:1.3;">${esc(item.title)}</div></div><div style="background:var(--surface2);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);"><div><div style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:3px;">Time Remaining</div><div style="font-size:16px;font-weight:700;" class="${remainCl}">${remainStr}</div>${remainPct!==null?`<div style="margin-top:4px;width:80px;height:3px;background:var(--border);border-radius:99px;overflow:hidden;"><div style="height:100%;width:${remainPct}%;border-radius:99px;background:${remainPct<30?'var(--coral)':remainPct<70?'var(--accent)':'var(--green)'};"></div></div>`:''}</div><div style="text-align:right;"><div style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:3px;">Status</div><div style="font-size:14px;display:flex;align-items:center;gap:4px;font-weight:600;"><span class="dot ${sc}"></span>${sl}</div></div></div><div class="detail-field"><div class="detail-label">Subject</div><div class="detail-value">${subjEmoji(item.subject)} ${esc(subjLabel(item.subject))}</div></div><div class="detail-field"><div class="detail-label">Priority</div><div class="detail-value" style="color:${pc};font-weight:600;">${pri}</div></div><div class="detail-field"><div class="detail-label">Due Date</div><div class="detail-value">${item.due?fmtDate(item.due):"<span style='color:var(--text3);'>Not set</span>"}</div></div><div class="detail-field"><div class="detail-label">Completed</div><div class="detail-value">${item.completed?fmtDate(item.completed):"<span style='color:var(--text3);'>Not done</span>"}</div></div><div class="detail-field"><div class="detail-label">Tags</div><div class="detail-value">${item.tags?.length?tagsHtml(item.tags):"<span style='color:var(--text3);font-style:italic;'>No tags</span>"}</div></div><div class="detail-field"><div class="detail-label">Note</div><div class="detail-value" style="white-space:pre-wrap;line-height:1.5;font-size:12px;">${item.note?esc(item.note):"<span style='color:var(--text3);font-style:italic;'>No notes</span>"}</div></div><div class="detail-field"><div class="detail-label">Notion</div><div class="detail-value"><a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-size:12px;font-weight:500;">Open in Notion →</a></div></div><div style="display:flex;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border);"><button class="btn" onclick="saveAsTemplate({title:qs('detailTitle')?.textContent,subject:'${item.subject}',due:'${item.due||''}',priority:'${item.priority}',tags:${JSON.stringify(item.tags||[])},note:'${item.note||''}'})" style="flex:1;"><svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;vertical-align:middle;margin-right:4px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 1 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="15" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="15"/></svg>Save as Template</button><button class="btn" onclick="openEditModal('${item.id}')" style="flex:1;"><svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;vertical-align:middle;margin-right:4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button><button class="btn" onclick="deleteHomework('${item.id}')" style="flex:1;color:var(--coral);border-color:var(--coral);"><svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;vertical-align:middle;margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button></div>`;qs("detailOverlay").classList.add("open");qs("detailPanel").classList.add("open")}
function closeDetail(){qs("detailOverlay").classList.remove("open");qs("detailPanel").classList.remove("open")}

function saveAsTemplate(item){
    const name=prompt("Template name:",item.title);
    if(!name)return;
    localStorage.setItem("tmpl_"+name,JSON.stringify({title:item.title,subject:item.subject,dueOffset:item.due?1:0,priority:item.priority,tags:item.tags,note:item.note}));showToast("Template saved!")
}

function applyTemplate(tmpl){
    qs("addTitle").value=tmpl.title||"";qs("addSubject").value=tmpl.subject||"";
    if(tmpl.dueOffset){const d=new Date();d.setDate(d.getDate()+tmpl.dueOffset);qs("addDue").value=d.toISOString().slice(0,10)}
    qs("addPriority").value=tmpl.priority||"🟡 Medium";
    qs("addNote").value=tmpl.note||"";
    const tagsContainer=qs("addTags");
    tagsContainer.querySelectorAll(".tag-btn").forEach(btn=>{btn.classList.toggle("selected",tmpl.tags?.includes(btn.dataset.tag))});
    showAddModal();
}

function loadTemplateList(){
    const keys=[...Array(localStorage.length).keys()].map((i)=>localStorage.key(i)).filter(k=>k&&k.startsWith("tmpl_"));
    if(!keys.length)return[];
    return keys.map(k=>({name:k.slice(5),data:JSON.parse(localStorage.getItem(k)||"{}")}))
}

function exportCSV(){const csvCell=v=>`"${String(v??"").replace(/"/g,'""').replace(/\n/g,' ').replace(/\r/g,'')}"`;const headers=["Title","Subject","Status","Priority","Due Date","Completed Date","Tags","Note","Notion URL"];const rows=S.items.map(i=>[csvCell(i.title),csvCell(i.subject),csvCell(LABELS[statusKey(i.status)]),csvCell(priCanon(i.priority)),i.due||"",i.completed||"",csvCell((i.tags||[]).join(", ")),csvCell(i.note),i.url||""]);const csv=[headers.join(","),...rows.map(r=>r.join(","))].join("\n");const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`homework_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);showToast("CSV downloaded!")}

async function exportPDF(){const{jsPDF}=await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm");await import("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/+esm");const doc=new jsPDF({unit:"mm",format:"a4"});const pageW=210;const margin=14;const colW=(pageW-2*margin)/5;const subjects={};for(const i of S.items){if(i.status===STATUS.DONE)continue;const sub=subjLabel(i.subject)||"Other";if(!subjects[sub])subjects[sub]={todo:0,prog:0};if(i.status===STATUS.TODO)subjects[sub].todo++;else subjects[sub].prog++}doc.setFontSize(18);doc.text("Homework Dashboard Report",margin,20);doc.setFontSize(9);doc.setTextColor(140);doc.text(`Generated ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}`,margin,27);doc.setFontSize(14);doc.setTextColor(0);doc.text("Summary",margin,38);doc.setFontSize(10);const s=S.stats;if(s){const statsY=45;const colors=["#e85d5d","#e8c84a","#3db89e"];const vals=[s.todo,s.prog,s.done];const labels=["To Do","In Progress","Done"];const total=vals.reduce((a,b)=>a+b,0);for(let i=0;i<3;i++){const pct=total>0?vals[i]/total:0;const x=margin+i*(colW+4);doc.setFillColor(colors[i]);doc.rect(x,statsY,8,8,"F");doc.setTextColor(100);doc.text(labels[i],x+10,statsY+6);doc.setFontSize(16);doc.setTextColor(0);doc.text(String(vals[i]),x+10,statsY+20)}doc.setFontSize(9);doc.setTextColor(140);doc.text(`Urgent: ${s.urgent||0}   Overdue: ${s.overdue||0}`,margin,statsY+34)}doc.setFontSize(14);doc.setTextColor(0);doc.text("Active Tasks",margin,statsY+50);if(subjects){const subY=statsY+54;let sx=margin;for(const[sub,data]of Object.entries(subjects)){doc.setFontSize(8);doc.setTextColor(140);doc.text(sub+":",sx,subY);doc.setFontSize(10);doc.setTextColor(0);doc.text(`${data.todo+data.prog}`,sx+doc.getTextWidth(sub+": ")+1,subY);sx+=doc.getTextWidth(sub+": "+String(data.todo+data.prog)+"")+8}}const activeItems=S.items.filter(i=>i.status!==STATUS.DONE);const tableData=activeItems.map(i=>[i.title||"-",subjLabel(i.subject)||"-",LABELS[statusKey(i.status)],priCanon(i.priority),i.due||"-"]);if(tableData.length){const headers=[["Title","Subject","Status","Priority","Due Date"]];doc.autoTable({head:headers,body:tableData,startY:statsY+68,theme:"striped",headStyles:{fillColor:[232,133,74],fontSize:8,textColor:[255,255,255]},bodyStyles:{fontSize:7,textColor:[60,60,60]},alternateRowStyles:{fillColor:[245,245,245]},margin:{left:margin,right:margin}})}const finalY=doc.lastAutoTable.finalY||statsY+68;doc.setFontSize(8);doc.setTextColor(180);doc.text(`Total: ${activeItems.length} active tasks  |  Generated by Homework Bot`,margin,finalY+10);doc.save(`homework_${new Date().toISOString().slice(0,10)}.pdf`);showToast("PDF downloaded!")}

function applyTheme(isDark){document.body.classList.toggle("dark",isDark);localStorage.setItem("dark",isDark?"1":"0");const icon=qs("darkIcon");if(icon)icon.innerHTML=isDark?'<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>':'<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'}
function toggleDark(){applyTheme(!document.body.classList.contains("dark"))}
applyTheme(localStorage.getItem("dark")==="1"||(!localStorage.getItem("dark")&&window.matchMedia("(prefers-color-scheme:dark)").matches));

/* ── PWA Service Worker ─ */
if("serviceWorker"in navigator){navigator.serviceWorker.register("/sw.js").then(()=>console.log("SW registered")).catch(e=>console.warn("SW registration failed:",e))}

/* ── Quick Add Modal ─ */
function recalcPriority(dueStr){
  if(!dueStr)return PRI_LOW;
  const today=new Date();today.setHours(0,0,0,0);
  const due=new Date(dueStr+"T00:00:00");
  const diff=Math.ceil((due-today)/86400000);
  if(diff<-30)return PRI_LOW;
  if(diff<0)return PRI_HIGH;
  if(diff<=3)return PRI_HIGH;
  if(diff<=14)return PRI_MED;
  return PRI_LOW;
}
function buildSubjectOptions(){
  return '<option value="">Select subject</option>' + SUBJ_OPTIONS.map(s => `<option value="${s}">${SUBJ_EMOJI[s]} ${s}</option>`).join('');
}
function updatePriorityPreview(){
  const due=qs("addDue").value||null;
  const pri=recalcPriority(due);
  const cls=priCanon(pri)===PRI_HIGH?"overdue":priCanon(pri)===PRI_MED?"soon":"safe";
  qs("addPriorityPreview").innerHTML=`<span class="${cls}">Auto: ${pri}</span>`;
  qs("addPriority").value=pri;
}
function openAddModal(){
  qs("addSubject").innerHTML=buildSubjectOptions();
  qs("addTpl").innerHTML='<option value="">— Load Template —</option>'+loadTemplateList().map(t=>`<option value="${t.name}">${t.name}</option>`).join("");
  qs("addTitle").value="";
  qs("addDue").value="";
  qs("addNote").value="";
  renderTagsPicker("addTags",[]);
  updatePriorityPreview();
  qs("addOverlay").classList.add("open");
  qs("addPanel").classList.add("open");
  setTimeout(()=>qs("addTitle").focus(),100);
}
function closeAddModal(){
  qs("addOverlay").classList.remove("open");
  qs("addPanel").classList.remove("open");
}
async function submitHomework(e){
  e.preventDefault();
  const data={
    title:qs("addTitle").value.trim(),
    subject:qs("addSubject").value||"General",
    due:qs("addDue").value||null,
    priority:qs("addPriority").value,
    note:qs("addNote").value.trim(),
    tags:getSelectedTags("addTags"),
  };
  if(!data.title)return;
  try{
    if(TOKEN===FAKE_TOKEN){
      showToast("Added! (demo mode)");
      closeAddModal();
      return;
    }
    const res=await fetch("/api/homework",{
      method:"POST",
      headers:authHeaders(),
      body:JSON.stringify(data),
    });
    if(!res.ok)throw new Error(await res.text());
    showToast("Added!");
    closeAddModal();
    S.ts=0;
    loadHome();
  }catch(err){
    showToast(err.message,"error");
  }
}
qs("addDue")?.addEventListener("change",updatePriorityPreview);

/* ── Edit Homework ─ */
function openEditModal(id){
  const item=S.items.find(i=>i.id===id);
  if(!item)return;
  qs("editId").value=item.id;
  qs("editSubject").innerHTML=buildSubjectOptions();
  qs("editTitle").value=item.title||"";
  qs("editSubject").value=item.subject||"";
  qs("editDue").value=item.due||"";
  qs("editNote").value=item.note||"";
  renderTagsPicker("editTags",item.tags||[]);
  const pri=priCanon(item.priority);
  qs("editPriority").value=pri;
  qs("editPriorityPreview").innerHTML=`<span class="${priCanon(pri)===PRI_HIGH?"overdue":priCanon(pri)===PRI_MED?"soon":"safe"}">${pri}</span>`;
  closeDetail();
  qs("editOverlay").classList.add("open");
  qs("editPanel").classList.add("open");
  setTimeout(()=>qs("editTitle").focus(),100);
}
function closeEditModal(){
  qs("editOverlay").classList.remove("open");
  qs("editPanel").classList.remove("open");
}
function updateEditPriorityPreview(){
  const due=qs("editDue").value||null;
  const pri=recalcPriority(due);
  const cls=priCanon(pri)===PRI_HIGH?"overdue":priCanon(pri)===PRI_MED?"soon":"safe";
  qs("editPriorityPreview").innerHTML=`<span class="${cls}">Auto: ${pri}</span>`;
  qs("editPriority").value=pri;
}
async function submitEdit(e){
  e.preventDefault();
  const data={
    id:qs("editId").value,
    title:qs("editTitle").value.trim(),
    subject:qs("editSubject").value||"General",
    due:qs("editDue").value||null,
    priority:qs("editPriority").value,
    note:qs("editNote").value.trim(),
    tags:getSelectedTags("editTags"),
  };
  if(!data.id||!data.title)return;
  try{
    if(TOKEN===FAKE_TOKEN){
      const item=S.items.find(i=>i.id===data.id);
      if(item){Object.assign(item,data)}
      showToast("Edited! (demo mode)");
      closeEditModal();
      S.ts=0;loadAll().then(()=>{showDetail(data.id)});
      return;
    }
    const res=await fetch("/api/homework/update",{
      method:"POST",
      headers:authHeaders(),
      body:JSON.stringify(data),
    });
    if(!res.ok)throw new Error(await res.text());
    showToast("Saved!");
    closeEditModal();
    S.ts=0;
    loadAll().then(()=>{showDetail(data.id)});
  }catch(err){
    showToast(err.message,"error");
  }
}
qs("editDue")?.addEventListener("change",updateEditPriorityPreview);

/* ── Delete Homework ─ */
async function deleteHomework(id){
  if(!confirm("Delete this homework permanently?"))return;
  try{
    if(TOKEN===FAKE_TOKEN){
      S.items=S.items.filter(i=>i.id!==id);
      showToast("Deleted! (demo mode)");
      closeDetail();S.ts=0;loadHome();
      return;
    }
    const res=await fetch("/api/homework/delete",{
      method:"POST",
      headers:authHeaders(),
      body:JSON.stringify({id}),
    });
    if(!res.ok)throw new Error(await res.text());
    showToast("Deleted!");
    closeDetail();
    S.ts=0;
    loadHome();
  }catch(err){
    showToast(err.message,"error");
  }
}
/* ── Status Change ─ */
async function changeStatus(id,status){
  try{
    if(TOKEN===FAKE_TOKEN){
      const item=S.items.find(i=>i.id===id);
      if(item)item.status=status;
      showToast("Status updated! (demo)");
      S.ts=0;loadHome();
      return;
    }
    const res=await fetch("/api/status",{
      method:"POST",
      headers:authHeaders(),
      body:JSON.stringify({id,status}),
    });
    if(!res.ok)throw new Error(await res.text());
    const item=S.items.find(i=>i.id===id);
    if(item)item.status=status;
    showToast("Status updated!");
    S.ts=0;
    const v=VIEWS[S.viewIdx];
    if(v==="homeView")loadHome();
    else if(v==="dashView")loadDash();
    else if(v==="listView")loadList();
  }catch(err){
    showToast(err.message,"error");
  }
}
/* ── Bulk Actions ─ */
function toggleSelect(id){
  if(S.selected.has(id))S.selected.delete(id);
  else S.selected.add(id);
  updateBulkBar();
  listRenderTable(applyListFilters());
}
function toggleSelectAll(){
  const all=getFilteredList();
  const allSelected=all.every(i=>S.selected.has(i.id));
  if(allSelected){all.forEach(i=>S.selected.delete(i.id));}
  else{all.forEach(i=>S.selected.add(i.id));}
  updateBulkBar();
  listRenderTable(applyListFilters());
}
function clearSelection(){
  S.selected.clear();
  updateBulkBar();
  listRenderTable(applyListFilters());
}
function updateBulkBar(){
  const bar=qs("bulkBar");
  const cnt=qs("bulkCount");
  const sel=qs("selectAll");
  if(S.selected.size>0){
    bar.classList.remove("hide");
    cnt.textContent=`${S.selected.size} selected`;
  }else{
    bar.classList.add("hide");
  }
  const all=getFilteredList();
  sel.checked=all.length>0&&S.selected.size===all.length;
}
async function bulkStatus(status){
  if(!S.selected.size)return;
  const ids=[...S.selected];
  try{
    if(TOKEN===FAKE_TOKEN){
      ids.forEach(id=>{const item=S.items.find(i=>i.id===id);if(item)item.status=status;});
      showToast(`Updated ${ids.length} items! (demo)`);
      S.selected.clear();
      updateBulkBar();
      listRenderFilters();
      listFilter();
      return;
    }
    const res=await fetch("/api/bulk-status",{
      method:"POST",
      headers:authHeaders(),
      body:JSON.stringify({ids,status}),
    });
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||res.statusText);
    if(data.failed>0){showToast(`Updated ${data.updated}/${ids.length} (${data.failed} failed)`);}
    else{showToast(`Updated ${ids.length} items!`);}
    ids.forEach(id=>{const item=S.items.find(i=>i.id===id);if(item)item.status=status;});
    S.selected.clear();
    updateBulkBar();
    listRenderFilters();
    listFilter();
  }catch(err){
    showToast(err.message,"error");
  }
}

/* ── Bulk Delete ─ */
async function bulkDelete(){
  if(!S.selected.size)return;
  if(!confirm(`Delete ${S.selected.size} homework(s) permanently?`))return;
  const ids=[...S.selected];
  try{
    if(TOKEN===FAKE_TOKEN){
      S.items=S.items.filter(i=>!S.selected.has(i.id));
      showToast(`Deleted ${ids.length} items! (demo)`);
      S.selected.clear();
      updateBulkBar();
      listRenderFilters();
      listFilter();
      return;
    }
    const results=await Promise.allSettled(ids.map(id=>
      fetch("/api/homework/delete",{method:"POST",headers:authHeaders(),body:JSON.stringify({id})})
    ));
    const ok=results.filter(r=>r.status==="fulfilled"&&r.value.ok).length;
    const fail=results.filter(r=>r.status==="rejected"||!r.value.ok).length;
    if(fail>0)showToast(`Deleted ${ok}/${ids.length} items (${fail} failed)`,"error");
    else showToast(`Deleted ${ids.length} items!`);
    S.items=S.items.filter(i=>!S.selected.has(i.id));
    S.selected.clear();
    updateBulkBar();
    listRenderFilters();
    listFilter();
  }catch(err){
    showToast(err.message,"error");
  }
}

/* ── Filter chips ─ */
function renderFilterChips(){
  const el=qs("filterChips");
  const chips=[];
  if(S.subject)chips.push(`📚 ${esc(S.subject)}`);
  if(S.tag)chips.push(`🏷 ${esc(S.tag)}`);
  const from=qs("dateFrom")?.value,to=qs("dateTo")?.value;
  if(from)chips.push(`📅 From ${esc(from)}`);
  if(to)chips.push(`📅 To ${esc(to)}`);
  if(S.search)chips.push(`🔍 "${esc(S.search)}"`);
  if(chips.length){
    el.innerHTML=chips.map(c=>`<span style="display:inline-flex;align-items:center;gap:3px;background:var(--accent-soft);color:var(--accent);padding:2px 8px;border-radius:99px;font-size:11px;">${c}<span onclick="clearAllFilters()" style="cursor:pointer;opacity:.6;margin-left:2px;" title="Clear filters">✕</span></span>`).join("");
    el.style.display="flex";
    el.style.gap="4px";
    el.style.flexWrap="wrap";
  }else{
    el.style.display="none";
  }
}
function clearAllFilters(){
  qs("searchBox").value="";
  qs("subjectFilter").value="";
  qs("tagFilter").value="";
  qs("dateFrom").value="";
  qs("dateTo").value="";
  S.filter="all";
  listRenderFilters();
  listFilter();
}

/* ── Keyboard Shortcuts ─ */
document.addEventListener("keydown",function(e){
  if(e.target.tagName==="INPUT"||e.target.tagName==="SELECT"||e.target.tagName==="TEXTAREA")return;
  switch(e.key){
    case "Escape":
      closeDetail();
      if(qs("editOverlay").classList.contains("open"))closeEditModal();
      if(qs("addOverlay").classList.contains("open"))closeAddModal();
      break;
    case "n":
      if(!e.ctrlKey&&!e.metaKey)openAddModal();
      break;
    case "r":
      if(!e.ctrlKey&&!e.metaKey){const v=VIEWS[S.viewIdx];if(v==="homeView")refreshHome();else if(v==="dashView")refreshDash();else if(v==="listView"){S.ts=0;loadList()}else if(v==="badgesView")loadBadges();else loadCal();showToast("Refreshed!")}
      break;
    case "1":showHome();break;
    case "2":showDashboard();break;
    case "3":showCalendar();break;
    case "4":showList();break;
    case "5":showBadges();break;
  }
});

/* ── Auto-refresh (30s, skip when hidden) ─ */
setInterval(()=>{
  if(document.hidden)return;
  loadAll().then(()=>{
    const v=VIEWS[S.viewIdx];
    if(v==="homeView")loadHome();
    else if(v==="dashView")loadDash();
    else if(v==="listView")loadList();
    else if(v==="badgesView")loadBadges();
    else if(v==="calView")loadCal();
  }).catch(()=>{});
},30000);

showHome();

/* Expose onclick handlers to global scope.
   Vite uses <script type="module"> so top-level function declarations are
   module-scoped, not on window. Inline onclick="showHome()" in the HTML
   requires these to be on window. */
Object.assign(globalThis, {
  showHome, showCalendar, showDashboard, showList, showBadges,
  refreshHome, refreshDash, loadBadges,
  calMove, calToday,
  listSort, listFilter,
  closeDetail, closeEditModal, openAddModal, closeAddModal,
  submitHomework, submitEdit,
  saveAsTemplate, applyTemplate, loadTemplateList,
  exportCSV, exportPDF, toggleDark,
  toggleSelectAll, clearSelection,
  bulkDelete, bulkStatus,
});
