// Service Worker Optimizado v5.0
// ================================

const CACHE_VERSION = 'v5.0';
const CACHE_STATIC = `static-${CACHE_VERSION}`;
const CACHE_DYNAMIC = `dynamic-${CACHE_VERSION}`;

const STATIC_FILES = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json',
    '/images/IconLogo.png',
    '/images/favicon-192.png',
    '/favicon.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// 🔥 NUEVA: Base de datos IndexedDB para tareas persistentes
const DB_NAME = 'TasksDB';
const DB_VERSION = 1;
const TASKS_STORE = 'tasks';

let db = null;

// ====================================
// INDEXEDDB SETUP
// ====================================
async function initDB() {
    return new Promise( ( resolve, reject ) => {
        const request = indexedDB.open( DB_NAME, DB_VERSION );

        request.onerror = () => reject( request.error );
        request.onsuccess = () => {
            db = request.result;
            resolve( db );
        };

        request.onupgradeneeded = ( event ) => {
            const database = event.target.result;
            if ( !database.objectStoreNames.contains( TASKS_STORE ) ) {
                database.createObjectStore( TASKS_STORE, { keyPath: 'id' } );
            }
        };
    } );
}

async function saveTasksToDB( tasks ) {
    if ( !db ) await initDB();

    const transaction = db.transaction( [ TASKS_STORE ], 'readwrite' );
    const store = transaction.objectStore( TASKS_STORE );

    // Limpiar store anterior
    await store.clear();

    // Guardar todas las tareas
    for ( const [ date, dayTasks ] of Object.entries( tasks ) ) {
        for ( const task of dayTasks ) {
            await store.put( {
                id: `${date}_${task.id}`,
                date,
                ...task
            } );
        }
    }

    console.log( '✅ Tareas guardadas en IndexedDB' );
}

async function getTasksFromDB() {
    if ( !db ) await initDB();

    return new Promise( ( resolve, reject ) => {
        const transaction = db.transaction( [ TASKS_STORE ], 'readonly' );
        const store = transaction.objectStore( TASKS_STORE );
        const request = store.getAll();

        request.onsuccess = () => {
            const allTasks = request.result;
            const tasksByDate = {};

            allTasks.forEach( task => {
                if ( !tasksByDate[ task.date ] ) {
                    tasksByDate[ task.date ] = [];
                }
                tasksByDate[ task.date ].push( task );
            } );

            resolve( tasksByDate );
        };

        request.onerror = () => reject( request.error );
    } );
}

// ====================================
// INSTALL / ACTIVATE
// ====================================
self.addEventListener( 'install', ( event ) => {
    console.log( '🔧 SW v5.0 instalando...' );

    event.waitUntil(
        Promise.all( [
            caches.open( CACHE_STATIC ).then( cache => cache.addAll( STATIC_FILES ) ),
            initDB()
        ] ).then( () => self.skipWaiting() )
    );
} );

self.addEventListener( 'activate', ( event ) => {
    console.log( '🚀 SW v5.0 activándose...' );

    event.waitUntil(
        Promise.all( [
            // Limpiar cachés antiguos
            caches.keys().then( keys =>
                Promise.all(
                    keys.map( key => {
                        if ( ![ CACHE_STATIC, CACHE_DYNAMIC ].includes( key ) ) {
                            return caches.delete( key );
                        }
                    } )
                )
            ),
            // Inicializar DB
            initDB(),
            // Tomar control inmediato
            self.clients.claim()
        ] ).then( () => {
            console.log( '✅ SW activado y listo' );
            // Iniciar verificación de notificaciones
            startNotificationScheduler();
        } )
    );
} );

// ====================================
// FETCH (sin cambios)
// ====================================
self.addEventListener( 'fetch', ( event ) => {
    const { request } = event;
    const url = new URL( request.url );

    if ( url.hostname.includes( 'googleapis.com' ) ||
        url.hostname.includes( 'firebaseapp.com' ) ||
        url.hostname.includes( 'google.com' ) ) {
        return;
    }

    if ( url.pathname.match( /\.(js|css|png|jpg|jpeg|svg|woff|woff2)$/ ) ) {
        event.respondWith( cacheFirst( request ) );
        return;
    }

    event.respondWith( networkFirst( request ) );
} );

async function cacheFirst( request ) {
    const cached = await caches.match( request );
    if ( cached ) return cached;

    try {
        const response = await fetch( request );
        if ( response && response.status === 200 ) {
            const cache = await caches.open( CACHE_DYNAMIC );
            cache.put( request, response.clone() );
        }
        return response;
    } catch {
        return new Response( 'Offline', { status: 503 } );
    }
}

async function networkFirst( request ) {
    try {
        const response = await fetch( request );
        if ( response && response.status === 200 ) {
            const cache = await caches.open( CACHE_DYNAMIC );
            cache.put( request, response.clone() );
        }
        return response;
    } catch {
        const cached = await caches.match( request );
        if ( cached ) return cached;

        if ( request.mode === 'navigate' ) {
            const fallback = await caches.match( '/index.html' );
            if ( fallback ) return fallback;
        }

        return new Response( 'Offline', { status: 503 } );
    }
}

// ====================================
// 🔥 NUEVO: SISTEMA DE NOTIFICACIONES PERSISTENTE
// ====================================
let notificationTimer = null;
const sentNotifications = new Set();

function startNotificationScheduler() {
    console.log( '⏰ Iniciando scheduler de notificaciones...' );

    // Limpiar timer anterior si existe
    if ( notificationTimer ) clearInterval( notificationTimer );

    // Verificar cada 30 segundos
    notificationTimer = setInterval( async () => {
        await checkTaskNotifications();
    }, 30000 );

    // Verificación inmediata
    checkTaskNotifications();
}

