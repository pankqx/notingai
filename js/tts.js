// Read aloud with three engines:
//  device — the phone/laptop's own voices (instant, offline)
//  neural — Kokoro, a neural voice model running in the browser (soft & natural, free, ~90 MB once)
//  gemini — Gemini's studio voices with a "how to say it" style prompt (closest to voice-mode feel)
import { getSettings } from './store.js';
import * as ai from './ai.js';

export const NEURAL_VOICES = [
  ['af_heart', 'Heart — warm, gentle (F)'], ['af_nicole', 'Nicole — hushed, soft (F)'], ['af_bella', 'Bella — bright, kind (F)'],
  ['af_sky', 'Sky — airy (F)'], ['af_sarah', 'Sarah — calm (F)'], ['af_nova', 'Nova — clear (F)'], ['af_river', 'River — relaxed (F)'],
  ['bf_emma', 'Emma — British, soft (F)'], ['bf_isabella', 'Isabella — British (F)'],
  ['am_michael', 'Michael — deep, steady (M)'], ['am_liam', 'Liam — easy (M)'], ['am_fenrir', 'Fenrir — low (M)'],
  ['bm_george', 'George — British, warm (M)'], ['bm_fable', 'Fable — storyteller (M)'],
];
export const GEMINI_VOICES = [
  ['Achernar', 'Achernar — soft'], ['Vindemiatrix', 'Vindemiatrix — gentle'], ['Sulafat', 'Sulafat — warm'],
  ['Despina', 'Despina — smooth'], ['Enceladus', 'Enceladus — breathy'], ['Aoede', 'Aoede — breezy'],
  ['Callirrhoe', 'Callirrhoe — easy-going'], ['Algieba', 'Algieba — smooth (M)'], ['Achird', 'Achird — friendly (M)'],
  ['Umbriel', 'Umbriel — easy-going (M)'], ['Charon', 'Charon — informative (M)'], ['Kore', 'Kore — firm'], ['Zephyr', 'Zephyr — bright'],
];
export const DELIVERY = {
  soothing: 'Read the following aloud in a soft, calm, warm and unhurried voice — like a gentle late-night radio host. Leave natural breaths between sentences:',
  neutral: 'Read the following aloud naturally and clearly:',
  bright: 'Read the following aloud in a bright, friendly, lightly smiling voice:',
  whisper: 'Read the following aloud in a very soft, close, intimate near-whisper, slow and soothing:',
};

export function deviceVoices() {
  return new Promise(res => {
    const v = speechSynthesis.getVoices();
    if (v.length) return res(v);
    const t = setTimeout(() => res(speechSynthesis.getVoices()), 1200);
    speechSynthesis.onvoiceschanged = () => { clearTimeout(t); res(speechSynthesis.getVoices()); };
  });
}

// split into sentence-sized segments, keeping the block id so the editor can highlight what's being read
export function segment(items, maxLen = 260) {
  const out = [];
  for (const it of items) {
    const parts = (it.text || '').replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]+["”’)]*|[^.!?…]+$/g) || [];
    let buf = '';
    for (const p of parts.map(s => s.trim()).filter(Boolean)) {
      if (buf && (buf + ' ' + p).length > maxLen) { out.push({ id: it.id, text: buf }); buf = p; }
      else buf = buf ? buf + ' ' + p : p;
    }
    if (buf) out.push({ id: it.id, text: buf, end: true });
  }
  return out;
}

// ---------- Kokoro worker ----------
let worker = null; let reqId = 0; const pending = new Map();
let neuralState = 'idle'; // idle | loading | ready | error
const progressFiles = {};
export const neuralStatus = () => neuralState;

function getWorker(onProgress) {
  if (!worker) {
    worker = new Worker(new URL('./kokoro-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') {
        progressFiles[m.file] = [m.loaded, m.total];
        const vals = Object.values(progressFiles);
        const pct = Math.round(100 * vals.reduce((a, v) => a + v[0], 0) / Math.max(1, vals.reduce((a, v) => a + v[1], 0)));
        document.dispatchEvent(new CustomEvent('neural-progress', { detail: pct }));
        return;
      }
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      if (m.type === 'error') { neuralState = 'error'; p.reject(new Error(m.message)); }
      else { neuralState = 'ready'; p.resolve(m); }
    };
  }
  return worker;
}
function callWorker(msg) {
  const id = ++reqId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); getWorker().postMessage({ id, ...msg }); });
}
export async function loadNeural() {
  if (neuralState === 'ready') return;
  neuralState = 'loading';
  document.dispatchEvent(new CustomEvent('neural-progress', { detail: 0 }));
  await callWorker({ type: 'load' });
  neuralState = 'ready';
  document.dispatchEvent(new CustomEvent('neural-progress', { detail: 100 }));
}

