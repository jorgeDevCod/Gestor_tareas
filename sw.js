// ====================================
// SERVICE WORKER CON FIREBASE INTEGRADO
// ====================================

const CACHE_NAME = 'TaskSmart-cache-v4.0';
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD9Lwkgd9NqJ5I0termPqVZxNxFk5Y-J4s",
    authDomain: "calendario-tareas-app.firebaseapp.com",
    projectId: "calendario-tareas-app"
};

// ====================================
// IMPORTAR FIREBASE EN SERVICE WORKER
// ====================================
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js' );

let firebaseInitialized = false;
let db = null;
let auth = null;
let messaging = null;
let currentUserId = null;

// Inicializar Firebase en el SW
function initFirebaseInSW() {
    if ( firebaseInitialized ) return;

    try {
        firebase.initializeApp( FIREBASE_CONFIG );
        db = firebase.firestore();
        auth = firebase.auth();
        messaging = firebase.messaging();
        firebaseInitialized = true;
        console.log( '✅ Firebase inicializado en Service Worker' );
    } catch ( error ) {
        console.error( '❌ Error inicializando Firebase en SW:', error );
    }
}

// ====================================
// SISTEMA DE AUTENTICACIÓN PERSISTENTE
// ====================================

// Guardar userId desde app.js
self.addEventListener( 'message', async ( event ) => {
    const { type, data } = event.data;

    if ( type === 'SET_USER_ID' ) {
        currentUserId = data.userId;
        await saveUserIdToCache( data.userId );
        console.log( '👤 Usuario guardado en SW:', currentUserId );

        // Iniciar sincronización automática
        if ( currentUserId ) {
            startPeriodicSync();
        }
    }

    if ( type === 'LOGOUT' ) {
        currentUserId = null;
        await clearUserCache();
        console.log( '👋 Usuario deslogueado del SW' );
    }
} );

// Guardar userId en IndexedDB (persiste entre reinicios)
async function saveUserIdToCache( userId ) {
    const cache = await caches.open( 'user-data' );
    const response = new Response( JSON.stringify( { userId } ) );
    await cache.put( new Request( '/user-session' ), response );
}

// Recuperar userId al reiniciar
async function loadUserIdFromCache() {
    try {
        const cache = await caches.open( 'user-data' );
        const response = await cache.match( '/user-session' );
        if ( response ) {
            const data = await response.json();
            currentUserId = data.userId;
            console.log( '✅ Usuario recuperado del cache:', currentUserId );
            return currentUserId;
        }
    } catch ( error ) {
        console.error( 'Error cargando usuario del cache:', error );
    }
    return null;
}

async function clearUserCache() {
    const cache = await caches.open( 'user-data' );
    await cache.delete( '/user-session' );
}

// ====================================
// SINCRONIZACIÓN AUTOMÁTICA DE TAREAS
// ====================================

let syncInterval = null;

function startPeriodicSync() {
    if ( syncInterval ) clearInterval( syncInterval );

    // Sync cada 5 minutos (incluso con app cerrada)
    syncInterval = setInterval( async () => {
        if ( currentUserId ) {
            await syncTasksFromFirebase();
            await checkNotificationsBackground();
        }
    }, 5 * 60 * 1000 ); // 5 minutos

    console.log( '🔄 Sincronización periódica iniciada' );
}

async function syncTasksFromFirebase() {
    if ( !currentUserId || !db ) {
        await loadUserIdFromCache();
        if ( !currentUserId ) return;
    }

    try {
        console.log( '📥 Sincronizando tareas desde Firebase...' );

        const tasksRef = db.collection( 'users' )
            .doc( currentUserId )
            .collection( 'tasks' );

        const snapshot = await tasksRef.get();
        const tasks = {};

        snapshot.forEach( doc => {
            const task = doc.data();
            const date = task.date;

            if ( !tasks[ date ] ) tasks[ date ] = [];
            tasks[ date ].push( {
                id: task.id,
                title: task.title,
                time: task.time,
                state: task.state || 'pending',
                priority: task.priority || 3,
                date: date
            } );
        } );

        // Guardar en cache para acceso rápido
        await saveTasksToCache( tasks );
        console.log( `✅ ${snapshot.size} tareas sincronizadas` );

        return tasks;
    } catch ( error ) {
        console.error( '❌ Error sincronizando tareas:', error );
        return await loadTasksFromCache(); // Fallback
    }
}

