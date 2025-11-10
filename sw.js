// ====================================
// SERVICE WORKER v2.1 - CORRECCIONES CRÍTICAS
// ====================================
const CACHE_NAME = 'TaskSmart-app-2.1';
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD9Lwkgd9NqJ5I0termPqVZxNxFk5Y-J4s",
    authDomain: "calendario-tareas-app.firebaseapp.com",
    projectId: "calendario-tareas-app"
};

// Importar Firebase
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js' );

let firebaseInitialized = false;
let db = null;
let auth = null;
let currentUserId = null;
let cachedTasks = {};

// ====================================
// INICIALIZACIÓN DE FIREBASE
// ====================================
function initFirebaseInSW() {
    if ( firebaseInitialized ) return;

    try {
        firebase.initializeApp( FIREBASE_CONFIG );
        db = firebase.firestore();
        auth = firebase.auth();

        // Configurar persistencia offline
        db.enablePersistence( { synchronizeTabs: true } )
            .catch( err => console.warn( '⚠️ Persistencia no disponible:', err.code ) );

        firebaseInitialized = true;
        console.log( '✅ Firebase inicializado en Service Worker' );
    } catch ( error ) {
        console.error( '❌ Error inicializando Firebase:', error );
    }
}

// ====================================
// GESTIÓN DE USUARIO Y TAREAS PERSISTENTE
// ====================================
self.addEventListener( 'message', async ( event ) => {
    const { type, data } = event.data;

    if ( type === 'SET_USER_ID' ) {
        currentUserId = data.userId;
        await saveUserData( {
            userId: data.userId,
            email: data.email,
            timestamp: Date.now()
        } );
        console.log( '👤 Usuario guardado en SW:', currentUserId );

        // Iniciar sistema de notificaciones
        await startNotificationSystem();
    }

    if ( type === 'LOGOUT' ) {
        currentUserId = null;
        await clearUserData();
        await clearTasksCache();
        console.log( '👋 Usuario deslogueado, cache limpiado' );
    }

    if ( type === 'CHECK_NOTIFICATIONS_NOW' ) {
        console.log( '🔔 Verificación forzada desde app' );
        await checkAndSendNotifications();
    }

    if ( type === 'UPDATE_TASKS' ) {
        // CRÍTICO: Guardar tareas en cache del SW
        await saveTasksToCache( data.tasks );
        console.log( '📝 Tareas actualizadas en cache SW' );
    }
} );

// ====================================
// PERSISTENCIA DE DATOS
// ====================================
async function saveUserData( userData ) {
    const cache = await caches.open( 'user-persistent' );
    const response = new Response( JSON.stringify( userData ) );
    await cache.put( new Request( '/user-session' ), response );
}

async function loadUserData() {
    try {
        const cache = await caches.open( 'user-persistent' );
        const response = await cache.match( '/user-session' );
        if ( response ) {
            const data = await response.json();
            currentUserId = data.userId;
            console.log( '✅ Usuario recuperado en SW:', currentUserId );
            return data;
        }
    } catch ( error ) {
        console.error( 'Error cargando usuario:', error );
    }
    return null;
}

async function clearUserData() {
    const cache = await caches.open( 'user-persistent' );
    await cache.delete( '/user-session' );
}

async function saveTasksToCache( tasks ) {
    const cache = await caches.open( 'tasks-persistent' );
    cachedTasks = tasks; // Guardar en memoria también
    const response = new Response( JSON.stringify( {
        tasks: tasks,
        timestamp: Date.now()
    } ) );
    await cache.put( new Request( '/cached-tasks' ), response );
    console.log( `💾 Tareas guardadas en cache: ${Object.keys( tasks ).length} días` );
}

async function loadTasksFromCache() {
    try {
        // Primero intentar de memoria
        if ( Object.keys( cachedTasks ).length > 0 ) {
            console.log( '✅ Tareas cargadas de memoria' );
            return cachedTasks;
        }

        // Si no, cargar del cache
        const cache = await caches.open( 'tasks-persistent' );
        const response = await cache.match( '/cached-tasks' );
        if ( response ) {
            const data = await response.json();
            cachedTasks = data.tasks || {};
            console.log( `✅ Tareas cargadas de cache: ${Object.keys( cachedTasks ).length} días` );
            return cachedTasks;
        }
    } catch ( error ) {
        console.error( 'Error cargando tareas:', error );
    }
    return {};
}

