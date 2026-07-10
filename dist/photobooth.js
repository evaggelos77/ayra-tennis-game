/* ============================================================
   photobooth.js — AI Photobooth layer for the ΑΥΡΑ × POWERADE
   tennis game. Self-contained; injects a face-capture step into
   the setup and a cover+QR result into the game-over panel.
   Does NOT modify the game's own code. Loaded as a plain script.
   ============================================================ */
(function () {
  'use strict';
  var state = { photo: null, gender: 'f', brand: 'ayra', session: null, stream: null, coverShown: false };

  // ---------- styles ----------
  var css = document.createElement('style');
  css.textContent = [
    /* ---- AI photobooth module (matches game design system) ---- */
    '.pb-wrap{margin:14px 0;padding:16px;border:1px solid var(--line,rgba(120,190,255,.18));border-radius:var(--r-lg,20px);background:var(--glass,linear-gradient(180deg,rgba(14,34,56,.82),rgba(6,18,33,.9)));box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}',
    '.pb-wrap h3{font-size:clamp(15px,1.4vw,18px);margin:0 0 4px;color:var(--ink,#eaf6ff);letter-spacing:.01em;font-weight:900;display:flex;align-items:center;gap:8px}',
    '.pb-wrap h3::after{content:"AI";font-size:10px;font-weight:900;letter-spacing:.08em;color:#04121e;background:var(--aqua,#35d6ff);padding:2px 7px;border-radius:999px;box-shadow:0 0 14px rgba(53,214,255,.5)}',
    '.pb-wrap p.pb-sub{font-size:12px;color:var(--muted,#9db2d4);margin:0 0 12px;line-height:1.4}',
    '.pb-stage{position:relative;width:100%;max-width:300px;aspect-ratio:3/4;margin:0 auto;border-radius:var(--r,14px);overflow:hidden;background:#04101f;box-shadow:inset 0 0 0 1px rgba(120,190,255,.22),inset 0 0 60px rgba(0,0,0,.55),0 12px 30px rgba(0,8,22,.4)}',
    '.pb-stage video,.pb-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}',
    '.pb-stage img{transform:none}',
    /* viewfinder corner ticks */
    '.pb-stage::before,.pb-stage::after{content:"";position:absolute;width:26px;height:26px;border:2px solid rgba(53,214,255,.85);z-index:4;pointer-events:none}',
    '.pb-stage::before{left:10px;top:10px;border-right:0;border-bottom:0;border-radius:6px 0 0 0}',
    '.pb-stage::after{right:10px;bottom:10px;border-left:0;border-top:0;border-radius:0 0 6px 0}',
    '.pb-oval{position:absolute;inset:0;pointer-events:none;display:grid;place-items:center;z-index:3}',
    '.pb-oval svg{width:66%;height:82%;opacity:.92;animation:pbPulse 2.4s ease-in-out infinite}',
    '@keyframes pbPulse{0%,100%{opacity:.55;transform:scale(.98)}50%{opacity:1;transform:scale(1.02)}}',
    '.pb-hint{position:absolute;left:0;right:0;bottom:0;padding:16px 8px 8px;text-align:center;font-size:12px;color:#eaf6ff;font-weight:700;z-index:3;background:linear-gradient(0deg,rgba(2,10,20,.82),transparent)}',
    '.pb-gender{display:flex;gap:12px;justify-content:center;margin:14px 0 6px}',
    '.pb-gbtn{flex:1;max-width:150px;padding:10px 8px;border-radius:var(--r,14px);border:1px solid var(--line,rgba(120,190,255,.2));background:rgba(4,16,30,.5);color:var(--muted,#cfe4ff);font-weight:800;font-size:15px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;transition:box-shadow .16s,border-color .16s,transform .14s,background .16s}',
    '.pb-gbtn:hover{transform:translateY(-2px);border-color:var(--line-strong,rgba(120,190,255,.36))}',
    '.pb-gbtn img{width:clamp(64px,7vw,84px);height:clamp(64px,7vw,84px);border-radius:12px;object-fit:cover;background:#04101f}',
    '.pb-gbtn.on{border-color:var(--aqua,#35d6ff);background:rgba(53,214,255,.16);color:#fff;box-shadow:inset 0 0 0 1px rgba(53,214,255,.4),0 10px 26px rgba(53,214,255,.28)}',
    '.pb-gbtn[data-g="f"].on{border-color:var(--lime,#b8f34d);box-shadow:inset 0 0 0 1px rgba(184,243,77,.4),0 10px 26px rgba(184,243,77,.28)}',
    '.pb-brandlabel{text-align:center;font-size:15px;color:#eaf6ff;margin:14px 0 8px;font-weight:900;letter-spacing:.02em}',
    '.pb-brand{display:flex;gap:14px;justify-content:center;margin:2px 0 8px}',
    '.pb-bbtn{flex:1;max-width:210px;padding:17px 10px;border-radius:16px;border:2px solid rgba(120,190,255,.25);background:rgba(4,16,30,.5);color:#8ea3bd;font-weight:900;font-size:19px;letter-spacing:.05em;cursor:pointer;opacity:.6;transition:all .16s}',
    '.pb-bbtn:hover{transform:translateY(-2px);opacity:.85}',
    '.pb-bbtn.on::after{content:" \\2714";font-size:16px}',
    '.pb-bbtn.ayra.on{border-color:#35d6ff;background:rgba(53,214,255,.24);color:#fff;opacity:1;transform:scale(1.05);box-shadow:0 0 0 3px rgba(53,214,255,.32),0 12px 30px rgba(53,214,255,.42)}',
    '.pb-bbtn.pwr.on{border-color:#ff3b3b;background:rgba(255,59,59,.22);color:#fff;opacity:1;transform:scale(1.05);box-shadow:0 0 0 3px rgba(255,59,59,.38),0 12px 30px rgba(255,59,59,.42)}',
    '.pb-btns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px}',
    '.pb-btn{min-height:46px;padding:0 20px;border-radius:var(--r,14px);border:none;font-weight:800;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;color:#f4fbff;background:linear-gradient(135deg,var(--aqua,#35d6ff),var(--blue,#1f6bff) 65%,var(--blue-deep,#0a3fd6));box-shadow:0 12px 30px rgba(31,107,255,.4);text-shadow:0 1px 5px rgba(2,12,30,.4);transition:filter .16s,transform .14s,box-shadow .16s}',
    '.pb-btn:hover{filter:brightness(1.07);transform:translateY(-1px)}',
    '.pb-btn:active{transform:translateY(1px)}',
    '.pb-btn.ghost{background:rgba(53,214,255,.08);color:var(--aqua-bright,#cfe4ff);border:1px solid var(--line-strong,rgba(120,190,255,.3));box-shadow:none;text-shadow:none}',
    '.pb-btn.ghost:hover{background:rgba(53,214,255,.16)}',
    '.pb-status{font-size:clamp(13px,1.1vw,15px);color:var(--muted,#9db2d4);text-align:center;margin-top:10px;min-height:16px;font-weight:700}',
    '.pb-status.ok{color:#3ff0a8}.pb-status.err{color:#ff9aa2}.pb-status.err::before{content:"\\26A0 "}',
    '.pb-file{display:none}',
    /* game-over cover reveal */
    '.pb-cover{display:flex;gap:20px;align-items:center;justify-content:center;flex-wrap:wrap;margin:16px 0}',
    '.pb-cover .pb-cimg{width:210px;aspect-ratio:3/4;border-radius:var(--r,14px);object-fit:cover;background:#0a1120;box-shadow:0 0 0 1px rgba(120,190,255,.24),0 20px 46px rgba(0,8,22,.5);display:none}',
    '.pb-cover .pb-cspin{width:210px;aspect-ratio:3/4;border-radius:var(--r,14px);background:var(--glass,linear-gradient(180deg,rgba(14,34,56,.82),rgba(6,18,33,.9)));border:1px solid var(--line,rgba(120,190,255,.2));display:grid;place-items:center;color:var(--muted,#9db2d4);font-size:13px;text-align:center;padding:14px;line-height:1.5}',
    '.pb-qrbox{background:#fff;border-radius:var(--r,14px);padding:10px;width:150px;height:150px;box-shadow:0 12px 30px rgba(0,8,22,.4)}',
    '.pb-qrbox img{width:100%;height:100%;image-rendering:pixelated}',
    '.pb-qrcap{font-size:13px;color:var(--aqua-bright,#cfe4ff);font-weight:800;text-align:center;margin-top:8px}',
    '.pb-cdl{margin-top:12px;min-height:44px;padding:0 18px;border-radius:var(--r,14px);border:1px solid var(--line-strong,rgba(120,190,255,.3));font-weight:800;font-size:13px;cursor:pointer;background:rgba(53,214,255,.08);color:var(--aqua-bright,#cfe4ff);display:none}',
    /* native option list readability (base selects styled in styles.css) */
    'select option{color:#eaf6ff;background:#0b2036}',
    /* game-time remaining bar (top edge) */
    '.time-bar{position:fixed;left:0;right:0;top:0;height:8px;background:rgba(4,14,26,.5);overflow:hidden;z-index:60;pointer-events:none}',
    '.time-bar>span{display:block;height:100%;width:100%;background:linear-gradient(90deg,var(--lime,#b8f34d),var(--aqua,#35d6ff));box-shadow:0 0 14px rgba(53,214,255,.6);transition:width .25s linear}',
    '.time-bar.low>span{background:linear-gradient(90deg,#ff3b4e,#ffb347)}',
    /* countdown timer number (top-center) */
    '.time-count{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:61;font-family:Inter,"Segoe UI",system-ui,sans-serif;font-weight:900;font-size:clamp(40px,5vw,64px);line-height:1;color:#eaf6ff;text-shadow:0 2px 18px rgba(0,0,0,.7);pointer-events:none;display:none;font-variant-numeric:tabular-nums}',
    '.time-count.show{display:block}',
    '.time-count.low{color:#ff6b4e;text-shadow:0 0 22px rgba(255,107,78,.75);animation:pbCount .6s ease-in-out infinite}',
    '@keyframes pbCount{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.14)}}',
    /* consent / terms */
    '.consent-field{margin:6px 0 2px;padding:13px 15px;border-radius:var(--r,14px);background:rgba(4,16,30,.5);border:1px solid var(--line,rgba(120,190,255,.2))}',
    '.consent-check{display:flex;gap:11px;align-items:flex-start;font-size:13px;color:var(--ink,#cfe4ff);line-height:1.45;cursor:pointer}',
    '.consent-check input{width:20px;height:20px;margin-top:1px;accent-color:var(--aqua,#35d6ff);flex:0 0 auto;cursor:pointer}',
    '.consent-check strong{color:#fff}',
    '.terms-link{background:none;border:none;color:var(--aqua,#35d6ff);font-weight:800;cursor:pointer;text-decoration:underline;padding:0;font-size:13px}',
    '.terms-text{margin-top:10px;padding:11px 13px;border-radius:var(--r-sm,10px);background:rgba(2,10,20,.6);border:1px solid var(--line,rgba(120,190,255,.18));font-size:12px;color:var(--muted,#9db2d4);line-height:1.5;max-height:190px;overflow:auto}',
    '.terms-text h4{color:var(--aqua-bright,#cfe4ff);margin:0 0 6px;font-size:12px;letter-spacing:.02em}',
    '.terms-text p{margin:0 0 6px}',
    '.consent-warn{margin:8px 0 0;color:#ff6b6b;font-weight:800;font-size:13px}'
  ].join('\n');
  document.head.appendChild(css);

  var OVAL = '<svg viewBox="0 0 200 260" fill="none"><ellipse cx="100" cy="120" rx="70" ry="95" stroke="#35d6ff" stroke-width="3" stroke-dasharray="10 8"/></svg>';

  // ---------- build capture UI, inject into setup ----------
  function buildCapture() {
    var setup = document.querySelector('#setupPanel');
    if (!setup || document.querySelector('#pb-capture')) return;
    var box = document.createElement('div');
    box.id = 'pb-capture';
    box.className = 'pb-wrap';
    box.innerHTML =
      '<h3>📸 Η φωτογραφία σου για το εξώφυλλο</h3>' +
      '<p class="pb-sub">Στάσου φυσικά — κεφάλι και ώμοι μέσα στο πλαίσιο, έλα λίγο πιο κοντά, με καλό φως. Μετά πάτα Λήψη.</p>' +
      '<div class="pb-stage" id="pb-stage">' +
        '<video id="pb-video" playsinline muted autoplay></video>' +
        '<img id="pb-shot" alt="" style="display:none">' +
        '<div class="pb-oval">' + OVAL + '</div>' +
        '<div class="pb-hint" id="pb-hint">Άνοιγμα κάμερας…</div>' +
      '</div>' +
      '<div class="pb-gender">' +
        '<button type="button" class="pb-gbtn" data-g="m"><img src="/pb-male.png" alt=""><span>Άνδρας</span></button>' +
        '<button type="button" class="pb-gbtn on" data-g="f"><img src="/pb-female.png" alt=""><span>Γυναίκα</span></button>' +
      '</div>' +
      '<div class="pb-brandlabel">Διάλεξε εξώφυλλο</div>' +
      '<div class="pb-brand">' +
        '<button type="button" class="pb-bbtn ayra on" data-b="ayra">ΑΥΡΑ</button>' +
        '<button type="button" class="pb-bbtn pwr" data-b="powerade">POWERADE</button>' +
      '</div>' +
      '<div class="pb-btns">' +
        '<button type="button" class="pb-btn" id="pb-open">🎥 Άνοιξε κάμερα</button>' +
        '<button type="button" class="pb-btn" id="pb-snap" style="display:none">📸 Λήψη</button>' +
        '<button type="button" class="pb-btn ghost" id="pb-retake" style="display:none">🔄 Ξανά</button>' +
        '<button type="button" class="pb-btn ghost" id="pb-upload">📁 Ανέβασμα</button>' +
        '<input type="file" accept="image/*" class="pb-file" id="pb-file">' +
      '</div>' +
      '<div class="pb-status" id="pb-status"></div>';
    // place it after the name/contact fields (name stays first), full-width
    var form = setup.querySelector('form') || setup;
    var anchor = form.querySelector('.avatar-field');
    if (anchor) form.insertBefore(box, anchor); else form.insertBefore(box, form.firstChild);
    wireCapture();
  }

  function setStatus(msg, cls) { var s = document.querySelector('#pb-status'); if (s) { s.textContent = msg || ''; s.className = 'pb-status ' + (cls || ''); } }
  function setHint(msg) { var h = document.querySelector('#pb-hint'); if (h) h.textContent = msg || ''; }

  function wireCapture() {
    document.querySelectorAll('.pb-gbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.gender = b.dataset.g;
        document.querySelectorAll('.pb-gbtn').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    document.querySelectorAll('.pb-bbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.brand = b.dataset.b;
        document.querySelectorAll('.pb-bbtn').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    document.querySelector('#pb-open').addEventListener('click', openCamera);
    document.querySelector('#pb-snap').addEventListener('click', snap);
    document.querySelector('#pb-retake').addEventListener('click', retake);
    document.querySelector('#pb-upload').addEventListener('click', function () { document.querySelector('#pb-file').click(); });
    document.querySelector('#pb-file').addEventListener('change', onUpload);
  }

  function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus('Δεν βρέθηκε κάμερα — χρησιμοποίησε «Ανέβασμα».', 'err'); return; }
    setHint('Άνοιγμα κάμερας…');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(function (stream) {
        state.stream = stream;
        var v = document.querySelector('#pb-video'); v.srcObject = stream; v.play();
        document.querySelector('#pb-open').style.display = 'none';
        document.querySelector('#pb-snap').style.display = '';
        setHint('Κεφάλι + ώμοι στο πλαίσιο · καλό φως');
        setStatus('');
      })
      .catch(function (e) { setStatus('Σφάλμα κάμερας: ' + (e.name || e.message) + ' — δοκίμασε «Ανέβασμα».', 'err'); });
  }

  function stopCamera() { if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; } var v = document.querySelector('#pb-video'); if (v) v.srcObject = null; }

  // capture a centered 3:4 portrait from the (mirrored) video
  function snap() {
    var v = document.querySelector('#pb-video');
    if (!v || !v.videoWidth) { setStatus('Η κάμερα δεν είναι έτοιμη ακόμα.', 'err'); return; }
    var vw = v.videoWidth, vh = v.videoHeight;
    // NATURAL 3:4 portrait (head + shoulders + context) — NOT an ultra-tight face crop.
    // AKOOL loses accuracy (mouth/jaw distortion) on ultra-tight crops; a looser portrait
    // gives its face detector proper landmark context. (proven fix from the EV Focus booth)
    var ch = Math.min(vh, vw / 0.75), cw = ch * 0.75;       // full available height → widest context, no zoom-in
    var sx = (vw - cw) / 2, sy = (vh - ch) / 2;             // centered (no upward bias that clips the chin)
    var out = 1600, canvas = document.createElement('canvas');
    canvas.width = Math.round(out * 0.75); canvas.height = out;
    var ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0); ctx.scale(-1, 1);       // un-mirror to natural orientation
    ctx.drawImage(v, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
    state.photo = canvas.toDataURL('image/jpeg', 0.97);
    showShot(state.photo);
    stopCamera();
  }

  function showShot(dataUrl) {
    var img = document.querySelector('#pb-shot'), v = document.querySelector('#pb-video');
    img.src = dataUrl; img.style.display = 'block'; v.style.display = 'none';
    document.querySelector('#pb-snap').style.display = 'none';
    document.querySelector('#pb-retake').style.display = '';
    setHint('');
    setStatus('✓ Έτοιμη! Πάτα Έναρξη για να παίξεις — το εξώφυλλο ετοιμάζεται όσο παίζεις.', 'ok');
  }

  function retake() {
    state.photo = null;
    var img = document.querySelector('#pb-shot'), v = document.querySelector('#pb-video');
    img.style.display = 'none'; v.style.display = '';
    document.querySelector('#pb-retake').style.display = 'none';
    setStatus('');
    if (state.stream) { document.querySelector('#pb-snap').style.display = ''; setHint('Κεφάλι + ώμοι στο πλαίσιο · καλό φως'); }
    else { document.querySelector('#pb-open').style.display = ''; setHint('Άνοιξε την κάμερα'); }
  }

  function onUpload(e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () { state.photo = r.result; stopCamera(); showShot(r.result); };
    r.readAsDataURL(f);
  }

  // ---------- kick off the cover swap when the game starts ----------
  function startCover() {
    var consent = document.querySelector('#consentCheck');
    if (consent && !consent.checked) return;             // no consent -> never send the photo
    stopCamera();                                        // game is starting -> free the webcam for hand-tracking
    if (!state.photo || state.session) return;           // need a photo; only once
    var name = (document.querySelector('#playerName') || {}).value || '';
    var contact = (document.querySelector('#playerContact') || {}).value || '';
    fetch('/api/cover/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: state.photo, gender: state.gender, brand: state.brand, name: name, contact: contact })
    }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) { state.session = d; console.log('[photobooth] cover session', d.id); } else { console.warn('[photobooth] start failed', d); } })
      .catch(function (e) { console.warn('[photobooth] start error', e); });
  }

  // ---------- game-over: show cover + QR ----------
  function buildCoverResult() {
    var panel = document.querySelector('#gameOverPanel');
    if (!panel || document.querySelector('#pb-cover')) return;
    var block = document.createElement('div');
    block.id = 'pb-cover';
    block.className = 'pb-cover';
    block.innerHTML =
      '<div>' +
        '<img class="pb-cimg" id="pb-cimg" alt="Το εξώφυλλό σου">' +
        '<div class="pb-cspin" id="pb-cspin">Το εξώφυλλό σου<br>ετοιμάζεται…<br>📲 σκάναρε το QR</div>' +
      '</div>' +
      '<div style="text-align:center">' +
        '<div class="pb-qrbox" id="pb-qr"></div>' +
        '<div class="pb-qrcap">Σκάναρε για το<br>εξώφυλλό σου</div>' +
        '<button class="pb-cdl" id="pb-cdl">💾 Λήψη στον υπολογιστή</button>' +
      '</div>';
    // insert near the top of the result panel
    var anchor = panel.querySelector('.result-content') || panel.querySelector('.result-copy') || panel.firstChild;
    panel.insertBefore(block, anchor && anchor.nextSibling ? anchor.nextSibling : anchor);
  }

  function showCoverResult() {
    if (!state.session) return;                 // no photo taken this round
    buildCoverResult();
    // the AI cover replaces the native game souvenir — hide the duplicate cover+QR
    var _rc = document.querySelector('#gameOverPanel .result-content');
    if (_rc) _rc.classList.add('hidden');
    // reset the reveal to the loading state (never show the previous player's cover)
    var img0 = document.querySelector('#pb-cimg'); if (img0) { img0.src = ''; img0.style.display = 'none'; }
    var sp0 = document.querySelector('#pb-cspin'); if (sp0) { sp0.style.display = 'grid'; sp0.innerHTML = 'Το εξώφυλλό σου<br>ετοιμάζεται…<br>📲 σκάναρε το QR'; }
    var dl0 = document.querySelector('#pb-cdl'); if (dl0) dl0.style.display = 'none';
    // QR immediately (deliver URL is known)
    var qrbox = document.querySelector('#pb-qr');
    try { var qr = window.qrcode(0, 'M'); qr.addData(state.session.deliverUrl); qr.make(); qrbox.innerHTML = qr.createImgTag(4, 2); } catch (e) {}
    // poll cover status — gated to THIS session so a restart silently kills the old chain
    var sid = state.session.id;
    var tries = 0;
    (function poll() {
      if (!state.session || state.session.id !== sid) return;   // superseded by a new player
      tries++;
      fetch('/api/cover/status/' + sid, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        if (!state.session || state.session.id !== sid) return;
        if (d && d.status === 'done' && d.coverUrl) {
          var img = document.querySelector('#pb-cimg'), sp = document.querySelector('#pb-cspin');
          img.src = d.coverUrl; img.style.display = 'block'; if (sp) sp.style.display = 'none';
          var dl = document.querySelector('#pb-cdl');
          if (dl) { dl.style.display = 'inline-block'; dl.onclick = function () { downloadCover(d.coverUrl); }; }
          return;
        }
        if (d && d.status === 'failed') { var sp2 = document.querySelector('#pb-cspin'); if (sp2) sp2.innerHTML = 'Το εξώφυλλο δεν ολοκληρώθηκε.<br>Δες το booth.'; return; }
        if (tries < 60) { setTimeout(poll, 2500); }
        else { var sp3 = document.querySelector('#pb-cspin'); if (sp3) sp3.innerHTML = 'Το εξώφυλλο αργεί λίγο —<br>📲 σκάναρε το QR για να<br>το δεις στο κινητό σου.'; }
      }).catch(function () { if (tries < 60 && state.session && state.session.id === sid) setTimeout(poll, 2500); });
    })();
  }

  function downloadCover(url) {
    fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
      var u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = 'ayra-tennis-cover.png'; a.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
    }).catch(function () { window.open(url, '_blank'); });
  }

  // ---------- observe game-over panel visibility ----------
  function watchGameOver() {
    var panel = document.querySelector('#gameOverPanel');
    if (!panel) return;
    var obs = new MutationObserver(function () {
      var shown = !panel.classList.contains('hidden');
      if (shown && !state.coverShown) { state.coverShown = true; showCoverResult(); }
      if (!shown) state.coverShown = false;      // reset for next player
    });
    obs.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  // ---------- boot ----------
  function boot() {
    buildCapture();
    // fire the swap when the player starts the game (form submit / start button)
    var form = document.querySelector('#playerForm');
    if (form) form.addEventListener('submit', function () { startCover(); }, true);
    var startBtn = document.querySelector('#startButton');
    if (startBtn) startBtn.addEventListener('click', function () { setTimeout(startCover, 0); }, true);
    // restart resets the session so the next player gets a fresh cover
    var restart = document.querySelector('#restartButton');
    if (restart) restart.addEventListener('click', function () {
      state.session = null; state.photo = null; state.coverShown = false;
      state.gender = 'f';                                                   // reset gender template for the next player
      document.querySelectorAll('.pb-gbtn').forEach(function (x) { x.classList.toggle('on', x.dataset.g === 'f'); });
      state.brand = 'ayra';                                                 // reset brand to ΑΥΡΑ for the next player
      document.querySelectorAll('.pb-bbtn').forEach(function (x) { x.classList.toggle('on', x.dataset.b === 'ayra'); });
      stopCamera();                                                          // release webcam / clear feed
      var _rc = document.querySelector('#gameOverPanel .result-content'); if (_rc) _rc.classList.remove('hidden');
      retakeSafe();
    }, true);
    // consent: terms toggle + clear warning once accepted
    var termsToggle = document.querySelector('#termsToggle');
    var termsText = document.querySelector('#termsText');
    if (termsToggle && termsText) termsToggle.addEventListener('click', function () { termsText.hidden = !termsText.hidden; });
    var consentCheck = document.querySelector('#consentCheck');
    var consentWarn = document.querySelector('#consentWarn');
    if (consentCheck) consentCheck.addEventListener('change', function () { if (consentWarn && consentCheck.checked) consentWarn.hidden = true; });
    // discreet staff shortcut: Ctrl+Alt+S opens the per-day stats dashboard
    document.addEventListener('keydown', function (e) { if (e.ctrlKey && e.altKey && (e.key === 's' || e.key === 'S')) { window.open('/stats', '_blank'); } });
    watchGameOver();
  }
  function retakeSafe() { try { retake(); } catch (e) {} }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