// ---------- player ----------
class Reader {
  constructor() { this.segs = []; this.i = 0; this.state = 'idle'; this.listeners = new Set(); this.token = 0; this.cache = new Map(); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(extra = {}) {
    const s = this.segs[this.i];
    const info = { state: this.state, index: this.i, total: this.segs.length, id: s?.id, text: s?.text || '', title: this.title, ...extra };
    this.listeners.forEach(f => f(info));
  }

  async play(items, title = '') {
    this.stop();
    this.segs = segment(items, getSettings().ttsEngine === 'gemini' ? 520 : 240);
    this.title = title; this.i = 0;
    if (!this.segs.length) return;
    this.state = 'playing';
    this.run(++this.token);
  }

  ctx() {
    if (!this.ac) {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.low = this.ac.createBiquadFilter(); this.low.type = 'lowpass';
      this.shelf = this.ac.createBiquadFilter(); this.shelf.type = 'lowshelf'; this.shelf.frequency.value = 240;
      this.gain = this.ac.createGain(); this.gain.gain.value = 0.92;
      this.low.connect(this.shelf); this.shelf.connect(this.gain); this.gain.connect(this.ac.destination);
    }
    const w = getSettings().ttsWarmth;
    this.low.frequency.value = 16000 - w * 11000;
    this.shelf.gain.value = w * 4;
    return this.ac;
  }

  async synth(seg) {
    const s = getSettings();
    const key = `${s.ttsEngine}|${s.ttsEngine === 'neural' ? s.neuralVoice + s.ttsRate : s.geminiVoice + s.ttsDelivery}|${seg.text}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let p;
    if (s.ttsEngine === 'neural') {
      if (neuralState !== 'ready') this.emit({ loading: true, message: 'Preparing neural voice…' });
      p = loadNeural().then(() => callWorker({ type: 'speak', text: seg.text, voice: s.neuralVoice, speed: s.ttsRate }));
    } else {
      p = ai.speak(seg.text, s.geminiVoice, DELIVERY[s.ttsDelivery]);
    }
    p = p.catch(e => { this.cache.delete(key); throw e; });
    this.cache.set(key, p);
    if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
    return p;
  }

  async run(token) {
    const s = getSettings();
    while (token === this.token && this.i < this.segs.length) {
      if (this.state === 'paused') { await new Promise(r => (this._wake = r)); if (token !== this.token) return; }
      const seg = this.segs[this.i];
      this.emit();
      try {
        if (s.ttsEngine === 'device') await this.speakDevice(seg, token);
        else {
          const out = this.synth(seg);
          for (let k = 1; k <= 2; k++) if (this.segs[this.i + k]) this.synth(this.segs[this.i + k]).catch(() => {});
          const { audio, rate } = await out;
          if (token !== this.token) return;
          await this.playBuffer(audio, rate, token);
        }
      } catch (e) {
        if (token !== this.token) return;
        this.state = 'idle';
        this.emit({ error: friendly(e) });
        return;
      }
      if (token !== this.token) return;
      const gap = s.ttsPause * (seg.end ? 1.8 : 1);
      await wait(gap);
      if (this.state === 'paused') continue;
      this.i++;
    }
    if (token === this.token) { this.state = 'idle'; this.i = Math.max(0, this.segs.length - 1); this.emit({ done: true }); }
  }

  speakDevice(seg, token) {
    const s = getSettings();
    return new Promise(async (resolve, reject) => {
      const u = new SpeechSynthesisUtterance(seg.text);
      const voices = await deviceVoices();
      const v = voices.find(x => x.voiceURI === s.deviceVoice) || voices.find(x => /en[-_]IN/i.test(x.lang)) || voices.find(x => /^en/i.test(x.lang));
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = s.ttsRate; u.pitch = s.ttsPitch; u.volume = 1;
      u.onend = () => resolve();
      u.onerror = e => (e.error === 'interrupted' || e.error === 'canceled') ? resolve() : reject(new Error(e.error));
      this._utter = u;
      speechSynthesis.speak(u);
    });
  }

  playBuffer(audio, rate, token) {
    const ac = this.ctx();
    if (ac.state === 'suspended' && this.state === 'playing') ac.resume();
    const buf = ac.createBuffer(1, audio.length, rate);
    buf.copyToChannel(audio instanceof Float32Array ? audio : new Float32Array(audio), 0);
    const src = ac.createBufferSource();
    src.buffer = buf;
    if (getSettings().ttsEngine === 'gemini') src.playbackRate.value = getSettings().ttsRate;
    src.connect(this.low);
    this.src = src;
    return new Promise(res => { src.onended = () => res(); src.start(); });
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (getSettings().ttsEngine === 'device') speechSynthesis.cancel(); // Android can't reliably pause; we restart the sentence
    else if (this.ac) this.ac.suspend();
    this.emit();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    if (this._wake) { const w = this._wake; this._wake = null; w(); }
    else if (getSettings().ttsEngine === 'device') { this.run(++this.token); }
    this.emit();
  }
  toggle() { this.state === 'playing' ? this.pause() : this.resume(); }
  skip(d) {
    if (!this.segs.length) return;
    this.i = Math.max(0, Math.min(this.segs.length - 1, this.i + d));
    this.state = 'playing';
    this.halt();
    this.run(++this.token);
  }
  halt() {
    try { speechSynthesis.cancel(); } catch {}
    if (this.src) { try { this.src.onended = null; this.src.stop(); } catch {} this.src = null; }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    if (this._wake) { const w = this._wake; this._wake = null; w(); }
  }
  stop() {
    this.token++;
    this.halt();
    const was = this.state; this.state = 'idle';
    if (was !== 'idle') this.emit({ done: true });
  }
}

function friendly(e) {
  const m = String(e && e.message || e);
  if (/quota|429|rate/i.test(m)) return 'Gemini voice quota reached for now — switch to Neural or Device voice in Settings.';
  if (/key/i.test(m)) return 'Gemini voice needs your API key (Settings → Intelligence).';
  return m.slice(0, 160);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

export const reader = new Reader();
