const CACHE_NAME = 'mi-app-cache-v4';
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/images/favicon-192.png',
    '/images/favicon-512.png',
    '/images/IconLogo.png',
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
    const networkAPIs = [ '/api/', '.php', '.json' ];
    return networkAPIs.some( api => request.url.includes( api ) ) || isFirebaseURL( request.url );
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
            .then( () => self.skipWaiting() )
    );
} );

// Activación
self.addEventListener( 'activate', event => {
    console.log( 'SW: Activando...' );
    event.waitUntil(
        caches.keys().then( cacheNames => {
            return Promise.all(
                cacheNames.filter( name => name !== CACHE_NAME ).map( name => {
                    console.log( 'SW: Eliminando cache antiguo:', name );
                    return caches.delete( name );
                } )
            );
        } ).then( () => self.clients.claim() )
    );
} );

// Interceptar solicitudes
self.addEventListener( 'fetch', event => {
    const request = event.request;
    const url = request.url;

    // NO interceptar peticiones de Firebase
    if ( isFirebaseURL( url ) ) {
        return;
    }

    // NO interceptar peticiones que no sean GET
    if ( request.method !== 'GET' ) {
        return;
    }

    // Estrategia Cache First para recursos estáticos
    if ( request.destination === 'image' ||
        request.destination === 'script' ||
        request.destination === 'style' ||
        url.includes( '/images/' ) ) {

        event.respondWith(
            caches.match( request ).then( response => {
                if ( response ) {
                    return response;
                }
                return fetch( request ).then( fetchResponse => {
                    if ( fetchResponse.status === 200 && request.url.startsWith( 'http' ) ) {
                        const responseClone = fetchResponse.clone();
                        caches.open( CACHE_NAME ).then( cache => {
                            cache.put( request, responseClone );
                        } );
                    }
                    return fetchResponse;
                } );
            } ).catch( () => {
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
            fetch( request ).then( response => {
                if ( request.destination === 'document' && response.status === 200 && request.url.startsWith( 'http' ) ) {
                    const responseClone = response.clone();
                    caches.open( CACHE_NAME ).then( cache => {
                        cache.put( request, responseClone );
                    } );
                }
                return response;
            } ).catch( () => {
                return caches.match( request ).then( cachedResponse => {
                    if ( cachedResponse ) {
                        return cachedResponse;
                    }
                    if ( request.destination === 'document' ) {
                        return caches.match( '/index.html' );
                    }
                    throw new Error( 'No hay cache disponible' );
                } );
            } )
        );
        return;
    }

    // Para todo lo demás, Cache First simple
    event.respondWith(
        caches.match( request ).then( response => response || fetch( request ) )
    );
} );

// Sincronización en segundo plano
self.addEventListener( 'sync', event => {
    if ( event.tag === 'sync-firebase-data' ) {
        event.waitUntil( syncPendingData() );
    }
} );

async function syncPendingData() {
    try {
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

// Manejar notificaciones push
self.addEventListener( 'push', event => {
    const data = event.data ? event.data.json() : {};
    const options = {
        body: data.body || 'Tienes tareas pendientes',
        icon: '/images/IconLogo.png',        // CORREGIDO: Logo principal
        badge: '/images/favicon-192.png',     // Badge pequeño
        tag: data.tag || 'task-reminder',
        requireInteraction: data.requiresAction || false,
        vibrate: getVibrationPattern( data.notificationType || 'default' ),
        renotify: true,
        silent: false,
        image: data.notificationType === 'task-start' ? '/images/favicon-512.png' : undefined,
        actions: [
            { action: 'view', title: 'Ver Tareas', icon: '/images/favicon-192.png' },
            { action: 'close', title: 'Cerrar' }
        ],
        data: {
            url: data.url || '/',
            timestamp: Date.now(),
            tag: data.tag,
            taskId: data.taskId
        }
    };

    event.waitUntil(
        self.registration.showNotification(
            data.title || 'Recordatorio de Tarea',
            options
        )
    );
} );

function getVibrationPattern( type ) {
    const patterns = {
        'default': [ 200, 100, 200 ],
        'task-reminder': [ 300, 100, 300 ],
        'task-start': [ 200, 50, 200, 50, 400 ],
        'task-late': [ 100, 100, 100, 100, 100 ],
        'success': [ 200, 100, 200 ],
        'morning': [ 300, 200, 300 ],
        'midday': [ 200, 100, 200 ],
        'evening': [ 400, 200, 400 ]
    };
    return patterns[ type ] || patterns.default;
}

// Manejar clicks en notificaciones
self.addEventListener( 'notificationclick', event => {
    event.notification.close();

    if ( event.action === 'view' || !event.action ) {
        event.waitUntil(
            clients.matchAll( { type: 'window', includeUncontrolled: true } )
                .then( clientList => {
                    for ( let i = 0; i < clientList.length; i++ ) {
                        const client = clientList[ i ];
                        if ( client.url === self.location.origin + '/' && 'focus' in client ) {
                            return client.focus();
                        }
                    }
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
        const options = {
            body: data.body,
            icon: '/images/IconLogo.png',        // CORREGIDO
            badge: '/images/favicon-192.png',
            tag: data.tag,
            requireInteraction: data.requiresAction || false,
            vibrate: getVibrationPattern( data.notificationType || 'default' ),
            data: {
                url: '/',
                taskId: data.taskId,
                timestamp: Date.now()
            }
        };

        self.registration.showNotification( data.title, options );
    }

    if ( data && data.type === 'REGISTER_SYNC' ) {
        self.registration.sync.register( 'sync-firebase-data' )
            .catch( err => console.error( 'SW: Error registrando sincronización:', err ) );
    }

    if ( data && data.type === 'PING' ) {
        event.ports[ 0 ].postMessage( {
            type: 'PONG',
            timestamp: Date.now()
        } );
    }
} );
