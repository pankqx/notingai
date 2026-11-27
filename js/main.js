// Nothing AI — app shell, router and screens.
import * as store from './store.js';
import { getSettings, setSetting } from './store.js';
import { blk, clone, esc, renderStatic, plainText, toMarkdown, wordCount, sanitize } from './blocks.js';
import { Dictation, speechSupported, COMMAND_HELP } from './speech.js';
import { BlockEditor } from './editor.js';
import { DotWave } from './wave.js';
import * as ai from './ai.js';
import { reader, deviceVoices, NEURAL_VOICES, GEMINI_VOICES, loadNeural, neuralStatus } from './tts.js';
import { $, $$, icon, dotSVG, dotGrid, wordmark, toast, fmtDate, fmtTime, fmtDur, ago, pad, confirmSheet, download, seal } from './ui.js';

const view = $('#view');
let cleanup = null;
let currentNoteEditor = null; // { id, editor }

// =====================================================================
// boot
// =====================================================================
async function boot() {
  chrome();
  await seed();
  const loaderDone = runLoader();
  window.addEventListener('hashchange', route);
  await loaderDone;
  route();
  shortcuts();
  bindPlayer();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

function chrome() {
  $('#railMark').innerHTML = dotSVG('N', { size: 6, gap: 2.4 }) ;
  $('#topMark').innerHTML = wordmark();
  $$('[data-open-settings]').forEach(b => { b.innerHTML = icon('sliders'); b.onclick = openSettings; });
  const bn = { home: ['home', 'Index'], notes: ['notes', 'Notes'], record: ['mic', 'Record'], ask: ['ask', 'Ask'], search: ['search', 'Search'] };
  $$('.bottomnav a').forEach(a => { const [i, l] = bn[a.dataset.nav]; a.innerHTML = icon(i) + `<span>${l}</span>`; });
  const tick = () => {
    const d = new Date();
    $('#railClock').innerHTML = `${pad(d.getHours())}<br>${pad(d.getMinutes())}`;
    $('#topStamp').textContent = fmtDate(d, true).slice(0, 10);
  };
  tick(); setInterval(tick, 15000);
  document.addEventListener('settings', e => {
    const { k, v } = e.detail;
    if (k === 'theme') { document.documentElement.classList.toggle('ink', v === 'ink'); $('meta[name=theme-color]').content = v === 'ink' ? '#111612' : '#DCE3D3'; }
    if (k === 'grain') document.documentElement.classList.toggle('nograin', !v);
    if (k === 'reduceMotion') document.documentElement.classList.toggle('calm', v);
  });
}

async function seed() {
  const s = getSettings();
  if (s.seeded) return;
  const notes = await store.allNotes();
  if (!notes.length) {
    const n = store.newNote({
      title: 'How to talk to Nothing AI', tags: ['guide'], pinned: true, duration: 0,
      blocks: [
        blk('p', 'Tap the red button and just talk. While you speak, tap a symbol on the dock — it lands exactly where you are in the sentence.'),
        blk('h', 'Lists, while you speak'),
        blk('ol', 'Tap 1. to start a numbered list, then say the first item.'),
        blk('ol', 'Tap it again — it now reads 2. — for the next one. Or just say “next”.'),
        blk('ol', 'Hands busy? Say “comma”, “full stop”, “new line” or “checkbox”.'),
        blk('h', 'Then let it think'),
        blk('todo', 'Try the ✦ tools: clean up, summarise, make a checklist.', { checked: false }),
        blk('todo', 'Press Listen to hear any note read back softly.', { checked: false }),
        blk('todo', 'Add a free Gemini key in Settings for the AI features.', { checked: false }),
        blk('quote', 'Speak freely. Think clearly. Keep everything.'),
      ],
    });
    n.original = clone(n.blocks);
    n.summary = { text: 'A short guide to dictating with structure, using the AI tools and listening back.', points: [], at: Date.now(), model: 'guide' };
    await store.saveNote(n);
  }
  setSetting('seeded', true);
}

// =====================================================================
// loader — dots assemble into the wordmark, a line is typed, the page lifts
// =====================================================================
function runLoader() {
  const L = $('#loader');
  const calm = document.documentElement.classList.contains('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seen = sessionStorage.getItem('nai.seen');
  return new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return; finished = true;
      sessionStorage.setItem('nai.seen', '1');
      L.classList.add('out');
      setTimeout(() => { L.remove(); }, 950);
      resolve();
    };
    $('#ldSkip').onclick = finish; L.onclick = finish;
    if (calm) { setTimeout(finish, 250); return; }
    const { w, h, dots } = dotGrid('NOTHING');
    const u = 10, r = 3.2;
    const svg = $('#ldMatrix');
    svg.setAttribute('viewBox', `-4 -4 ${(w - 1) * u + 8} ${(h - 1) * u + 8}`);
    const cx = (w - 1) * u / 2, cy = (h - 1) * u / 2;
    svg.innerHTML = dots.map(d => {
      const x = d.x * u, y = d.y * u;
      if (!d.on) return `<circle class="bg" cx="${x}" cy="${y}" r="1.2"/>`;
      const a = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 140;
      const tx = Math.cos(a) * dist + (cx - x) * 0.4, ty = Math.sin(a) * dist + (cy - y) * 0.4;
      return `<circle class="fg" cx="${x}" cy="${y}" r="${r}" style="transform:translate(${tx}px,${ty}px);opacity:0;transform-box:fill-box"/>`;
    }).join('');
    const fg = $$('circle.fg', svg);
    const speed = seen ? 0.45 : 1;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fg.forEach((c, i) => {
        c.style.transitionDelay = (Math.random() * 520 * speed) + 'ms';
        c.style.transitionDuration = (900 * speed) + 'ms';
        c.style.transform = 'translate(0,0)'; c.style.opacity = 1;
      });
    }));
    // one dot turns red — the recording light
    setTimeout(() => { const last = fg[fg.length - 1]; last && last.classList.add('hot'); $('#ldAi').classList.add('in'); }, 1250 * speed);
    const tag = 'Speak freely. Think clearly. Keep everything.';
    const tagEl = $('#ldTag');
    let k = 0;
    const type = () => {
      if (finished) return;
      tagEl.innerHTML = esc(tag.slice(0, k)) + '<span class="cur"></span>';
      if (k++ < tag.length) setTimeout(type, (seen ? 12 : 28) + Math.random() * 30);
    };
    setTimeout(type, 900 * speed);
    const log = ['paper · loaded', 'ink · ready', 'microphone · standing by', 'notebook · open'];
    const logEl = $('#ldLog');
    log.forEach((l, i) => setTimeout(() => { if (!finished) logEl.innerHTML += `<div>${String(i + 1).padStart(2, '0')} — ${l}</div>`; }, (700 + i * 380) * speed));
    setTimeout(finish, seen ? 1500 : 3000);
  });
}

// =====================================================================
// router
// =====================================================================
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  return { parts: path.split('/').filter(Boolean), params };
}

async function route() {
  if (cleanup) { const c = cleanup; cleanup = null; try { await c(); } catch (e) { console.error(e); } }
  closeSheet();
  document.body.classList.remove('has-notebar');
  currentNoteEditor = null;
  const { parts, params } = parseHash();
  const name = parts[0] || 'home';
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === name || (name === 'note' && a.dataset.nav === 'notes') || (name === 'notes' && params.q && a.dataset.nav === 'search')));
  if (name === 'notes' && params.q) $$('.bottomnav [data-nav=notes]').forEach(a => a.classList.remove('on'));
  window.scrollTo(0, 0);
  try {
    if (name === 'home') await Home();
    else if (name === 'record') await Record(params);
    else if (name === 'note') await Note(parts[1]);
    else if (name === 'notes') await Library(params);
    else if (name === 'ask') await Ask();
    else await Home();
  } catch (e) { console.error(e); view.innerHTML = `<div class="page-head"><h1>Something <em>slipped.</em></h1></div><p class="err">${esc(e.message)}</p>`; }
  view.focus({ preventScroll: true });
}
const go = h => { if (location.hash === h) route(); else location.hash = h; };

// =====================================================================
// HOME
// =====================================================================
const titleOf = n => n.title || firstWords(n) || 'Untitled thought';
function firstWords(n) { const t = (n.blocks.find(b => b.text.trim()) || {}).text || ''; const w = t.split(/\s+/).slice(0, 7).join(' '); return w.length < t.length ? w + '…' : w; }

function mini(n, meta) {
  return `<a class="mini" href="#/note/${n.id}"><span class="mt">${esc(titleOf(n))}</span><span class="mm">${meta}</span></a>`;
}

