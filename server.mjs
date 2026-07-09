import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import crypto from "node:crypto";
import { handleCover, loadCovers } from "./cover.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const distDir = join(root, "dist");
const dataDir = join(root, "data");
const souvenirDir = join(dataDir, "souvenirs");
const recordsPath = join(dataDir, "records.json");
const playsPath = join(dataDir, "plays.json");
const coversDir = join(root, "covers");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const port = Number(process.env.PORT || 4287);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm"
};

await mkdir(souvenirDir, { recursive: true });
await mkdir(coversDir, { recursive: true });
await loadCovers(coversDir);

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function localUrls() {
  const urls = [`http://localhost:${port}`];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

async function readRecords() {
  try {
    return JSON.parse(await readFile(recordsPath, "utf8"));
  } catch {
    return [];
  }
}

async function saveRecords(records) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(recordsPath, JSON.stringify(records.slice(0, 500), null, 2), "utf8");
}

// --- player attendance log (every player who starts a round), grouped per day ---
function athensDay(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
}
async function readPlays() {
  try { return JSON.parse(await readFile(playsPath, "utf8")); } catch { return []; }
}
async function savePlays(plays) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(playsPath, JSON.stringify(plays.slice(-10000), null, 2), "utf8");
}

function readBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/network") {
    return sendJson(res, 200, { urls: localUrls(), preferred: localUrls()[1] || localUrls()[0] });
  }

  if (url.pathname === "/api/records" && req.method === "GET") {
    return sendJson(res, 200, { records: await readRecords() });
  }

  // log a player at game start (per-day attendance — the client asks "how many played per day")
  if (url.pathname === "/api/play-log" && req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: "bad-json" }); }
    const now = new Date();
    const entry = {
      id: crypto.randomUUID(),
      ts: now.toISOString(),
      day: athensDay(now),
      playerName: String(body.playerName || "").slice(0, 80),
      contact: String(body.contact || "").slice(0, 120),
      consent: body.consent === true,
      avatar: String(body.avatar || "").slice(0, 40),
      gender: String(body.gender || "").slice(0, 4),
      difficulty: String(body.difficulty || "").slice(0, 16),
      duration: Number(body.duration || 0)
    };
    const plays = await readPlays();
    plays.push(entry);
    await savePlays(plays);
    return sendJson(res, 201, { ok: true, id: entry.id, day: entry.day });
  }

  // per-day attendance summary
  if (url.pathname === "/api/stats" && req.method === "GET") {
    const plays = await readPlays();
    const byDay = {};
    for (const p of plays) {
      const d = p.day || String(p.ts || "").slice(0, 10);
      if (d) byDay[d] = (byDay[d] || 0) + 1;
    }
    const today = athensDay();
    return sendJson(res, 200, { total: plays.length, today, todayCount: byDay[today] || 0, byDay });
  }

  // full attendance export (CSV, for the client)
  if (url.pathname === "/api/plays.csv" && req.method === "GET") {
    const plays = await readPlays();
    const esc = v => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const rows = [["day", "timestamp", "player_name", "contact", "consent", "gender", "avatar", "difficulty", "duration_sec"].join(",")];
    for (const p of plays) {
      rows.push([p.day, p.ts, p.playerName, p.contact, p.consent, p.gender, p.avatar, p.difficulty, p.duration].map(esc).join(","));
    }
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=ayra-tennis-plays.csv",
      "cache-control": "no-store"
    });
    return res.end("﻿" + rows.join("\n"));
  }

  // full scores export (CSV, grouped by Athens day — players & their scores, for the client)
  if (url.pathname === "/api/records.csv" && req.method === "GET") {
    const records = await readRecords();
    const esc = v => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const withDay = records.map(r => ({ ...r, _day: r.day || athensDay(new Date(r.createdAt)) }));
    withDay.sort((a, b) => (a._day < b._day ? -1 : a._day > b._day ? 1 : b.score - a.score));
    const rows = [["day", "timestamp", "player_name", "contact", "avatar", "score", "cpu_score", "high_score"].join(",")];
    for (const r of withDay) {
      rows.push([r._day, r.createdAt, r.playerName, r.contact, r.avatar, r.score, r.cpuScore, r.highScore].map(esc).join(","));
    }
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=ayra-tennis-scores.csv",
      "cache-control": "no-store"
    });
    return res.end("﻿" + rows.join("\n"));
  }

  if (url.pathname === "/api/souvenirs" && req.method === "POST") {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: "bad-json" }); }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const record = {
      id,
      createdAt,
      day: athensDay(new Date(createdAt)),
      playerName: String(payload.playerName || "Player").slice(0, 80),
      contact: String(payload.contact || "").slice(0, 120),
      avatar: String(payload.avatar || "ace"),
      score: Number(payload.score || 0),
      cpuScore: Number(payload.cpuScore || 0),
      highScore: Number(payload.highScore || 0)
    };

    const image = String(payload.image || "");
    const base64 = image.replace(/^data:image\/png;base64,/, "");
    if (base64 && base64 !== image) {
      await writeFile(join(souvenirDir, `${id}.png`), Buffer.from(base64, "base64"));
    }
    await writeFile(join(souvenirDir, `${id}.json`), JSON.stringify(record, null, 2), "utf8");

    const records = await readRecords();
    records.unshift(record);
    records.sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt));
    await saveRecords(records);

    return sendJson(res, 201, {
      record,
      souvenirPath: `/souvenir/${id}`,
      imagePath: `/api/souvenirs/${id}/image`
    });
  }

  const match = url.pathname.match(/^\/api\/souvenirs\/([a-z0-9-]+)(\/image)?$/i);
  if (match && req.method === "GET") {
    const id = match[1];
    if (match[2]) {
      const imagePath = join(souvenirDir, `${id}.png`);
      try {
        await stat(imagePath);
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        createReadStream(imagePath).pipe(res);
      } catch {
        sendJson(res, 404, { error: "Souvenir image not found" });
      }
      return;
    }
    try {
      const record = JSON.parse(await readFile(join(souvenirDir, `${id}.json`), "utf8"));
      return sendJson(res, 200, { record, imagePath: `/api/souvenirs/${id}/image` });
    } catch {
      return sendJson(res, 404, { error: "Souvenir not found" });
    }
  }

  sendJson(res, 404, { error: "API route not found" });
}

