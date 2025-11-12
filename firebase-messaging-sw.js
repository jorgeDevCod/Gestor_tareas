// ====================================
// Versión: 3.2 - FCM optimizado para móvil
// ====================================

// IMPORTS: Firebase (compat) - Versión 10.x para mejor soporte móvil
importScripts( 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js' );

// ====================================
// CONFIGURACIÓN FIREBASE (igual que en app.js)
// ====================================
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD9Lwkgd9NqJ5I0termPqVZxNxFk5Y-J4s",
    authDomain: "calendario-tareas-app.firebaseapp.com",
    projectId: "calendario-tareas-app",
    storageBucket: "calendario-tareas-app.firebasestorage.app",
    messagingSenderId: "646091363424",
    appId: "1:646091363424:web:d923bbcc0224bd1bed5f05",
};

// Inicializar Firebase (solo una vez)
let app;
try {
    app = firebase.initializeApp( FIREBASE_CONFIG );
    console.log( '✅ Firebase inicializado en SW' );
} catch ( e ) {
    console.warn( '⚠️ Firebase init (ignorado si ya existía):', e.message || e );
}

// Servicios
let db = null;
let auth = null;
let messaging = null;

try {
    db = firebase.firestore();
    auth = firebase.auth();
    messaging = firebase.messaging();
    console.log( '✅ Servicios Firebase inicializados en SW' );
} catch ( e ) {
    console.error( '❌ Error inicializando servicios firebase en SW:', e );
}

// Servicios
let db = null;
let auth = null;
let messaging = null;
try {
    db = firebase.firestore();
    auth = firebase.auth();
    messaging = firebase.messaging();
} catch ( e ) {
    console.warn( 'Error inicializando servicios firebase en SW:', e.message || e );
}

// ====================================
// CACHÉ Y VARIABLES GLOBALES
// ====================================
const CACHE_VERSION = 'v3.2';
const CACHE_STATIC = `static-${CACHE_VERSION}`;
const CACHE_DYNAMIC = `dynamic-${CACHE_VERSION}`;
const CACHE_IMAGES = `images-${CACHE_VERSION}`;

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

let firebaseInitialized = true; // ya inicializamos arriba
let currentUserId = null;
let notificationCheckInterval = null;

// Control de notificaciones ya enviadas para evitar duplicados
const sentNotifications = new Set();
// Control de tags recientes para evitar race duplicates entre push/onBackgroundMessage
const recentNotificationTags = new Map(); // tag -> timestamp (ms)
const DUPLICATE_WINDOW_MS = 5000; // 5s

// ====================================
// HELPERS DE DEDUPLICADO
// ====================================
function tagWasShownRecently( tag ) {
    if ( !tag ) return false;
    const ts = recentNotificationTags.get( tag );
    if ( !ts ) return false;
    if ( Date.now() - ts < DUPLICATE_WINDOW_MS ) return true;
    recentNotificationTags.delete( tag );
    return false;
}
function markTagShown( tag ) {
    if ( !tag ) return;
    recentNotificationTags.set( tag, Date.now() );
    // limpiar entries viejos
    for ( const [ k, v ] of recentNotificationTags.entries() ) {
        if ( Date.now() - v > DUPLICATE_WINDOW_MS * 10 ) recentNotificationTags.delete( k );
    }
}

// ====================================
// INSTALL / ACTIVATE
// ====================================
self.addEventListener( 'install', ( event ) => {
    console.log( '🔧 Service Worker instalándose (unificado)...' );

    event.waitUntil(
        caches.open( CACHE_STATIC )
            .then( ( cache ) => {
                console.log( '📦 Cacheando archivos estáticos...' );
                return cache.addAll( STATIC_FILES );
            } )
            .then( () => self.skipWaiting() )
            .catch( ( err ) => console.error( '❌ Error cacheando archivos durante install:', err ) )
    );
} );

self.addEventListener( 'activate', ( event ) => {
    console.log( '🚀 Service Worker activándose (unificado)...' );

    event.waitUntil(
        caches.keys().then( ( cacheNames ) => {
            return Promise.all(
                cacheNames.map( ( cacheName ) => {
                    if ( ![ CACHE_STATIC, CACHE_DYNAMIC, CACHE_IMAGES ].includes( cacheName ) ) {
                        console.log( '🗑️ Eliminando caché antigua:', cacheName );
                        return caches.delete( cacheName );
                    }
                } )
            );
        } ).then( () => self.clients.claim() )
    );
} );

