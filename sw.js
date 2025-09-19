const CACHE_NAME = 'mi-app-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/images/favicon-192.png',
    '/images/favicon-512.png'
];

// Instalación
self.addEventListener( 'install', event => {
    event.waitUntil(
        caches.open( CACHE_NAME )
            .then( cache => cache.addAll( urlsToCache ) )
    );
} );

// Activación mejorada
self.addEventListener( 'activate', event => {
    event.waitUntil(
        caches.keys().then( cacheNames => {
            return Promise.all(
                cacheNames.filter( name => name !== CACHE_NAME )
                    .map( name => caches.delete( name ) )
            );
        } ).then( () => {
            return self.clients.claim();
        } )
    );
} );

// Interceptar solicitudes
self.addEventListener( 'fetch', event => {
    event.respondWith(
        caches.match( event.request )
            .then( response => {
                return response || fetch( event.request );
            } )
    );
} );

// Manejar notificaciones push mejoradas
self.addEventListener( 'push', event => {
    const data = event.data ? event.data.json() : {};

    const options = {
        body: data.body || 'Tienes tareas pendientes',
        icon: '/images/favicon-192.png',
        badge: '/images/favicon-192.png',
        tag: data.tag || 'task-reminder',
        requireInteraction: true,
        vibrate: [ 200, 100, 200 ],
        renotify: true,
        silent: false,
        image: '/images/favicon-512.png',
        actions: [
            { action: 'view', title: 'Ver Tareas', icon: 'favicon.png' },
            { action: 'close', title: 'Cerrar' }
        ],
        data: {
            url: data.url || '/',
            timestamp: Date.now(),
            tag: data.tag
        }
    };

    event.waitUntil(
        self.registration.showNotification(
            data.title || 'Recordatorio de Tarea',
            options
        )
    );
} );

// Manejar clicks en notificaciones
self.addEventListener( 'notificationclick', event => {
    event.notification.close();

    if ( event.action === 'view' || !event.action ) {
        event.waitUntil(
            clients.matchAll( { type: 'window', includeUncontrolled: true } )
                .then( clientList => {
                    // Si ya hay una ventana abierta, enfocarla
                    for ( let i = 0; i < clientList.length; i++ ) {
                        const client = clientList[ i ];
                        if ( client.url === self.location.origin + '/' && 'focus' in client ) {
                            return client.focus();
                        }
                    }
                    // Si no hay ventana abierta, abrir una nueva
                    if ( clients.openWindow ) {
                        return clients.openWindow( event.notification.data.url || '/' );
                    }
                } )
        );
    }
} );

// Manejo de mensajes desde la aplicación
self.addEventListener( 'message', event => {
    if ( event.data && event.data.type === 'SHOW_NOTIFICATION' ) {
        const { title, body, tag } = event.data;

        const options = {
            body: body,
            icon: '/images/favicon-192.png',
            badge: '/images/favicon-192.png',
            tag: tag,
            requireInteraction: true,
            vibrate: [ 200, 100, 200 ],
            data: { url: '/' }
        };

        self.registration.showNotification( title, options );
    }
} );