async function clearTasksCache() {
    cachedTasks = {};
    const cache = await caches.open( 'tasks-persistent' );
    await cache.delete( '/cached-tasks' );
}

// ====================================
// SISTEMA DE NOTIFICACIONES
// ====================================
async function startNotificationSystem() {
    console.log( '🚀 Iniciando sistema de notificaciones en SW' );

    // Sincronizar tareas desde Firebase
    await syncTasksFromFirebase();

    // Primera verificación
    await checkAndSendNotifications();

    // Programar verificaciones con Alarms API
    await scheduleNextCheck();
}

async function scheduleNextCheck() {
    if ( 'alarms' in chrome ) {
        chrome.alarms.create( 'notification-check', {
            delayInMinutes: 1,
            periodInMinutes: 1
        } );
        console.log( '⏰ Alarma programada (cada 1 minuto)' );
    } else {
        console.warn( '⚠️ Alarms API no disponible' );
    }
}

// Listener de alarmas
if ( 'alarms' in chrome ) {
    chrome.alarms.onAlarm.addListener( async ( alarm ) => {
        if ( alarm.name === 'notification-check' ) {
            console.log( '⏰ Alarm triggered - verificando notificaciones' );
            await checkAndSendNotifications();
        }
    } );
}

// ====================================
// SINCRONIZACIÓN DE TAREAS DESDE FIREBASE
// ====================================
async function syncTasksFromFirebase() {
    // CRÍTICO: Cargar usuario si no está en memoria
    if ( !currentUserId ) {
        const userData = await loadUserData();
        if ( !userData ) {
            console.log( '⚠️ No hay usuario, cargando tareas del cache' );
            await loadTasksFromCache();
            return cachedTasks;
        }
    }

    if ( !db ) initFirebaseInSW();

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
                time: task.time || '',
                state: task.state || 'pending',
                priority: task.priority || 3,
                date: date,
                description: task.description || ''
            } );
        } );

        await saveTasksToCache( tasks );
        console.log( `✅ ${snapshot.size} tareas sincronizadas desde Firebase` );
        return tasks;

    } catch ( error ) {
        console.error( '❌ Error sincronizando desde Firebase:', error );
        // Usar cache si falla Firebase
        return await loadTasksFromCache();
    }
}

// ====================================
// VERIFICACIÓN Y ENVÍO DE NOTIFICACIONES
// ====================================
async function checkAndSendNotifications() {
    const tasks = await loadTasksFromCache();

    if ( Object.keys( tasks ).length === 0 ) {
        console.log( '📭 No hay tareas en cache, intentando sincronizar...' );
        await syncTasksFromFirebase();
        return;
    }

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

        // 15 minutos antes
        if ( timeDiff >= -15 && timeDiff <= -13 && task.state === 'pending' ) {
            await sendNotification( {
                title: `⏰ Recordatorio: ${task.title}`,
                body: `Inicia en 15 minutos (${task.time})`,
                tag: `${task.id}-15min`,
                requireInteraction: false
            } );
        }

        // Hora exacta
        if ( timeDiff >= 0 && timeDiff <= 2 && task.state === 'pending' ) {
            await sendNotification( {
                title: `🔔 Es hora de: ${task.title}`,
                body: `Programada para ${task.time}`,
                tag: `${task.id}-start`,
                requireInteraction: true
            } );
        }

        // Retrasada (30 min después)
        if ( timeDiff >= 30 && timeDiff <= 32 && task.state !== 'completed' ) {
            await sendNotification( {
                title: `⚠️ Tarea Retrasada: ${task.title}`,
                body: task.state === 'inProgress' ? 'Aún en proceso' : 'No iniciada',
                tag: `${task.id}-late`,
                requireInteraction: false
            } );
        }
    }
}

