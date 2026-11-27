// Runs the Kokoro neural voice model fully in the browser (no server, no cost).
// First use downloads ~90 MB once; the browser caches it after that.
let tts = null;
let loading = null;

async function load() {
  if (tts) return tts;
  if (!loading) {
    loading = (async () => {
      const { KokoroTTS } = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm');
      tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: p => {
          if (p.status === 'progress' && p.total) self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
        },
      });
      return tts;
    })();
  }
  return loading;
}

self.onmessage = async e => {
  const { id, type, text, voice, speed } = e.data;
  try {
    if (type === 'load') { await load(); self.postMessage({ id, type: 'ready' }); return; }
    if (type === 'speak') {
      const model = await load();
      const out = await model.generate(text, { voice: voice || 'af_heart', speed: speed || 1 });
      const audio = out.audio;
      self.postMessage({ id, type: 'audio', audio, rate: out.sampling_rate }, [audio.buffer]);
    }
  } catch (err) {
    loading = null;
    self.postMessage({ id, type: 'error', message: String(err && err.message || err) });
  }
};