async function Home() {
  const notes = (await store.allNotes()).filter(n => !n.archived);
  const now = new Date();
  const recs = notes.filter(n => n.duration > 0).sort((a, b) => b.created - a.created).slice(0, 4);
  const edited = notes.slice().sort((a, b) => b.updated - a.updated).slice(0, 4);
  const pinned = notes.filter(n => n.pinned).sort((a, b) => b.updated - a.updated).slice(0, 4);
  const sums = notes.filter(n => n.summary && n.summary.text).sort((a, b) => b.updated - a.updated).slice(0, 3);
  view.innerHTML = `<section class="home enter">
    <div class="mast"><span>Vol. 01 — <b>${fmtDate(now, true)}</b></span><span>${notes.length} ${notes.length === 1 ? 'note' : 'notes'} · on this device</span></div>
    <div class="hero">
      <div class="stagger">
        <p class="eyebrow">Nothing AI · a voice notebook</p>
        <h1 class="display">Your thoughts,<br><em>without interruption<span class="redot">.</span></em></h1>
        <p class="lede">Capture the moment. We'll organize the rest.</p>
        <div class="cta">
          <a class="btn solid big" href="#/record?go=1"><span class="rdot"></span>+ Start recording</a>
          <a class="btn ghost big" href="#/notes">Browse your notes</a>
        </div>
      </div>
      <figure class="enso-fig">
        <svg class="enso" viewBox="0 0 300 300" aria-hidden="true">
          <g filter="url(#brush)">
            <path class="draw" style="--len:820" stroke-width="15" d="M214 64 C 270 104, 276 196, 214 240 C 160 278, 74 262, 46 196 C 22 140, 52 70, 118 50 C 150 40, 178 44, 196 54"/>
            <path class="draw" style="--len:820;animation-delay:.5s;opacity:.35" stroke-width="5" d="M206 70 C 258 112, 262 192, 208 232 C 156 268, 82 252, 56 192"/>
          </g>
        </svg>
        ${seal('lg')}
        <figcaption>fig. 01 — 無 (mu): nothing.<br>the empty mind that holds everything.</figcaption>
      </figure>
      <div class="dotfield"></div>
    </div>
    <div class="cols stagger">
      <div class="col"><h2>Recent recordings <span class="n">01</span></h2>
        ${recs.map(n => mini(n, `<span>${fmtDate(n.created)}</span><span>${fmtDur(n.duration)}</span>`)).join('') || '<p class="empty">Nothing recorded yet. That’s the point — begin.</p>'}</div>
      <div class="col"><h2>Recently edited <span class="n">02</span></h2>
        ${edited.map(n => mini(n, `<span>${ago(n.updated)}</span><span>${wordCount(n.blocks)} words</span>`)).join('') || '<p class="empty">Blank pages, waiting.</p>'}</div>
      <div class="col"><h2>Pinned <span class="n">03</span></h2>
        ${pinned.map(n => mini(n, `<span>${(n.tags || []).slice(0, 2).map(t => '#' + esc(t)).join(' ') || fmtDate(n.updated)}</span>`)).join('') || '<p class="empty">Pin what matters most.</p>'}</div>
    </div>
    <div class="summaries">
      <h2>Summaries <span class="n">04 · ✦ AI</span></h2>
      <div class="sum-strip">${sums.map(n => `<a class="sum-item" href="#/note/${n.id}"><q>${esc(n.summary.text)}</q><div class="mm">${esc(titleOf(n))} — ${fmtDate(n.updated)}</div></a>`).join('') || '<p class="empty">Summaries appear here once the AI has read your notes.</p>'}</div>
    </div>
    <p class="help shortcuts" style="margin-top:30px">Shortcuts — <span class="kbd">R</span> record · <span class="kbd">N</span> notes · <span class="kbd">A</span> ask · <span class="kbd">/</span> search · <span class="kbd">,</span> settings</p>
  </section>`;
}

// =====================================================================
// RECORDING STUDIO
// =====================================================================
const CHIPS = [
  ['punct', '.', '.', 'Stop'], ['punct', ',', ',', 'Comma'], ['punct', '?', '?', 'Ask'], ['punct', '!', '!', 'Bang'],
  ['act', 'line', '↵', 'Line'], ['act', 'para', '¶', 'Para'],
  ['act', 'ol', '1.', 'Number'], ['act', 'ul', '•', 'Bullet'], ['act', 'todo', '<i class="gl-box"></i>', 'Check'],
  ['act', 'h', 'H', 'Head'], ['act', 'quote', '“', 'Quote'], ['undo', '', '⌫', 'Undo'],
];
const CHIP_KEYS = { '.': ['punct', '.'], ',': ['punct', ','], '?': ['punct', '?'], '!': ['punct', '!'], Enter: ['act', 'line'], '1': ['act', 'ol'], '-': ['act', 'ul'], '[': ['act', 'todo'], h: ['act', 'h'], q: ['act', 'quote'], Backspace: ['undo', ''] };

async function Record(params) {
  const s = getSettings();
  const appendTo = params.note ? await store.getNote(params.note) : null;
  const S = { state: 'idle', elapsed: 0, t0: 0, stream: null, ac: null, mr: null, chunks: [], timer: 0 };
  const noShare = localStorage.getItem('nai.nomicshare') === '1';

  view.innerHTML = `<section class="studio idle enter" id="studio">
    <div class="st-head">
      <a class="iconbtn" href="${appendTo ? '#/note/' + appendTo.id : '#/'}" aria-label="Back">${icon('back')}</a>
      <div class="rec-state"><span class="rec-sq"></span><span id="recLabel">Ready</span></div>
      <button class="iconbtn" id="helpBtn" aria-label="Spoken commands" title="Spoken commands">${icon('ask')}</button>
    </div>
    <div class="st-wave">
      <canvas id="waveC"></canvas>
      <div class="bigtime" id="bigTime">00:00<span class="ms">.0</span></div>
      <div class="hint" id="recHint">${appendTo ? 'Adding to “' + esc(titleOf(appendTo)) + '”' : 'Tap record · speak · tap symbols as you go'} · ${esc(s.lang.toUpperCase())}</div>
    </div>
    ${speechSupported ? '' : `<div class="notice">Live speech-to-text isn’t available in this browser. Use Chrome or Edge (Android / desktop) or Safari. <a href="#" id="typeInstead" style="text-decoration:underline">Write instead →</a></div>`}
    <div class="st-doc" id="stDoc">
      <div class="label"><span>Live transcript</span><span id="wc">0 words</span></div>
      <div class="doc" id="live" aria-live="polite"></div>
    </div>
    <div class="side">
      <div class="cmdhelp" id="cmdHelp">${COMMAND_HELP.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('')}<div><span>Keyboard: . , ? ! ↵ 1 - [ H Q ⌫ · space = pause</span><span>desktop</span></div></div>
      <div class="dock" role="toolbar" aria-label="Structure and punctuation">
        ${CHIPS.map(([k, v, g, l]) => `<button class="chip k-${k}" data-k="${k}" data-v="${v}" aria-label="${l}"><b>${g}</b><small>${l}</small></button>`).join('')}
      </div>
      <div class="controls">
        <button class="btn ghost ctl-side" id="discardBtn">${icon('close')} Discard</button>
        <button class="btn ctl-main" id="mainBtn"><span class="dt"></span> Record</button>
        <button class="btn ghost ctl-side" id="pauseBtn">${icon('pause')} Pause</button>
      </div>
    </div>
  </section>`;

  const studio = $('#studio');
  const wave = new DotWave($('#waveC'));
  const dict = new Dictation({
    blocks: appendTo ? appendTo.blocks : [],
    lang: s.lang, commands: s.spokenCommands,
    onUpdate: () => paint(),
    onActivity: () => wave.bump(0.7),
    onError: err => onErr(err),
  });
  const initialIds = new Set(dict.blocks.map(b => b.id));
  const live = $('#live');
  const stDoc = $('#stDoc');

  function paint() {
    const showFrom = appendTo ? Math.max(0, dict.blocks.length - 6) : 0; // in append mode keep context short
    live.innerHTML = renderStatic(dict.blocks.slice(showFrom), { interim: dict.interim, caret: S.state === 'live' });
    $('#wc').textContent = wordCount(dict.blocks) + ' words';
    stDoc.scrollTop = stDoc.scrollHeight;
    const cur = dict.cur.type;
    $$('.chip', studio).forEach(c => c.classList.toggle('on', c.dataset.k === 'act' && c.dataset.v === cur && cur !== 'p'));
    const ol = $('.chip[data-v=ol] b', studio); ol.textContent = dict.nextLabel() + '.';
  }
  paint();

  function setState(st) {
    S.state = st;
    studio.classList.remove('idle', 'live', 'paused');
    studio.classList.add(st === 'finishing' ? 'paused' : st);
    wave.setMode(st === 'live' ? 'rec' : st === 'paused' ? 'paused' : 'idle');
    $('#recLabel').textContent = { idle: 'Ready', live: 'Recording', paused: 'Paused', finishing: 'Finishing' }[st];
    const main = $('#mainBtn');
    main.innerHTML = st === 'idle' ? '<span class="dt"></span> Record' : '<span class="sq"></span> Done';
    $('#pauseBtn').innerHTML = st === 'paused' ? icon('play') + ' Resume' : icon('pause') + ' Pause';
    paint();
  }

  function tickTime() {
    const ms = S.elapsed + (S.state === 'live' ? performance.now() - S.t0 : 0);
    const sec = ms / 1000;
    $('#bigTime').innerHTML = `${fmtDur(sec)}<span class="ms">.${Math.floor((ms % 1000) / 100)}</span>`;
  }

  async function openMic() {
    if (!s.keepAudio || localStorage.getItem('nai.nomicshare') === '1') return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    S.stream = stream;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    S.ac = ac;
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.6;
    src.connect(an); wave.attach(an);
    if (window.MediaRecorder && !appendTo) {
      try {
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(m => MediaRecorder.isTypeSupported?.(m));
        S.mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        S.chunks = [];
        S.mr.ondataavailable = e => e.data.size && S.chunks.push(e.data);
        S.mr.start(1000);
      } catch { S.mr = null; }
    }
  }
  function closeMic() {
    try { S.stream && S.stream.getTracks().forEach(t => t.stop()); } catch {}
    try { S.ac && S.ac.close(); } catch {}
    S.stream = null; S.ac = null; wave.analyser = null;
  }
  function stopRecorder() {
    return new Promise(res => {
      if (!S.mr || S.mr.state === 'inactive') return res(S.chunks.length ? new Blob(S.chunks, { type: S.mr?.mimeType || 'audio/webm' }) : null);
      S.mr.onstop = () => res(S.chunks.length ? new Blob(S.chunks, { type: S.mr.mimeType || 'audio/webm' }) : null);
      try { S.mr.stop(); } catch { res(null); }
    });
  }

  function onErr(err) {
    if (err === 'audio-capture' && S.stream) {
      // this device can't share the mic between recognition and the waveform — fall back gracefully
      if (S.mr) { try { S.mr.stop(); } catch {} S.mr = null; S.chunks = []; }
      closeMic(); localStorage.setItem('nai.nomicshare', '1');
      toast('Mic can’t be shared here — waveform now follows your voice. Audio won’t be kept.');
      return;
    }
    const msg = {
      'not-allowed': 'Microphone permission is blocked — allow it in your browser settings.',
      'service-not-allowed': 'Speech service not allowed in this browser.',
      network: 'Speech recognition needs an internet connection.',
      'language-not-supported': 'This language isn’t supported here — change it in Settings.',
      unstable: 'Speech recognition keeps stopping. Tap Resume to continue.',
      unsupported: 'Speech recognition isn’t supported in this browser.',
      'audio-capture': 'No microphone found.',
    }[err] || 'Speech error: ' + err;
    toast(msg, 'err');
    if (['not-allowed', 'service-not-allowed', 'unsupported', 'audio-capture'].includes(err) && S.state === 'live') { S.elapsed += performance.now() - S.t0; setState(S.elapsed > 0 ? 'paused' : 'idle'); }
    if (err === 'unstable' && S.state === 'live') { S.elapsed += performance.now() - S.t0; dict.pause(); setState('paused'); }
  }

  async function start() {
    if (!speechSupported) return toast('Speech-to-text isn’t supported in this browser', 'err');
    try { await openMic(); }
    catch (e) {
      if (e.name === 'NotAllowedError') return toast('Microphone permission is blocked — allow it to record.', 'err');
      closeMic();
    }
    dict.start();
    S.t0 = performance.now(); S.elapsed = 0;
    S.timer = setInterval(tickTime, 100);
    setState('live');
  }
  function pause() {
    if (S.state === 'live') { S.elapsed += performance.now() - S.t0; dict.pause(); try { S.mr?.pause(); } catch {} setState('paused'); }
    else if (S.state === 'paused') { S.t0 = performance.now(); dict.resume(); try { S.mr?.resume(); } catch {} setState('live'); }
    tickTime();
  }

  async function finish({ silent = false } = {}) {
    if (S.state === 'idle' || S.state === 'finishing') return null;
    if (S.state === 'live') S.elapsed += performance.now() - S.t0;
    setState('finishing');
    clearInterval(S.timer);
    await dict.stop();
    const blob = await stopRecorder();
    closeMic();
    const blocks = dict.result();
    const duration = Math.round(S.elapsed / 1000);
    if (!blocks.length) { if (!silent) { toast('Nothing was captured — try again'); setState('idle'); } return null; }
    let note;
    if (appendTo) {
      note = await store.getNote(appendTo.id);
      pushHistory(note, 'Before dictation');
      note.blocks = blocks;
      note.original = (note.original || []).concat(clone(blocks.filter(b => !initialIds.has(b.id))));
      note.duration = (note.duration || 0) + duration;
    } else {
      note = store.newNote({ blocks, original: clone(blocks), duration, lang: s.lang });
    }
    if (silent) {
      if (!note.title) note.title = firstWords(note);
      await store.saveNote(note);
      if (blob && !appendTo) { await store.saveAudio(note.id, blob).catch(() => {}); note.hasAudio = true; await store.saveNote(note); }
      toast('Recording saved', 'ok');
      return note;
    }
    wave.destroy(); cleanup = null;
    document.removeEventListener('keydown', onKey, true);
    await processing(note, blob, !!appendTo);
    return note;
  }

  async function discard() {
    if (S.state === 'idle') return;
    if (!(await confirmSheet('Discard this recording?', 'The words captured so far will be lost.', 'Discard', true))) return;
    clearInterval(S.timer); dict.abort(); await stopRecorder(); closeMic();
    toast('Discarded');
    go(appendTo ? '#/note/' + appendTo.id : '#/');
  }

  $('#mainBtn').onclick = () => S.state === 'idle' ? start() : finish();
  $('#pauseBtn').onclick = pause;
  $('#discardBtn').onclick = discard;
  $('#helpBtn').onclick = () => $('#cmdHelp').classList.toggle('show');
  const ti = $('#typeInstead'); if (ti) ti.onclick = async e => { e.preventDefault(); const n = store.newNote({ blocks: [blk('p')] }); await store.saveNote(n); go('#/note/' + n.id); };
  $$('.chip', studio).forEach(c => {
    // pointerdown so the tap registers instantly, even mid-word
    c.addEventListener('pointerdown', e => { e.preventDefault(); press(c.dataset.k, c.dataset.v, c); });
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(c.dataset.k, c.dataset.v, c); } });
  });
  function press(k, v, el) {
    dict.action(k, v);
    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
    if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 140); }
  }

  const onKey = e => {
    if (e.target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); S.state === 'idle' ? start() : pause(); return; }
    if (e.key === 'Escape' && S.state !== 'idle') { e.preventDefault(); finish(); return; }
    const m = CHIP_KEYS[e.key] || CHIP_KEYS[e.key.toLowerCase()];
    if (m && (S.state !== 'idle' || e.key !== 'Backspace')) {
      e.preventDefault(); e.stopPropagation();
      const el = $$('.chip', studio).find(c => c.dataset.k === m[0] && c.dataset.v === m[1]);
      press(m[0], m[1], el);
    }
  };
  document.addEventListener('keydown', onKey, true);

  cleanup = async () => {
    document.removeEventListener('keydown', onKey, true);
    if (S.state === 'live' || S.state === 'paused') await finish({ silent: true });
    clearInterval(S.timer); dict.abort(); closeMic(); wave.destroy();
  };
  if (params.go && speechSupported) start();
}