async function checkTaskNotifications() {
    try {
        const tasks = await getTasksFromDB();
        const now = new Date();
        const today = formatDate( now );
        const todayTasks = tasks[ today ] || [];

        if ( todayTasks.length === 0 ) return;

        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTimeInMinutes = currentHour * 60 + currentMinute;

        console.log( `🔍 Verificando ${todayTasks.length} tareas para ${today} a las ${currentHour}:${currentMinute}` );

        // Reset diario
        const resetKey = `reset-${today}`;
        if ( !sentNotifications.has( resetKey ) && currentHour === 0 && currentMinute === 0 ) {
            sentNotifications.clear();
            sentNotifications.add( resetKey );
            console.log( '🔄 Reset diario de notificaciones' );
        }

        // Verificar cada tarea
        for ( const task of todayTasks ) {
            if ( !task.time || task.state === 'completed' ) continue;

            const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );
            const taskTimeInMinutes = taskHours * 60 + taskMinutes;

            // 15 minutos antes
            const reminderKey = `${task.id}-15min`;
            if ( !sentNotifications.has( reminderKey ) &&
                currentTimeInMinutes >= taskTimeInMinutes - 15 &&
                currentTimeInMinutes < taskTimeInMinutes - 13 ) {

                await showNotification( {
                    title: `⏰ Recordatorio: ${task.title}`,
                    body: `Inicia en 15 minutos (${task.time})`,
                    tag: reminderKey,
                    icon: '/images/IconLogo.png',
                    requireInteraction: false,
                    vibrate: [ 300, 100, 300 ]
                } );

                sentNotifications.add( reminderKey );
                console.log( `✅ Notificación 15min enviada: ${task.title}` );
            }

            // Hora exacta
            const startKey = `${task.id}-start`;
            if ( !sentNotifications.has( startKey ) &&
                currentTimeInMinutes >= taskTimeInMinutes &&
                currentTimeInMinutes < taskTimeInMinutes + 2 ) {

                await showNotification( {
                    title: `🔔 Es hora de: ${task.title}`,
                    body: `Programada para ${task.time}`,
                    tag: startKey,
                    icon: '/images/IconLogo.png',
                    requireInteraction: true,
                    vibrate: [ 200, 50, 200, 50, 400 ],
                    actions: [
                        { action: 'view', title: 'Ver tarea', icon: '/images/IconLogo.png' }
                    ]
                } );

                sentNotifications.add( startKey );
                console.log( `✅ Notificación inicio enviada: ${task.title}` );
            }

            // 30 minutos tarde
            const lateKey = `${task.id}-late`;
            if ( !sentNotifications.has( lateKey ) &&
                currentTimeInMinutes >= taskTimeInMinutes + 30 ) {

                await showNotification( {
                    title: `⚠️ Tarea Retrasada: ${task.title}`,
                    body: 'Han pasado 30 minutos desde la hora programada',
                    tag: lateKey,
                    icon: '/images/IconLogo.png',
                    requireInteraction: false,
                    vibrate: [ 100, 100, 100, 100, 100 ]
                } );

                sentNotifications.add( lateKey );
                console.log( `⚠️ Notificación retraso enviada: ${task.title}` );
            }
        }

    } catch ( error ) {
        console.error( '❌ Error verificando notificaciones:', error );
    }
}

async function showNotification( options ) {
    try {
        await self.registration.showNotification( options.title, {
            body: options.body,
            icon: options.icon || '/images/IconLogo.png',
            badge: '/images/favicon-192.png',
            tag: options.tag,
            requireInteraction: options.requireInteraction || false,
            vibrate: options.vibrate || [ 200, 100, 200 ],
            data: { timestamp: Date.now(), ...options.data },
            actions: options.actions || []
        } );

        console.log( `✅ Notificación mostrada: ${options.title}` );
    } catch ( error ) {
        console.error( '❌ Error mostrando notificación:', error );
    }
}

function formatDate( date ) {
    const year = date.getFullYear();
    const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( date.getDate() ).padStart( 2, '0' );
    return `${year}-${month}-${day}`;
}

// ====================================
// MENSAJES DESDE LA APP
// ====================================
self.addEventListener( 'message', async ( event ) => {
    const { type, data } = event.data || {};

    switch ( type ) {
        case 'UPDATE_TASKS':
            await saveTasksToDB( data.tasks );
            console.log( '📝 Tareas actualizadas en SW' );
            break;

        case 'CLEAR_TASK_NOTIFICATION':
            const taskId = data.taskId;
            sentNotifications.delete( `${taskId}-15min` );
            sentNotifications.delete( `${taskId}-start` );
            sentNotifications.delete( `${taskId}-late` );
            console.log( `🧹 Notificaciones limpiadas: ${taskId}` );
            break;

        case 'FORCE_CHECK':
            await checkTaskNotifications();
            break;
    }
} );

// ====================================
// CLICK EN NOTIFICACIÓN
// ====================================
self.addEventListener( 'notificationclick', ( event ) => {
    console.log( '🖱️ Click en notificación:', event.notification.tag );

    event.notification.close();

    event.waitUntil(
        clients.matchAll( { type: 'window', includeUncontrolled: true } )
            .then( clientList => {
                for ( const client of clientList ) {
                    if ( 'focus' in client ) return client.focus();
                }
                if ( clients.openWindow ) return clients.openWindow( '/' );
            } )
    );
} );

// ====================================
// INICIALIZACIÓN
// ====================================
initDB().then( () => {
    console.log( '✅ Service Worker v5.0 iniciado' );
    startNotificationScheduler();
} );
