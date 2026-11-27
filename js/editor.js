// Typewriter-style block editor: each block is a plain-text editable line.
// Enter splits (continuing lists), Backspace at start un-formats / merges,
// markdown shortcuts: "1. ", "- ", "[] ", "# ", "> ".
import { blk, marker, esc, LIST_TYPES } from './blocks.js';

const PT = (() => { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; })();

export class BlockEditor {
  constructor(root, blocks, { onChange = () => {}, placeholder = 'Start typing, or dictate…' } = {}) {
    this.root = root; this.onChange = onChange; this.placeholder = placeholder;
    this.blocks = blocks.length ? blocks : [blk('p')];
    this.focusId = null; this.shift = false; this.speaking = null;
    root.classList.add('editor');
    root.addEventListener('beforeinput', e => this.beforeInput(e));
    root.addEventListener('input', e => this.input(e));
    root.addEventListener('keydown', e => { this.shift = e.shiftKey; if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.split(); } });
    root.addEventListener('focusin', e => { const b = e.target.closest('.blk'); if (b) { this.focusId = b.dataset.id; root.dispatchEvent(new CustomEvent('blockfocus', { detail: this.cur() })); } });
    root.addEventListener('click', e => {
      const t = e.target.closest('.tick');
      if (t) {
        const b = this.find(t.closest('.blk').dataset.id);
        b.checked = !b.checked;
        t.classList.toggle('on', b.checked);
        t.closest('.blk').classList.toggle('done', b.checked);
        this.changed();
      }
    });
    this.render();
  }

  find(id) { return this.blocks.find(b => b.id === id); }
  idx(id) { return this.blocks.findIndex(b => b.id === id); }
  cur() { return this.find(this.focusId) || this.blocks[this.blocks.length - 1]; }
  span(id) { return this.root.querySelector(`.blk[data-id="${id}"] .txt`); }
  changed() { this.onChange(this.blocks); }

  render() {
    if (!this.blocks.length) this.blocks = [blk('p')];
    const only = this.blocks.length === 1 && !this.blocks[0].text;
    this.root.innerHTML = this.blocks.map((b, i) => {
      const m = marker(this.blocks, i);
      return `<div class="blk t-${b.type} ${b.ai ? 'is-ai' : ''} ${b.checked ? 'done' : ''} ${this.speaking === b.id ? 'speaking' : ''}" data-id="${b.id}">` +
        (b.ai ? '<span class="ai-mark" title="Written by AI">✦</span>' : '') +
        (m ? `<span class="mk" contenteditable="false">${m}</span>` : '') +
        (b.type === 'todo' ? `<button class="tick ${b.checked ? 'on' : ''}" contenteditable="false" aria-label="Toggle done"></button>` : '') +
        `<span class="txt" contenteditable="${PT ? 'plaintext-only' : 'true'}" spellcheck="true" ${only ? `data-ph="${esc(this.placeholder)}"` : ''}>${esc(b.text)}</span></div>`;
    }).join('');
  }

  setBlocks(blocks) { this.blocks = blocks.length ? blocks : [blk('p')]; this.render(); }

  highlight(id) {
    this.speaking = id;
    this.root.querySelectorAll('.blk.speaking').forEach(e => e.classList.remove('speaking'));
    if (id) { const el = this.root.querySelector(`.blk[data-id="${id}"]`); if (el) { el.classList.add('speaking'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
  }

  // ---------- caret ----------
  offset(span) {
    const sel = getSelection();
    if (!sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    if (!span.contains(r.startContainer)) return span.textContent.length;
    const pre = r.cloneRange(); pre.selectNodeContents(span); pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  }
  caret(id, off = 0) {
    const span = this.span(id); if (!span) return;
    span.focus({ preventScroll: false });
    const sel = getSelection(); const r = document.createRange();
    let left = off; let node = null;
    const walk = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) { const n = walk.currentNode; if (left <= n.length) { node = n; break; } left -= n.length; }
    if (node) r.setStart(node, left); else { r.selectNodeContents(span); r.collapse(off > 0 ? false : true); }
    r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
    this.focusId = id;
  }
  textOf(span) { return PT ? span.textContent : span.innerText.replace(/\n$/, ''); }

  // ---------- editing ----------
  beforeInput(e) {
    const span = e.target.closest?.('.txt'); if (!span) return;
    if (e.inputType === 'insertParagraph' || (e.inputType === 'insertLineBreak' && !this.shift)) { e.preventDefault(); this.split(); }
    else if (e.inputType === 'deleteContentBackward') {
      const sel = getSelection();
      if (sel.isCollapsed && this.offset(span) === 0) { e.preventDefault(); this.backspace(); }
    }
  }

  input(e) {
    const span = e.target.closest?.('.txt'); if (!span) return;
    const el = span.closest('.blk'); const b = this.find(el.dataset.id); if (!b) return;
    b.text = this.textOf(span);
    if (span.dataset.ph && b.text) { delete span.dataset.ph; }
    // markdown shortcuts
    if (b.type === 'p') {
      const m = b.text.match(/^(1[.)]|-|\*|\[\s?\]|#{1,3}|>)\s/);
      if (m) {
        const k = m[1];
        const type = /^1/.test(k) ? 'ol' : (k === '-' || k === '*') ? 'ul' : k.startsWith('[') ? 'todo' : k.startsWith('#') ? 'h' : 'quote';
        b.type = type; b.text = b.text.slice(m[0].length); if (type === 'todo') b.checked = false;
        this.render(); this.caret(b.id, 0);
      }
    }
    this.changed();
  }

  split() {
    const b = this.cur(); if (!b) return;
    const span = this.span(b.id); const off = span ? this.offset(span) : b.text.length;
    if (LIST_TYPES.includes(b.type) && !b.text.trim()) { b.type = 'p'; this.render(); this.caret(b.id, 0); return this.changed(); }
    const before = b.text.slice(0, off), after = b.text.slice(off);
    const type = LIST_TYPES.includes(b.type) ? b.type : 'p';
    b.text = before;
    const nb = blk(type, after, type === 'todo' ? { checked: false } : {});
    this.blocks.splice(this.idx(b.id) + 1, 0, nb);
    this.render(); this.caret(nb.id, 0); this.changed();
  }

  backspace() {
    const b = this.cur(); const i = this.idx(b.id);
    if (b.type !== 'p') { b.type = 'p'; delete b.checked; this.render(); this.caret(b.id, 0); return this.changed(); }
    if (i <= 0) return;
    const prev = this.blocks[i - 1]; const at = prev.text.length;
    prev.text += b.text; this.blocks.splice(i, 1);
    this.render(); this.caret(prev.id, at); this.changed();
  }

  setType(type) {
    const b = this.cur(); if (!b) return;
    const span = this.span(b.id); const off = span && document.activeElement === span ? this.offset(span) : b.text.length;
    b.type = b.type === type && type !== 'p' ? 'p' : type;
    if (b.type === 'todo') b.checked = !!b.checked; else delete b.checked;
    this.render(); this.caret(b.id, off); this.changed();
  }

  insertAfter(blocks, atEnd = false) {
    const i = atEnd ? this.blocks.length - 1 : this.idx(this.cur().id);
    const last = this.blocks[this.blocks.length - 1];
    if (atEnd && last && !last.text.trim()) this.blocks.pop();
    this.blocks.splice((atEnd ? this.blocks.length - 1 : i) + 1, 0, ...blocks);
    this.render(); this.changed();
  }
  prepend(blocks) { this.blocks.unshift(...blocks); this.render(); this.changed(); }
}
