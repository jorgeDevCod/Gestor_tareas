// ====================================
// AGREGAR AL INICIO DEL ARCHIVO (después de importScripts)
// ====================================

// Importar Firebase Messaging (CRÍTICO para FCM)
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js' );

// ====================================
// NUEVA VARIABLE GLOBAL
// ====================================
let messaging = null;

// ====================================
// MODIFICAR initFirebaseInSW() - AGREGAR MESSAGING
// ====================================
function initFirebaseInSW() {
    if ( firebaseInitialized ) return;

    try {
        firebase.initializeApp( FIREBASE_CONFIG );
        db = firebase.firestore();
        auth = firebase.auth();

        // ✅ NUEVO: Inicializar Messaging
        messaging = firebase.messaging();

        // Configurar persistencia offline
        db.enablePersistence( { synchronizeTabs: true } )
            .catch( err => console.warn( '⚠️ Persistencia no disponible:', err.code ) );

        firebaseInitialized = true;
        console.log( '✅ Firebase inicializado en Service Worker (con FCM)' );
    } catch ( error ) {
        console.error( '❌ Error inicializando Firebase:', error );
    }
}

// ====================================
// NUEVO LISTENER: Recibir notificaciones push de FCM
// ====================================
self.addEventListener( 'push', async ( event ) => {
    console.log( '📥 Push notification recibida:', event );

    let notificationData = {
        title: 'Recordatorio de Tarea',
        body: 'Tienes tareas pendientes',
        icon: '/images/IconLogo.png',
        badge: '/images/favicon-192.png'
    };

    // Si viene data del servidor, usarla
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
// NUEVO: Programar notificaciones inteligentes
// ====================================
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

    // Programar alarmas para cada tarea
    todayTasks.forEach( task => {
        if ( !task.time || task.state === 'completed' ) return;

        const [ hours, minutes ] = task.time.split( ':' ).map( Number );
        const taskDate = new Date( now );
        taskDate.setHours( hours, minutes, 0, 0 );

        // Si la tarea es futura, programar notificaciones
        if ( taskDate > now ) {
            // 15 minutos antes
            const reminder15 = new Date( taskDate.getTime() - 15 * 60000 );
            if ( reminder15 > now ) {
                scheduleNotificationAt( reminder15, {
                    title: `⏰ Recordatorio: ${task.title}`,
                    body: `Inicia en 15 minutos (${task.time})`,
                    tag: `${task.id}-15min`
                } );
            }

            // Hora exacta
            scheduleNotificationAt( taskDate, {
                title: `🔔 Es hora de: ${task.title}`,
                body: `Programada para ${task.time}`,
                tag: `${task.id}-start`
            } );
        }
    } );
}

function scheduleNotificationAt( date, notificationData ) {
    const delay = date.getTime() - Date.now();

    if ( delay > 0 && 'alarms' in chrome ) {
        // Usar Alarms API si está disponible
        const alarmName = `notification-${notificationData.tag}`;
        chrome.alarms.create( alarmName, {
            when: date.getTime()
        } );

        console.log( `⏰ Alarma programada: ${alarmName} para ${date.toLocaleTimeString()}` );
    } else if ( delay > 0 ) {
        // Fallback a setTimeout (menos confiable)
        setTimeout( async () => {
            await sendNotification( notificationData );
        }, delay );
    }
}

// ====================================
// MODIFICAR startNotificationSystem
// ====================================
async function startNotificationSystem() {
    console.log( '🚀 Iniciando sistema de notificaciones en SW' );

    // Sincronizar tareas desde Firebase
    await syncTasksFromFirebase();

    // Primera verificación
    await checkAndSendNotifications();

    // ✅ NUEVO: Programar notificaciones inteligentes
    await scheduleSmartNotifications();

    // Programar verificaciones con Alarms API
    await scheduleNextCheck();
}

// ====================================
// LISTENER DE MENSAJES: Actualizar cuando cambian tareas
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
        await scheduleSmartNotifications(); // ✅ NUEVO
    }

    if ( type === 'UPDATE_TASKS' ) {
        // CRÍTICO: Guardar tareas en cache del SW
        await saveTasksToCache( data.tasks );
        console.log( '📝 Tareas actualizadas en cache SW' );

        // ✅ NUEVO: Re-programar notificaciones cuando cambian las tareas
        await scheduleSmartNotifications();
    }

    // ✅ NUEVO: Recibir FCM token desde app.js
    if ( type === 'FCM_TOKEN' ) {
        console.log( '🔑 FCM Token recibido:', data.token );
        // El token se guarda automáticamente en Firebase
    }
} );

console.log( '✅ Service Worker v2.2 cargado - FCM habilitado' );
