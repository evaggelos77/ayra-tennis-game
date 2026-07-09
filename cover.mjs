// ============================================================
// cover.mjs — AI Photobooth cover service for the tennis kiosk.
// Player photo -> async AKOOL face-swap onto an ΑΥΡΑ cover template
// -> phone delivery page + QR. Non-blocking (queue-friendly).
// ============================================================
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import crypto from 'node:crypto';
import { faceSwapCover } from './facecover.mjs';

const sessions = new Map();            // id -> { status, coverUrl, error, name, contact, gender, createdAt }
let _savedDir = null;                   // covers auto-saved to disk here
const TTL_MS = 3 * 60 * 60 * 1000;     // keep sessions 3h
const MOCK = String(process.env.COVER_MOCK || '').toLowerCase() === 'true';

// cover templates (brand -> gender -> file). Overridable via covers/covers.json. Drop-in replaceable.
let COVERS = {
  ayra:     { m: { file: 'male.png',          label: 'ΑΥΡΑ Ανδρικό' },     f: { file: 'female.png',          label: 'ΑΥΡΑ Γυναικείο' } },
  powerade: { m: { file: 'powerade-male.png', label: 'POWERADE Ανδρικό' }, f: { file: 'powerade-female.png', label: 'POWERADE Γυναικείο' } },
};

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export async function loadCovers(coversDir) {
  try {
    const j = JSON.parse(await readFile(join(coversDir, 'covers.json'), 'utf8'));
    if (j && typeof j === 'object') {
      if (j.ayra && j.powerade) COVERS = j;                     // new brand×gender structure
      else if (j.m && j.f) COVERS = { ayra: j, powerade: j };   // legacy flat (gender only) → same for both brands
    }
  } catch {}
  try { _savedDir = join(coversDir, '..', 'saved_covers'); await mkdir(_savedDir, { recursive: true }); } catch {}
  // verify each configured public cover target is reachable — catches a broken covers.json on day 1
  for (const brand of Object.keys(COVERS)) {
    for (const g of ['m', 'f']) {
      const url = COVERS[brand] && COVERS[brand][g] && COVERS[brand][g].url;
      if (!url) continue;
      try {
        const r = await fetch(url, { method: 'GET' });
        if (!r.ok) console.warn(`[covers] WARN ${brand}/${g} target ${url} -> HTTP ${r.status}  (AKOOL swap will FAIL for ${brand}/${g}!)`);
        else console.log(`[covers] ${brand}/${g} cover OK: ${url}`);
      } catch (e) {
        console.warn(`[covers] WARN ${brand}/${g} target ${url} unreachable: ${e.message}  (AKOOL swap will FAIL!)`);
      }
    }
  }
  return COVERS;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.createdAt > TTL_MS) sessions.delete(id);
}, 10 * 60 * 1000).unref?.();

function beginSwap(id, imageDataUrl, targetUrl) {
  const s = sessions.get(id);
  if (MOCK) {                          // demo without AKOOL: deliver the plain cover template after a beat
    setTimeout(() => { s.status = 'done'; s.coverUrl = targetUrl; }, 4000);
    return;
  }
  faceSwapCover(imageDataUrl, targetUrl, { attempts: 3 })
    .then(async (coverUrl) => {
      s.status = 'done'; s.coverUrl = coverUrl; console.log(`[cover ${id}] done -> ${coverUrl}`);
      if (_savedDir) {                             // auto-save the finished cover to the booth PC
        try {
          const r = await fetch(coverUrl); const b = Buffer.from(await r.arrayBuffer());
          const safe = (s.name || 'player').replace(/[^A-Za-z0-9Α-Ωα-ωΆ-Ώά-ώ_-]/g, '').slice(0, 30) || 'player';
          await writeFile(join(_savedDir, `${Date.now()}_${safe}_${id}.png`), b);
          console.log(`[cover ${id}] saved to disk`);
        } catch (e) { console.warn(`[cover ${id}] disk save failed: ${e.message}`); }
      }
    })
    .catch((e) => { s.status = 'failed'; s.error = String(e.message || e); console.warn(`[cover ${id}] failed: ${s.error}`); });
}