// ====================================
// FETCH STRATEGIES
// ====================================

async function cacheFirst( request ) {
    try {
        const cachedResponse = await caches.match( request );
        if ( cachedResponse ) return cachedResponse;
        const response = await fetch( request );
        if ( response && response.status === 200 ) {
            const cache = await caches.open( CACHE_DYNAMIC );
            cache.put( request, response.clone() );
        }
        return response;
    } catch ( err ) {
        console.error( 'cacheFirst error:', err );
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
    } catch ( err ) {
        const cachedResponse = await caches.match( request );
        if ( cachedResponse ) return cachedResponse;
        if ( request.mode === 'navigate' ) {
            const fallback = await caches.match( '/index.html' );
            if ( fallback ) return fallback;
        }
        return new Response( 'Offline', { status: 503 } );
    }
}

// ====================================
// FIRESTORE SYNC / CACHE TAREAS
// ====================================
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

async function saveTasksToCache( tasks ) {
    try {
        const cache = await caches.open( 'app-data' );
        const data = { tasks, timestamp: Date.now() };
        const response = new Response( JSON.stringify( data ) );
        await cache.put( 'tasks-data', response );
        console.log( '💾 Tareas guardadas en caché SW' );
    } catch ( error ) {
        console.error( '❌ Error guardando tareas:', error );
    }
}

