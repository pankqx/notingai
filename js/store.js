// Nothing AI — on-device storage (IndexedDB). Notes, original audio, embeddings.
const DB_NAME = 'nothing-ai';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      if (!db.objectStoreNames.contains('emb')) db.createObjectStore('emb', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// in-memory cache of notes for instant search
let cache = null;

export async function allNotes() {
  if (cache) return cache.slice();
  const list = await tx('notes', 'readonly', s => s.getAll());
  cache = list || [];
  return cache.slice();
}

export async function getNote(id) {
  const list = await allNotes();
  return list.find(n => n.id === id) || null;
}

export async function saveNote(note) {
  note.updated = Date.now();
  await tx('notes', 'readwrite', s => s.put(note));
  if (cache) {
    const i = cache.findIndex(n => n.id === note.id);
    if (i >= 0) cache[i] = note; else cache.push(note);
  }
  return note;
}

export async function deleteNote(id) {
  await tx('notes', 'readwrite', s => s.delete(id));
  await tx('audio', 'readwrite', s => s.delete(id)).catch(() => {});
  await tx('emb', 'readwrite', s => s.delete(id)).catch(() => {});
  if (cache) cache = cache.filter(n => n.id !== id);
}

export const saveAudio = (id, blob) => tx('audio', 'readwrite', s => s.put(blob, id));
export const getAudio = id => tx('audio', 'readonly', s => s.get(id));

export const getEmb = id => tx('emb', 'readonly', s => s.get(id));
export const putEmb = rec => tx('emb', 'readwrite', s => s.put(rec));

export function newNote(partial = {}) {
  const now = Date.now();
  return {
    id: uid(), title: '', blocks: [], original: [], tags: [], pinned: false, archived: false,
    created: now, updated: now, duration: 0, summary: null, history: [], hasAudio: false,
    ...partial,
  };
}

export async function exportAll() {
  const notes = await allNotes();
  return { app: 'nothing-ai', version: 1, exported: new Date().toISOString(), notes };
}

export async function importAll(data) {
  if (!data || !Array.isArray(data.notes)) throw new Error('Not a Nothing AI export file');
  let n = 0;
  for (const note of data.notes) {
    if (!note.id || !Array.isArray(note.blocks)) continue;
    await tx('notes', 'readwrite', s => s.put(note));
    n++;
  }
  cache = null;
  return n;
}

export async function wipeAll() {
  for (const st of ['notes', 'audio', 'emb']) await tx(st, 'readwrite', s => s.clear());
  cache = [];
}

export async function storageEstimate() {
  try { const e = await navigator.storage.estimate(); return e.usage || 0; } catch { return 0; }
}

// ---------- settings (localStorage) ----------
const DEFAULTS = {
  geminiKey: '', textModel: 'auto', autoMeta: true,
  lang: 'en-IN', spokenCommands: true, keepAudio: true,
  ttsEngine: 'device', deviceVoice: '', neuralVoice: 'af_heart', geminiVoice: 'Achernar',
  ttsRate: 0.95, ttsPitch: 1, ttsPause: 380, ttsWarmth: 0.55, ttsDelivery: 'soothing',
  theme: 'paper', grain: true, reduceMotion: false, seeded: false,
};
let settings = null;
export function getSettings() {
  if (!settings) {
    try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('nai.settings') || '{}') }; }
    catch { settings = { ...DEFAULTS }; }
  }
  return settings;
}
export function setSetting(k, v) {
  getSettings()[k] = v;
  try { localStorage.setItem('nai.settings', JSON.stringify(settings)); } catch {}
  document.dispatchEvent(new CustomEvent('settings', { detail: { k, v } }));
}
