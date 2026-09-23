// 🔥 SERVICE WORKER CON FCM BACKGROUND v8.0 - NOTIFICACIONES PERSISTENTES
importScripts( 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js' );

// Configuración Firebase
const firebaseConfig = {
    apiKey: "AIzaSyD9Lwkgd9NqJ5I0termPqVZxNxFk5Y-J4s",
    authDomain: "calendario-tareas-app.firebaseapp.com",
    projectId: "calendario-tareas-app",
    storageBucket: "calendario-tareas-app.firebasestorage.app",
    messagingSenderId: "646091363424",
    appId: "1:646091363424:web:d923bbcc0224bd1bed5f05",
};

firebase.initializeApp( firebaseConfig );
const messaging = firebase.messaging();

const CACHE_VERSION = 'v5.1';
const CACHE_STATIC = `static-${CACHE_VERSION}`;
const CACHE_DYNAMIC = `dynamic-${CACHE_VERSION}`;

// NOTA: solo archivos locales del mismo origen. Los CDN (font-awesome,
// gstatic, cdnjs) NO van en cache.addAll porque una respuesta opaque/404
// aborta toda la instalación del SW.
const STATIC_FILES = [
    './',
    './index.html',
    './app.js',
    './manifest.json',
    './images/IconLogo.png',
    './images/favicon-192.png',
    './images/favicon-512.png',
    './favicon.png',
    './dist/output.css',
    './src/aditional.css',
    './src/theme.css'
];

// ==========================================
// 📦 IndexedDB MEJORADO
// ==========================================
const DB_NAME = 'TasksDB';
const DB_VERSION = 2;
const TASKS_STORE = 'tasks';
const USER_STORE = 'userSession'; // NUEVO: Store para sesión persistente
const NOTIFICATIONS_STORE = 'notifications'; // NUEVO: Store para tracking de notificaciones
let db = null;

async function initDB() {
    return new Promise( ( resolve, reject ) => {
        const request = indexedDB.open( DB_NAME, DB_VERSION );

        request.onerror = () => reject( request.error );

        request.onsuccess = () => {
            db = request.result;
            console.log( '✅ IndexedDB inicializado' );
            resolve( db );
        };

        request.onupgradeneeded = ( event ) => {
            const database = event.target.result;

            // Store de tareas
            if ( !database.objectStoreNames.contains( TASKS_STORE ) ) {
                database.createObjectStore( TASKS_STORE, { keyPath: 'id' } );
            }

            // NUEVO: Store de sesión de usuario
            if ( !database.objectStoreNames.contains( USER_STORE ) ) {
                database.createObjectStore( USER_STORE, { keyPath: 'id' } );
            }

            // NUEVO: Store de notificaciones enviadas
            if ( !database.objectStoreNames.contains( NOTIFICATIONS_STORE ) ) {
                const notifStore = database.createObjectStore( NOTIFICATIONS_STORE, { keyPath: 'key' } );
                notifStore.createIndex( 'date', 'date', { unique: false } );
                notifStore.createIndex( 'timestamp', 'timestamp', { unique: false } );
            }

            console.log( '🔧 IndexedDB estructuras creadas/actualizadas' );
        };
    } );
}

// ==========================================
// 👤 GESTIÓN DE SESIÓN PERSISTENTE
// ==========================================
async function saveUserSession( userData ) {
    if ( !db ) await initDB();

    const transaction = db.transaction( [ USER_STORE ], 'readwrite' );
    const store = transaction.objectStore( USER_STORE );

    await store.put( {
        id: 'currentUser',
        uid: userData.uid,
        email: userData.email,
        displayName: userData.displayName,
        photoURL: userData.photoURL,
        fcmToken: userData.fcmToken,
        timestamp: Date.now(),
        lastActive: Date.now()
    } );

    console.log( '💾 Sesión de usuario guardada:', userData.email );
}

async function getUserSession() {
    if ( !db ) await initDB();

    return new Promise( ( resolve, reject ) => {
        const transaction = db.transaction( [ USER_STORE ], 'readonly' );
        const store = transaction.objectStore( USER_STORE );
        const request = store.get( 'currentUser' );

        request.onsuccess = () => {
            const session = request.result;
            if ( session ) {
                console.log( '✅ Sesión recuperada:', session.email );
            }
            resolve( session );
        };
        request.onerror = () => reject( request.error );
    } );
}

async function clearUserSession() {
    if ( !db ) await initDB();

    const transaction = db.transaction( [ USER_STORE ], 'readwrite' );
    const store = transaction.objectStore( USER_STORE );
    await store.clear();

    console.log( '🗑️ Sesión de usuario borrada' );
}

// ==========================================
// 📝 GESTIÓN DE TAREAS
// ==========================================
async function saveTasksToDB( tasks ) {
    if ( !db ) await initDB();

    const transaction = db.transaction( [ TASKS_STORE ], 'readwrite' );
    const store = transaction.objectStore( TASKS_STORE );
    await store.clear();

    for ( const [ date, dayTasks ] of Object.entries( tasks ) ) {
        for ( const task of dayTasks ) {
            await store.put( {
                id: `${date}_${task.id}`,
                date,
                ...task
            } );
        }
    }

    console.log( `📝 ${Object.keys( tasks ).length} días de tareas guardados en IndexedDB` );
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

            console.log( `📖 ${allTasks.length} tareas recuperadas de IndexedDB` );
            resolve( tasksByDate );
        };

        request.onerror = () => reject( request.error );
    } );
}