async function saveTasksToCache( tasks ) {
    const cache = await caches.open( 'tasks-data' );
    const response = new Response( JSON.stringify( tasks ) );
    await cache.put( new Request( '/cached-tasks' ), response );
}

async function loadTasksFromCache() {
    try {
        const cache = await caches.open( 'tasks-data' );
        const response = await cache.match( '/cached-tasks' );
        if ( response ) {
            return await response.json();
        }
    } catch ( error ) {
        console.error( 'Error cargando tareas del cache:', error );
    }
    return {};
}

// ====================================
// VERIFICACIÓN DE NOTIFICACIONES EN BACKGROUND
// ====================================

async function checkNotificationsBackground() {
    const tasks = await loadTasksFromCache();
    const now = new Date();
    const today = formatDate( now );
    const todayTasks = tasks[ today ] || [];

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    console.log( `⏰ Verificando notificaciones - ${currentHour}:${String( currentMinute ).padStart( 2, '0' )}` );

    for ( const task of todayTasks ) {
        if ( !task.time || task.state === 'completed' ) continue;

        const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );
        const taskTimeInMinutes = taskHours * 60 + taskMinutes;
        const timeDiff = currentTimeInMinutes - taskTimeInMinutes;

        // 15 minutos antes
        if ( timeDiff >= -15 && timeDiff <= -13 && task.state === 'pending' ) {
            await sendBackgroundNotification( {
                title: `⏰ Recordatorio: ${task.title}`,
                body: `Inicia en 15 minutos (${task.time})`,
                tag: `${task.id}-15min`,
                requireInteraction: false,
                data: { taskId: task.id, type: 'reminder' }
            } );
        }

        // Hora exacta
        if ( timeDiff >= 0 && timeDiff <= 2 && task.state === 'pending' ) {
            await sendBackgroundNotification( {
                title: `🔔 Es hora de: ${task.title}`,
                body: `Programada para ${task.time}`,
                tag: `${task.id}-start`,
                requireInteraction: true,
                data: { taskId: task.id, type: 'start' }
            } );
        }

        // Retrasada (30 minutos después)
        if ( timeDiff >= 30 && timeDiff <= 32 && task.state !== 'completed' ) {
            await sendBackgroundNotification( {
                title: `⚠️ Tarea Retrasada: ${task.title}`,
                body: 'No iniciada - 30min de retraso',
                tag: `${task.id}-late`,
                requireInteraction: false,
                data: { taskId: task.id, type: 'late' }
            } );
        }
    }
}

async function sendBackgroundNotification( { title, body, tag, requireInteraction, data } ) {
    try {
        // Verificar si ya se envió (evitar duplicados)
        const sent = await wasNotificationSent( tag );
        if ( sent ) {
            console.log( `⏭️ Notificación ya enviada: ${tag}` );
            return;
        }

        await self.registration.showNotification( title, {
            body: body,
            icon: '/images/IconLogo.png',
            badge: '/images/favicon-192.png',
            tag: tag,
            renotify: true,
            requireInteraction: requireInteraction,
            vibrate: [ 200, 100, 200 ],
            data: data
        } );

        // Marcar como enviada
        await markNotificationAsSent( tag );
        console.log( `✅ Notificación enviada: ${tag}` );
    } catch ( error ) {
        console.error( `❌ Error enviando notificación ${tag}:`, error );
    }
}

// Control de notificaciones enviadas (persiste en IndexedDB)
async function markNotificationAsSent( tag ) {
    const cache = await caches.open( 'notifications-sent' );
    const response = new Response( JSON.stringify( { sent: true, timestamp: Date.now() } ) );
    await cache.put( new Request( `/notif-${tag}` ), response );
}

async function wasNotificationSent( tag ) {
    try {
        const cache = await caches.open( 'notifications-sent' );
        const response = await cache.match( `/notif-${tag}` );
        if ( response ) {
            const data = await response.json();
            // Considerar enviada si fue hace menos de 5 minutos
            return ( Date.now() - data.timestamp ) < 5 * 60 * 1000;
        }
    } catch ( error ) {
        console.error( 'Error verificando notificación:', error );
    }
    return false;
}

