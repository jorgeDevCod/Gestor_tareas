// ====================================
// SERVICE WORKER COMPLETO Y OPTIMIZADO
// Versión: 3.0
// ====================================

// Importar Firebase SDKs
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js' );

// ====================================
// CONFIGURACIÓN Y VARIABLES GLOBALES
// ====================================

const CACHE_VERSION = 'v3.0';
const CACHE_STATIC = `static-${CACHE_VERSION}`;
const CACHE_DYNAMIC = `dynamic-${CACHE_VERSION}`;
const CACHE_IMAGES = `images-${CACHE_VERSION}`;

// Archivos estáticos a cachear
const STATIC_FILES = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json',
    '/images/IconLogo.png',
    '/images/favicon-192.png',
    '/favicon.png',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// Configuración Firebase
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD9Lwkgd9NqJ5I0termPqVZxNxFk5Y-J4s",
    authDomain: "calendario-tareas-app.firebaseapp.com",
    projectId: "calendario-tareas-app",
    storageBucket: "calendario-tareas-app.firebasestorage.app",
    messagingSenderId: "646091363424",
    appId: "1:646091363424:web:d923bbcc0224bd1bed5f05",
};

// Variables globales
let db = null;
let auth = null;
let firebaseInitialized = false;
let currentUserId = null;
let notificationCheckInterval = null;
let sentNotifications = new Set();

// ====================================
// EVENTO: INSTALACIÓN
// ====================================

self.addEventListener( 'install', ( event ) => {
    console.log( '🔧 Service Worker instalándose...' );

    event.waitUntil(
        caches.open( CACHE_STATIC )
            .then( ( cache ) => {
                console.log( '📦 Cacheando archivos estáticos...' );
                return cache.addAll( STATIC_FILES );
            } )
            .then( () => {
                console.log( '✅ Archivos estáticos cacheados' );
                return self.skipWaiting(); // Activar inmediatamente
            } )
            .catch( ( error ) => {
                console.error( '❌ Error cacheando archivos:', error );
            } )
    );
} );

// ====================================
// EVENTO: ACTIVACIÓN
// ====================================

self.addEventListener( 'activate', ( event ) => {
    console.log( '🚀 Service Worker activándose...' );

    event.waitUntil(
        // Limpiar cachés antiguas
        caches.keys()
            .then( ( cacheNames ) => {
                return Promise.all(
                    cacheNames.map( ( cacheName ) => {
                        if (
                            cacheName !== CACHE_STATIC &&
                            cacheName !== CACHE_DYNAMIC &&
                            cacheName !== CACHE_IMAGES
                        ) {
                            console.log( '🗑️ Eliminando caché antigua:', cacheName );
                            return caches.delete( cacheName );
                        }
                    } )
                );
            } )
            .then( () => {
                console.log( '✅ Cachés antiguas eliminadas' );
                return self.clients.claim(); // Tomar control de todas las páginas
            } )
            .then( () => {
                console.log( '✅ Service Worker activado y listo' );
            } )
    );
} );

// ====================================
// EVENTO: FETCH (Intercepción de peticiones)
// ====================================

self.addEventListener( 'fetch', ( event ) => {
    const { request } = event;
    const url = new URL( request.url );

    // Ignorar peticiones a Firebase y APIs externas
    if (
        url.hostname.includes( 'firebaseio.com' ) ||
        url.hostname.includes( 'googleapis.com' ) ||
        url.hostname.includes( 'gstatic.com' ) ||
        request.method !== 'GET'
    ) {
        return;
    }

    // Estrategia: Cache First para recursos estáticos
    if (
        request.url.includes( '.js' ) ||
        request.url.includes( '.css' ) ||
        request.url.includes( '/images/' )
    ) {
        event.respondWith( cacheFirst( request ) );
        return;
    }

    // Estrategia: Network First para HTML
    if ( request.url.includes( '.html' ) || request.url === url.origin + '/' ) {
        event.respondWith( networkFirst( request ) );
        return;
    }

    // Estrategia por defecto: Network First con fallback
    event.respondWith( networkFirst( request ) );
} );

// ====================================
// ESTRATEGIAS DE CACHÉ
// ====================================