async function sendNotification( { title, body, tag, requireInteraction } ) {
    try {
        // Evitar duplicados
        if ( await wasNotificationSent( tag ) ) {
            console.log( `⏭️ Ya enviada: ${tag}` );
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
            actions: requireInteraction ? [
                { action: 'view', title: '👁️ Ver' },
                { action: 'dismiss', title: '❌ Cerrar' }
            ] : []
        } );

        await markNotificationAsSent( tag );
        console.log( `✅ Notificación enviada: ${title}` );

    } catch ( error ) {
        console.error( `❌ Error enviando notificación:`, error );
    }
}

// Control de notificaciones enviadas
async function markNotificationAsSent( tag ) {
    const cache = await caches.open( 'notifications-sent' );
    const response = new Response( JSON.stringify( {
        sent: true,
        timestamp: Date.now()
    } ) );
    await cache.put( new Request( `/notif-${tag}` ), response );
}

async function wasNotificationSent( tag ) {
    try {
        const cache = await caches.open( 'notifications-sent' );
        const response = await cache.match( `/notif-${tag}` );
        if ( response ) {
            const data = await response.json();
            // Válida por 3 minutos
            return ( Date.now() - data.timestamp ) < 3 * 60 * 1000;
        }
    } catch ( error ) {
        console.error( 'Error verificando notificación:', error );
    }
    return false;
}

// Reset diario de notificaciones
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
}, 60 * 1000 );

// ====================================
// BACKGROUND SYNC
// ====================================
self.addEventListener( 'sync', async ( event ) => {
    console.log( '🔄 Background Sync:', event.tag );

    if ( event.tag === 'sync-tasks' || event.tag === 'sync-notifications' ) {
        event.waitUntil(
            syncTasksFromFirebase()
                .then( () => checkAndSendNotifications() )
        );
    }
} );

// Periodic Background Sync
self.addEventListener( 'periodicsync', async ( event ) => {
    console.log( '🔄 Periodic Sync:', event.tag );

    if ( event.tag === 'check-notifications' ) {
        event.waitUntil(
            Promise.all( [
                syncTasksFromFirebase(),
                checkAndSendNotifications()
            ] )
        );
    }
} );

// ====================================
// CLICK EN NOTIFICACIONES
// ====================================
self.addEventListener( 'notificationclick', ( event ) => {
    event.notification.close();

    if ( event.action === 'dismiss' ) return;

    event.waitUntil(
        clients.matchAll( { type: 'window', includeUncontrolled: true } )
            .then( clientList => {
                for ( let client of clientList ) {
                    if ( client.url.includes( self.registration.scope ) && 'focus' in client ) {
                        return client.focus();
                    }
                }
                if ( clients.openWindow ) {
                    return clients.openWindow( '/' );
                }
            } )
    );
} );

// ====================================
// INSTALACIÓN Y ACTIVACIÓN
// ====================================
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/images/favicon-192.png',
    '/images/favicon-512.png',
    '/images/IconLogo.png'
];

self.addEventListener( 'install', event => {
    console.log( '🔧 Instalando Service Worker v2.1' );
    event.waitUntil(
        caches.open( CACHE_NAME )
            .then( cache => cache.addAll( urlsToCache ) )
            .then( () => self.skipWaiting() )
    );
} );

self.addEventListener( 'activate', event => {
    console.log( '✅ Activando Service Worker v2.1' );
    event.waitUntil(
        caches.keys()
            .then( names => Promise.all(
                names.filter( name => name !== CACHE_NAME )
                    .map( name => caches.delete( name ) )
            ) )
            .then( () => self.clients.claim() )
            .then( async () => {
                initFirebaseInSW();

                const userData = await loadUserData();
                if ( userData ) {
                    console.log( '✅ Usuario encontrado al activar:', userData.userId );
                    await startNotificationSystem();
                }
            } )
    );
} );

self.addEventListener( 'fetch', event => {
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

console.log( '✅ Service Worker v2.1 cargado - Correcciones aplicadas' );
