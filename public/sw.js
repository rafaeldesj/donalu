// Service worker mínimo para habilitar a instalação PWA no Android/Chrome.
// Não faz cache agressivo para evitar problemas com atualizações durante o desenvolvimento,
// mas atende aos requisitos do navegador para exibir o botão "Instalar".

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // O manipulador de fetch vazio é suficiente para o Chrome considerar o PWA como instalável.
});
