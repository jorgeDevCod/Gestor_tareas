const CACHE_NAME = 'TaskSmart-cache-v3.4';
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
    if ( !event.data ) {
        console.log( "SW: Push sin datos, no se muestra notificación." );
        return;
    }

    const data = event.data.json();

    // Validar que venga al menos un título o body
    if ( !data.title && !data.body ) {
        console.log( "SW: Push sin título ni cuerpo, notificación ignorada." );
        return;
    }

    const options = {
        body: data.body,
        icon: '/images/IconLogo.png',
        badge: '/images/favicon-192.png',
        tag: data.tag || `task-${Date.now()}`,
        requireInteraction: data.requiresAction || false,
        vibrate: getVibrationPattern( data.notificationType || 'default' ),
        renotify: true,
        silent: false,
        data: {
            url: data.url || '/',
            timestamp: Date.now(),
            taskId: data.taskId
        }
    };

    event.waitUntil(
        self.registration.showNotification( data.title, options )
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
// Manejo de mensajes desde la aplicación
self.addEventListener( 'message', event => {
    const data = event.data;

    if ( data && data.type === 'SHOW_NOTIFICATION' ) {
        const options = {
            body: data.body,
            icon: '/images/IconLogo.png',
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

    // NUEVO: Manejar solicitudes de verificación de notificaciones
    if ( data && data.type === 'CHECK_NOTIFICATIONS' ) {
        // El cliente está pidiendo que verifiquemos notificaciones pendientes
        const tasks = data.tasks || [];
        const now = new Date();

        tasks.forEach( task => {
            if ( task.time && task.state !== 'completed' ) {
                const [ hours, minutes ] = task.time.split( ':' ).map( Number );
                const taskTimeInMinutes = hours * 60 + minutes;
                const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();

                // Verificar si es hora de notificar (15 minutos antes)
                if ( currentTimeInMinutes >= taskTimeInMinutes - 15 &&
                    currentTimeInMinutes <= taskTimeInMinutes - 13 &&
                    task.state === 'pending' ) {

                    const priority = {
                        1: 'Muy Importante',
                        2: 'Importante',
                        3: 'Moderado',
                        4: 'No Prioritario'
                    }[ task.priority ] || 'Moderado';

                    self.registration.showNotification( `⏰ ${task.title}`, {
                        body: `${priority} en 15 minutos (${task.time})`,
                        icon: '/images/IconLogo.png',
                        badge: '/images/favicon-192.png',
                        tag: `${task.id}-15min`,
                        vibrate: getVibrationPattern( 'task-reminder' ),
                        data: {
                            taskId: task.id,
                            timestamp: Date.now()
                        }
                    } );
                }
            }
        } );
    }

    // NUEVO: Manejar notificaciones periódicas incluso con app cerrada
    if ( data && data.type === 'PERIODIC_CHECK' ) {
        // Mantener notificaciones activas aunque la app esté cerrada
        console.log( 'SW: Verificación periódica de notificaciones recibida' );

        // Registrar sincronización en background
        if ( 'sync' in self.registration ) {
            self.registration.sync.register( 'check-notifications' )
                .catch( err => console.error( 'SW: Error registrando sync:', err ) );
        }
    }

    if ( data && data.type === 'REGISTER_SYNC' ) {
        if ( 'sync' in self.registration ) {
            self.registration.sync.register( 'sync-firebase-data' )
                .catch( err => console.error( 'SW: Error registrando sincronización:', err ) );
        }
    }

    if ( data && data.type === 'PING' ) {
        event.ports[ 0 ].postMessage( {
            type: 'PONG',
            timestamp: Date.now()
        } );
    }
} );

// NUEVO: Sincronización periódica en background para notificaciones
self.addEventListener( 'sync', event => {
    if ( event.tag === 'sync-firebase-data' ) {
        event.waitUntil( syncPendingData() );
    }

    // NUEVO: Verificar notificaciones incluso con app cerrada
    if ( event.tag === 'check-notifications' ) {
        console.log( 'SW: Ejecutando verificación de notificaciones en background' );
        event.waitUntil(
            self.clients.matchAll().then( clients => {
                // Si hay clientes activos, pedirles que verifiquen
                clients.forEach( client => {
                    client.postMessage( {
                        type: 'BACKGROUND_NOTIFICATION_CHECK',
                        timestamp: Date.now()
                    } );
                } );
            } ).catch( err => {
                console.error( 'SW: Error en background sync:', err );
            } )
        );
    }
} );

// NUEVO: Despertar periódicamente (cada 10 minutos si es posible)
setInterval( () => {
    if ( 'sync' in self.registration ) {
        self.registration.sync.register( 'check-notifications' )
            .catch( err => console.warn( 'SW: No se pudo registrar sync periódico:', err ) );
    }
}, 10 * 60 * 1000 );

console.log( '✅ Service Worker actualizado - Notificaciones en background activas' );