// ==========================================
// 🔔 TRACKING DE NOTIFICACIONES PERSISTENTE
// ==========================================
async function markNotificationSent( key, taskId, dateStr ) {
    if ( !db ) await initDB();

    const transaction = db.transaction( [ NOTIFICATIONS_STORE ], 'readwrite' );
    const store = transaction.objectStore( NOTIFICATIONS_STORE );

    await store.put( {
        key: key,
        taskId: taskId,
        date: dateStr,
        timestamp: Date.now()
    } );

    console.log( `✅ Notificación marcada como enviada: ${key}` );
}

async function wasNotificationSent( key ) {
    if ( !db ) await initDB();

    return new Promise( ( resolve, reject ) => {
        const transaction = db.transaction( [ NOTIFICATIONS_STORE ], 'readonly' );
        const store = transaction.objectStore( NOTIFICATIONS_STORE );
        const request = store.get( key );

        request.onsuccess = () => {
            const exists = !!request.result;
            resolve( exists );
        };
        request.onerror = () => reject( request.error );
    } );
}

async function clearOldNotifications() {
    if ( !db ) await initDB();

    const twoDaysAgo = Date.now() - ( 2 * 24 * 60 * 60 * 1000 );

    const transaction = db.transaction( [ NOTIFICATIONS_STORE ], 'readwrite' );
    const store = transaction.objectStore( NOTIFICATIONS_STORE );
    const index = store.index( 'timestamp' );

    const request = index.openCursor( IDBKeyRange.upperBound( twoDaysAgo ) );

    request.onsuccess = ( event ) => {
        const cursor = event.target.result;
        if ( cursor ) {
            cursor.delete();
            cursor.continue();
        }
    };

    console.log( '🧹 Notificaciones antiguas limpiadas' );
}

async function clearTaskNotifications( taskId ) {
    if ( !db ) await initDB();

    const transaction = db.transaction( [ NOTIFICATIONS_STORE ], 'readwrite' );
    const store = transaction.objectStore( NOTIFICATIONS_STORE );

    const keysToRemove = [
        `${taskId}-5min`,
        `${taskId}-15min`,
        `${taskId}-start`,
        `${taskId}-late`
    ];

    for ( const key of keysToRemove ) {
        await store.delete( key );
    }

    console.log( `🗑️ Notificaciones de tarea ${taskId} limpiadas` );
}

// ==========================================
// INSTALL / ACTIVATE
// ==========================================
self.addEventListener( 'install', ( event ) => {
    console.log( '🔧 SW v8.1 instalando...' );
    event.waitUntil(
        Promise.all( [
            // Cache resiliente: un archivo faltante no aborta la instalación
            caches.open( CACHE_STATIC ).then( async cache => {
                await Promise.all( STATIC_FILES.map( async url => {
                    try {
                        await cache.add( url );
                    } catch ( err ) {
                        console.warn( '⚠️ SW: no se pudo cachear', url, err?.message || err );
                    }
                } ) );
            } ),
            initDB()
        ] ).then( () => self.skipWaiting() )
    );
} );

self.addEventListener( 'activate', ( event ) => {
    console.log( '🚀 SW v8.1 activándose...' );
    event.waitUntil(
        Promise.all( [
            caches.keys().then( keys =>
                Promise.all(
                    keys.map( key => {
                        if ( ![ CACHE_STATIC, CACHE_DYNAMIC ].includes( key ) ) {
                            return caches.delete( key );
                        }
                    } )
                )
            ),
            initDB(),
            clearOldNotifications(),
            self.clients.claim()
        ] ).then( () => {
            console.log( '✅ SW activado y listo' );
            startNotificationScheduler();
        } )
    );
} );