// Returns true if it handled the request.
export async function handleCover(req, res, url, ctx) {
  const { readBody, sendJson, publicBaseUrl, coversDir } = ctx;
  const path = url.pathname;

  // --- serve cover template files publicly (AKOOL fetches the target from here) ---
  if (path.startsWith('/covers/')) {
    const file = path.slice('/covers/'.length).replace(/[^a-zA-Z0-9._-]/g, '');
    try {
      const buf = await readFile(join(coversDir, file));
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'public, max-age=3600' });
      res.end(buf);
    } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('cover not found'); }
    return true;
  }

  // --- start a cover session (kick off async swap) ---
  if (path === '/api/cover/start' && req.method === 'POST') {
    let body; try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: 'bad-json' }); return true; }
    const image = String(body.image || body.image_data_url || '');
    const gender = String(body.gender || 'f').toLowerCase().startsWith('m') ? 'm' : 'f';
    const brand = String(body.brand || 'ayra').toLowerCase().startsWith('p') ? 'powerade' : 'ayra';
    if (!image.startsWith('data:image')) { sendJson(res, 400, { error: 'no-image' }); return true; }
    const brandSet = COVERS[brand] || COVERS.ayra;
    const cov = brandSet[gender] || brandSet.f;
    // Target the AKOOL swap fetches: a fixed public "url" (recommended: GitHub Pages),
    // else the cover served by this kiosk at its public base URL.
    const targetUrl = cov.url || `${publicBaseUrl}/covers/${cov.file}`;
    if (!cov.url && (!publicBaseUrl || /localhost|127\.0\.0\.1/.test(publicBaseUrl)) && !MOCK) {
      sendJson(res, 503, { error: 'no-public-cover-url', hint: 'Set cover "url" in covers.json (stable host) OR PUBLIC_BASE_URL (tunnel/deploy), or COVER_MOCK=true' });
      return true;
    }
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    sessions.set(id, { status: 'processing', coverUrl: null, error: null, name: String(body.name || '').slice(0, 80), contact: String(body.contact || '').slice(0, 120), gender, createdAt: Date.now() });
    beginSwap(id, image, targetUrl);
    sendJson(res, 201, { ok: true, id, deliverUrl: `${publicBaseUrl}/cover/${id}`, statusUrl: `/api/cover/status/${id}` });
    return true;
  }

  // --- poll status ---
  const mStatus = path.match(/^\/api\/cover\/status\/([a-z0-9]+)$/i);
  if (mStatus && req.method === 'GET') {
    const s = sessions.get(mStatus[1]);
    if (!s) { sendJson(res, 404, { error: 'not-found' }); return true; }
    sendJson(res, 200, { status: s.status, coverUrl: s.coverUrl, error: s.error, name: s.name });
    return true;
  }

  // --- phone delivery page (QR target) ---
  const mDeliver = path.match(/^\/cover\/([a-z0-9]+)$/i);
  if (mDeliver && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(deliveryHtml(mDeliver[1]));
    return true;
  }

  return false;
}

function deliveryHtml(id) {
  return `<!doctype html><html lang="el"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Το εξώφυλλό σου — ΑΥΡΑ</title>
<style>
  *{box-sizing:border-box;margin:0} body{background:#05070E;color:#eaf6ff;font-family:"Segoe UI",system-ui,Arial,sans-serif;
  min-height:100vh;display:flex;flex-direction:column;align-items:center;gap:16px;padding:22px;text-align:center}
  h1{font-size:22px;letter-spacing:.12em;opacity:.8;margin-top:6px} .brand{color:#39D7FF;font-weight:800}
  #img{width:min(92vw,440px);border-radius:16px;box-shadow:0 14px 60px rgba(57,215,255,.28);display:none}
  .spin{width:64px;height:64px;border-radius:50%;border:6px solid #17324f;border-top-color:#39D7FF;animation:s 1s linear infinite;margin:40px}
  @keyframes s{to{transform:rotate(360deg)}} .msg{font-size:18px;color:#9db2d4;max-width:420px}
  .btns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:6px}
  button{font-size:18px;font-weight:800;padding:14px 26px;border-radius:14px;border:none;cursor:pointer;
  background:linear-gradient(90deg,#0033A0,#1E6BFF);color:#fff} button.ghost{background:#131C2E;color:#cfe4ff}
  .hint{font-size:14px;opacity:.6;max-width:420px}
</style></head><body>
  <h1><span class="brand">ΑΥΡΑ</span> × POWERADE — ΤΟ ΕΞΩΦΥΛΛΟ ΣΟΥ</h1>
  <div id="spin" class="spin"></div>
  <div id="msg" class="msg">Ετοιμάζουμε το εξώφυλλό σου…</div>
  <img id="img" alt="Το εξώφυλλό σου">
  <div class="btns" id="btns" style="display:none">
    <button id="save">📥 Αποθήκευση</button>
    <button id="share" class="ghost">📲 Κοινοποίηση</button>
  </div>
  <div class="hint" id="hint" style="display:none">Αποθήκευσε το εξώφυλλό σου και ανέβασέ το στα stories! #AyraTennis</div>
<script>
  const id=${JSON.stringify(id)};
  const img=document.getElementById('img'),spin=document.getElementById('spin'),msg=document.getElementById('msg'),btns=document.getElementById('btns'),hint=document.getElementById('hint');
  let done=false;
  async function poll(){
    if(done) return;
    try{
      const r=await fetch('/api/cover/status/'+id,{cache:'no-store'}); const d=await r.json();
      if(d.status==='done'&&d.coverUrl){ done=true; spin.style.display='none'; msg.style.display='none';
        img.src=d.coverUrl; img.style.display='block'; btns.style.display='flex'; hint.style.display='block'; return; }
      if(d.status==='failed'){ done=true; spin.style.display='none'; msg.textContent='Ωχ, κάτι πήγε στραβά. Ζήτησε νέα λήψη στο booth.'; return; }
    }catch(e){}
    setTimeout(poll,2500);
  }
  poll();
  async function blob(){ const r=await fetch(img.src); return await r.blob(); }
  document.getElementById('save').onclick=async()=>{ const b=await blob(); const u=URL.createObjectURL(b);
    const a=document.createElement('a'); a.href=u; a.download='ayra-tennis-cover.jpg'; a.click(); setTimeout(()=>URL.revokeObjectURL(u),1500); };
  document.getElementById('share').onclick=async()=>{ try{ const b=await blob(); const f=new File([b],'ayra-tennis-cover.jpg',{type:b.type||'image/jpeg'});
    if(navigator.canShare&&navigator.canShare({files:[f]})){ await navigator.share({files:[f],title:'ΑΥΡΑ Tennis'}); } else { document.getElementById('save').click(); } }catch(e){} };
</script></body></html>`;
}
