// sw.js
const CACHE_NAME = 'mi-app-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/images/favicon-192.png',
    '/images/favicon-512.png'
];

// Instalación del Service Worker
self.addEventListener( 'install', event => {
    event.waitUntil(
        caches.open( CACHE_NAME )
            .then( cache => {
                return cache.addAll( urlsToCache );
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