// Cache First: Buscar en caché primero
async function cacheFirst( request ) {
    try {
        const cachedResponse = await caches.match( request );
        if ( cachedResponse ) {
            return cachedResponse;
        }

        const response = await fetch( request );

        if ( response && response.status === 200 ) {
            const cache = await caches.open( CACHE_DYNAMIC );
            cache.put( request, response.clone() );
        }

        return response;
    } catch ( error ) {
        console.error( '❌ Error en cacheFirst:', error );
        return new Response( 'Offline', { status: 503 } );
    }
}

// Network First: Intentar red primero
async function networkFirst( request ) {
    try {
        const response = await fetch( request );

        if ( response && response.status === 200 ) {
            const cache = await caches.open( CACHE_DYNAMIC );
            cache.put( request, response.clone() );
        }

        return response;
    } catch ( error ) {
        const cachedResponse = await caches.match( request );

        if ( cachedResponse ) {
            return cachedResponse;
        }

        // Fallback para navegación offline
        if ( request.mode === 'navigate' ) {
            const indexCache = await caches.match( '/index.html' );
            if ( indexCache ) {
                return indexCache;
            }
        }

        return new Response( 'Offline', { status: 503 } );
    }
}

// ====================================
// INICIALIZAR FIREBASE EN SW
// ====================================

function initFirebaseInSW() {
    if ( firebaseInitialized ) return;

    try {
        firebase.initializeApp( FIREBASE_CONFIG );
        db = firebase.firestore();
        auth = firebase.auth();

        // Configurar persistencia offline
        db.enablePersistence( { synchronizeTabs: true } )
            .catch( ( err ) => console.warn( '⚠️ Persistencia no disponible:', err.code ) );

        firebaseInitialized = true;
        console.log( '✅ Firebase inicializado en Service Worker' );
    } catch ( error ) {
        console.error( '❌ Error inicializando Firebase:', error );
    }
}

// ====================================
// SISTEMA DE NOTIFICACIONES
// ====================================

// Verificar y enviar notificaciones
async function checkAndSendNotifications() {
    if ( !currentUserId ) {
        console.log( '⚠️ No hay usuario para notificaciones' );
        return;
    }

    const now = new Date();
    const today = formatDate( now );
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const tasks = await loadTasksFromCache();
    const todayTasks = tasks[ today ] || [];

    if ( todayTasks.length === 0 ) {
        console.log( '📭 No hay tareas para hoy' );
        return;
    }

    // Revisar cada tarea
    for ( const task of todayTasks ) {
        if ( !task.time || task.state === 'completed' ) continue;

        const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );
        const taskTimeInMinutes = taskHours * 60 + taskMinutes;
        const currentTimeInMinutes = currentHour * 60 + currentMinute;

        // Notificación 15 minutos antes
        const reminderKey = `${task.id}-15min`;
        if (
            !sentNotifications.has( reminderKey ) &&
            currentTimeInMinutes >= taskTimeInMinutes - 15 &&
            currentTimeInMinutes <= taskTimeInMinutes - 13 &&
            task.state === 'pending'
        ) {
            await sendNotification( {
                title: `⏰ Recordatorio: ${task.title}`,
                body: `Inicia en 15 minutos (${task.time})`,
                tag: reminderKey,
                requireInteraction: false,
                vibrate: [ 300, 100, 300 ]
            } );
            sentNotifications.add( reminderKey );
        }

        // Notificación hora exacta
        const startKey = `${task.id}-start`;
        if (
            !sentNotifications.has( startKey ) &&
            currentTimeInMinutes >= taskTimeInMinutes &&
            currentTimeInMinutes <= taskTimeInMinutes + 2 &&
            task.state === 'pending'
        ) {
            await sendNotification( {
                title: `🔔 Es hora de: ${task.title}`,
                body: `Programada para ${task.time}`,
                tag: startKey,
                requireInteraction: true,
                vibrate: [ 200, 50, 200, 50, 400 ]
            } );
            sentNotifications.add( startKey );
        }

        // Notificación de retraso (30 min después)
        const lateKey = `${task.id}-late`;
        if (
            !sentNotifications.has( lateKey ) &&
            currentTimeInMinutes >= taskTimeInMinutes + 30 &&
            task.state !== 'completed'
        ) {
            await sendNotification( {
                title: `⚠️ Tarea Retrasada: ${task.title}`,
                body: task.state === 'inProgress' ? 'Aún en proceso' : 'No iniciada - 30min de retraso',
                tag: lateKey,
                requireInteraction: false,
                vibrate: [ 100, 100, 100, 100, 100 ]
            } );
            sentNotifications.add( lateKey );
        }
    }

    // Notificaciones generales del día
    await sendDailySummaryNotifications( todayTasks, currentHour, currentMinute );
}

