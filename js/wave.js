// Dot-matrix waveform. Reacts to the mic (AnalyserNode) or, if the mic can't be shared
// with speech recognition on this device, to speech activity instead.
export class DotWave {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.hist = []; this.level = 0; this.target = 0; this.mode = 'idle';
    this.analyser = null; this.buf = null; this.raf = 0; this.t0 = performance.now();
    this.resize = this.resize.bind(this); this.frame = this.frame.bind(this);
    this.ro = new ResizeObserver(this.resize); this.ro.observe(canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }
  attach(analyser) { this.analyser = analyser; this.buf = new Uint8Array(analyser.fftSize); }
  bump(v = 0.5) { this.target = Math.max(this.target, v * (0.55 + Math.random() * 0.45)); }
  setMode(m) { this.mode = m; }
  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.c.width = Math.max(1, r.width * dpr); this.c.height = Math.max(1, r.height * dpr);
    this.dpr = dpr; this.w = r.width; this.h = r.height;
    this.step = r.width < 520 ? 9 : 11;
    this.cols = Math.floor(r.width / this.step); this.rows = Math.max(7, Math.floor(r.height / this.step) | 1);
    if (this.rows % 2 === 0) this.rows--;
  }
  readMic() {
    if (!this.analyser) return null;
    this.analyser.getByteTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; s += v * v; }
    return Math.min(1, Math.sqrt(s / this.buf.length) * 4.2);
  }
  frame(now) {
    this.raf = requestAnimationFrame(this.frame);
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || '#141714';
    const faint = css.getPropertyValue('--rule').trim() || '#C9C2B7';
    const red = css.getPropertyValue('--red').trim() || '#D83227';
    let lv;
    if (this.mode === 'rec') {
      const mic = this.readMic();
      if (mic != null) lv = mic;
      else { lv = this.target; this.target *= 0.9; }
    } else if (this.mode === 'paused') lv = 0.02;
    else lv = 0.05 + 0.04 * Math.sin((now - this.t0) / 700); // idle breathing
    this.level += (lv - this.level) * 0.35;
    // push one column every ~55ms for a calm scroll
    if (!this.last || now - this.last > 55) {
      this.last = now;
      const organic = this.level * (0.75 + 0.25 * Math.sin(now / 90) * Math.sin(now / 37));
      this.hist.push(Math.max(0, Math.min(1, organic)));
      if (this.hist.length > this.cols) this.hist.splice(0, this.hist.length - this.cols);
    }
    const g = this.g; const d = this.dpr; const st = this.step;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const mid = (this.rows - 1) / 2;
    const ox = (this.w - (this.cols - 1) * st) / 2, oy = (this.h - (this.rows - 1) * st) / 2;
    const rad = st * 0.2;
    const offset = this.cols - this.hist.length;
    for (let c = 0; c < this.cols; c++) {
      const hv = c >= offset ? this.hist[c - offset] : 0;
      const lit = Math.round(hv * mid);
      const newest = c === this.cols - 1 && this.mode === 'rec';
      for (let r = 0; r < this.rows; r++) {
        const on = Math.abs(r - mid) <= lit && hv > 0.015;
        g.fillStyle = on ? (newest ? red : ink) : faint;
        g.globalAlpha = on ? 1 : 0.55;
        g.beginPath(); g.arc(ox + c * st, oy + r * st, on ? rad * 1.25 : rad * 0.8, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); }
}
