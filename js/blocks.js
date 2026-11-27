// Block document model shared by the recording studio and the editor.
// Block: { id, type: 'p'|'h'|'ol'|'ul'|'todo'|'quote', text, checked?, ai? }
import { uid } from './store.js';

export const TYPES = ['p', 'h', 'ol', 'ul', 'todo', 'quote'];
export const LIST_TYPES = ['ol', 'ul', 'todo'];

export const blk = (type = 'p', text = '', extra = {}) => ({ id: uid(), type, text, ...extra });
export const clone = blocks => blocks.map(b => ({ ...b }));

export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Number for an ordered-list block = its position within the consecutive run of 'ol' blocks.
export function olNumber(blocks, i) {
  let n = 0;
  for (let j = i; j >= 0 && blocks[j].type === 'ol'; j--) n++;
  return n;
}

export function marker(blocks, i) {
  const b = blocks[i];
  switch (b.type) {
    case 'ol': return String(olNumber(blocks, i)).padStart(2, '0') + '.';
    case 'ul': return '—';
    case 'todo': return '';
    case 'quote': return '“';
    default: return '';
  }
}

export function plainText(blocks, { numbers = true } = {}) {
  return blocks.map((b, i) => {
    const t = b.text || '';
    if (b.type === 'ol') return (numbers ? olNumber(blocks, i) + '. ' : '') + t;
    if (b.type === 'ul') return '• ' + t;
    if (b.type === 'todo') return (b.checked ? '[x] ' : '[ ] ') + t;
    if (b.type === 'quote') return '“' + t + '”';
    return t;
  }).filter(Boolean).join('\n');
}

export function toMarkdown(title, blocks) {
  const body = blocks.map((b, i) => {
    const t = b.text || '';
    if (b.type === 'h') return '\n## ' + t;
    if (b.type === 'ol') return olNumber(blocks, i) + '. ' + t;
    if (b.type === 'ul') return '- ' + t;
    if (b.type === 'todo') return (b.checked ? '- [x] ' : '- [ ] ') + t;
    if (b.type === 'quote') return '> ' + t;
    return '\n' + t;
  }).join('\n');
  return `# ${title || 'Untitled thought'}\n${body}\n`;
}

export function wordCount(blocks) {
  return blocks.reduce((n, b) => n + ((b.text || '').trim().split(/\s+/).filter(Boolean).length), 0);
}

// Read-only render (used by recording live view, previews, AI previews)
export function renderStatic(blocks, { interim = '', caret = false, highlight = null } = {}) {
  if (!blocks.length && !interim) return '';
  let html = '';
  blocks.forEach((b, i) => {
    const last = i === blocks.length - 1;
    const m = marker(blocks, i);
    const box = b.type === 'todo' ? `<span class="tick ${b.checked ? 'on' : ''}" aria-hidden="true"></span>` : '';
    const tail = last ? (interim ? ` <span class="interim">${esc(interim)}</span>` : '') + (caret ? '<span class="caret" aria-hidden="true"></span>' : '') : '';
    html += `<div class="blk t-${b.type} ${b.ai ? 'is-ai' : ''} ${highlight === b.id ? 'speaking' : ''}" data-id="${b.id}">` +
      (m ? `<span class="mk">${m}</span>` : '') + box +
      `<span class="txt">${esc(b.text).replace(/\n/g, '<br>')}${tail}</span></div>`;
  });
  return html;
}

// Coerce blocks coming back from the AI into valid blocks
export function sanitize(list, ai = true) {
  if (!Array.isArray(list)) return [];
  return list.map(x => {
    if (typeof x === 'string') return blk('p', x, ai ? { ai: true } : {});
    const type = TYPES.includes(x.type) ? x.type : 'p';
    const b = blk(type, String(x.text || '').trim(), ai ? { ai: true } : {});
    if (type === 'todo') b.checked = !!x.checked;
    return b;
  }).filter(b => b.text);
}