// Enviar notificaciones resumen del día
async function sendDailySummaryNotifications( tasks, hour, minute ) {
    const pendingTasks = tasks.filter( t => t.state === 'pending' );
    const inProgressTasks = tasks.filter( t => t.state === 'inProgress' );
    const totalActive = pendingTasks.length + inProgressTasks.length;

    // Buenos días (9:00)
    if ( !sentNotifications.has( 'morning' ) && hour === 9 && minute <= 1 && totalActive > 0 ) {
        let message = '';
        if ( pendingTasks.length > 0 ) {
            message += `${pendingTasks.length} pendiente${pendingTasks.length > 1 ? 's' : ''}`;
        }
        if ( inProgressTasks.length > 0 ) {
            if ( message ) message += ' y ';
            message += `${inProgressTasks.length} en proceso`;
        }

        await sendNotification( {
            title: '🌅 Buenos días',
            body: `Tienes ${message} para hoy`,
            tag: 'morning',
            requireInteraction: false,
            vibrate: [ 300, 200, 300 ]
        } );
        sentNotifications.add( 'morning' );
    }

    // Mediodía (12:00)
    if ( !sentNotifications.has( 'midday' ) && hour === 12 && minute <= 1 && pendingTasks.length > 0 ) {
        await sendNotification( {
            title: '🌞 Mediodía',
            body: `${pendingTasks.length} tarea${pendingTasks.length > 1 ? 's' : ''} pendiente${pendingTasks.length > 1 ? 's' : ''}`,
            tag: 'midday',
            requireInteraction: false,
            vibrate: [ 200, 100, 200 ]
        } );
        sentNotifications.add( 'midday' );
    }

    // Final del día (18:00)
    if ( !sentNotifications.has( 'evening' ) && hour === 18 && minute <= 1 && totalActive > 0 ) {
        await sendNotification( {
            title: '🌆 Final del día',
            body: `${totalActive} tarea${totalActive > 1 ? 's' : ''} sin completar`,
            tag: 'evening',
            requireInteraction: false,
            vibrate: [ 400, 200, 400 ]
        } );
        sentNotifications.add( 'evening' );
    }
}

// Enviar notificación física
async function sendNotification( options ) {
    const defaultOptions = {
        icon: '/images/IconLogo.png',
        badge: '/images/favicon-192.png',
        requireInteraction: false,
        vibrate: [ 200, 100, 200 ],
        data: { timestamp: Date.now() }
    };

    const finalOptions = { ...defaultOptions, ...options };

    try {
        await self.registration.showNotification( finalOptions.title, finalOptions );
        console.log( `✅ Notificación enviada: ${finalOptions.title}` );
    } catch ( error ) {
        console.error( '❌ Error enviando notificación:', error );
    }
}

// ====================================
// GESTIÓN DE TAREAS EN CACHÉ
// ====================================

// Cargar tareas desde IndexedDB
async function loadTasksFromCache() {
    try {
        const cache = await caches.open( 'app-data' );
        const response = await cache.match( 'tasks-data' );

        if ( response ) {
            const data = await response.json();
            return data.tasks || {};
        }

        return {};
    } catch ( error ) {
        console.error( '❌ Error cargando tareas:', error );
        return {};
    }
}

// Guardar tareas en caché
async function saveTasksToCache( tasks ) {
    try {
        const cache = await caches.open( 'app-data' );
        const data = {
            tasks,
            timestamp: Date.now()
        };

        const response = new Response( JSON.stringify( data ) );
        await cache.put( 'tasks-data', response );

        console.log( '💾 Tareas guardadas en caché SW' );
    } catch ( error ) {
        console.error( '❌ Error guardando tareas:', error );
    }
}

