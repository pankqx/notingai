// Gemini (free tier) — text tools, embeddings for "ask my notes", and TTS.
// Model names change often, so we discover them from the API and fall back down a ranked list.
import { getSettings } from './store.js';
import { plainText } from './blocks.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
let modelCache = null;

export const hasKey = () => !!getSettings().geminiKey;

function ver(name) {
  const m = name.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

export async function listModels(force = false) {
  if (modelCache && !force) return modelCache;
  const key = getSettings().geminiKey;
  if (!key) throw new Error('Add your Gemini API key in Settings → Intelligence');
  const res = await fetch(`${BASE}/models?pageSize=1000&key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(await errText(res));
  const data = await res.json();
  const all = (data.models || []).map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name, methods: m.supportedGenerationMethods || [] }));
  const isText = m => m.methods.includes('generateContent') && /gemini/.test(m.id) && !/(tts|live|image|audio|embedding|banana|omni|veo|imagen|robotics|computer|learnlm|gemma|aqa|translate|vision)/.test(m.id);
  const text = all.filter(isText).sort((a, b) => score(b.id) - score(a.id));
  const emb = all.filter(m => m.methods.includes('embedContent') || /embedding/.test(m.id)).sort((a, b) => ver(b.id) - ver(a.id) || (/gemini/.test(b.id) - /gemini/.test(a.id)));
  const tts = all.filter(m => /tts/.test(m.id)).sort((a, b) => score(b.id) - score(a.id));
  modelCache = { text, emb, tts };
  return modelCache;
}

// Prefer fast "flash" models, newest first; lite models next; pro last (free tier is tight on pro).
function score(id) {
  let s = ver(id) * 10;
  if (/flash/.test(id)) s += 100;
  if (/lite/.test(id)) s -= 30;
  if (/pro/.test(id)) s -= 60;
  if (/(preview|exp)/.test(id)) s -= 8;
  if (/-\d{2,}$|\d{4}/.test(id)) s -= 4;
  if (/latest/.test(id)) s += 2;
  return s;
}

async function errText(res) {
  try { const j = await res.json(); return j.error?.message || res.statusText; } catch { return res.statusText || 'Request failed'; }
}

const deadModels = new Set();
let lastModel = '';
export const lastModelUsed = () => lastModel;

async function candidates(kind) {
  const s = getSettings();
  const list = await listModels();
  const ids = list[kind].map(m => m.id).filter(id => !deadModels.has(id));
  if (kind === 'text' && s.textModel && s.textModel !== 'auto') return [s.textModel, ...ids.filter(i => i !== s.textModel)];
  if (!ids.length) {
    if (kind === 'text') return ['gemini-flash-latest', 'gemini-2.5-flash'];
    if (kind === 'emb') return ['gemini-embedding-001', 'text-embedding-004'];
    if (kind === 'tts') return ['gemini-2.5-flash-preview-tts'];
  }
  return ids;
}

async function withFallback(kind, fn) {
  const ids = (await candidates(kind)).slice(0, 6);
  let lastErr;
  for (const id of ids) {
    try { const r = await fn(id); lastModel = id; return r; }
    catch (e) {
      lastErr = e;
      // move on for missing models / no free quota / overload; stop for bad key or bad input
      if (e.status && [400, 401].includes(e.status) && !/model|not supported|not found/i.test(e.message)) throw e;
      if (e.status === 404 || e.status === 403 || /quota|limit: 0|not found|not supported/i.test(e.message)) deadModels.add(id);
    }
  }
  throw lastErr || new Error('No Gemini model available');
}

async function post(path, body) {
  const key = getSettings().geminiKey;
  const res = await fetch(`${BASE}/${path}?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) { const e = new Error(await errText(res)); e.status = res.status; throw e; }
  return res.json();
}

const SYSTEM = `You are the quiet editor inside "Nothing AI", a voice note app. Notes are dictated speech, so expect missing punctuation and filler words. Never invent facts. Keep the user's own vocabulary and voice. Reply with JSON only.`;

export async function json(prompt, { temperature = 0.4 } = {}) {
  return withFallback('text', async model => {
    const data = await post(`models/${model}:generateContent`, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, responseMimeType: 'application/json' },
    });
    const txt = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!txt) throw new Error(data.promptFeedback?.blockReason ? 'Blocked: ' + data.promptFeedback.blockReason : 'Empty response');
    try { return JSON.parse(txt.replace(/^```json\s*|```$/g, '')); }
    catch { const m = txt.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Could not read AI response'); }
  });
}

const BLOCK_SPEC = `Blocks are objects {"type": one of "p" (paragraph) | "h" (heading) | "ol" (numbered item) | "ul" (bullet) | "todo" (checkbox item, add "checked": boolean) | "quote", "text": string}.`;
const asJSONBlocks = blocks => JSON.stringify(blocks.map(b => ({ type: b.type, text: b.text, ...(b.type === 'todo' ? { checked: !!b.checked } : {}) })));