// ==========================================
// 🔥 FCM BACKGROUND MESSAGING
// ==========================================
messaging.onBackgroundMessage( ( payload ) => {
    console.log( '📨 Mensaje FCM en background:', payload );

    const { notification, data } = payload;

    const notificationTitle = notification?.title || 'Recordatorio de Tarea';
    const notificationOptions = {
        body: notification?.body || 'Tienes una tarea programada',
        icon: notification?.icon || '/images/IconLogo.png',
        badge: '/images/favicon-192.png',
        tag: data?.tag || `fcm-${Date.now()}`,
        requireInteraction: data?.requiresAction === 'true',
        vibrate: [ 200, 100, 200 ],
        data: {
            taskId: data?.taskId,
            dateStr: data?.dateStr,
            url: data?.url || '/',
            timestamp: Date.now()
        },
        actions: [
            { action: 'open', title: 'Ver tarea', icon: '/images/IconLogo.png' },
            { action: 'close', title: 'Cerrar', icon: '/images/IconLogo.png' }
        ]
    };

    return self.registration.showNotification( notificationTitle, notificationOptions );
} );

// ==========================================
// FETCH
// ==========================================
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

// ==========================================
// ⏰ NOTIFICATION SCHEDULER (MEJORADO)
// ==========================================
let notificationTimer = null;

function startNotificationScheduler() {
    console.log( '⏰ Iniciando scheduler de notificaciones persistentes...' );

    if ( notificationTimer ) clearInterval( notificationTimer );

    // Verificar inmediatamente
    checkTaskNotifications();

    // Luego cada 30 segundos
    notificationTimer = setInterval( async () => {
        await checkTaskNotifications();
    }, 30000 );
}

async function checkTaskNotifications() {
    try {
        // Verificar si hay sesión activa
        const userSession = await getUserSession();
        if ( !userSession ) {
            console.log( '⏭️ No hay sesión activa, saltando verificación' );
            return;
        }

        const tasks = await getTasksFromDB();
        const local = getLocalNow(); // ✅ hora local real
        const today = local.dateStr;
        const todayTasks = tasks[ today ] || [];

        if ( todayTasks.length === 0 ) {
            console.log( '📭 No hay tareas para hoy' );
            return;
        }

        const currentHour = local.hours;
        const currentMinute = local.minutes;
        const currentTimeInMinutes = local.totalMinutes;

        console.log( `🔍 Verificando ${todayTasks.length} tareas para ${today} - ${currentHour}:${String( currentMinute ).padStart( 2, '0' )} (hora local)` );

        // Reset diario
        if ( currentHour === 0 && currentMinute < 1 ) {
            await clearOldNotifications();
            console.log( '🔄 Reset diario de notificaciones completado' );
        }

        for ( const task of todayTasks ) {
            if ( !task.time || task.state === 'completed' ) continue;

            const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );
            const taskTimeInMinutes = taskHours * 60 + taskMinutes;

            // 🔔 5 minutos antes
            const reminderKey = `${task.id}-5min`;
            const alreadySentReminder = await wasNotificationSent( reminderKey );

            if ( !alreadySentReminder &&
                currentTimeInMinutes >= taskTimeInMinutes - 5 &&
                currentTimeInMinutes < taskTimeInMinutes - 3 ) {

                await showNotification( {
                    title: `⏰ Próximamente: ${task.title}`,
                    body: `Comienza en 5 minutos (${task.time})`,
                    tag: reminderKey,
                    requireInteraction: false,
                    vibrate: [ 300, 100, 300 ],
                    data: { taskId: task.id, dateStr: today, type: 'reminder' }
                } );

                await markNotificationSent( reminderKey, task.id, today );
            }

            // 🔔 Hora exacta
            const startKey = `${task.id}-start`;
            const alreadySentStart = await wasNotificationSent( startKey );

            if ( !alreadySentStart &&
                currentTimeInMinutes >= taskTimeInMinutes &&
                currentTimeInMinutes < taskTimeInMinutes + 2 ) {

                await showNotification( {
                    title: `🔔 Es hora de: ${task.title}`,
                    body: `Programada para ${task.time}`,
                    tag: startKey,
                    requireInteraction: true,
                    vibrate: [ 200, 50, 200, 50, 400 ],
                    data: { taskId: task.id, dateStr: today, type: 'start' }
                } );

                await markNotificationSent( startKey, task.id, today );
            }

            // ⚠️ 30 minutos tarde
            const lateKey = `${task.id}-late`;
            const alreadySentLate = await wasNotificationSent( lateKey );

            if ( !alreadySentLate &&
                currentTimeInMinutes >= taskTimeInMinutes + 30 ) {

                await showNotification( {
                    title: `⚠️ Tarea Retrasada: ${task.title}`,
                    body: 'Han pasado 30+ minutos desde la hora programada',
                    tag: lateKey,
                    requireInteraction: false,
                    vibrate: [ 100, 100, 100, 100, 100 ],
                    data: { taskId: task.id, dateStr: today, type: 'late' }
                } );

                await markNotificationSent( lateKey, task.id, today );
            }
        }
    } catch ( error ) {
        console.error( '❌ Error en checkTaskNotifications:', error );
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
            actions: [
                { action: 'open', title: 'Ver tarea' },
                { action: 'close', title: 'Cerrar' }
            ]
        } );

        console.log( `✅ Notificación enviada: ${options.title}` );
        return true;
    } catch ( error ) {
        console.error( '❌ Error mostrando notificación:', error );
        return false;
    }
}
function formatDate( date ) {
    const year = date.getFullYear();
    const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( date.getDate() ).padStart( 2, '0' );
    return `${year}-${month}-${day}`;
}

