// ====================================
// SERVICE WORKER CON FIREBASE INTEGRADO
// ====================================
const CACHE_NAME = 'TaskSmart-app-1.4';
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

// NUEVO: Intervalo de verificación de notificaciones (cada 1 minuto)
let notificationCheckInterval = null;

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

        // CRÍTICO: Iniciar verificación continua de notificaciones
        startContinuousNotificationCheck();
        startPeriodicSync();
    }

    if ( type === 'LOGOUT' ) {
        currentUserId = null;
        await clearUserCache();
        stopContinuousNotificationCheck(); // Detener verificaciones
        console.log( '👋 Usuario deslogueado del SW' );
    }

    // NUEVO: Forzar verificación inmediata desde app.js
    if ( type === 'CHECK_NOTIFICATIONS_NOW' ) {
        console.log( '🔔 Verificación de notificaciones forzada desde app' );
        await checkNotificationsBackground();
    }
} );

// Guardar userId en IndexedDB (persiste entre reinicios)
async function saveUserIdToCache( userId ) {
    const cache = await caches.open( 'user-data' );
    const response = new Response( JSON.stringify( { userId, timestamp: Date.now() } ) );
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
// 🚀 VERIFICACIÓN CONTINUA DE NOTIFICACIONES (CLAVE)
// ====================================

function startContinuousNotificationCheck() {
    if ( notificationCheckInterval ) {
        clearInterval( notificationCheckInterval );
    }

    // CRÍTICO: Verificar cada 1 minuto (incluso con app cerrada)
    notificationCheckInterval = setInterval( async () => {
        if ( currentUserId ) {
            console.log( '🔍 Verificando notificaciones en background...' );
            await checkNotificationsBackground();
        }
    }, 60 * 1000 ); // 1 minuto

    console.log( '✅ Verificación continua de notificaciones iniciada (cada 1 min)' );
}

function stopContinuousNotificationCheck() {
    if ( notificationCheckInterval ) {
        clearInterval( notificationCheckInterval );
        notificationCheckInterval = null;
        console.log( '⏹️ Verificación continua detenida' );
    }
}

// ====================================
// SINCRONIZACIÓN AUTOMÁTICA DE TAREAS
// ====================================

let syncInterval = null;

function startPeriodicSync() {
    if ( syncInterval ) clearInterval( syncInterval );

    // Sync cada 5 minutos (actualizar tareas desde Firebase)
    syncInterval = setInterval( async () => {
        if ( currentUserId ) {
            console.log( '🔄 Sincronizando tareas desde Firebase...' );
            await syncTasksFromFirebase();
        }
    }, 5 * 60 * 1000 ); // 5 minutos

    console.log( '🔄 Sincronización periódica iniciada (cada 5 min)' );
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
                date: date,
                description: task.description || ''
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

    if ( todayTasks.length === 0 ) {
        console.log( '📭 No hay tareas para hoy' );
        return;
    }

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    console.log( `⏰ Verificando ${todayTasks.length} tareas - ${String( currentHour ).padStart( 2, '0' )}:${String( currentMinute ).padStart( 2, '0' )}` );

    for ( const task of todayTasks ) {
        if ( !task.time || task.state === 'completed' ) continue;

        const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );
        const taskTimeInMinutes = taskHours * 60 + taskMinutes;
        const timeDiff = currentTimeInMinutes - taskTimeInMinutes;

        // 🔔 15 minutos antes
        if ( timeDiff >= -15 && timeDiff <= -13 && task.state === 'pending' ) {
            await sendBackgroundNotification( {
                title: `⏰ Recordatorio: ${task.title}`,
                body: `Inicia en 15 minutos (${task.time})`,
                tag: `${task.id}-15min`,
                requireInteraction: false,
                data: { taskId: task.id, type: 'reminder', date: today }
            } );
        }

        // 🔔 Hora exacta
        if ( timeDiff >= 0 && timeDiff <= 2 && task.state === 'pending' ) {
            await sendBackgroundNotification( {
                title: `🔔 Es hora de: ${task.title}`,
                body: `Programada para ${task.time}`,
                tag: `${task.id}-start`,
                requireInteraction: true,
                data: { taskId: task.id, type: 'start', date: today }
            } );
        }

        // ⚠️ Retrasada (30 minutos después)
        if ( timeDiff >= 30 && timeDiff <= 32 && task.state !== 'completed' ) {
            await sendBackgroundNotification( {
                title: `⚠️ Tarea Retrasada: ${task.title}`,
                body: task.state === 'inProgress' ? 'Aún en proceso' : 'No iniciada - 30min de retraso',
                tag: `${task.id}-late`,
                requireInteraction: false,
                data: { taskId: task.id, type: 'late', date: today }
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
            data: data,
            actions: requireInteraction ? [
                { action: 'view', title: 'Ver Tarea', icon: '/images/IconLogo.png' },
                { action: 'dismiss', title: 'Cerrar', icon: '/images/IconLogo.png' }
            ] : []
        } );

        // Marcar como enviada
        await markNotificationAsSent( tag );
        console.log( `✅ Notificación enviada: ${tag} - ${title}` );
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
            // Considerar enviada si fue hace menos de 3 minutos
            return ( Date.now() - data.timestamp ) < 3 * 60 * 1000;
        }
    } catch ( error ) {
        console.error( 'Error verificando notificación:', error );
    }
    return false;
}

// 🔄 Reset diario de notificaciones (a medianoche)
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

// Periodic Sync para navegadores compatibles
self.addEventListener( 'periodicsync', async ( event ) => {
    console.log( '🔄 Periodic Sync triggered:', event.tag );

    if ( event.tag === 'check-tasks' ) {
        event.waitUntil( Promise.all( [
            syncTasksFromFirebase(),
            checkNotificationsBackground()
        ] ) );
    }
} );

// Registrar sync periódico (solo Chrome/Edge soportan)
async function registerPeriodicBackgroundSync() {
    try {
        const registration = await self.registration;

        // Periodic Sync (cada 15 minutos - backup del intervalo)
        if ( 'periodicSync' in registration ) {
            await registration.periodicSync.register( 'check-tasks', {
                minInterval: 15 * 60 * 1000 // 15 minutos
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

    const { action, data } = event;

    if ( action === 'dismiss' ) {
        return; // Solo cerrar
    }

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
                    return clients.openWindow( '/?notification=' + ( data?.taskId || '' ) );
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
    console.log( '🔧 SW: Instalando versión 1.3...' );
    event.waitUntil(
        caches.open( CACHE_NAME )
            .then( cache => cache.addAll( urlsToCache ) )
            .then( () => self.skipWaiting() )
    );
} );

self.addEventListener( 'activate', event => {
    console.log( '✅ SW: Activando v1.3...' );
    event.waitUntil(
        caches.keys()
            .then( names => Promise.all(
                names.filter( name => name !== CACHE_NAME )
                    .map( name => caches.delete( name ) )
            ) )
            .then( () => self.clients.claim() )
            .then( async () => {
                // Inicializar Firebase al activar
                initFirebaseInSW();

                // Cargar usuario si existe y activar verificaciones
                const userId = await loadUserIdFromCache();
                if ( userId ) {
                    console.log( '✅ Usuario encontrado al activar SW:', userId );
                    startContinuousNotificationCheck(); // CRÍTICO
                    startPeriodicSync();

                    // Sync inmediato al activar
                    await syncTasksFromFirebase();
                    await checkNotificationsBackground();
                }

                // Registrar periodic sync
                await registerPeriodicBackgroundSync();
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

console.log( '✅ Service Worker v1.3 - Notificaciones continuas activas' );
