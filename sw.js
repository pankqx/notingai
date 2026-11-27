// Offline app shell. AI calls, fonts and the neural voice model are never cached here.
const CACHE = 'nothing-ai-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/store.js', 'js/blocks.js', 'js/speech.js', 'js/editor.js',
  'js/wave.js', 'js/ai.js', 'js/tts.js', 'js/ui.js', 'js/kokoro-worker.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first so updates land immediately; cache as the offline fallback
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