// ---------- processing sequence ----------
async function processing(note, blob, appended) {
  const s = getSettings();
  const useAI = ai.hasKey() && s.autoMeta && !appended;
  const stages = [['Listening', 'done'], ['Transcribing', ''], ['Understanding', ''], ['Organizing', ''], ['Ready', '']];
  view.innerHTML = `<section class="proc enter">
    <div id="procMark">${dotSVG('READY', { size: 6, gap: 3 })}</div>
    <div class="stages">${stages.map(([l], i) => `<div class="stage" data-i="${i}"><span class="n">${pad(i + 1)}</span><span class="l">${l}</span><span class="s"></span><div class="bar"><i></i></div></div>`).join('')}</div>
    <p class="help" id="procNote"></p>
  </section>`;
  const mark = $('#procMark svg');
  const on = $$('circle.on', mark);
  on.forEach(c => { c.style.opacity = 0.08; });
  const st = i => $(`.stage[data-i="${i}"]`);
  const activate = (i, status = '…') => { st(i).classList.add('active'); $('.s', st(i)).textContent = status; };
  const complete = (i, status = 'OK') => { st(i).classList.remove('active'); st(i).classList.add('done'); $('.s', st(i)).textContent = status; lightUp((i + 1) / stages.length); };
  const lightUp = f => on.forEach((c, k) => { if (k / on.length < f) c.style.opacity = 1; });
  const wait = ms => new Promise(r => setTimeout(r, document.documentElement.classList.contains('calm') ? 0 : ms));

  activate(0); await wait(250); complete(0, fmtDur(note.duration));
  activate(1); await wait(550); complete(1, wordCount(note.blocks) + ' words');
  activate(2);
  if (useAI) {
    try {
      const meta = await Promise.race([ai.tools.meta(note), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
      if (meta.title) note.title = String(meta.title).trim();
      if (Array.isArray(meta.tags)) note.tags = [...new Set([...(note.tags || []), ...meta.tags.map(t => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean)])].slice(0, 6);
      if (meta.summary) note.summary = { text: meta.summary, points: meta.points || [], at: Date.now(), model: ai.lastModelUsed() };
      complete(2, 'Titled · tagged');
    } catch (e) { complete(2, 'Skipped'); $('#procNote').textContent = 'AI couldn’t reach Gemini (' + e.message.slice(0, 80) + '). Your note is safe.'; }
  } else {
    await wait(350); complete(2, appended ? 'Merged' : 'Skipped');
    if (!ai.hasKey() && !appended) $('#procNote').innerHTML = 'Tip — add a free Gemini key in <a href="#" data-set>Settings</a> for automatic titles, tags and summaries.';
  }
  if (!note.title) note.title = firstWords(note);
  activate(3);
  await store.saveNote(note);
  if (blob) { try { await store.saveAudio(note.id, blob); note.hasAudio = true; await store.saveNote(note); } catch {} }
  await wait(380); complete(3, 'Saved');
  activate(4); await wait(450); complete(4, '●');
  await wait(650);
  go('#/note/' + note.id);
}

// =====================================================================
// NOTE EDITOR
// =====================================================================
function pushHistory(note, label) {
  note.history = note.history || [];
  note.history.unshift({ at: Date.now(), label, title: note.title, blocks: clone(note.blocks) });
  note.history = note.history.slice(0, 20);
}

const TOOLS = [
  ['cleanup', 'Clean up transcript', 'edit'], ['summary', 'Summarize', 'spark'], ['checklist', 'Convert into checklist', 'check'],
  ['tone', 'Rewrite tone', 'wave'], ['actions', 'Extract action items', 'plus'], ['titles', 'Generate title', 'notes'], ['tags', 'Generate tags', 'search'],
];

async function Note(id) {
  let note = await store.getNote(id);
  if (!note) { view.innerHTML = `<div class="page-head"><h1>Not <em>here.</em></h1></div><p class="empty">This note doesn’t exist on this device. <a href="#/notes" style="text-decoration:underline">Back to notes</a></p>`; return; }
  const toolsHTML = `<p class="eyebrow">✦ AI tools · Gemini</p><div class="tools">${TOOLS.map(([k, l, ic], i) => `<button class="tool" data-tool="${k}"><span class="n">${pad(i + 1)}</span><span class="l">${l}</span>${icon(ic)}</button>${k === 'tone' ? '<div class="tones" hidden>' + ['professional', 'casual', 'concise', 'detailed', 'creative', 'cancel'].map(t => `<button data-tone="${t}">${t}</button>`).join('') + '</div>' : ''}`).join('')}
    <button class="tool" data-act="listen"><span class="n">08</span><span class="l">Read aloud</span>${icon('speaker')}</button>
    <button class="tool" data-act="dictate"><span class="n">09</span><span class="l">Continue dictating</span>${icon('mic')}</button></div>
    ${ai.hasKey() ? '' : '<p class="help" style="margin-top:12px">AI tools need a free Gemini API key — <a href="#" data-set>add it in Settings</a>.</p>'}`;

  view.innerHTML = `<section class="note-page enter">
    <div class="note-top">
      <a class="back" href="#/notes">${icon('back')} Notes</a>
      <span class="save-state saved" id="saveState"><i></i><span>Saved</span></span>
      <div class="row">
        <button class="iconbtn ${note.pinned ? 'on' : ''}" id="pinBtn" aria-label="Pin" title="Pin">${icon('pin')}</button>
        <button class="iconbtn" id="listenBtn" aria-label="Read aloud" title="Read aloud">${icon('speaker')}</button>
        <button class="iconbtn" id="moreBtn" aria-label="More" title="More">${icon('sliders')}</button>
      </div>
    </div>
    <div class="note-grid">
      <div class="note-main">
        <h1 class="n-title" id="nTitle" contenteditable="plaintext-only" spellcheck="true">${esc(note.title)}</h1>
        <div class="n-meta"><span><b>${fmtDate(note.created, true)}</b></span><span>${fmtTime(note.created)}</span><span>${note.duration ? fmtDur(note.duration) + ' spoken' : 'written'}</span><span id="nWords">${wordCount(note.blocks)} words</span>${note.summary ? '<span class="red">✦ summarised</span>' : ''}</div>
        <div class="tags" id="tags"></div>
        <div id="aiLayer"></div>
        <div class="fmt" role="toolbar" aria-label="Format">
          ${[['p', '¶'], ['h', 'H'], ['ol', '1.'], ['ul', '•'], ['todo', '☐'], ['quote', '“']].map(([t, g]) => `<button data-fmt="${t}" title="${t}">${t === 'todo' ? '<i class="gl-box"></i>' : g}</button>`).join('')}
          <span class="sep"></span>
          <button data-dictate title="Dictate into this note">${icon('mic')}</button>
        </div>
        <div class="doc" id="editor"></div>
        <details class="original" id="original">
          <summary><span>Original — as spoken</span><span class="pm"></span></summary>
          <div id="origBody"></div>
        </details>
      </div>
      <aside class="ai-side" id="aiSide">${toolsHTML}</aside>
    </div>
    <div class="notebar">
      <button data-sheet-tools><span class="spark">✦</span> AI tools</button>
      <button data-act="listen">${icon('speaker')} Listen</button>
      <button data-act="dictate">${icon('mic')} Dictate</button>
    </div>
  </section>`;
  document.body.classList.add('has-notebar');

  // ----- saving -----
  let saveT;
  const saveState = $('#saveState');
  const scheduleSave = () => {
    saveState.className = 'save-state saving'; saveState.lastChild.textContent = 'Saving';
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      await store.saveNote(note);
      saveState.className = 'save-state saved'; saveState.lastChild.textContent = 'Saved · ' + fmtTime(Date.now());
      $('#nWords').textContent = wordCount(note.blocks) + ' words';
    }, 500);
  };
  cleanup = async () => { if (saveT) { clearTimeout(saveT); await store.saveNote(note); } };

  // ----- title -----
  const title = $('#nTitle');
  title.addEventListener('input', () => { note.title = title.textContent.replace(/\n/g, ' ').trim(); scheduleSave(); });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); editor.caret(editor.blocks[0].id, 0); } });

  // ----- editor -----
  const editor = new BlockEditor($('#editor'), note.blocks, { onChange: b => { note.blocks = b; scheduleSave(); } });
  currentNoteEditor = { id: note.id, editor };
  note.blocks = editor.blocks;
  $('#editor').addEventListener('blockfocus', e => { $$('.fmt [data-fmt]').forEach(b => b.classList.toggle('on', b.dataset.fmt === e.detail.type)); });
  $$('.fmt [data-fmt]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); editor.setType(b.dataset.fmt); $$('.fmt [data-fmt]').forEach(x => x.classList.toggle('on', x.dataset.fmt === editor.cur().type)); }));

  // ----- tags -----
  const renderTags = (sugg = []) => {
    $('#tags').innerHTML = (note.tags || []).map(t => `<span class="tag">#${esc(t)}<button class="x" data-rm="${esc(t)}" aria-label="Remove tag">×</button></span>`).join('') +
      sugg.filter(t => !(note.tags || []).includes(t)).map(t => `<button class="tag sugg" data-add="${esc(t)}">+ ${esc(t)}</button>`).join('') +
      `<button class="tag add" id="addTag">+ tag</button>`;
  };
  renderTags();
  $('#tags').addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]'); const add = e.target.closest('[data-add]');
    if (rm) { note.tags = note.tags.filter(t => t !== rm.dataset.rm); renderTags(); scheduleSave(); }
    if (add) { note.tags = [...(note.tags || []), add.dataset.add]; add.remove(); renderTags($$('.tag.sugg').map(x => x.dataset.add)); scheduleSave(); }
    if (e.target.closest('#addTag')) {
      const inp = document.createElement('input'); inp.className = 'tag-input'; inp.placeholder = 'tag name';
      e.target.closest('#addTag').replaceWith(inp); inp.focus();
      const commit = () => { const v = inp.value.trim().toLowerCase().replace(/^#/, ''); if (v && !(note.tags || []).includes(v)) { note.tags = [...(note.tags || []), v]; scheduleSave(); } renderTags(); };
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') renderTags(); });
      inp.addEventListener('blur', commit);
    }
  });

  // ----- original transcript & audio -----
  const renderOriginal = async () => {
    const ob = $('#origBody');
    let audioHTML = '';
    if (note.hasAudio) audioHTML = `<div class="audio-row" id="audioRow"><button class="iconbtn" id="aPlay">${icon('play')}</button><input type="range" class="seek" id="aSeek" min="0" max="1000" value="0"><span class="mono help" id="aTime">00:00</span></div>`;
    ob.innerHTML = audioHTML + `<div class="doc">${renderStatic(note.original || []) || '<p class="empty">No spoken original — this note was written.</p>'}</div>` +
      ((note.original || []).length ? `<div class="row gap" style="padding-bottom:16px"><button class="btn sm ghost" id="restoreOrig">${icon('history')} Restore original</button><span class="help">Your current version is kept in history.</span></div>` : '');
    const ro = $('#restoreOrig');
    if (ro) ro.onclick = async () => {
      if (!(await confirmSheet('Restore the original?', 'The note goes back to exactly what you said. The current version is saved in history.', 'Restore'))) return;
      pushHistory(note, 'Before restoring original');
      note.blocks = clone(note.original); editor.setBlocks(note.blocks); note.blocks = editor.blocks; scheduleSave(); toast('Original restored', 'ok');
    };
    if (note.hasAudio) {
      const blob = await store.getAudio(note.id).catch(() => null);
      if (!blob) { $('#audioRow')?.remove(); return; }
      const a = new Audio(URL.createObjectURL(blob));
      const btn = $('#aPlay'), seek = $('#aSeek'), tm = $('#aTime');
      btn.onclick = () => { a.paused ? a.play() : a.pause(); };
      a.onplay = () => (btn.innerHTML = icon('pause')); a.onpause = () => (btn.innerHTML = icon('play'));
      a.ontimeupdate = () => { const d = isFinite(a.duration) ? a.duration : note.duration; seek.value = d ? (a.currentTime / d) * 1000 : 0; tm.textContent = fmtDur(a.currentTime); };
      seek.oninput = () => { const d = isFinite(a.duration) ? a.duration : note.duration; a.currentTime = (seek.value / 1000) * d; };
      const prev = cleanup; cleanup = async () => { a.pause(); URL.revokeObjectURL(a.src); await prev(); };
    }
  };
  renderOriginal();

  // ----- actions -----
  $('#pinBtn').onclick = () => { note.pinned = !note.pinned; $('#pinBtn').classList.toggle('on', note.pinned); scheduleSave(); toast(note.pinned ? 'Pinned' : 'Unpinned'); };
  const listen = () => {
    const items = [{ id: '_title', text: note.title }, ...note.blocks.map(b => ({ id: b.id, text: b.text }))].filter(i => i.text && i.text.trim());
    reader.play(items, note.title || 'Untitled');
  };
  const dictate = async () => { await store.saveNote(note); go('#/record?go=1&note=' + note.id); };
  $('#listenBtn').onclick = listen;
  $$('[data-act=listen]').forEach(b => (b.onclick = () => { closeSheet(); listen(); }));
  $$('[data-act=dictate], [data-dictate]').forEach(b => (b.onclick = () => { closeSheet(); dictate(); }));
  $('#moreBtn').onclick = () => moreMenu(note, editor, scheduleSave, renderOriginal);
  $('[data-sheet-tools]').onclick = () => openSheet('AI tools', `<div style="padding-top:14px">${toolsHTML}</div>`, root => bindTools(root));

  // ----- AI tools -----
  const layer = $('#aiLayer');
  const bindTools = root => {
    $$('[data-set]', root).forEach(a => a.onclick = e => { e.preventDefault(); openSettings('intel'); });
    $$('[data-tool]', root).forEach(b => b.onclick = () => {
      if (b.dataset.tool === 'tone') { const t = b.nextElementSibling; t.hidden = !t.hidden; return; }
      closeSheet(); runTool(b.dataset.tool);
    });
    $$('[data-tone]', root).forEach(b => b.onclick = () => { b.parentElement.hidden = true; if (b.dataset.tone !== 'cancel') { closeSheet(); runTool('tone', b.dataset.tone); } });
    $$('[data-act=listen]', root).forEach(b => (b.onclick = () => { closeSheet(); listen(); }));
    $$('[data-act=dictate]', root).forEach(b => (b.onclick = () => { closeSheet(); dictate(); }));
  };
  bindTools($('#aiSide'));

  async function runTool(kind, arg) {
    if (!ai.hasKey()) { toast('Add your free Gemini key first'); openSettings('intel'); return; }
    if (!wordCount(note.blocks)) { toast('Write or dictate something first'); return; }
    const label = { cleanup: 'Clean transcript', summary: 'Summary', checklist: 'Checklist', tone: 'Tone · ' + arg, actions: 'Action items', titles: 'Titles', tags: 'Tags' }[kind];
    layer.innerHTML = `<div class="ailayer"><div class="al-head"><span class="red">✦ ${esc(label)}</span><button class="iconbtn" data-x aria-label="Dismiss">${icon('close')}</button></div>
      <div class="al-body"><div class="thinking"><span class="dots">${'<i></i>'.repeat(18)}</span><span>Reading your note…</span></div></div></div>`;
    layer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('[data-x]', layer).onclick = () => (layer.innerHTML = '');
    const body = $('.al-body', layer);
    let r;
    try { r = await ai.tools[kind](note, arg); }
    catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p><p class="help">Check your key / model in Settings, or try again in a minute (free tier has per-minute limits).</p>`; return; }
    const model = ai.lastModelUsed();
    $('.al-head .red', layer).innerHTML = `✦ ${esc(label)} <span class="help" style="letter-spacing:.06em">· ${esc(model)}</span>`;
    const acts = btns => `<div class="al-acts">${btns.map(([k, l, cls = 'ghost']) => `<button class="btn ${cls}" data-a="${k}">${l}</button>`).join('')}</div>`;
    const done = msg => { layer.innerHTML = ''; toast(msg, 'ok'); };
    const apply = (blocks, mode, histLabel) => {
      if (mode === 'replace') { pushHistory(note, histLabel); editor.setBlocks(blocks); }
      else if (mode === 'top') editor.prepend(blocks);
      else editor.insertAfter(blocks, true);
      note.blocks = editor.blocks; scheduleSave();
    };

    if (kind === 'cleanup' || kind === 'tone') {
      const blocks = sanitize(r.blocks);
      if (!blocks.length) { body.innerHTML = '<p class="err">The AI returned nothing usable — try again.</p>'; return; }
      body.innerHTML = `<div class="doc">${renderStatic(blocks)}</div>`;
      body.insertAdjacentHTML('afterend', acts([['replace', 'Replace note', 'solid'], ['append', 'Add below'], ['copy', 'Copy']]));
      $('.al-acts', layer).onclick = e => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        if (a === 'copy') { navigator.clipboard?.writeText(plainText(blocks)); return toast('Copied'); }
        apply(a === 'replace' ? blocks.map(b => ({ ...b, ai: kind === 'tone' })) : blocks, a, label);
        done(a === 'replace' ? 'Replaced — original kept safe below' : 'Added');
      };
    } else if (kind === 'summary') {
      note.summary = { text: r.summary || '', points: r.points || [], at: Date.now(), model };
      scheduleSave();
      body.innerHTML = `<p class="al-sum">${esc(r.summary || '')}</p>${(r.points || []).length ? '<ul>' + r.points.map(p => `<li>${esc(p)}</li>`).join('') + '</ul>' : ''}`;
      body.insertAdjacentHTML('afterend', acts([['top', 'Insert at top', 'solid'], ['listen', 'Listen'], ['copy', 'Copy']]));
      $('.al-acts', layer).onclick = e => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        const blocks = [blk('h', 'Summary', { ai: true }), blk('p', r.summary || '', { ai: true }), ...(r.points || []).map(p => blk('ul', p, { ai: true }))];
        if (a === 'copy') { navigator.clipboard?.writeText(plainText(blocks)); return toast('Copied'); }
        if (a === 'listen') return reader.play([{ id: '_s', text: r.summary }, ...(r.points || []).map((p, i) => ({ id: '_p' + i, text: p }))], 'Summary');
        apply(blocks, 'top'); done('Summary added');
      };
    } else if (kind === 'checklist' || kind === 'actions') {
      const items = (r.items || []).map(x => typeof x === 'string' ? x : (x.text + (x.when ? ' — ' + x.when : ''))).filter(Boolean);
      if (!items.length) { body.innerHTML = `<p class="empty">${kind === 'actions' ? 'No action items found in this note.' : 'Nothing to turn into a checklist.'}</p>`; return; }
      const blocks = items.map(t => blk('todo', t, { checked: false, ai: true }));
      body.innerHTML = `<div class="doc">${renderStatic(blocks)}</div>`;
      body.insertAdjacentHTML('afterend', acts(kind === 'checklist' ? [['append', 'Add to note', 'solid'], ['replace', 'Replace note'], ['copy', 'Copy']] : [['append', 'Add to note', 'solid'], ['copy', 'Copy']]));
      $('.al-acts', layer).onclick = e => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        if (a === 'copy') { navigator.clipboard?.writeText(items.map(i => '[ ] ' + i).join('\n')); return toast('Copied'); }
        const add = a === 'append' ? [blk('h', kind === 'actions' ? 'Action items' : 'Checklist', { ai: true }), ...blocks] : blocks;
        apply(add, a, label); done(a === 'replace' ? 'Replaced — original kept safe below' : 'Added to note');
      };
    } else if (kind === 'titles') {
      const ts = (r.titles || []).filter(Boolean).slice(0, 4);
      body.innerHTML = `<p class="eyebrow">Tap to use</p>${ts.map(t => `<button class="pick">${esc(t)}</button>`).join('')}`;
      $$('.pick', body).forEach(b => b.onclick = () => { note.title = b.textContent; title.textContent = note.title; scheduleSave(); done('Title set'); });
    } else if (kind === 'tags') {
      const tg = (r.tags || []).map(t => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean);
      body.innerHTML = `<div class="tags">${tg.map(t => `<button class="tag sugg" data-add="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>`;
      body.insertAdjacentHTML('afterend', acts([['all', 'Add all', 'solid']]));
      $$('[data-add]', body).forEach(b => b.onclick = () => { if (!(note.tags || []).includes(b.dataset.add)) note.tags = [...(note.tags || []), b.dataset.add]; b.remove(); renderTags(); scheduleSave(); });
      $('.al-acts', layer).onclick = () => { note.tags = [...new Set([...(note.tags || []), ...tg])]; renderTags(); scheduleSave(); done('Tags added'); };
    }
  }
}