async function syncTasksFromFirebase() {
    if ( !currentUserId || !db ) {
        console.log( '⚠️ No se puede sincronizar sin usuario o db' );
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
            if ( !tasks[ date ] ) tasks[ date ] = [];
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
// SISTEMA DE NOTIFICACIONES PROGRAMADAS
// ====================================
function formatDate( date ) {
    const year = date.getFullYear();
    const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( date.getDate() ).padStart( 2, '0' );
    return `${year}-${month}-${day}`;
}

async function sendNotification( options ) {
    const defaultOptions = {
        icon: '/images/IconLogo.png',
        badge: '/images/favicon-192.png',
        requireInteraction: false,
        vibrate: [ 200, 100, 200 ],
        data: { timestamp: Date.now() }
    };

    const finalOptions = { ...defaultOptions, ...options };
    const tag = finalOptions.tag || finalOptions.data?.tag || finalOptions.title;

    // dedupe by tag
    if ( tagWasShownRecently( tag ) ) {
        console.log( '⚠️ Saltando notificación duplicada (tag reciente):', tag );
        return;
    }
    markTagShown( tag );

    try {
        await self.registration.showNotification( finalOptions.title, finalOptions );
        console.log( '✅ Notificación enviada:', finalOptions.title );
        sentNotifications.add( tag );
    } catch ( error ) {
        console.error( '❌ Error enviando notificación:', error );
    }
}

async function sendDailySummaryNotifications( tasks, hour, minute ) {
    const pendingTasks = tasks.filter( t => t.state === 'pending' );
    const inProgressTasks = tasks.filter( t => t.state === 'inProgress' );
    const totalActive = pendingTasks.length + inProgressTasks.length;

    if ( !totalActive ) return;

    if ( !sentNotifications.has( 'morning' ) && hour === 9 && minute <= 1 && totalActive > 0 ) {
        let message = '';
        if ( pendingTasks.length > 0 ) message += `${pendingTasks.length} pendiente${pendingTasks.length > 1 ? 's' : ''}`;
        if ( inProgressTasks.length > 0 ) message += ( message ? ' y ' : '' ) + `${inProgressTasks.length} en proceso`;

        await sendNotification( {
            title: '🌅 Buenos días',
            body: `Tienes ${message} para hoy`,
            tag: 'morning'
        } );
        sentNotifications.add( 'morning' );
    }

    if ( !sentNotifications.has( 'midday' ) && hour === 12 && minute <= 1 && pendingTasks.length > 0 ) {
        await sendNotification( {
            title: '🌞 Mediodía',
            body: `${pendingTasks.length} tarea${pendingTasks.length > 1 ? 's' : ''} pendiente${pendingTasks.length > 1 ? 's' : ''}`,
            tag: 'midday'
        } );
        sentNotifications.add( 'midday' );
    }

    if ( !sentNotifications.has( 'evening' ) && hour === 18 && minute <= 1 && totalActive > 0 ) {
        await sendNotification( {
            title: '🌆 Final del día',
            body: `${totalActive} tarea${totalActive > 1 ? 's' : ''} sin completar`,
            tag: 'evening'
        } );
        sentNotifications.add( 'evening' );
    }
}

async function checkAndSendNotifications() {
    if ( !currentUserId ) {
        //console.log('⚠️ No hay usuario para notificaciones');
        return;
    }

    const now = new Date();
    const today = formatDate( now );
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const tasks = await loadTasksFromCache();
    const todayTasks = tasks[ today ] || [];

    if ( todayTasks.length === 0 ) {
        //console.log('📭 No hay tareas para hoy');
        return;
    }

    for ( const task of todayTasks ) {
        if ( !task.time || task.state === 'completed' ) continue;
        const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );
        const taskTimeInMinutes = taskHours * 60 + taskMinutes;
        const currentTimeInMinutes = currentHour * 60 + currentMinute;

        const reminderKey = `${task.id}-15min`;
        if ( !sentNotifications.has( reminderKey ) &&
            currentTimeInMinutes >= taskTimeInMinutes - 15 &&
            currentTimeInMinutes <= taskTimeInMinutes - 13 &&
            task.state === 'pending' ) {
            await sendNotification( {
                title: `⏰ Recordatorio: ${task.title}`,
                body: `Inicia en 15 minutos (${task.time})`,
                tag: reminderKey,
                requireInteraction: false,
                vibrate: [ 300, 100, 300 ]
            } );
            sentNotifications.add( reminderKey );
        }

        const startKey = `${task.id}-start`;
        if ( !sentNotifications.has( startKey ) &&
            currentTimeInMinutes >= taskTimeInMinutes &&
            currentTimeInMinutes <= taskTimeInMinutes + 2 &&
            task.state === 'pending' ) {
            await sendNotification( {
                title: `🔔 Es hora de: ${task.title}`,
                body: `Programada para ${task.time}`,
                tag: startKey,
                requireInteraction: true,
                vibrate: [ 200, 50, 200, 50, 400 ]
            } );
            sentNotifications.add( startKey );
        }

        const lateKey = `${task.id}-late`;
        if ( !sentNotifications.has( lateKey ) &&
            currentTimeInMinutes >= taskTimeInMinutes + 30 &&
            task.state !== 'completed' ) {
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

    await sendDailySummaryNotifications( todayTasks, currentHour, currentMinute );
}

async function scheduleNextCheck() {
    if ( notificationCheckInterval ) clearInterval( notificationCheckInterval );
    // Ejecutar inmediatamente y luego cada 30s
    await checkAndSendNotifications();
    notificationCheckInterval = setInterval( async () => {
        await checkAndSendNotifications();
    }, 30000 );
    console.log( '⏰ Verificaciones programadas cada 30 segundos' );
}

// ====================================
// MENSAJES DESDE LA APP (postMessage)
// ====================================
self.addEventListener( 'message', async ( event ) => {
    try {
        const { type, data } = event.data || {};
        switch ( type ) {
            case 'SET_USER_ID':
                currentUserId = data.userId;
                await saveUserData( { userId: data.userId, email: data.email, timestamp: Date.now() } );
                console.log( '👤 Usuario guardado en SW:', currentUserId );
                // iniciar sincronía y programaciones
                await syncTasksFromFirebase();
                await scheduleNextCheck();
                break;

            case 'LOGOUT':
                currentUserId = null;
                await clearUserData();
                await clearTasksCache();
                sentNotifications.clear();
                if ( notificationCheckInterval ) clearInterval( notificationCheckInterval );
                console.log( '👋 Usuario deslogueado, cache limpiado' );
                break;

            case 'UPDATE_TASKS':
                await saveTasksToCache( data.tasks );
                console.log( '📝 Tareas actualizadas en cache SW' );
                break;

            case 'CHECK_NOTIFICATIONS_NOW':
                console.log( '🔔 Verificación forzada desde app' );
                await checkAndSendNotifications();
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

            default:
                // console.log('Mensaje SW: tipo desconocido', type);
                break;
        }
    } catch ( err ) {
        console.error( 'Error manejando message en SW:', err );
    }
} );

// ====================================
// MANEJO DE NOTIFICACIONES EN BACKGROUND (FCM compat)
// ====================================
if ( messaging && typeof messaging.onBackgroundMessage === 'function' ) {
    messaging.onBackgroundMessage( ( payload ) => {
        try {
            console.log( '📬 onBackgroundMessage payload:', payload );
            const title = payload.notification?.title || 'Recordatorio de Tarea';
            const body = payload.notification?.body || '';
            const icon = payload.notification?.icon || '/images/IconLogo.png';
            const badge = payload.notification?.badge || '/images/favicon-192.png';
            const tag = payload.data?.tag || payload.notification?.tag || `fcm-${Date.now()}`;

            if ( tagWasShownRecently( tag ) ) {
                console.log( '⚠️ onBackgroundMessage: saltando duplicado tag:', tag );
                return;
            }
            markTagShown( tag );

            return self.registration.showNotification( title, {
                body,
                icon,
                badge,
                tag,
                requireInteraction: true,
                vibrate: [ 200, 100, 200 ],
                data: payload.data || {}
            } );
        } catch ( err ) {
            console.error( 'Error en onBackgroundMessage:', err );
        }
    } );
}

// ====================================
// PUSH RAW (por si llegan pushes sin pasar por la lib de firebase)
// ====================================
self.addEventListener( 'push', ( event ) => {
    try {
        console.log( '📥 Push raw recibido:', event );
        if ( !event.data ) {
            // puede ser un push vacío (heartbeat), ignorar o mostrar fallback
            return;
        }

        let payloadJson = {};
        try {
            payloadJson = event.data.json();
        } catch ( e ) {
            // no es JSON, tratar como texto
            payloadJson = { notification: { title: 'Notificación', body: event.data.text() } };
        }

        const title = payloadJson.notification?.title || 'Recordatorio de Tarea';
        const body = payloadJson.notification?.body || '';
        const icon = payloadJson.notification?.icon || '/images/IconLogo.png';
        const badge = payloadJson.notification?.badge || '/images/favicon-192.png';
        const tag = payloadJson.data?.tag || payloadJson.notification?.tag || `push-${Date.now()}`;

        if ( tagWasShownRecently( tag ) ) {
            console.log( '⚠️ push: saltando duplicado tag:', tag );
            return;
        }
        markTagShown( tag );

        event.waitUntil(
            self.registration.showNotification( title, {
                body,
                icon,
                badge,
                tag,
                requireInteraction: true,
                vibrate: [ 200, 100, 200 ],
                data: payloadJson.data || {}
            } )
        );
    } catch ( err ) {
        console.error( 'Error manejando push raw:', err );
    }
} );

// ====================================
// CLICK EN NOTIFICACIÓN
// ====================================
self.addEventListener( 'notificationclick', ( event ) => {
    console.log( '🖱️ Notificación clickeada:', event.notification?.tag );
    try {
        event.notification.close();
        event.waitUntil(
            clients.matchAll( { type: 'window', includeUncontrolled: true } ).then( ( clientList ) => {
                for ( const client of clientList ) {
                    if ( 'focus' in client ) return client.focus();
                }
                if ( clients.openWindow ) return clients.openWindow( '/' );
            } )
        );
    } catch ( err ) {
        console.error( 'Error en notificationclick:', err );
    }
} );

// ====================================
// GUARDAR / CARGAR DATOS DE USUARIO (cache app-data)
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
        if ( response ) return await response.json();
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
// INICIALIZACIÓN AL ARRANCAR EL SW
// ====================================
( async function initServiceWorker() {
    console.log( '🔧 Inicializando Service Worker (unificado) ...' );

    try {
        const userData = await loadUserData();
        if ( userData && userData.userId ) {
            currentUserId = userData.userId;
            console.log( '👤 Usuario restaurado:', currentUserId );
            // sincronizar tareas y arrancar programador si corresponde
            await syncTasksFromFirebase();
            await scheduleNextCheck();
        } else {
            console.log( '⚠️ No hay usuario guardado' );
        }
    } catch ( err ) {
        console.error( 'Error al initServiceWorker:', err );
    }

    console.log( '✅ firebase-messaging-sw.js cargado - Con caché y notificaciones' );
} )();