// Reset diario de notificaciones (a medianoche)
setInterval( async () => {
    const now = new Date();
    if ( now.getHours() === 0 && now.getMinutes() === 0 ) {
        console.log( '🔄 Reset diario de notificaciones' );
        const cache = await caches.open( 'notifications-sent' );
        const keys = await cache.keys();
        for ( const key of keys ) {
            await cache.delete( key );
        }
    }
}, 60 * 1000 ); // Verificar cada minuto

// ====================================
// PUSH NOTIFICATIONS (FCM)
// ====================================

self.addEventListener( 'push', async ( event ) => {
    if ( !event.data ) return;

    const data = event.data.json();
    const options = {
        body: data.body || 'Nueva notificación',
        icon: '/images/IconLogo.png',
        badge: '/images/favicon-192.png',
        tag: data.tag || `notification-${Date.now()}`,
        requireInteraction: data.requiresAction || false,
        vibrate: [ 200, 100, 200 ],
        data: data.data || {}
    };

    await self.registration.showNotification( data.title || 'Tarea', options );
} );

// ====================================
// BACKGROUND SYNC (Chrome/Edge)
// ====================================

self.addEventListener( 'sync', async ( event ) => {
    console.log( '🔄 Background Sync triggered:', event.tag );

    if ( event.tag === 'sync-tasks' ) {
        event.waitUntil( syncTasksFromFirebase() );
    }

    if ( event.tag === 'check-notifications' ) {
        event.waitUntil( checkNotificationsBackground() );
    }
} );

// Registrar sync periódico (solo Chrome/Edge soportan)
async function registerPeriodicBackgroundSync() {
    try {
        const registration = await navigator.serviceWorker.ready;

        // Periodic Sync (cada 30 minutos)
        if ( 'periodicSync' in registration ) {
            await registration.periodicSync.register( 'check-tasks', {
                minInterval: 30 * 60 * 1000 // 30 minutos
            } );
            console.log( '✅ Periodic Background Sync registrado' );
        }
    } catch ( error ) {
        console.warn( '⚠️ Periodic Sync no disponible:', error );
    }
}

// ====================================
// CLICK EN NOTIFICACIONES
// ====================================

self.addEventListener( 'notificationclick', ( event ) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll( { type: 'window', includeUncontrolled: true } )
            .then( clientList => {
                // Si la app está abierta, enfocarla
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

                // Si no está abierta, abrirla
                if ( clients.openWindow ) {
                    return clients.openWindow( '/' );
                }
            } )
    );
} );

// ====================================
// CACHE & INSTALACIÓN
// ====================================

const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/images/favicon-192.png',
    '/images/favicon-512.png',
    '/images/IconLogo.png',
];

self.addEventListener( 'install', event => {
    console.log( '🔧 SW: Instalando versión 4.0...' );
    event.waitUntil(
        caches.open( CACHE_NAME )
            .then( cache => cache.addAll( urlsToCache ) )
            .then( () => self.skipWaiting() )
    );
} );

self.addEventListener( 'activate', event => {
    console.log( '✅ SW: Activando...' );
    event.waitUntil(
        caches.keys()
            .then( names => Promise.all(
                names.filter( name => name !== CACHE_NAME )
                    .map( name => caches.delete( name ) )
            ) )
            .then( () => self.clients.claim() )
            .then( () => {
                // Inicializar Firebase al activar
                initFirebaseInSW();
                // Cargar usuario si existe
                loadUserIdFromCache().then( userId => {
                    if ( userId ) startPeriodicSync();
                } );
                // Registrar periodic sync
                registerPeriodicBackgroundSync();
            } )
    );
} );

self.addEventListener( 'fetch', event => {
    // Cache-first para recursos estáticos
    event.respondWith(
        caches.match( event.request )
            .then( response => response || fetch( event.request ) )
    );
} );

// ====================================
// UTILIDADES
// ====================================
function formatDate( date ) {
    const year = date.getFullYear();
    const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( date.getDate() ).padStart( 2, '0' );
    return `${year}-${month}-${day}`;
}

console.log( '✅ Service Worker v4.0 - Firebase integrado activo' );