function moreMenu(note, editor, scheduleSave, renderOriginal) {
  const hist = (note.history || []);
  openSheet('This note', `
    <div class="tools" style="margin-top:14px">
      <button class="tool" data-m="copy"><span class="n">01</span><span class="l">Copy as text</span>${icon('copy')}</button>
      <button class="tool" data-m="md"><span class="n">02</span><span class="l">Export Markdown</span>${icon('download')}</button>
      <button class="tool" data-m="share"><span class="n">03</span><span class="l">Share…</span>${icon('send')}</button>
      <button class="tool" data-m="archive"><span class="n">04</span><span class="l">${note.archived ? 'Unarchive' : 'Archive'}</span>${icon('archive')}</button>
      <button class="tool" data-m="delete"><span class="n">05</span><span class="l" style="color:var(--red)">Delete note</span>${icon('trash')}</button>
    </div>
    <p class="eyebrow" style="margin-top:26px">Versions · ${hist.length}</p>
    <div class="tools">${hist.map((h, i) => `<button class="tool" data-h="${i}"><span class="n">${pad(i + 1)}</span><span class="l" style="font-size:17px">${esc(h.label)}<br><span class="help">${fmtDate(h.at)} ${fmtTime(h.at)} · ${wordCount(h.blocks)} words</span></span>${icon('history')}</button>`).join('') || '<p class="empty">No earlier versions yet. Every AI replacement keeps one.</p>'}</div>`,
  root => {
    root.addEventListener('click', async e => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      const h = e.target.closest('[data-h]')?.dataset.h;
      if (m === 'copy') { await navigator.clipboard?.writeText((note.title ? note.title + '\n\n' : '') + plainText(note.blocks)); toast('Copied'); closeSheet(); }
      if (m === 'md') { download((note.title || 'note').replace(/[^\w\- ]+/g, '').slice(0, 60) + '.md', toMarkdown(note.title, note.blocks), 'text/markdown'); closeSheet(); }
      if (m === 'share') {
        const text = (note.title ? note.title + '\n\n' : '') + plainText(note.blocks);
        if (navigator.share) navigator.share({ title: note.title, text }).catch(() => {}); else { navigator.clipboard?.writeText(text); toast('Copied — sharing isn’t available here'); }
        closeSheet();
      }
      if (m === 'archive') { note.archived = !note.archived; scheduleSave(); toast(note.archived ? 'Archived' : 'Back in notes'); closeSheet(); }
      if (m === 'delete') {
        closeSheet();
        if (await confirmSheet('Delete this note?', 'It will be removed from this device, including its audio. This can’t be undone.', 'Delete', true)) {
          cleanup = null; await store.deleteNote(note.id); toast('Deleted'); go('#/notes');
        }
      }
      if (h != null) {
        const v = note.history[+h];
        closeSheet();
        if (!(await confirmSheet('Restore this version?', `“${esc(v.label)}” from ${fmtDate(v.at)} ${fmtTime(v.at)}. Your current version is kept too.`, 'Restore'))) return;
        pushHistory(note, 'Before restoring a version');
        note.blocks = clone(v.blocks); editor.setBlocks(note.blocks); note.blocks = editor.blocks;
        scheduleSave(); toast('Version restored', 'ok');
      }
    });
  });
}