export const tools = {
  async cleanup(note) {
    return json(`Clean up this dictated note. Fix grammar, punctuation, capitalisation and sentence breaks. Remove filler words (um, uh, like, you know) and accidental repeats. Preserve meaning, vocabulary, tone and the block structure (keep lists as lists). Do not summarise or add content.
${BLOCK_SPEC}
Return {"blocks": [...]}.
Note blocks: ${asJSONBlocks(note.blocks)}`, { temperature: 0.2 });
  },
  async summary(note) {
    return json(`Summarise this note. Return {"summary": "2-3 sentence summary in plain language", "points": ["3-6 key points, short"]}.
Title: ${note.title || '(none)'}
Note:
${plainText(note.blocks)}`);
  },
  async checklist(note) {
    return json(`Turn this spoken note into a clear, actionable checklist. Each item starts with a verb when possible, short, no duplicates. Return {"items": ["..."]}.
Note:
${plainText(note.blocks)}`);
  },
  async actions(note) {
    return json(`Extract only the concrete action items / tasks / commitments mentioned in this note (who/what/when if stated). If none, return an empty list. Return {"items": [{"text": "...", "when": "optional due date or time as said, else empty"}]}.
Note:
${plainText(note.blocks)}`);
  },
  async titles(note) {
    return json(`Suggest 3 meaningful, specific titles for this note (max 7 words each, no quotes, no emojis, Title Case not required). Return {"titles": ["..","..",".."]}.
Note:
${plainText(note.blocks).slice(0, 6000)}`, { temperature: 0.7 });
  },
  async tags(note) {
    return json(`Suggest up to 5 short topic tags for this note: lowercase, 1-2 words, no '#'. Return {"tags": ["..."]}.
Existing tags: ${(note.tags || []).join(', ') || 'none'}
Note:
${plainText(note.blocks).slice(0, 6000)}`);
  },
  async tone(note, tone) {
    const guide = {
      professional: 'clear, polished and professional, suitable to share at work',
      casual: 'relaxed, friendly and conversational',
      concise: 'as short as possible while keeping every important point',
      detailed: 'fuller and more explanatory, expanding on points that are already there (no new facts)',
      creative: 'vivid, expressive and a little playful, like a well-written journal entry',
    }[tone] || tone;
    return json(`Rewrite this note so it reads ${guide}. Keep the facts. You may change structure if it helps.
${BLOCK_SPEC}
Return {"blocks": [...]}.
Note blocks: ${asJSONBlocks(note.blocks)}`, { temperature: 0.6 });
  },
  async meta(note) {
    return json(`For this freshly dictated note return {"title": "specific title, max 7 words", "tags": ["up to 4 lowercase topic tags"], "summary": "1-2 sentence summary", "points": ["2-4 key points"]}.
Note:
${plainText(note.blocks).slice(0, 8000)}`, { temperature: 0.4 });
  },
};

// ---------- embeddings ----------
export async function embed(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  return withFallback('emb', async model => {
    const out = [];
    for (let i = 0; i < texts.length; i += 90) {
      const chunk = texts.slice(i, i + 90);
      const data = await post(`models/${model}:batchEmbedContents`, {
        requests: chunk.map(t => ({ model: `models/${model}`, content: { parts: [{ text: t.slice(0, 8000) }] }, taskType })),
      });
      (data.embeddings || []).forEach(e => out.push(e.values));
    }
    if (out.length !== texts.length) throw new Error('Embedding count mismatch');
    return { model, vectors: out };
  });
}

export function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function answer(question, sources) {
  const ctx = sources.map((s, i) => `[${i + 1}] "${s.title}" (${s.date})\n${s.text}`).join('\n\n');
  return json(`Answer the question using ONLY the user's notes below. Be warm, brief and precise. Cite notes inline like [1] or [2][3]. If the notes do not contain the answer, say so plainly. For list questions use short lines starting with "- ".
Return {"answer": "text with [n] citations", "used": [numbers of notes you used]}.

Question: ${question}

Notes:
${ctx}`, { temperature: 0.3 });
}

// ---------- TTS ----------
export async function speak(text, voice, style) {
  return withFallback('tts', async model => {
    const data = await post(`models/${model}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: style ? `${style}\n\n${text}` : text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
    const part = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
    if (!part) throw new Error('No audio returned');
    const rate = parseInt((part.inlineData.mimeType.match(/rate=(\d+)/) || [])[1] || '24000', 10);
    const bin = atob(part.inlineData.data);
    const n = bin.length >> 1;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      if (v >= 32768) v -= 65536;
      pcm[i] = v / 32768;
    }
    return { audio: pcm, rate };
  });
}