// Sincronizar tareas desde Firebase
async function syncTasksFromFirebase() {
    if ( !currentUserId || !db ) {
        console.log( '⚠️ No se puede sincronizar sin usuario' );
        return;
    }

    try {
        const userTasksRef = db.collection( 'users' ).doc( currentUserId ).collection( 'tasks' );
        const snapshot = await userTasksRef.get();

        if ( snapshot.empty ) {
            console.log( '📭 No hay tareas en Firebase' );
            return;
        }

        const tasks = {};
        snapshot.forEach( ( doc ) => {
            const task = doc.data();
            const date = task.date;

            if ( !tasks[ date ] ) {
                tasks[ date ] = [];
            }

            tasks[ date ].push( {
                id: task.id,
                title: task.title,
                description: task.description || '',
                time: task.time || '',
                state: task.state || 'pending',
                priority: task.priority || 3,
                completed: task.completed || false
            } );
        } );

        await saveTasksToCache( tasks );
        console.log( '✅ Tareas sincronizadas desde Firebase' );
    } catch ( error ) {
        console.error( '❌ Error sincronizando tareas:', error );
    }
}

// ====================================
// GESTIÓN DE DATOS DE USUARIO
// ====================================

async function saveUserData( userData ) {
    try {
        const cache = await caches.open( 'app-data' );
        const response = new Response( JSON.stringify( userData ) );
        await cache.put( 'user-data', response );
        console.log( '💾 Datos de usuario guardados' );
    } catch ( error ) {
        console.error( '❌ Error guardando datos de usuario:', error );
    }
}

async function loadUserData() {
    try {
        const cache = await caches.open( 'app-data' );
        const response = await cache.match( 'user-data' );

        if ( response ) {
            return await response.json();
        }

        return null;
    } catch ( error ) {
        console.error( '❌ Error cargando datos de usuario:', error );
        return null;
    }
}

async function clearUserData() {
    try {
        const cache = await caches.open( 'app-data' );
        await cache.delete( 'user-data' );
        await cache.delete( 'tasks-data' );
        console.log( '🗑️ Datos de usuario eliminados' );
    } catch ( error ) {
        console.error( '❌ Error eliminando datos:', error );
    }
}

async function clearTasksCache() {
    try {
        const cache = await caches.open( 'app-data' );
        await cache.delete( 'tasks-data' );
        console.log( '🗑️ Caché de tareas limpiada' );
    } catch ( error ) {
        console.error( '❌ Error limpiando tareas:', error );
    }
}

// ====================================
// PROGRAMACIÓN DE VERIFICACIONES
// ====================================

async function scheduleNextCheck() {
    // Verificar cada 30 segundos
    if ( notificationCheckInterval ) {
        clearInterval( notificationCheckInterval );
    }

    notificationCheckInterval = setInterval( async () => {
        await checkAndSendNotifications();
    }, 30000 ); // 30 segundos

    console.log( '⏰ Verificaciones programadas cada 30 segundos' );
}

// Programar notificaciones inteligentes
async function scheduleSmartNotifications() {
    if ( !currentUserId ) {
        console.log( '⚠️ No hay usuario, no se programan notificaciones' );
        return;
    }

    const tasks = await loadTasksFromCache();
    const now = new Date();
    const today = formatDate( now );
    const todayTasks = tasks[ today ] || [];

    if ( todayTasks.length === 0 ) {
        console.log( '📭 No hay tareas para hoy' );
        return;
    }

    console.log( `📅 ${todayTasks.length} tareas programadas para hoy` );
}

// ====================================
// INICIAR SISTEMA DE NOTIFICACIONES
// ====================================

async function startNotificationSystem() {
    console.log( '🚀 Iniciando sistema de notificaciones en SW' );

    // Inicializar Firebase
    initFirebaseInSW();

    // Sincronizar tareas desde Firebase
    await syncTasksFromFirebase();

    // Primera verificación
    await checkAndSendNotifications();

    // Programar notificaciones inteligentes
    await scheduleSmartNotifications();

    // Programar verificaciones periódicas
    await scheduleNextCheck();
}

// ====================================
// UTILIDADES
// ====================================

