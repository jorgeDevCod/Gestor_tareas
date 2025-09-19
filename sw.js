const CACHE_NAME = 'mi-app-cache-v4'; // IMPORTANTE: Incrementar versión para actualizar
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/images/favicon-192.png',
    '/images/favicon-512.png',
    '/images/IconLogo.png',    // Tu logo principal para notificaciones
    '/images/favicon.png'      // Favicon adicional
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

// NOTIFICACIONES PUSH CON LOGO Y VIBRACIÓN CORRECTOS
self.addEventListener( 'push', event => {
    const data = event.data ? event.data.json() : {};

    // Configuración mejorada de notificaciones con tu logo
    const options = {
        body: data.body || 'Tienes tareas pendientes',
        icon: '/images/IconLogo.png',           // TU LOGO PRINCIPAL
        badge: '/images/favicon-192.png',       // Badge pequeño (esquina superior)
        tag: data.tag || 'task-reminder',
        requireInteraction: data.requireInteraction || false,
        vibrate: getVibrationPattern( data.type || 'default' ), // Patrón de vibración dinámico
        renotify: true,
        silent: false,
        image: data.image || '/images/favicon-512.png',  // Imagen grande expandida
        actions: [
            {
                action: 'view',
                title: 'Ver Tareas',
                icon: '/images/favicon-192.png'  // Icono del botón
            },
            {
                action: 'close',
                title: 'Cerrar'
            }
        ],
        data: {
            url: data.url || '/',
            timestamp: Date.now(),
            tag: data.tag,
            type: data.type
        }
    };

    event.waitUntil(
        self.registration.showNotification(
            data.title || 'Recordatorio de Tarea',
            options
        )
    );
} );

// Función para obtener patrones de vibración según el tipo
function getVibrationPattern( type ) {
    const patterns = {
        'task-start': [ 300, 100, 100, 100, 300 ],    // iniciada
        'task-reminder': [ 200, 100, 200, 100, 200 ], // Recordatorio
        'error': [ 400, 200, 400, 200, 400 ],         // Error importante
        'success': [ 100, 50, 100 ],                  // Éxito suave
        'urgent': [ 500, 100, 500, 100, 500 ],        // Urgente
        'default': [ 200, 100, 200 ]                  // Por defecto
    };

    return patterns[ type ] || patterns[ 'default' ];
}

// Manejar clicks en notificaciones
self.addEventListener( 'notificationclick', event => {
    event.notification.close();

    if ( event.action === 'view' || !event.action ) {
        event.waitUntil(
            clients.matchAll( { type: 'window', includeUncontrolled: true } )
                .then( clientList => {
                    // Buscar ventana existente
                    for ( let i = 0; i < clientList.length; i++ ) {
                        const client = clientList[ i ];
                        if ( client.url === self.location.origin + '/' && 'focus' in client ) {
                            return client.focus();
                        }
                    }
                    // Abrir nueva ventana si no existe
                    if ( clients.openWindow ) {
                        return clients.openWindow( event.notification.data.url || '/' );
                    }
                } )
        );
    }

    // Notificar a la aplicación sobre el click
    event.waitUntil(
        clients.matchAll().then( clientList => {
            clientList.forEach( client => {
                client.postMessage( {
                    type: 'NOTIFICATION_CLICKED',
                    data: event.notification.data
                } );
            } );
        } )
    );
} );

// MANEJO DE MENSAJES DESDE LA APLICACIÓN CON LOGO CORRECTO
self.addEventListener( 'message', event => {
    const data = event.data;

    if ( data && data.type === 'SHOW_NOTIFICATION' ) {
        const { title, body, tag, requiresAction = false, notificationType = 'default' } = data;

        const options = {
            body: body,
            icon: '/images/IconLogo.png',              // TU LOGO PRINCIPAL
            badge: '/images/favicon-192.png',          // Badge pequeño
            tag: tag,
            requireInteraction: requiresAction,
            vibrate: getVibrationPattern( notificationType ), // Vibración según tipo
            renotify: true,
            silent: false,
            data: {
                url: '/',
                timestamp: Date.now(),
                requiresAction,
                type: notificationType
            }
        };

        event.waitUntil(
            self.registration.showNotification( title, options )
        );
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
