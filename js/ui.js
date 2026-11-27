// Small UI helpers: icons, dot-matrix type, toasts, formatting.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const P = {
  mic: '<rect x="9" y="3" width="6" height="11"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  pin: '<path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/>',
  search: '<path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 21 21"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><path d="M14 4v4M8 10v4M16 16v4"/>',
  back: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
  spark: '<path d="M12 3v18M3 12h18M12 3c0 5 4 9 9 9-5 0-9 4-9 9 0-5-4-9-9-9 5 0 9-4 9-9z" stroke-width="1"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  archive: '<path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>',
  copy: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
  send: '<path d="M5 19 19 5M9 5h10v10"/>',
  skipb: '<path d="M18 6v12l-9-6zM6 6v12"/>',
  skipf: '<path d="M6 6v12l9-6zM18 6v12"/>',
  home: '<path d="M3 11 12 4l9 7M5 10v10h14V10"/>',
  notes: '<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h3"/>',
  ask: '<path d="M4 4h16v12H9l-5 4zM9 9h6M9 12h4"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2"/>',
};
export const icon = (n, cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${P[n] || ''}</svg>`;

// 5×7 dot-matrix glyphs
const G = {
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};
// returns {w, h, dots:[{x,y,on}]} in grid units
export function dotGrid(text) {
  const dots = []; let x = 0;
  for (const ch of text.toUpperCase()) {
    const g = G[ch] || G[' '];
    g.forEach((row, y) => [...row].forEach((v, i) => dots.push({ x: x + i, y, on: v === '1' })));
    x += g[0].length + 1;
  }
  return { w: x - 1, h: 7, dots };
}
export function dotSVG(text, { size = 4, gap = 1.6, cls = '', faint = true } = {}) {
  const { w, h, dots } = dotGrid(text);
  const u = size + gap;
  const r = size / 2;
  const c = dots.filter(d => d.on || faint).map(d =>
    `<circle cx="${d.x * u + r}" cy="${d.y * u + r}" r="${d.on ? r : r * 0.42}" class="${d.on ? 'on' : 'off'}"/>`).join('');
  return `<svg class="dotword ${cls}" viewBox="0 0 ${(w - 1) * u + size} ${(h - 1) * u + size}" aria-label="${text}" role="img">${c}</svg>`;
}

export function wordmark() {
  return `<a class="wordmark" href="#/" aria-label="Nothing AI home">${dotSVG('NOTHING', { size: 3, gap: 1.2 })}<span class="wm-ai">ai</span></a>`;
}

export const seal = (cls = '') => `<span class="seal ${cls}" aria-hidden="true">無</span>`;

let toastT;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.innerHTML = `<span class="t-dot ${kind}"></span><span>${msg}</span>`;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const pad = n => String(n).padStart(2, '0');
export function fmtDate(ts, long = false) {
  const d = new Date(ts);
  if (long) return `${DAY[d.getDay()]} ${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}
export const fmtTime = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtDur = s => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
export function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return fmtDate(ts);
}

export function confirmSheet(title, body, okLabel = 'Confirm', danger = false) {
  return new Promise(res => {
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
      <p class="eyebrow">Confirm</p><h3>${title}</h3><p class="muted">${body}</p>
      <div class="row gap"><button class="btn ghost" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'solid'}" data-ok>${okLabel}</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const done = v => { el.classList.remove('show'); setTimeout(() => el.remove(), 220); res(v); };
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-no]')) done(false); if (e.target.closest('[data-ok]')) done(true); });
  });
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const reduced = () => document.documentElement.classList.contains('calm');
