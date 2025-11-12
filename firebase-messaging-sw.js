// ====================================
// SERVICE WORKER OPTIMIZADO v4.0
// Gestión de caché + Notificaciones push
// ====================================

// IMPORTS: Firebase (compat) - Solo para FCM
importScripts( 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js' );

// ====================================
// CONFIGURACIÓN
// ====================================
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD9Lwkgd9NqJ5I0termPqVZxNxFk5Y-J4s",
    authDomain: "calendario-tareas-app.firebaseapp.com",
    projectId: "calendario-tareas-app",
    storageBucket: "calendario-tareas-app.firebasestorage.app",
    messagingSenderId: "646091363424",
    appId: "1:646091363424:web:d923bbcc0224bd1bed5f05",
};

const CACHE_VERSION = 'v4.0';
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

// Variables globales
let currentUserId = null;
let tasksCache = {}; // Caché local de tareas
let notificationCheckInterval = null;
const sentNotifications = new Set();
const recentNotificationTags = new Map();
const DUPLICATE_WINDOW_MS = 5000;

// ====================================
// INICIALIZAR FIREBASE (SOLO MESSAGING)
// ====================================
let messaging = null;

if ( !firebase.apps.length ) {
    try {
        firebase.initializeApp( FIREBASE_CONFIG );
        console.log( '✅ Firebase inicializado en SW' );

        if ( typeof firebase.messaging !== 'undefined' && firebase.messaging.isSupported() ) {
            messaging = firebase.messaging();
            console.log( '✅ FCM inicializado' );
        } else {
            console.warn( '⚠️ FCM no soportado en este navegador' );
        }
    } catch ( e ) {
        console.error( '❌ Error inicializando Firebase en SW:', e );
    }
}

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

    // Limpiar entries viejos
    for ( const [ k, v ] of recentNotificationTags.entries() ) {
        if ( Date.now() - v > DUPLICATE_WINDOW_MS * 10 ) {
            recentNotificationTags.delete( k );
        }
    }
}

// ====================================
// INSTALL / ACTIVATE
// ====================================
self.addEventListener( 'install', ( event ) => {
    console.log( '🔧 Service Worker instalando...' );

    event.waitUntil(
        caches.open( CACHE_STATIC )
            .then( ( cache ) => {
                console.log( '📦 Cacheando archivos estáticos...' );
                return cache.addAll( STATIC_FILES );
            } )
            .then( () => self.skipWaiting() )
            .catch( ( err ) => console.error( '❌ Error cacheando archivos:', err ) )
    );
} );

