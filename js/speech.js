// Live dictation that writes into a structured block document.
// Speech goes into the "current" block; structure chips / spoken commands change where it goes next.
import { blk, clone, LIST_TYPES } from './blocks.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupported = !!SR;
const isAndroid = /Android/i.test(navigator.userAgent);

const CMDS = [
  ['question mark', 'punct', '?'], ['exclamation mark', 'punct', '!'], ['exclamation point', 'punct', '!'],
  ['full stop', 'punct', '.'], ['comma', 'punct', ','], ['semicolon', 'punct', ';'], ['colon', 'punct', ':'],
  ['new paragraph', 'act', 'para'], ['new line', 'act', 'line'], ['next line', 'act', 'line'],
  ['numbered list', 'act', 'ol'], ['number list', 'act', 'ol'],
  ['bullet point', 'act', 'ul'], ['bullet list', 'act', 'ul'], ['new bullet', 'act', 'ul'],
  ['check box', 'act', 'todo'], ['checkbox', 'act', 'todo'], ['to do item', 'act', 'todo'], ['new task', 'act', 'todo'],
  ['next point', 'act', 'next'], ['next item', 'act', 'next'],
  ['new heading', 'act', 'h'], ['end list', 'act', 'para'], ['new quote', 'act', 'quote'],
];
const CMD_RE = new RegExp('\\b(' + CMDS.map(c => c[0].replace(/ /g, '\\s+')).join('|') + ')\\b', 'gi');
const CMD_MAP = Object.fromEntries(CMDS.map(c => [c[0], [c[1], c[2]]]));
const NUMWORD = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const LEAD_NEXT = new RegExp('^\\s*(?:next|number\\s+' + NUMWORD + '|point\\s+' + NUMWORD + ')\\b[\\s,.:-]*', 'i');

export const COMMAND_HELP = [
  ['“comma” · “full stop” · “question mark”', 'punctuation'],
  ['“new line” · “new paragraph”', 'breaks'],
  ['“numbered list” · “bullet point” · “checkbox”', 'start a list'],
  ['“next” · “next point” · “number two”', 'next list item'],
  ['“new heading” · “end list”', 'structure'],
];

export class Dictation {
  constructor({ blocks, lang = 'en-IN', commands = true, onUpdate = () => {}, onError = () => {}, onActivity = () => {} }) {
    this.blocks = blocks && blocks.length ? clone(blocks) : [blk('p')];
    if (this.blocks[this.blocks.length - 1].text) this.blocks.push(blk('p'));
    this.lang = lang; this.commands = commands;
    this.onUpdate = onUpdate; this.onError = onError; this.onActivity = onActivity;
    this.interim = ''; this.interimParts = [];
    this.undoStack = []; this.forced = null; this.sid = 0;
    this.want = false; this.paused = false; this.rec = null;
    this.restarts = []; this._endWaiters = [];
  }

  get cur() { return this.blocks[this.blocks.length - 1]; }

  snapshot() { this.undoStack.push(clone(this.blocks)); if (this.undoStack.length > 120) this.undoStack.shift(); }