function formatDate( date ) {
    const year = date.getFullYear();
    const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( date.getDate() ).padStart( 2, '0' );
    return `${year}-${month}-${day}`;
}

// ====================================
// LISTENERS DE MENSAJES
// ====================================

self.addEventListener( 'message', async ( event ) => {
    const { type, data } = event.data;

    switch ( type ) {
        case 'SET_USER_ID':
            currentUserId = data.userId;
            await saveUserData( {
                userId: data.userId,
                email: data.email,
                timestamp: Date.now()
            } );
            console.log( '👤 Usuario guardado en SW:', currentUserId );
            await startNotificationSystem();
            break;

        case 'LOGOUT':
            currentUserId = null;
            await clearUserData();
            await clearTasksCache();
            sentNotifications.clear();
            if ( notificationCheckInterval ) {
                clearInterval( notificationCheckInterval );
            }
            console.log( '👋 Usuario deslogueado, cache limpiado' );
            break;

        case 'UPDATE_TASKS':
            await saveTasksToCache( data.tasks );
            await scheduleSmartNotifications();
            console.log( '📝 Tareas actualizadas en cache SW' );
            break;

        case 'CHECK_NOTIFICATIONS_NOW':
            console.log( '🔔 Verificación forzada desde app' );
            await checkAndSendNotifications();
            await scheduleSmartNotifications();
            break;

        case 'CLEAR_TASK_NOTIFICATION':
            const taskId = data.taskId;
            sentNotifications.delete( `${taskId}-15min` );
            sentNotifications.delete( `${taskId}-start` );
            sentNotifications.delete( `${taskId}-late` );
            console.log( `🧹 Notificaciones limpiadas para tarea: ${taskId}` );
            break;

        case 'SYNC_REQUIRED':
            await syncTasksFromFirebase();
            break;
    }
} );

// ====================================
// LISTENER: Push Notifications (FCM)
// ====================================

self.addEventListener( 'push', async ( event ) => {
    console.log( '📥 Push notification recibida:', event );

    let notificationData = {
        title: 'Recordatorio de Tarea',
        body: 'Tienes tareas pendientes',
        icon: '/images/IconLogo.png',
        badge: '/images/favicon-192.png'
    };

    if ( event.data ) {
        try {
            const data = event.data.json();
            notificationData = {
                title: data.notification?.title || notificationData.title,
                body: data.notification?.body || notificationData.body,
                icon: data.notification?.icon || notificationData.icon,
                badge: data.notification?.badge || notificationData.badge,
                data: data.data || {}
            };
        } catch ( error ) {
            console.error( 'Error parseando push data:', error );
        }
    }

    event.waitUntil(
        self.registration.showNotification( notificationData.title, {
            body: notificationData.body,
            icon: notificationData.icon,
            badge: notificationData.badge,
            tag: 'fcm-notification',
            requireInteraction: true,
            vibrate: [ 200, 100, 200 ],
            data: notificationData.data
        } )
    );
} );

// ====================================
// LISTENER: Click en Notificación
// ====================================

self.addEventListener( 'notificationclick', async ( event ) => {
    console.log( '🖱️ Notificación clickeada:', event.notification.tag );

    event.notification.close();

    event.waitUntil(
        clients.matchAll( { type: 'window', includeUncontrolled: true } )
            .then( ( clientList ) => {
                // Si hay una ventana abierta, enfocarla
                for ( const client of clientList ) {
                    if ( 'focus' in client ) {
                        return client.focus();
                    }
                }

                // Si no, abrir nueva ventana
                if ( clients.openWindow ) {
                    return clients.openWindow( '/' );
                }
            } )
    );
} );

// ====================================
// RESTAURAR SESIÓN AL INICIAR
// ====================================

( async function initServiceWorker() {
    console.log( '🔧 Inicializando Service Worker...' );

    // Cargar usuario guardado
    const userData = await loadUserData();

    if ( userData && userData.userId ) {
        currentUserId = userData.userId;
        console.log( '👤 Usuario restaurado:', currentUserId );

        // Iniciar sistema de notificaciones
        await startNotificationSystem();
    } else {
        console.log( '⚠️ No hay usuario guardado' );
    }
} )();

console.log( '✅ Service Worker v3.0 cargado - Con caché y notificaciones' );
