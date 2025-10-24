const CACHE_NAME = 'TaskSmart-cache-v3.6';
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

// ===============================
// SISTEMA DE NOTIFICACIONES
// ===============================
let taskCache = [];
let sentNotifications = new Set();
let lastCheckTime = 0;

// Función para verificar si es una URL de Firebase
function isFirebaseURL( url ) {
    return FIREBASE_URLS.some( domain => url.includes( domain ) );
}

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

    if ( isFirebaseURL( url ) ) return;
    if ( request.method !== 'GET' ) return;

    // Cache First para recursos estáticos
    if ( request.destination === 'image' ||
        request.destination === 'script' ||
        request.destination === 'style' ||
        url.includes( '/images/' ) ) {

        event.respondWith(
            caches.match( request ).then( response => {
                if ( response ) return response;
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

    // Network First para HTML
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
                    if ( cachedResponse ) return cachedResponse;
                    if ( request.destination === 'document' ) {
                        return caches.match( '/index.html' );
                    }
                    throw new Error( 'No hay cache disponible' );
                } );
            } )
        );
        return;
    }

    event.respondWith(
        caches.match( request ).then( response => response || fetch( request ) )
    );
} );

// ===============================
// MANEJO DE MENSAJES
// ===============================
self.addEventListener( 'message', event => {
    const data = event.data;

    switch ( data?.type ) {
        case 'CHECK_NOTIFICATIONS':
            taskCache = data.tasks || [];
            console.log( `📥 SW: ${taskCache.length} tareas recibidas` );
            checkTaskNotificationsNow();
            break;

        case 'SHOW_NOTIFICATION':
            showNotification( {
                title: data.title,
                body: data.body,
                tag: data.tag,
                requireInteraction: data.requiresAction || false,
                notificationType: data.notificationType
            } );
            break;

        case 'CLEAR_TASK_NOTIFICATION':
            sentNotifications.delete( `${data.taskId}-15min` );
            sentNotifications.delete( `${data.taskId}-start` );
            sentNotifications.delete( `${data.taskId}-late` );
            break;

        case 'REGISTER_SYNC':
            if ( 'sync' in self.registration ) {
                self.registration.sync.register( 'sync-firebase-data' )
                    .catch( err => console.error( 'SW: Error sync:', err ) );
            }
            break;

        case 'PING':
            event.ports[ 0 ]?.postMessage( {
                type: 'PONG',
                timestamp: Date.now()
            } );
            break;
    }
} );

// ===============================
// VERIFICACIÓN DE NOTIFICACIONES
// ===============================
function checkTaskNotificationsNow() {
    const now = Date.now();

    // Limitar verificaciones (cada 30 segundos)
    if ( now - lastCheckTime < 30000 ) {
        console.log( '⏭️ SW: Skip - verificación reciente' );
        return;
    }

    lastCheckTime = now;

    const currentDate = new Date();
    const today = formatDate( currentDate );
    const currentHour = currentDate.getHours();
    const currentMinute = currentDate.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    console.log( `⏰ SW: Verificando tareas - ${currentHour}:${String( currentMinute ).padStart( 2, '0' )}` );

    const todayTasks = taskCache.filter( task => task.date === today );

    todayTasks.forEach( task => {
        processTaskNotification( task, currentTimeInMinutes );
    } );
}

function processTaskNotification( task, currentTimeInMinutes ) {
    if ( !task.time || task.state === 'completed' ) return;

    const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );
    const taskTimeInMinutes = taskHours * 60 + taskMinutes;
    const timeDiff = currentTimeInMinutes - taskTimeInMinutes;

    const priority = {
        1: 'Muy Importante',
        2: 'Importante',
        3: 'Moderado',
        4: 'No Prioritario'
    }[ task.priority ] || 'Moderado';

    // 15 minutos antes
    const tag15 = `${task.id}-15min`;
    if ( timeDiff >= -15 && timeDiff <= -13 &&
        task.state === 'pending' &&
        !sentNotifications.has( tag15 ) ) {

        showNotification( {
            title: `⏰ Recordatorio: ${task.title}`,
            body: `${priority} - Inicia en 15 minutos (${task.time})`,
            tag: tag15,
            requireInteraction: false,
            notificationType: 'task-reminder'
        } );
        sentNotifications.add( tag15 );
    }

    // Hora exacta
    const tagStart = `${task.id}-start`;
    if ( timeDiff >= 0 && timeDiff <= 2 &&
        task.state === 'pending' &&
        !sentNotifications.has( tagStart ) ) {

        showNotification( {
            title: `🔔 Es hora de: ${task.title}`,
            body: `${priority} programada para ${task.time}`,
            tag: tagStart,
            requireInteraction: true,
            notificationType: 'task-start'
        } );
        sentNotifications.add( tagStart );
    }

    // 30 minutos después (retrasada)
    const tagLate = `${task.id}-late`;
    if ( timeDiff >= 30 && timeDiff <= 32 &&
        task.state !== 'completed' &&
        !sentNotifications.has( tagLate ) ) {

        showNotification( {
            title: `⚠️ Tarea Retrasada: ${task.title}`,
            body: task.state === 'inProgress' ? 'Aún en proceso' : 'No iniciada - 30min de retraso',
            tag: tagLate,
            requireInteraction: false,
            notificationType: 'task-late'
        } );
        sentNotifications.add( tagLate );
    }
}

