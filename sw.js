// sw.js
const CACHE_NAME = 'mi-app-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/images/favicon-192.png',
    '/images/favicon-512.png'
];

const serviceWorkerContent = `
self.addEventListener('push', event => {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: data.tag,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    renotify: true,
    actions: [
      { action: 'view', title: 'Ver tareas' },
      { action: 'close', title: 'Cerrar' },
    ],
    data: { url: data.url },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'view') {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
`;

// Instalación del Service Worker
self.addEventListener( 'activate', event => {
    event.waitUntil(
        caches.keys().then( cacheNames => {
            return Promise.all(
                cacheNames.filter( name => name !== CACHE_NAME )
                    .map( name => caches.delete( name ) )
            );
        } )
    );
} );

// Activación del Service Worker
self.addEventListener( 'activate', event => {
    event.waitUntil(
        caches.keys().then( cacheNames => {
            return Promise.all(
                cacheNames.filter( name => name !== CACHE_NAME )
                    .map( name => caches.delete( name ) )
            );
        } )
    );
} );

// Interceptar solicitudes de red
self.addEventListener( 'fetch', event => {
    event.respondWith(
        caches.match( event.request )
            .then( response => {
                return response || fetch( event.request );
            } )
    );
} );