// =====================================================================
// LIBRARY
// =====================================================================
const LIB = { q: '', mode: 'words', tag: '', date: 'all', view: 'all' };

async function Library(params) {
  const notes = await store.allNotes();
  const tags = [...new Set(notes.flatMap(n => n.tags || []))].sort();
  view.innerHTML = `<section class="enter">
    <div class="page-head"><h1>The <em>archive.</em></h1><div class="count">${notes.filter(n => !n.archived).length} notes<br>${notes.filter(n => n.archived).length} archived</div></div>
    <div class="lib-tools">
      <div class="searchbox">${icon('search')}<input id="q" type="search" placeholder="Search ${notes.length} notes…" value="${esc(LIB.q)}" autocomplete="off" aria-label="Search notes">
        <div class="seg" role="group" aria-label="Search mode"><button data-mode="words" class="${LIB.mode === 'words' ? 'on' : ''}">Words</button><button data-mode="meaning" class="${LIB.mode === 'meaning' ? 'on' : ''}">Meaning</button></div></div>
      <div class="filters">
        ${['all', 'pinned', 'recent', 'archived'].map(v => `<button class="tag ${LIB.view === v ? 'on' : ''}" data-view="${v}">${v}</button>`).join('')}
        <select class="input" id="dateF" aria-label="Date filter">${[['all', 'Any date'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year']].map(([v, l]) => `<option value="${v}" ${LIB.date === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${tags.map(t => `<button class="tag ${LIB.tag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}
      </div>
    </div>
    <div id="list"></div>
  </section>`;
  const q = $('#q');
  let semT; let semToken = 0;
  const draw = async () => {
    const list = $('#list');
    let pool = notes.filter(n => LIB.view === 'archived' ? n.archived : !n.archived);
    if (LIB.view === 'pinned') pool = pool.filter(n => n.pinned);
    if (LIB.tag) pool = pool.filter(n => (n.tags || []).includes(LIB.tag));
    if (LIB.date !== 'all') {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      const from = { today: +d, week: +d - 6 * 864e5, month: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), year: new Date(d.getFullYear(), 0, 1).getTime() }[LIB.date];
      pool = pool.filter(n => n.created >= from);
    }
    let rows; let scores = null;
    if (LIB.q.trim() && LIB.mode === 'meaning') {
      if (!ai.hasKey()) { list.innerHTML = '<p class="empty" style="padding-top:20px">Search by meaning uses Gemini — <a href="#" data-set style="text-decoration:underline">add a free key</a>. Searching by words meanwhile.</p>'; $('[data-set]', list).onclick = e => { e.preventDefault(); openSettings('intel'); }; rows = keywordRank(pool, LIB.q).map(x => x.note); }
      else {
        const tok = ++semToken;
        list.innerHTML = `<div class="thinking" style="padding:24px 0"><span class="dots">${'<i></i>'.repeat(18)}</span><span>Searching by meaning…</span></div>`;
        try {
          const ranked = await semanticRank(pool, LIB.q);
          if (tok !== semToken) return;
          rows = ranked.filter(r => r.score > 0.3).map(r => r.note); scores = Object.fromEntries(ranked.map(r => [r.note.id, r.score]));
        } catch (e) { if (tok !== semToken) return; toast(e.message.slice(0, 120), 'err'); rows = keywordRank(pool, LIB.q).map(x => x.note); }
      }
    } else if (LIB.q.trim()) rows = keywordRank(pool, LIB.q).map(x => x.note);
    else rows = pool.sort((a, b) => (LIB.view === 'recent' ? b.updated - a.updated : (b.pinned - a.pinned) || (b.created - a.created)));
    const total = notes.length;
    const pinnedRows = !LIB.q && LIB.view === 'all' ? rows.filter(n => n.pinned) : [];
    const rest = rows.filter(n => !pinnedRows.includes(n));
    const row = n => {
      const num = total - notes.slice().sort((a, b) => b.created - a.created).findIndex(x => x.id === n.id);
      const prev = plainText(n.blocks, { numbers: false }).replace(/\n/g, ' · ');
      return `<a class="nrow" href="#/note/${n.id}">
        <span class="no"><b>№ ${pad(num).padStart(3, '0')}</b>${fmtDate(n.created)}</span>
        <span class="body"><span class="nt">${hl(titleOf(n), LIB.q)}${n.pinned ? '<span class="flag">● pinned</span>' : ''}</span>
        <span class="np">${hl(snippet(prev, LIB.q), LIB.q)}</span></span>
        <span class="nx"><span>${n.duration ? fmtDur(n.duration) + ' spoken' : 'written'}</span>${n.summary ? '<span class="red">✦ summary</span>' : ''}<span class="t">${(n.tags || []).slice(0, 3).map(t => '#' + esc(t)).join(' ')}</span>${scores ? `<span class="score">${Math.round(scores[n.id] * 100)}% match</span>` : ''}</span>
      </a>`;
    };
    list.innerHTML = (pinnedRows.length ? `<div class="lib-sec"><span>Pinned</span><span>${pinnedRows.length}</span></div>${pinnedRows.map(row).join('')}` : '') +
      `<div class="lib-sec"><span>${LIB.q ? 'Results' : LIB.view === 'archived' ? 'Archived' : LIB.view === 'recent' ? 'Recently edited' : 'All notes'}</span><span>${rest.length}</span></div>` +
      (rest.map(row).join('') || `<p class="empty">${LIB.q ? 'Nothing matches — try searching by meaning.' : 'Nothing here. Quiet, isn’t it.'}</p>`);
  };
  q.addEventListener('input', () => { LIB.q = q.value; clearTimeout(semT); semT = setTimeout(draw, LIB.mode === 'meaning' ? 550 : 0); });
  $$('[data-mode]').forEach(b => b.onclick = () => { LIB.mode = b.dataset.mode; $$('[data-mode]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $$('[data-view]').forEach(b => b.onclick = () => { LIB.view = b.dataset.view; $$('[data-view]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $$('[data-tag]').forEach(b => b.onclick = () => { LIB.tag = LIB.tag === b.dataset.tag ? '' : b.dataset.tag; $$('[data-tag]').forEach(x => x.classList.toggle('on', x.dataset.tag === LIB.tag)); draw(); });
  $('#dateF').onchange = e => { LIB.date = e.target.value; draw(); };
  await draw();
  if (params.q) q.focus();
}

function hl(text, q) {
  const t = esc(text);
  const words = (q || '').trim().split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length || LIB.mode === 'meaning') return t;
  return t.replace(new RegExp('(' + words.join('|') + ')', 'gi'), '<mark>$1</mark>');
}
function snippet(text, q) {
  const w = (q || '').trim().split(/\s+/)[0];
  if (!w || LIB.mode === 'meaning') return text.slice(0, 220);
  const i = text.toLowerCase().indexOf(w.toLowerCase());
  return i > 60 ? '…' + text.slice(i - 50, i + 170) : text.slice(0, 220);
}

const noteText = n => `${n.title || ''}\n${(n.tags || []).map(t => '#' + t).join(' ')}\n${plainText(n.blocks)}${n.summary?.text ? '\nSummary: ' + n.summary.text : ''}`;
const tokens = s => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1);
function keywordRank(pool, q) {
  const qt = tokens(q); if (!qt.length) return pool.map(note => ({ note, score: 0 }));
  return pool.map(note => {
    const t = tokens(noteText(note)); const tt = tokens(note.title || '');
    let s = 0;
    for (const w of qt) { s += t.filter(x => x.startsWith(w)).length; s += 3 * tt.filter(x => x.startsWith(w)).length; }
    return { note, score: s };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function chunksOf(n) {
  const text = noteText(n); const out = [];
  for (let i = 0; i < text.length; i += 1400) out.push((i ? `${n.title}\n…` : '') + text.slice(i, i + 1500));
  return out.length ? out : [n.title || ''];
}
async function ensureEmbeddings(pool) {
  const recs = {}; const todo = [];
  for (const n of pool) {
    const h = hash(noteText(n));
    const r = await store.getEmb(n.id).catch(() => null);
    if (r && r.hash === h) recs[n.id] = r; else todo.push({ n, h });
  }
  if (todo.length) {
    const texts = []; const map = [];
    todo.forEach(({ n }) => chunksOf(n).forEach(c => { texts.push(c); map.push(n.id); }));
    const { model, vectors } = await ai.embed(texts, 'RETRIEVAL_DOCUMENT');
    for (const { n, h } of todo) {
      const chunks = []; texts.forEach((t, i) => { if (map[i] === n.id) chunks.push({ text: t, v: vectors[i] }); });
      const rec = { id: n.id, hash: h, model, chunks };
      await store.putEmb(rec); recs[n.id] = rec;
    }
  }
  return recs;
}
async function semanticChunks(pool, q) {
  let recs = await ensureEmbeddings(pool);
  const { model, vectors } = await ai.embed([q], 'RETRIEVAL_QUERY');
  const stale = pool.filter(n => recs[n.id] && recs[n.id].model !== model);
  if (stale.length) { for (const n of stale) await store.putEmb({ id: n.id, hash: 0, model: '', chunks: [] }); recs = await ensureEmbeddings(pool); }
  const qv = vectors[0]; const out = [];
  for (const n of pool) (recs[n.id]?.chunks || []).forEach(c => out.push({ note: n, text: c.text, score: ai.cosine(qv, c.v) }));
  return out.sort((a, b) => b.score - a.score);
}
async function semanticRank(pool, q) {
  const ch = await semanticChunks(pool, q); const best = {};
  ch.forEach(c => { if (!best[c.note.id] || best[c.note.id].score < c.score) best[c.note.id] = c; });
  return Object.values(best).sort((a, b) => b.score - a.score);
}

// =====================================================================
// ASK MY NOTES
// =====================================================================
const ASK_LOG = [];
async function Ask() {
  const ex = ['What did I decide about my project last week?', 'List all the tasks I mentioned.', 'What were my ideas about the business?', 'Find the note where I talked about my internship.', 'What are the recurring problems I mention?'];
  view.innerHTML = `<section class="ask enter">
    <div class="page-head"><h1>Ask your <em>notes.</em></h1><div class="count">A quiet research<br>assistant</div></div>
    <div class="ask-log" id="askLog">
      ${ASK_LOG.length ? '' : `<div class="suggest">${ex.map((q, i) => `<button data-q="${esc(q)}"><span class="n">Q.${pad(i + 1)}</span><span>${esc(q)}</span></button>`).join('')}</div>`}
    </div>
    <div class="askbar"><div class="inner">
      <textarea id="askIn" rows="1" placeholder="Ask anything you’ve said…" aria-label="Ask your notes"></textarea>
      ${speechSupported ? `<button class="mic" id="askMic" aria-label="Ask by voice">${icon('mic')}</button>` : ''}
      <button id="askGo" aria-label="Ask">${icon('send')}</button>
    </div></div>
  </section>`;
  const log = $('#askLog'); const inp = $('#askIn');
  ASK_LOG.forEach(qa => log.appendChild(renderQA(qa)));
  $$('[data-q]').forEach(b => b.onclick = () => askNow(b.dataset.q));
  const fit = () => { inp.style.height = 'auto'; inp.style.height = Math.min(140, inp.scrollHeight) + 'px'; };
  inp.addEventListener('input', fit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askNow(inp.value); } });
  $('#askGo').onclick = () => askNow(inp.value);
  const mic = $('#askMic');
  if (mic) mic.onclick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const r = new SR();
    r.lang = getSettings().lang; r.interimResults = true;
    mic.classList.add('on');
    r.onresult = e => { inp.value = [...e.results].map(x => x[0].transcript).join(' '); fit(); if (e.results[e.results.length - 1].isFinal) askNow(inp.value); };
    r.onend = () => mic.classList.remove('on'); r.onerror = () => mic.classList.remove('on');
    r.start();
  };

  async function askNow(q) {
    q = (q || '').trim(); if (!q) return;
    inp.value = ''; fit();
    $('.suggest', log)?.remove();
    const qa = { q, n: ASK_LOG.length + 1, state: 'thinking' };
    ASK_LOG.push(qa);
    const el = renderQA(qa); log.appendChild(el); el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    const pool = (await store.allNotes()).filter(n => !n.archived && wordCount(n.blocks));
    try {
      if (!pool.length) throw Object.assign(new Error('You have no notes yet — record one first.'), { soft: true });
      let picked;
      if (ai.hasKey()) {
        let chunks;
        try { chunks = await semanticChunks(pool, q); }
        catch { chunks = keywordRank(pool, q).flatMap(x => chunksOf(x.note).slice(0, 2).map(text => ({ note: x.note, text }))); }
        const byNote = new Map();
        for (const c of chunks) { if (!byNote.has(c.note.id)) { if (byNote.size >= 6) continue; byNote.set(c.note.id, { note: c.note, texts: [] }); } const b = byNote.get(c.note.id); if (b.texts.length < 2) b.texts.push(c.text); }
        if (!byNote.size) pool.slice(0, 6).forEach(n => byNote.set(n.id, { note: n, texts: [chunksOf(n)[0]] }));
        picked = [...byNote.values()];
        const r = await ai.answer(q, picked.map(p => ({ title: titleOf(p.note), date: fmtDate(p.note.created, true), text: p.texts.join('\n').slice(0, 3000) })));
        qa.answer = r.answer || ''; qa.used = (r.used || []).map(Number);
        qa.sources = picked.map(p => ({ id: p.note.id, title: titleOf(p.note), date: fmtDate(p.note.created) }));
        qa.model = ai.lastModelUsed();
      } else {
        const kr = keywordRank(pool, q).slice(0, 6);
        qa.answer = kr.length ? 'These notes mention it. Add a free Gemini key in Settings and I’ll read them and answer properly.' : 'Nothing in your notes matches those words. Add a free Gemini key in Settings to search by meaning.';
        qa.sources = kr.map(x => ({ id: x.note.id, title: titleOf(x.note), date: fmtDate(x.note.created) })); qa.used = qa.sources.map((_, i) => i + 1);
      }
      qa.state = 'done';
    } catch (e) { qa.state = 'error'; qa.error = e.message; }
    const fresh = renderQA(qa); el.replaceWith(fresh); fresh.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function renderQA(qa) {
  const el = document.createElement('div'); el.className = 'qa';
  let a = '';
  if (qa.state === 'thinking') a = `<div class="thinking" style="margin-top:16px"><span class="dots">${'<i></i>'.repeat(18)}</span><span>Reading through your notes…</span></div>`;
  else if (qa.state === 'error') a = `<p class="err" style="margin-top:14px">${esc(qa.error)}</p>`;
  else {
    const src = qa.sources || [];
    const body = esc(qa.answer).replace(/\[(\d+)\]/g, (m, n) => { const s = src[+n - 1]; return s ? `<sup><a href="#/note/${s.id}">${n}</a></sup>` : m; })
      .split(/\n{2,}/).map(p => `<p>${p.split('\n').map(l => /^\s*[-•]\s+/.test(l) ? `<span class="li">${l.replace(/^\s*[-•]\s+/, '')}</span>` : l).join('<br>')}</p>`).join('');
    const used = src.map((s, i) => ({ ...s, k: i + 1 })).filter(s => !qa.used?.length || qa.used.includes(s.k));
    a = `<div class="a">${body}</div>${used.length ? `<div class="src"><p class="eyebrow" style="margin:12px 0 4px">Sources${qa.model ? ' · ' + esc(qa.model) : ''}</p>${used.map(s => `<a href="#/note/${s.id}"><span class="k">[${s.k}]</span><span>${esc(s.title)}</span><span class="d">${s.date}</span></a>`).join('')}</div>` : ''}`;
  }
  el.innerHTML = `<div class="q"><span class="n">Q.${pad(qa.n)}</span><span>${esc(qa.q)}</span></div>${a}`;
  return el;
}

// =====================================================================
// SHEET + SETTINGS
// =====================================================================
function openSheet(title, html, bind) {
  const wrap = $('#sheetWrap'); const sh = $('#sheet');
  sh.innerHTML = `<div class="sh-head"><h3>${title}</h3><button class="iconbtn" data-close aria-label="Close">${icon('close')}</button></div>${html}`;
  wrap.classList.add('show');
  $('[data-close]', sh).onclick = closeSheet;
  wrap.onclick = e => { if (e.target === wrap) closeSheet(); };
  if (bind) bind(sh);
}
function closeSheet() { $('#sheetWrap').classList.remove('show'); }

async function openSettings(focus) {
  if (focus && focus.preventDefault) focus = null;
  const s = getSettings();
  const voices = await deviceVoices().catch(() => []);
  const langs = [['en-IN', 'English (India)'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['hi-IN', 'हिन्दी Hindi'], ['kn-IN', 'ಕನ್ನಡ Kannada'], ['ta-IN', 'தமிழ் Tamil'], ['te-IN', 'తెలుగు Telugu'], ['ml-IN', 'മലയാളം Malayalam'], ['ja-JP', '日本語 Japanese']];
  const usage = await store.storageEstimate();
  const sw = (k, label, sub) => `<label class="switch"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}></label>`;
  const range = (k, label, min, max, step, fmt) => `<div class="field"><label>${label}<span class="val" data-v="${k}">${fmt(s[k])}</span></label><input type="range" data-r="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"></div>`;
  const fmts = { ttsRate: v => (+v).toFixed(2) + '×', ttsPitch: v => (+v).toFixed(2), ttsPause: v => v + ' ms', ttsWarmth: v => Math.round(v * 100) + '%' };
  openSheet('Settings', `
    <div class="set-sec" id="sec-intel"><h4><span class="n">01</span>Intelligence</h4>
      <div class="field"><label for="gk">Gemini API key</label>
        <div class="row"><input class="input" id="gk" type="password" placeholder="AIza…" value="${esc(s.geminiKey)}" autocomplete="off" spellcheck="false"><button class="btn solid" id="gkTest" style="min-height:44px">Test</button></div>
        <p class="help">Free from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>. Stored only on this device; notes are sent to Gemini only when you use an AI feature.</p></div>
      <div class="field"><label for="tm">Text model</label><select class="input" id="tm"><option value="auto">Auto — newest free Flash</option>${s.textModel !== 'auto' ? `<option value="${esc(s.textModel)}" selected>${esc(s.textModel)}</option>` : ''}</select><p class="help" id="tmHelp">Test your key to load the models it can use.</p></div>
      ${sw('autoMeta', 'Auto title, tags & summary', 'after each recording')}
    </div>
    <div class="set-sec"><h4><span class="n">02</span>Voice input</h4>
      <div class="field"><label for="lg">Dictation language</label><select class="input" id="lg">${langs.map(([v, l]) => `<option value="${v}" ${s.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${sw('spokenCommands', 'Spoken commands', 'say “comma”, “new line”, “next point”, “checkbox”…')}
      ${sw('keepAudio', 'Live waveform & keep original audio', 'turn off if dictation stops on your phone')}
      <button class="btn sm ghost" id="resetShare" style="margin:6px 0 14px">Re-check mic sharing</button>
    </div>
    <div class="set-sec"><h4><span class="n">03</span>Read aloud</h4>
      <div class="field"><span class="lbl">Voice engine</span><div class="seg" id="eng">${[['device', 'Device'], ['neural', 'Neural'], ['gemini', 'Gemini']].map(([v, l]) => `<button data-eng="${v}" class="${s.ttsEngine === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <p class="help" id="engHelp"></p></div>
      <div class="field" id="voiceField"></div>
      <div id="neuralBox"></div>
      ${range('ttsRate', 'Speed', 0.6, 1.4, 0.05, fmts.ttsRate)}
      <div id="pitchBox">${range('ttsPitch', 'Pitch', 0.6, 1.4, 0.05, fmts.ttsPitch)}</div>
      ${range('ttsPause', 'Pause between sentences', 0, 1400, 20, fmts.ttsPause)}
      <div id="warmBox">${range('ttsWarmth', 'Warmth (softens highs)', 0, 1, 0.05, fmts.ttsWarmth)}</div>
      <div class="field" id="delivBox"><label for="dl">Delivery</label><select class="input" id="dl">${[['soothing', 'Soothing — soft late-night calm'], ['whisper', 'Hushed — near-whisper'], ['neutral', 'Neutral'], ['bright', 'Bright & friendly']].map(([v, l]) => `<option value="${v}" ${s.ttsDelivery === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button class="btn solid" id="preview" style="width:100%;margin-bottom:16px">${icon('play')} Preview voice</button>
    </div>
    <div class="set-sec"><h4><span class="n">04</span>Appearance</h4>
      <div class="field"><span class="lbl">Theme</span><div class="seg">${[['paper', 'Paper'], ['ink', 'Ink']].map(([v, l]) => `<button data-theme="${v}" class="${s.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      ${sw('grain', 'Paper grain')}
      ${sw('reduceMotion', 'Reduce motion')}
    </div>
    <div class="set-sec"><h4><span class="n">05</span>Your data</h4>
      <p class="help">Everything lives on this device (${(usage / 1048576).toFixed(1)} MB used). Export regularly to keep a backup.</p>
      <div class="row gap" style="margin:12px 0 16px;flex-wrap:wrap"><button class="btn ghost sm" id="exp">${icon('download')} Export all</button><label class="btn ghost sm" style="cursor:pointer">${icon('upload')} Import<input type="file" id="imp" accept="application/json,.json" hidden></label><button class="btn danger sm" id="wipe">${icon('trash')} Erase everything</button></div>
    </div>
    <p class="help" style="padding:18px 0 0">${seal('sm')} &nbsp;Nothing AI · v1.0 · speak freely, think clearly, keep everything.</p>
  `, root => bindSettings(root, voices));
  if (focus === 'intel') setTimeout(() => $('#gk')?.focus(), 400);
}

function bindSettings(root, voices) {
  const s = getSettings();
  $$('[data-k]', root).forEach(i => i.onchange = () => setSetting(i.dataset.k, i.checked));
  $$('[data-r]', root).forEach(i => i.oninput = () => {
    const k = i.dataset.r; setSetting(k, parseFloat(i.value));
    const fm = { ttsRate: v => (+v).toFixed(2) + '×', ttsPitch: v => (+v).toFixed(2), ttsPause: v => v + ' ms', ttsWarmth: v => Math.round(v * 100) + '%' }[k];
    $(`[data-v="${k}"]`, root).textContent = fm(i.value);
    if (k === 'ttsRate') $('#plRate').textContent = (+i.value).toFixed(1) + '×';
  });
  const gk = $('#gk', root);
  gk.onchange = () => { setSetting('geminiKey', gk.value.trim()); };
  const loadModels = async () => {
    const help = $('#tmHelp', root);
    setSetting('geminiKey', gk.value.trim());
    if (!gk.value.trim()) { help.textContent = 'Paste a key first.'; return; }
    help.textContent = 'Checking…';
    try {
      const m = await ai.listModels(true);
      const sel = $('#tm', root);
      sel.innerHTML = `<option value="auto">Auto — ${esc(m.text[0]?.id || 'newest Flash')}</option>` + m.text.map(x => `<option value="${esc(x.id)}" ${s.textModel === x.id ? 'selected' : ''}>${esc(x.id)}</option>`).join('');
      help.innerHTML = `<span class="red">● Connected.</span> ${m.text.length} text · ${m.emb.length} embedding · ${m.tts.length} voice models available.`;
      toast('Gemini connected', 'ok');
    } catch (e) { help.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
  $('#gkTest', root).onclick = loadModels;
  if (s.geminiKey) ai.listModels().then(() => loadModels()).catch(() => {});
  $('#tm', root).onchange = e => setSetting('textModel', e.target.value);
  $('#lg', root).onchange = e => setSetting('lang', e.target.value);
  $('#dl', root).onchange = e => setSetting('ttsDelivery', e.target.value);
  $('#resetShare', root).onclick = () => { localStorage.removeItem('nai.nomicshare'); toast('Will try the live waveform again next recording'); };
  $$('[data-theme]', root).forEach(b => b.onclick = () => { setSetting('theme', b.dataset.theme); $$('[data-theme]', root).forEach(x => x.classList.toggle('on', x === b)); });

  const paintEngine = () => {
    const e = getSettings().ttsEngine;
    $$('[data-eng]', root).forEach(x => x.classList.toggle('on', x.dataset.eng === e));
    $('#engHelp', root).textContent = {
      device: 'Your device’s built-in voices. Instant and offline; quality depends on the phone.',
      neural: 'Kokoro — a neural voice that runs inside your browser. Soft and natural, free, private. One-time ~90 MB download.',
      gemini: 'Gemini studio voices with a soft delivery style — closest to a voice-assistant feel. Uses your free Gemini quota; needs internet.',
    }[e];
    let opts;
    if (e === 'device') opts = `<option value="">Auto — best English voice</option>` + voices.map(v => `<option value="${esc(v.voiceURI)}" ${getSettings().deviceVoice === v.voiceURI ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
    else if (e === 'neural') opts = NEURAL_VOICES.map(([v, l]) => `<option value="${v}" ${getSettings().neuralVoice === v ? 'selected' : ''}>${l}</option>`).join('');
    else opts = GEMINI_VOICES.map(([v, l]) => `<option value="${v}" ${getSettings().geminiVoice === v ? 'selected' : ''}>${l}</option>`).join('');
    $('#voiceField', root).innerHTML = `<label for="vc">Voice</label><select class="input" id="vc">${opts}</select>`;
    $('#vc', root).onchange = ev => setSetting({ device: 'deviceVoice', neural: 'neuralVoice', gemini: 'geminiVoice' }[e], ev.target.value);
    $('#pitchBox', root).hidden = e !== 'device';
    $('#warmBox', root).hidden = e === 'device';
    $('#delivBox', root).hidden = e !== 'gemini';
    const nb = $('#neuralBox', root);
    if (e === 'neural') {
      const st = neuralStatus();
      nb.innerHTML = st === 'ready' ? '<p class="help"><span class="red">●</span> Neural voice ready on this device.</p>' :
        `<div class="field"><button class="btn ghost sm" id="nload">${icon('download')} ${st === 'loading' ? 'Downloading…' : 'Download neural voice (~90 MB)'}</button><div class="progress"><i id="nprog" style="width:0"></i></div></div>`;
      const nl = $('#nload', root);
      if (nl) nl.onclick = () => { nl.textContent = 'Downloading…'; loadNeural().then(() => { toast('Neural voice ready', 'ok'); paintEngine(); }).catch(err => { toast('Couldn’t load neural voice: ' + err.message.slice(0, 80), 'err'); paintEngine(); }); };
    } else nb.innerHTML = '';
    if (e === 'gemini' && !ai.hasKey()) $('#engHelp', root).innerHTML += ' <span class="err">Add your key above first.</span>';
  };
  $$('[data-eng]', root).forEach(b => b.onclick = () => { setSetting('ttsEngine', b.dataset.eng); reader.stop(); paintEngine(); });
  paintEngine();
  const onProg = e => { const p = $('#nprog'); if (p) p.style.width = e.detail + '%'; };
  document.addEventListener('neural-progress', onProg);
  $('#preview', root).onclick = () => reader.play([{ id: '_pv', text: 'Hello. This is how your notes will sound. Take a breath — there’s no rush.' }], 'Voice preview');

  $('#exp', root).onclick = async () => { download(`nothing-ai-backup-${fmtDate(Date.now()).replace(/\./g, '')}.json`, JSON.stringify(await store.exportAll(), null, 1), 'application/json'); };
  $('#imp', root).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = await store.importAll(JSON.parse(await f.text())); toast(`Imported ${n} notes`, 'ok'); closeSheet(); route(); }
    catch (err) { toast(err.message, 'err'); }
  };
  $('#wipe', root).onclick = async () => {
    if (!(await confirmSheet('Erase everything?', 'All notes, audio and AI data on this device will be deleted. Export first if you want a backup.', 'Erase all', true))) return;
    await store.wipeAll(); toast('Everything erased'); closeSheet(); go('#/');
  };
}

// =====================================================================
// PLAYER
// =====================================================================
function bindPlayer() {
  const P = $('#player');
  $('#plBack').innerHTML = icon('skipb'); $('#plFwd').innerHTML = icon('skipf'); $('#plStop').innerHTML = icon('close'); $('#plPlay').innerHTML = icon('pause');
  $('#plRate').textContent = getSettings().ttsRate.toFixed(1) + '×';
  $('#plPlay').onclick = () => reader.toggle();
  $('#plBack').onclick = () => reader.skip(-1);
  $('#plFwd').onclick = () => reader.skip(1);
  $('#plStop').onclick = () => reader.stop();
  const rates = [0.8, 0.9, 1, 1.15, 1.3];
  $('#plRate').onclick = () => {
    const cur = getSettings().ttsRate; const next = rates.find(r => r > cur + 0.01) || rates[0];
    setSetting('ttsRate', next); $('#plRate').textContent = next.toFixed(1) + '×';
    if (getSettings().ttsEngine !== 'gemini') reader.skip(0);
  };
  reader.on(info => {
    if (info.error) toast(info.error, 'err');
    const show = info.state !== 'idle' || (info.loading && !info.done);
    P.classList.toggle('show', show && !info.done);
    P.classList.toggle('paused', info.state === 'paused');
    $('#plPlay').innerHTML = icon(info.state === 'paused' ? 'play' : 'pause');
    $('#plLine').textContent = info.loading ? (info.message || 'Preparing voice…') : info.text;
    $('#plMeta').textContent = `${info.title ? info.title.slice(0, 28) + ' · ' : ''}${pad(info.index + 1)}/${pad(info.total)}`;
    $('#plProg').style.width = info.total ? ((info.index + (info.done ? 1 : 0.5)) / info.total * 100) + '%' : '0';
    if (currentNoteEditor) currentNoteEditor.editor.highlight(info.state === 'idle' ? null : info.id);
  });
  document.addEventListener('neural-progress', e => { if (reader.state !== 'idle') $('#plLine').textContent = `Downloading neural voice · ${e.detail}%`; });
}

// =====================================================================
// SHORTCUTS
// =====================================================================
function shortcuts() {
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { closeSheet(); return; }
    const r = parseHash().parts[0];
    if (r === 'record') return; // studio has its own keys
    const map = { r: '#/record', n: '#/notes', a: '#/ask', i: '#/' };
    if (map[e.key]) { e.preventDefault(); go(map[e.key]); }
    if (e.key === '/') { e.preventDefault(); go('#/notes?q=1'); }
    if (e.key === ',') { e.preventDefault(); openSettings(); }
  });
  document.addEventListener('click', e => { const a = e.target.closest('[data-set]'); if (a && !a.onclick) { e.preventDefault(); openSettings('intel'); } });
}

boot();