  // ---------- document mutations ----------
  appendText(raw) {
    let s = (raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return;
    if (/^en/i.test(this.lang)) s = s.replace(/\bi\b/g, 'I').replace(/\bi'(m|ve|ll|d)\b/gi, "I'$1");
    const cur = this.cur; const t = cur.text;
    if (!t.trim() || /[.?!]\s*$/.test(t) || /\n$/.test(t)) s = s[0].toUpperCase() + s.slice(1);
    const sep = (!t || /\s$/.test(t) || /^[,.?!:;]/.test(s)) ? '' : ' ';
    cur.text = t + sep + s;
  }

  punct(p) {
    let target = this.cur;
    if (!target.text.trim() && this.blocks.length > 1) target = this.blocks[this.blocks.length - 2];
    target.text = target.text.replace(/\s+$/, '') + p;
  }

  act(name) {
    const cur = this.cur;
    const empty = !cur.text.trim();
    switch (name) {
      case 'line':
        if (LIST_TYPES.includes(cur.type)) { if (!empty) this.blocks.push(blk(cur.type)); }
        else if (!empty) cur.text = cur.text.replace(/\s+$/, '') + '\n';
        break;
      case 'para':
        if (empty) cur.type = 'p'; else this.blocks.push(blk('p'));
        break;
      case 'next':
        if (!empty) this.blocks.push(blk(LIST_TYPES.includes(cur.type) ? cur.type : 'p'));
        break;
      case 'ol': case 'ul': case 'todo': case 'h': case 'quote':
        if (empty) { cur.type = name; if (name === 'todo') cur.checked = false; }
        else this.blocks.push(blk(name, '', name === 'todo' ? { checked: false } : {}));
        break;
    }
  }

  // public: chip taps & keyboard
  action(kind, v) {
    if (kind === 'undo') {
      const prev = this.undoStack.pop();
      if (prev) this.blocks = prev;
      if (!this.blocks.length) this.blocks = [blk('p')];
      return this.emit();
    }
    this.flushInterim();
    this.snapshot();
    if (kind === 'punct') this.punct(v);
    else this.act(v);
    this.emit();
  }

  nextLabel() {
    // number the next ordered item would get — shown on the dock
    const b = this.blocks; let n = 0;
    for (let j = b.length - 1; j >= 0 && b[j].type === 'ol'; j--) n++;
    const cur = this.cur;
    if (cur.type === 'ol' && !cur.text.trim()) return n;
    return n + 1;
  }

  // Apply a final utterance: plain text, optionally with spoken commands inside
  commit(text) {
    if (!text || !text.trim()) return;
    this.snapshot();
    let rest = text;
    if (this.commands) {
      if (LIST_TYPES.includes(this.cur.type) && this.cur.text.trim() && LEAD_NEXT.test(rest)) {
        rest = rest.replace(LEAD_NEXT, ''); this.act('next');
      }
      if (/^\s*heading\b/i.test(rest)) { rest = rest.replace(/^\s*heading\b[\s,:.-]*/i, ''); this.act('h'); }
      let last = 0; let m; CMD_RE.lastIndex = 0;
      while ((m = CMD_RE.exec(rest))) {
        this.appendText(rest.slice(last, m.index));
        const [kind, v] = CMD_MAP[m[1].toLowerCase().replace(/\s+/g, ' ')];
        if (kind === 'punct') this.punct(v); else this.act(v);
        last = m.index + m[0].length;
        rest.slice(last).match(/^[\s.,]*/) && (last += rest.slice(last).match(/^[\s.,]*/)[0].length);
      }
      this.appendText(rest.slice(last));
    } else this.appendText(rest);
    // a heading is one line — speech after it flows into a new paragraph
    if (this.cur.type === 'h' && this.cur.text.trim()) this.blocks.push(blk('p'));
  }

  // When a chip is tapped mid-sentence, lock in the words heard so far so the chip lands after them.
  flushInterim() {
    if (!this.interim) return;
    const words = {};
    this.interimParts.forEach(p => { words[p.idx] = (words[p.idx] || 0) + p.text.trim().split(/\s+/).filter(Boolean).length; });
    this.forced = { sid: this.sid, words };
    const txt = this.interim; this.interim = ''; this.interimParts = [];
    this.commit(txt);
  }

  emit() { this.onUpdate(this); }

  // ---------- recognition lifecycle ----------
  start() { this.want = true; this.paused = false; this._start(); }

  _start() {
    if (!SR) { this.onError('unsupported'); return; }
    const now = Date.now();
    this.restarts = this.restarts.filter(t => now - t < 4000); this.restarts.push(now);
    if (this.restarts.length > 8) { this.want = false; this.onError('unstable'); return; }
    const rec = new SR();
    rec.lang = this.lang;
    rec.interimResults = true;
    rec.continuous = !isAndroid; // Android repeats text in continuous mode; restart per utterance instead
    rec.maxAlternatives = 1;
    const sid = ++this.sid;
    rec.onresult = e => {
      if (sid !== this.sid) return;
      let interim = ''; const parts = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        let t = r[0].transcript;
        if (this.forced && this.forced.sid === sid && this.forced.words[i]) {
          t = t.trim().split(/\s+/).slice(this.forced.words[i]).join(' ');
        }
        if (r.isFinal) {
          if (this.forced && this.forced.sid === sid) delete this.forced.words[i];
          this.commit(t);
        } else if (t.trim()) { interim += (interim ? ' ' : '') + t.trim(); parts.push({ idx: i, text: t }); }
      }
      this.interim = interim; this.interimParts = parts;
      this.onActivity();
      this.emit();
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.want = false; }
      this.onError(e.error);
    };
    rec.onend = () => {
      if (sid !== this.sid) return;
      if (this.want && !this.paused) { setTimeout(() => { if (this.want && !this.paused && sid === this.sid) this._start(); }, 120); return; }
      if (this.interim) { const t = this.interim; this.interim = ''; this.interimParts = []; this.commit(t); this.emit(); }
      this.rec = null;
      this._endWaiters.splice(0).forEach(f => f());
    };
    this.rec = rec;
    try { rec.start(); } catch (err) { this.onError('start-failed'); }
  }

  pause() { this.paused = true; if (this.rec) try { this.rec.stop(); } catch {} }
  resume() { this.paused = false; this.restarts = []; if (!this.rec) this._start(); }

  stop() {
    this.want = false;
    return new Promise(res => {
      if (!this.rec) { if (this.interim) { this.commit(this.interim); this.interim = ''; } return res(); }
      this._endWaiters.push(res);
      try { this.rec.stop(); } catch { res(); }
      setTimeout(() => { if (this.interim) { this.commit(this.interim); this.interim = ''; } res(); }, 1800);
    });
  }

  abort() { this.want = false; if (this.rec) try { this.rec.abort(); } catch {} this.rec = null; }

  result() {
    return this.blocks.filter((b, i) => b.text.trim() || i < this.blocks.length - 1).filter(b => b.text.trim());
  }
}