function showNotification( { title, body, tag, requireInteraction = false, notificationType = 'default' } ) {
    const options = {
        body: body,
        icon: '/images/IconLogo.png',
        badge: '/images/favicon-192.png',
        tag: tag,
        renotify: true,
        requireInteraction: requireInteraction,
        vibrate: getVibrationPattern( notificationType ),
        data: {
            timestamp: Date.now(),
            tag: tag
        }
    };

    self.registration.showNotification( title, options )
        .then( () => console.log( `✅ SW: Notificación enviada - ${tag}` ) )
        .catch( err => console.error( `❌ SW: Error notificación - ${tag}:`, err ) );
}

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

function formatDate( date ) {
    const year = date.getFullYear();
    const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( date.getDate() ).padStart( 2, '0' );
    return `${year}-${month}-${day}`;
}

// ===============================
// CLICK EN NOTIFICACIONES
// ===============================
self.addEventListener( 'notificationclick', event => {
    console.log( '🔔 SW: Click en notificación' );
    event.notification.close();

    event.waitUntil(
        clients.matchAll( { type: 'window', includeUncontrolled: true } )
            .then( clientList => {
                for ( let client of clientList ) {
                    if ( client.url.includes( self.registration.scope ) && 'focus' in client ) {
                        return client.focus().then( focusedClient => {
                            focusedClient.postMessage( {
                                type: 'NOTIFICATION_CLICKED',
                                data: event.notification.data
                            } );
                        } );
                    }
                }
                if ( clients.openWindow ) {
                    return clients.openWindow( '/' );
                }
            } )
    );
} );

// ===============================
// PUSH NOTIFICATIONS
// ===============================
self.addEventListener( 'push', event => {
    if ( !event.data ) return;

    const data = event.data.json();
    if ( !data.title && !data.body ) return;

    const options = {
        body: data.body,
        icon: '/images/IconLogo.png',
        badge: '/images/favicon-192.png',
        tag: data.tag || `task-${Date.now()}`,
        requireInteraction: data.requiresAction || false,
        vibrate: getVibrationPattern( data.notificationType || 'default' ),
        renotify: true,
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

// ===============================
// SINCRONIZACIÓN EN BACKGROUND
// ===============================
self.addEventListener( 'sync', event => {
    if ( event.tag === 'sync-firebase-data' ) {
        event.waitUntil( syncPendingData() );
    }

    if ( event.tag === 'check-notifications' ) {
        console.log( 'SW: Sync background - verificando notificaciones' );
        event.waitUntil(
            self.clients.matchAll().then( clients => {
                if ( clients.length > 0 ) {
                    clients.forEach( client => {
                        client.postMessage( {
                            type: 'BACKGROUND_NOTIFICATION_CHECK',
                            timestamp: Date.now()
                        } );
                    } );
                } else {
                    // Si no hay clientes activos, verificar desde el SW
                    checkTaskNotificationsNow();
                }
            } )
        );
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
        console.error( 'SW: Error sincronizando:', error );
    }
}

// ===============================
// VERIFICACIÓN AUTOMÁTICA
// ===============================
// Verificar cada 30 segundos
setInterval( () => {
    if ( taskCache.length > 0 ) {
        checkTaskNotificationsNow();
    }
}, 30000 );

// Resetear notificaciones enviadas a medianoche
setInterval( () => {
    const now = new Date();
    if ( now.getHours() === 0 && now.getMinutes() === 0 ) {
        console.log( '🔄 SW: Reset diario de notificaciones' );
        sentNotifications.clear();
    }
}, 60000 ); // Verificar cada minuto

console.log( '✅ Service Worker v3.6 - Notificaciones optimizadas activas' );
