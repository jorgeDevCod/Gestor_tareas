const CACHE_NAME = 'mi-app-cache-v3'; // Incrementa versión para actualizar
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/images/favicon-192.png',
    '/images/favicon-512.png'
];

// URLs de Firebase que NO deben ser interceptadas
const FIREBASE_URLS = [
    'firebaseapp.com',
    'googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'firebaseio.com'
];

// Función para verificar si es una URL de Firebase
function isFirebaseURL( url ) {
    return FIREBASE_URLS.some( domain => url.includes( domain ) );
}

// Función para verificar si es una petición que necesita red
function needsNetwork( request ) {
    // APIs que siempre necesitan red
    const networkAPIs = [ '/api/', '.php', '.json' ];
    return networkAPIs.some( api => request.url.includes( api ) ) ||
        isFirebaseURL( request.url );
}

// Instalación
self.addEventListener( 'install', event => {
    console.log( 'SW: Instalando...' );
    event.waitUntil(
        caches.open( CACHE_NAME )
            .then( cache => {
                console.log( 'SW: Cache abierto' );
                return cache.addAll( urlsToCache );
            } )
            .then( () => {
                // Forzar activación inmediata
                return self.skipWaiting();
            } )
    );
} );

// Activación mejorada
self.addEventListener( 'activate', event => {
    console.log( 'SW: Activando...' );
    event.waitUntil(
        caches.keys().then( cacheNames => {
            return Promise.all(
                cacheNames.filter( name => name !== CACHE_NAME )
                    .map( name => {
                        console.log( 'SW: Eliminando cache antiguo:', name );
                        return caches.delete( name );
                    } )
            );
        } ).then( () => {
            console.log( 'SW: Tomando control de todas las páginas' );
            return self.clients.claim();
        } )
    );
} );

// Interceptar solicitudes con estrategia mejorada
self.addEventListener( 'fetch', event => {
    const request = event.request;
    const url = request.url;

    // NO interceptar peticiones de Firebase - dejarlas pasar directamente
    if ( isFirebaseURL( url ) ) {
        console.log( 'SW: Petición Firebase pasando directamente:', url );
        return; // No hacer nada, dejar que la petición normal continue
    }

    // NO interceptar peticiones POST/PUT/DELETE
    if ( request.method !== 'GET' ) {
        return;
    }

    // Estrategia Cache First para recursos estáticos
    if ( request.destination === 'image' ||
        request.destination === 'script' ||
        request.destination === 'style' ||
        url.includes( '/images/' ) ) {

        event.respondWith(
            caches.match( request )
                .then( response => {
                    if ( response ) {
                        console.log( 'SW: Sirviendo desde cache:', url );
                        return response;
                    }
                    console.log( 'SW: Descargando recurso:', url );
                    return fetch( request ).then( fetchResponse => {
                        // Guardar en cache si es exitoso
                        if ( fetchResponse.status === 200 ) {
                            const responseClone = fetchResponse.clone();
                            caches.open( CACHE_NAME ).then( cache => {
                                cache.put( request, responseClone );
                            } );
                        }
                        return fetchResponse;
                    } );
                } )
                .catch( () => {
                    console.log( 'SW: Error cargando recurso:', url );
                    // Retornar recurso por defecto si existe
                    if ( request.destination === 'image' ) {
                        return caches.match( '/images/favicon-192.png' );
                    }
                } )
        );
        return;
    }

    // Estrategia Network First para HTML y APIs (excepto Firebase)
    if ( request.destination === 'document' || needsNetwork( request ) ) {
        event.respondWith(
            fetch( request )
                .then( response => {
                    console.log( 'SW: Red exitosa para:', url );
                    // Guardar en cache solo si es HTML
                    if ( request.destination === 'document' && response.status === 200 ) {
                        const responseClone = response.clone();
                        caches.open( CACHE_NAME ).then( cache => {
                            cache.put( request, responseClone );
                        } );
                    }
                    return response;
                } )
                .catch( () => {
                    console.log( 'SW: Red falló, intentando cache para:', url );
                    return caches.match( request ).then( cachedResponse => {
                        if ( cachedResponse ) {
                            return cachedResponse;
                        }
                        // Fallback para documentos HTML
                        if ( request.destination === 'document' ) {
                            return caches.match( '/index.html' );
                        }
                        throw new Error( 'No hay cache disponible' );
                    } );
                } )
        );
        return;
    }

    // Para todo lo demás, estrategia Cache First
    event.respondWith(
        caches.match( request )
            .then( response => {
                return response || fetch( request );
            } )
    );
} );

// Sincronización en segundo plano
self.addEventListener( 'sync', event => {
    console.log( 'SW: Evento de sincronización:', event.tag );

    if ( event.tag === 'sync-firebase-data' ) {
        event.waitUntil(
            // Aquí puedes sincronizar datos pendientes con Firebase
            syncPendingData()
        );
    }
} );

// Función para sincronizar datos pendientes
async function syncPendingData() {
    try {
        console.log( 'SW: Sincronizando datos pendientes...' );
        // Enviar mensaje a la app principal para que maneje la sincronización
        const clients = await self.clients.matchAll();
        clients.forEach( client => {
            client.postMessage( {
                type: 'SYNC_FIREBASE_DATA',
                timestamp: Date.now()
            } );
        } );
    } catch ( error ) {
        console.error( 'SW: Error sincronizando datos:', error );
    }
}

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
            { action: 'view', title: 'Ver Tareas', icon: '/images/favicon-192.png' },
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
    const data = event.data;

    if ( data && data.type === 'SHOW_NOTIFICATION' ) {
        const { title, body, tag } = data;

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

    // Mensaje para registrar sincronización en segundo plano
    if ( data && data.type === 'REGISTER_SYNC' ) {
        self.registration.sync.register( 'sync-firebase-data' )
            .then( () => {
                console.log( 'SW: Sincronización registrada' );
            } )
            .catch( err => {
                console.error( 'SW: Error registrando sincronización:', err );
            } );
    }

    // Respuesta al ping de la app
    if ( data && data.type === 'PING' ) {
        event.ports[ 0 ].postMessage( {
            type: 'PONG',
            timestamp: Date.now()
        } );
    }
} );