async function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
  if (pathname === "/" || pathname.startsWith("/souvenir/")) {
    pathname = "/index.html";
  }
  const filePath = normalize(join(distDir, pathname));
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    res.writeHead(200, {
      "content-type": mime[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": pathname === "/index.html" ? "no-store" : "public, max-age=31536000, immutable"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found. Run npm run build before npm run kiosk.");
  }
}

function statsHtml() {
  return `<!doctype html><html lang="el"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ΑΥΡΑ × POWERADE — Συμμετοχές ανά ημέρα</title>
<style>
  *{box-sizing:border-box;margin:0} body{background:#05070E;color:#eaf6ff;font-family:"Segoe UI",system-ui,Arial,sans-serif;padding:28px;max-width:820px;margin:0 auto}
  h1{font-size:22px;letter-spacing:.06em} h1 .b{color:#39D7FF} .sub{color:#9db2d4;font-size:13px;margin:4px 0 22px}
  .today{background:linear-gradient(135deg,#0b2a4a,#0a1730);border:1px solid rgba(57,215,255,.35);border-radius:18px;padding:22px 26px;display:flex;align-items:baseline;gap:16px;margin-bottom:18px}
  .today .n{font-size:64px;font-weight:900;color:#39D7FF;line-height:1;font-variant-numeric:tabular-nums} .today .l{font-size:15px;color:#cfe4ff}
  .grid{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px}
  .kpi{flex:1;min-width:150px;background:#0b1220;border:1px solid rgba(120,170,255,.2);border-radius:14px;padding:16px 18px}
  .kpi .n{font-size:30px;font-weight:800} .kpi .l{font-size:12px;color:#9db2d4;margin-top:2px}
  table{width:100%;border-collapse:collapse;background:#0b1220;border-radius:14px;overflow:hidden;border:1px solid rgba(120,170,255,.18)}
  th,td{text-align:left;padding:12px 16px;border-bottom:1px solid rgba(120,170,255,.1)} th{color:#9db2d4;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  td.c{text-align:right;font-weight:800;font-size:18px;color:#b8f34d;font-variant-numeric:tabular-nums} tr:last-child td{border-bottom:none}
  .bar{height:8px;background:linear-gradient(90deg,#39D7FF,#b8f34d);border-radius:6px;margin-top:6px}
  .btns{display:flex;gap:10px;margin:22px 0 8px;flex-wrap:wrap}
  a.btn,button.btn{font-size:14px;font-weight:800;padding:12px 20px;border-radius:12px;border:none;cursor:pointer;text-decoration:none;background:linear-gradient(90deg,#0033A0,#1E6BFF);color:#fff}
  button.btn.ghost{background:#131C2E;color:#cfe4ff;border:1px solid rgba(120,170,255,.3)}
  .foot{color:#5f7699;font-size:12px;margin-top:16px}
  @media print{body{background:#fff;color:#000} .btns{display:none} .kpi,.today,table{border-color:#ccc;background:#fff} .today .n,td.c{color:#0033A0} .bar{display:none}}
</style></head><body>
  <h1><span class="b">ΑΥΡΑ × POWERADE</span> — Συμμετοχές ανά ημέρα</h1>
  <div class="sub">Πόσοι έπαιξαν κάθε μέρα του φεστιβάλ · ζωντανή ενημέρωση</div>
  <div class="today"><div class="n" id="todayN">–</div><div class="l">παίκτες<br>σήμερα (<span id="todayD"></span>)</div></div>
  <div class="grid">
    <div class="kpi"><div class="n" id="totalN">–</div><div class="l">σύνολο συμμετοχών</div></div>
    <div class="kpi"><div class="n" id="daysN">–</div><div class="l">ημέρες με συμμετοχές</div></div>
    <div class="kpi"><div class="n" id="avgN">–</div><div class="l">μέσος όρος / ημέρα</div></div>
  </div>
  <table><thead><tr><th>Ημερομηνία</th><th style="text-align:right">Παίκτες</th></tr></thead><tbody id="rows"></tbody></table>
  <div class="btns">
    <a class="btn" href="/api/plays.csv">📥 Συμμετοχές ανά μέρα (CSV)</a>
    <a class="btn" href="/api/records.csv">🏆 Παίκτες &amp; Σκορ (CSV)</a>
    <button class="btn ghost" onclick="window.print()">🖨️ Εκτύπωση</button>
    <button class="btn ghost" onclick="load()">🔄 Ανανέωση</button>
  </div>
  <div class="foot">Τα δεδομένα αποθηκεύονται τοπικά στον υπολογιστή του booth (data/plays.json).</div>
<script>
  function fmt(d){ try{ return new Date(d+"T00:00:00").toLocaleDateString("el-GR",{weekday:"short",day:"2-digit",month:"2-digit"}); }catch(e){ return d; } }
  async function load(){
    try{
      const r = await fetch("/api/stats",{cache:"no-store"}); const d = await r.json();
      document.getElementById("todayN").textContent = d.todayCount || 0;
      document.getElementById("todayD").textContent = fmt(d.today);
      document.getElementById("totalN").textContent = d.total || 0;
      const days = Object.keys(d.byDay||{}).sort();
      document.getElementById("daysN").textContent = days.length;
      document.getElementById("avgN").textContent = days.length ? Math.round((d.total/days.length)*10)/10 : 0;
      const max = Math.max(1, ...days.map(k=>d.byDay[k]));
      const tb = document.getElementById("rows"); tb.innerHTML = "";
      days.slice().reverse().forEach(function(k){
        const tr = document.createElement("tr");
        tr.innerHTML = "<td>"+fmt(k)+" <div class='bar' style='width:"+Math.round(d.byDay[k]/max*100)+"%'></div></td><td class='c'>"+d.byDay[k]+"</td>";
        tb.appendChild(tr);
      });
      if(!days.length){ tb.innerHTML = "<tr><td colspan='2' style='color:#9db2d4'>Καμία συμμετοχή ακόμη.</td></tr>"; }
    }catch(e){}
  }
  load(); setInterval(load, 15000);
</script></body></html>`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${port}`}`);
    const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
    const publicBaseUrl = PUBLIC_BASE_URL || `${proto}://${req.headers.host || `localhost:${port}`}`;
    if (await handleCover(req, res, url, { readBody, sendJson, publicBaseUrl, coversDir })) return;
    if (url.pathname === "/stats") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(statsHtml());
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Tennis kiosk server ready: http://localhost:${port}`);
  const lan = localUrls().slice(1);
  if (lan.length) console.log(`LAN souvenir URL base: ${lan.join(", ")}`);
});
