/* sw.js — service worker para permitir instalar na tela inicial e uso offline.
 * Estratégia: NETWORK-FIRST para arquivos do próprio site (mesma origem) — assim
 * o app sempre pega a versão mais nova quando há internet, e usa o cache só como
 * reserva quando estiver offline. Requisições externas (Firebase/gstatic) NÃO são
 * interceptadas.
 */
const CACHE = 'meugestor-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/styles.css',
  './assets/js/storage.js',
  './assets/js/utils.js',
  './assets/js/finance.js',
  './assets/js/charts.js',
  './assets/js/ui.js',
  './assets/js/app.js',
  './assets/js/sync.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).catch(function () {}));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  // Só cuida de GET na mesma origem; deixa Firebase/gstatic passarem direto
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Network-first: tenta a rede, atualiza o cache e cai para o cache se offline
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, clone); });
      }
      return res;
    }).catch(function () {
      return caches.match(req);
    })
  );
});