// obtiene fecha y hora local correcta desde el SW
function getLocalNow() {
    const now = new Date();
    // toLocaleString con timeZone fuerza la interpretación local correcta
    const localStr = now.toLocaleString( 'sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } );
    // localStr tiene formato "YYYY-MM-DD HH:MM:SS"
    const [ datePart, timePart ] = localStr.split( ' ' );
    const [ hours, minutes ] = timePart.split( ':' ).map( Number );
    return {
        dateStr: datePart,
        hours,
        minutes,
        totalMinutes: hours * 60 + minutes
    };
}

// ==========================================
// 📨 MENSAJES DESDE LA APP
// ==========================================
self.addEventListener( 'message', async ( event ) => {
    const { type, data } = event.data || {};

    console.log( `📬 Mensaje recibido en SW: ${type}` );

    switch ( type ) {
        case 'UPDATE_TASKS':
            await saveTasksToDB( data.tasks );
            console.log( '📝 Tareas actualizadas en SW' );

            // Re-verificar notificaciones después de actualizar tareas
            setTimeout( () => checkTaskNotifications(), 1000 );
            break;

        case 'SET_USER_ID':
            await saveUserSession( {
                uid: data.userId,
                email: data.email,
                displayName: data.displayName || data.email,
                photoURL: data.photoURL || null,
                fcmToken: data.fcmToken || null
            } );
            console.log( '👤 Usuario guardado en SW:', data.email );

            // Iniciar scheduler si no está activo
            if ( !notificationTimer ) {
                startNotificationScheduler();
            }
            break;

        case 'LOGOUT':
            await clearUserSession();
            await clearOldNotifications();
            if ( notificationTimer ) {
                clearInterval( notificationTimer );
                notificationTimer = null;
            }
            console.log( '👋 Sesión cerrada en SW' );
            break;

        case 'CLEAR_TASK_NOTIFICATION':
            await clearTaskNotifications( data.taskId );
            break;

        case 'FORCE_CHECK':
            await checkTaskNotifications();
            break;

        case 'FCM_TOKEN':
            const session = await getUserSession();
            if ( session ) {
                session.fcmToken = data.token;
                await saveUserSession( session );
                console.log( '🔑 FCM Token actualizado en SW' );
            }
            break;
    }
} );

// ==========================================
// 🖱️ CLICK EN NOTIFICACIÓN
// ==========================================
self.addEventListener( 'notificationclick', ( event ) => {
    console.log( '🖱️ Click en notificación:', event.notification.tag );

    event.notification.close();

    const notifData = event.notification.data || {};
    const urlToOpen = notifData.url || '/';

    event.waitUntil(
        clients.matchAll( { type: 'window', includeUncontrolled: true } )
            .then( clientList => {
                // Intentar enfocar una ventana existente
                for ( const client of clientList ) {
                    if ( client.url.includes( urlToOpen.split( '?' )[ 0 ] ) && 'focus' in client ) {
                        return client.focus().then( client => {
                            // Enviar mensaje a la app con los datos de la notificación
                            client.postMessage( {
                                type: 'NOTIFICATION_CLICKED',
                                data: notifData
                            } );
                            return client;
                        } );
                    }
                }

                // Si no hay ventana abierta, abrir una nueva
                if ( clients.openWindow ) {
                    return clients.openWindow( urlToOpen );
                }
            } )
    );
} );

// ==========================================
// 🔄 PERIODIC BACKGROUND SYNC
// ==========================================
self.addEventListener( 'periodicsync', ( event ) => {
    if ( event.tag === 'check-tasks' ) {
        console.log( '⏰ Periodic sync: verificando tareas' );
        event.waitUntil( checkTaskNotifications() );
    }
} );

// ==========================================
// 🚀 INICIALIZACIÓN
// ==========================================
initDB().then( async () => {

    // Verificar si hay sesión guardada
    const session = await getUserSession();
    if ( session ) {
        console.log( '👤 Sesión encontrada:', session.email );
        startNotificationScheduler();
    } else {
        console.log( '❌ No hay sesión guardada' );
    }
} );

setInterval( () => {
    clearOldNotifications();
}, 24 * 60 * 60 * 1000 ); // Cada 24 horas
