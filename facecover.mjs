// ============================================================
// facecover.mjs — AKOOL image face-swap mechanism
// Distilled from the EV Focus AI Booth (server.py). Node 18+.
//   source photo (local file or data URL) --> detect (AKOOL hosts the face)
//   --> faceswapByImage(sourceFace, targetCoverURL) --> poll --> result URL
// Auth: x-api-key = raw AKOOL API Key (verified: AKOOL accepts it directly).
// Usage (CLI test): node facecover.mjs <sourcePath> <targetPublicUrl> [outPath]
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const _here = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = 'akool_ayra_tennis.env';
// Search order — makes the key self-contained: drop the .env next to the game and it just works on any PC.
const ENV_PATHS = [
  process.env.AKOOL_ENV,
  join(_here, KEY_FILE),                    // 1) inside the game folder (recommended for the mini PC)
  join(process.cwd(), KEY_FILE),            // 2) current working directory
  join(homedir(), KEY_FILE),                // 3) user home (~/), any machine
  'C:/Users/evtsa/akool_ayra_tennis.env',   // 4) legacy fallback (this PC)
].filter(Boolean);
let _key = null;
function apiKey() {
  if (_key) return _key;
  if (process.env.AKOOL_API_KEY && process.env.AKOOL_API_KEY.trim()) return (_key = process.env.AKOOL_API_KEY.trim());
  for (const p of ENV_PATHS) {
    try {
      const txt = readFileSync(p, 'utf8');
      const m = txt.match(/^\s*AKOOL_API_KEY\s*=\s*(.+?)\s*$/m);
      if (m) return (_key = m[1].trim());
    } catch {}
  }
  throw new Error('AKOOL_API_KEY not found (set env or put ' + KEY_FILE + ' in the game folder)');
}
const H = () => ({ 'x-api-key': apiKey(), 'Content-Type': 'application/json' });

const EP = {
  detect: 'https://openapi.akool.com/interface/detect-api/detect_faces',
  swap:   'https://openapi.akool.com/api/open/v4/faceswap/faceswapByImage',
  poll:   'https://openapi.akool.com/api/open/v3/faceswap/result/listbyids',
};

const log = (...a) => console.log('[facecover]', ...a);

async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { _raw: t }; }
  return { status: r.status, d };
}

// source photo (data URL) -> AKOOL-hosted face URL (also validates a face exists)
async function detectFaceUrl(imgDataUrl) {
  const { status, d } = await jpost(EP.detect, { img: imgDataUrl, single_face: true, return_face_url: true });
  log('detect status', status, 'code', d.error_code ?? d.code, 'msg', d.error_msg ?? d.msg);
  const fo = d.faces_obj || d.data?.faces_obj || {};
  for (const k of Object.keys(fo)) {
    const face = fo[k] || {};
    const urls = face.face_urls || face.faceUrls || [];
    if (Array.isArray(urls) && urls.length) return urls[0];
  }
  // some tiers return a flat structure
  if (Array.isArray(d.face_urls) && d.face_urls.length) return d.face_urls[0];
  throw new Error('detect: no face_url. raw=' + JSON.stringify(d).slice(0, 500));
}

async function createSwap(sourceFaceUrl, targetUrl) {
  // face_enhance ON can over-smooth / beautify the face and drift from the real person's
  // identity. The EV Focus booth keeps it OFF for events (max likeness). Override: AKOOL_FACE_ENHANCE=1
  const faceEnhance = /^(1|true|yes|on)$/i.test(String(process.env.AKOOL_FACE_ENHANCE || 'false').trim());
  const body = {
    sourceImage: [{ path: sourceFaceUrl }],
    targetImage: [{ path: targetUrl }],
    model_name: 'akool_faceswap_image_hq',
    face_enhance: faceEnhance,
  };
  const { status, d } = await jpost(EP.swap, body);
  log('swap status', status, 'code', d.code, 'msg', d.msg);
  const id = d.data?._id || d.data?.job_id || d._id;
  if (!id) throw new Error('swap create failed. raw=' + JSON.stringify(d).slice(0, 600));
  return id;
}

async function pollResult(id, { timeoutMs = 150000, intervalMs = 3000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(EP.poll + '?_ids=' + encodeURIComponent(id), { headers: H() });
    const d = await r.json();
    const item = d.data?.result?.[0] || d.data?.[0] || d.result?.[0];
    const st = item?.faceswap_status;
    log('poll status', st, 'progress', item?.progress);
    if (st === 3) return item.url;
    if (st === 4) throw new Error('swap failed (status 4). raw=' + JSON.stringify(item).slice(0, 400));
    await new Promise((s) => setTimeout(s, intervalMs));
  }
  throw new Error('poll timeout');
}

export async function faceSwapCover(source, targetUrl, { attempts = 3 } = {}) {
  let dataUrl = source;
  if (!/^data:/.test(source) && !/^https?:/.test(source)) {
    const buf = readFileSync(source);
    const ext = source.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    dataUrl = `data:image/${ext};base64,` + buf.toString('base64');
  }
  let faceUrl;
  if (/^https?:/.test(source)) {
    faceUrl = source;   // URL mode: pass full source image, let AKOOL auto-detect
    log('URL mode: source =', source.slice(0, 90));
  } else {
    log('detect source face...');
    faceUrl = await detectFaceUrl(dataUrl);
    log('   source face:', faceUrl.slice(0, 90));
  }
  let lastErr;
  for (let a = 1; a <= attempts; a++) {
    try {
      log(`attempt ${a}/${attempts}: create swap (target ${targetUrl.slice(0, 70)})...`);
      const id = await createSwap(faceUrl, targetUrl);
      log('   job id:', id, '- polling...');
      return await pollResult(id);
    } catch (e) {
      lastErr = e;
      log(`   attempt ${a} failed: ${e.message.slice(0, 90)}`);
      if (a < attempts) await new Promise((s) => setTimeout(s, 2500));
    }
  }
  throw lastErr;
}

// ---- CLI test ----
const argv = process.argv.slice(2);
if (argv.length >= 2) {
  const [src, target, out = 'result.png'] = argv;
  faceSwapCover(src, target, { attempts: Number(process.env.ATTEMPTS || 3) })
    .then(async (url) => {
      log('RESULT URL:', url);
      const r = await fetch(url);
      const b = Buffer.from(await r.arrayBuffer());
      writeFileSync(out, b);
      log('SAVED', out, b.length, 'bytes ✓');
    })
    .catch((e) => { console.error('[facecover] ERROR:', e.message); process.exit(1); });
}