self.addEventListener( 'activate', ( event ) => {
    console.log( '🚀 Service Worker activándose...' );

    event.waitUntil(
        caches.keys().then( ( cacheNames ) => {
            return Promise.all(
                cacheNames.map( ( cacheName ) => {
                    if ( ![ CACHE_STATIC, CACHE_DYNAMIC ].includes( cacheName ) ) {
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
self.addEventListener( 'fetch', ( event ) => {
    const { request } = event;
    const url = new URL( request.url );

    // Ignorar requests a Firebase/Google APIs
    if ( url.hostname.includes( 'googleapis.com' ) ||
        url.hostname.includes( 'firebaseapp.com' ) ||
        url.hostname.includes( 'google.com' ) ) {
        return;
    }

    // Network-first para API calls
    if ( url.pathname.includes( '/api/' ) ) {
        event.respondWith( networkFirst( request ) );
        return;
    }

    // Cache-first para assets estáticos
    if ( url.pathname.match( /\.(js|css|png|jpg|jpeg|svg|woff|woff2)$/ ) ) {
        event.respondWith( cacheFirst( request ) );
        return;
    }

    // Network-first para HTML
    event.respondWith( networkFirst( request ) );
} );

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
// MENSAJES DESDE LA APP
// ====================================
self.addEventListener( 'message', async ( event ) => {
    try {
        const { type, data } = event.data || {};

        switch ( type ) {
            case 'SET_USER_ID':
                currentUserId = data.userId;
                console.log( '👤 Usuario guardado en SW:', currentUserId );

                // Iniciar verificación de notificaciones
                if ( notificationCheckInterval ) clearInterval( notificationCheckInterval );
                await scheduleNextCheck();
                break;

            case 'LOGOUT':
                currentUserId = null;
                tasksCache = {};
                sentNotifications.clear();
                if ( notificationCheckInterval ) clearInterval( notificationCheckInterval );
                console.log( '👋 Usuario deslogueado, cache limpiado' );
                break;

            case 'UPDATE_TASKS':
                tasksCache = data.tasks || {};
                console.log( '📝 Tareas actualizadas en SW:', Object.keys( tasksCache ).length, 'días' );
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

            default:
                break;
        }
    } catch ( err ) {
        console.error( 'Error manejando message en SW:', err );
    }
} );

// ====================================
// NOTIFICACIONES
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

    if ( tagWasShownRecently( tag ) ) {
        console.log( '⚠️ Saltando notificación duplicada:', tag );
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

async function checkAndSendNotifications() {
    if ( !currentUserId ) return;

    const now = new Date();
    const today = formatDate( now );
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const todayTasks = tasksCache[ today ] || [];

    if ( todayTasks.length === 0 ) return;

    // Verificar tareas con hora específica
    for ( const task of todayTasks ) {
        if ( !task.time || task.state === 'completed' ) continue;

        const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );
        const taskTimeInMinutes = taskHours * 60 + taskMinutes;
        const currentTimeInMinutes = currentHour * 60 + currentMinute;

        // Recordatorio 15 minutos antes
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
        }

        // Notificación hora exacta
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
        }

        // Notificación tarea retrasada
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
        }
    }

    // Notificaciones resumen del día
    await sendDailySummaryNotifications( todayTasks, currentHour, currentMinute );
}

async function sendDailySummaryNotifications( tasks, hour, minute ) {
    const pendingTasks = tasks.filter( t => t.state === 'pending' );
    const inProgressTasks = tasks.filter( t => t.state === 'inProgress' );
    const totalActive = pendingTasks.length + inProgressTasks.length;

    if ( !totalActive ) return;

    // Buenos días (9:00)
    if ( !sentNotifications.has( 'morning' ) && hour === 9 && minute <= 1 ) {
        let message = '';
        if ( pendingTasks.length > 0 ) {
            message += `${pendingTasks.length} pendiente${pendingTasks.length > 1 ? 's' : ''}`;
        }
        if ( inProgressTasks.length > 0 ) {
            message += ( message ? ' y ' : '' ) + `${inProgressTasks.length} en proceso`;
        }

        await sendNotification( {
            title: '🌅 Buenos días',
            body: `Tienes ${message} para hoy`,
            tag: 'morning'
        } );
        sentNotifications.add( 'morning' );
    }

    // Mediodía (12:00)
    if ( !sentNotifications.has( 'midday' ) && hour === 12 && minute <= 1 && pendingTasks.length > 0 ) {
        await sendNotification( {
            title: '🌞 Mediodía',
            body: `${pendingTasks.length} tarea${pendingTasks.length > 1 ? 's' : ''} pendiente${pendingTasks.length > 1 ? 's' : ''}`,
            tag: 'midday'
        } );
        sentNotifications.add( 'midday' );
    }

    // Final del día (18:00)
    if ( !sentNotifications.has( 'evening' ) && hour === 18 && minute <= 1 && totalActive > 0 ) {
        await sendNotification( {
            title: '🌆 Final del día',
            body: `${totalActive} tarea${totalActive > 1 ? 's' : ''} sin completar`,
            tag: 'evening'
        } );
        sentNotifications.add( 'evening' );
    }
}

async function scheduleNextCheck() {
    if ( notificationCheckInterval ) clearInterval( notificationCheckInterval );

    await checkAndSendNotifications();

    notificationCheckInterval = setInterval( async () => {
        await checkAndSendNotifications();
    }, 30000 ); // Cada 30 segundos

    console.log( '⏰ Verificaciones programadas cada 30 segundos' );
}

// ====================================
// MANEJO DE NOTIFICACIONES FCM
// ====================================
if ( messaging && typeof messaging.onBackgroundMessage === 'function' ) {
    messaging.onBackgroundMessage( ( payload ) => {
        try {
            console.log( '📬 FCM onBackgroundMessage:', payload );

            const title = payload.notification?.title || 'Recordatorio de Tarea';
            const body = payload.notification?.body || '';
            const icon = payload.notification?.icon || '/images/IconLogo.png';
            const badge = payload.notification?.badge || '/images/favicon-192.png';
            const tag = payload.data?.tag || payload.notification?.tag || `fcm-${Date.now()}`;

            if ( tagWasShownRecently( tag ) ) {
                console.log( '⚠️ FCM: saltando duplicado tag:', tag );
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

// PUSH RAW (backup)
self.addEventListener( 'push', ( event ) => {
    try {
        if ( !event.data ) return;

        let payloadJson = {};
        try {
            payloadJson = event.data.json();
        } catch ( e ) {
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

// CLICK EN NOTIFICACIÓN
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
// INICIALIZACIÓN
// ====================================
console.log( '✅ Service Worker v4.0 cargado - Optimizado' );
