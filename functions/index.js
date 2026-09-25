const { onSchedule } = require( 'firebase-functions/v2/scheduler' );
const { onCall, HttpsError } = require( 'firebase-functions/v2/https' );
const admin = require( 'firebase-admin' );

admin.initializeApp();

// Hora/fecha ACTUAL en la zona horaria del usuario.
// El servidor corre en UTC: usar getHours() desplazaba los avisos varias
// horas (llegaban "mucho antes"). La app guarda user.timezone (ver saveFCMToken).
function getUserLocalParts( timeZone ) {
    const tz = timeZone || 'America/Lima';
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat( 'en-CA', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
        } ).formatToParts( new Date() ).map( p => [ p.type, p.value ] )
    );
    return {
        today: `${parts.year}-${parts.month}-${parts.day}`,
        minutes: ( parseInt( parts.hour, 10 ) % 24 ) * 60 + parseInt( parts.minute, 10 ),
    };
}

// Idempotencia: reclama el tag en notifLog con create() (falla si existe).
// Evita duplicados si la función reintenta o se solapa en el mismo minuto.
async function claimNotification( userId, tag ) {
    const ref = admin.firestore()
        .collection( 'users' ).doc( userId )
        .collection( 'notifLog' ).doc( tag );
    try {
        await ref.create( { sentAt: admin.firestore.FieldValue.serverTimestamp() } );
        return true;
    } catch ( e ) {
        if ( e.code === 6 ) return false; // ALREADY_EXISTS → ya enviada
        throw e;
    }
}

async function sendOnce( userId, token, data ) {
    const claimed = await claimNotification( userId, data.tag );
    if ( !claimed ) {
        console.log( `⏭️ Duplicado evitado: ${data.tag}` );
        return null;
    }
    return sendNotification( token, data );
}

// Limpieza best-effort de notifLog mayor a 2 días (evita crecimiento infinito)
async function cleanupNotifLog( userId ) {
    try {
        const cutoff = new Date( Date.now() - 2 * 24 * 60 * 60 * 1000 );
        const snap = await admin.firestore()
            .collection( 'users' ).doc( userId )
            .collection( 'notifLog' )
            .where( 'sentAt', '<', cutoff )
            .limit( 100 )
            .get();
        if ( snap.empty ) return;
        const batch = admin.firestore().batch();
        snap.docs.forEach( d => batch.delete( d.ref ) );
        await batch.commit();
    } catch ( e ) {
        console.warn( '⚠️ Limpieza notifLog omitida:', e.message );
    }
}

// 🔥 FUNCIÓN PRINCIPAL: Verifica y envía notificaciones cada minuto
exports.checkTaskNotifications = onSchedule( 'every 1 minutes', async ( event ) => {
    console.log( '⏰ Verificando tareas programadas...' );

    try {
        const usersSnapshot = await admin.firestore().collection( 'users' ).get();

        if ( usersSnapshot.empty ) {
            console.log( '⚠️ No hay usuarios para verificar' );
            return;
        }

        for ( const userDoc of usersSnapshot.docs ) {
            const userId = userDoc.id;
            const userData = userDoc.data();
            const fcmToken = userData.fcmToken;

            if ( !fcmToken ) {
                console.log( `⚠️ Usuario ${userId} sin token FCM` );
                continue;
            }

            const { today, minutes: currentTimeInMinutes } = getUserLocalParts( userData.timezone );

            const tasksSnapshot = await admin.firestore()
                .collection( 'users' )
                .doc( userId )
                .collection( 'tasks' )
                .where( 'date', '==', today )
                .get();

            if ( tasksSnapshot.empty ) continue;

            for ( const taskDoc of tasksSnapshot.docs ) {
                const task = taskDoc.data();

                if ( !task.time || task.state === 'completed' ) continue;

                const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );
                const taskTimeInMinutes = taskHours * 60 + taskMinutes;

                // 🔔 5 minutos antes
                if ( currentTimeInMinutes === taskTimeInMinutes - 5 ) {
                    await sendOnce( userId, fcmToken, {
                        title: `⏰ Recordatorio: ${task.title}`,
                        body: `Tu tarea inicia en 5 minutos (${task.time})`,
                        tag: `${task.id}-5min`,
                        taskId: task.id,
                        dateStr: today,
                        type: 'task-reminder'
                    } );
                    console.log( `✅ Notificación 5min enviada: ${task.title}` );
                }

                // 🔔 Hora exacta
                if ( currentTimeInMinutes === taskTimeInMinutes ) {
                    await sendOnce( userId, fcmToken, {
                        title: `🔔 Es hora de: ${task.title}`,
                        body: `Tu tarea programada para ${task.time}`,
                        tag: `${task.id}-start`,
                        taskId: task.id,
                        dateStr: today,
                        type: 'task-start',
                        requiresAction: 'true'
                    } );
                    console.log( `✅ Notificación inicio enviada: ${task.title}` );
                }

                // 🔔 30 minutos tarde
                if ( currentTimeInMinutes === taskTimeInMinutes + 30 ) {
                    await sendOnce( userId, fcmToken, {
                        title: `⚠️ Tarea Retrasada: ${task.title}`,
                        body: 'Han pasado 30 minutos desde la hora programada',
                        tag: `${task.id}-late`,
                        taskId: task.id,
                        dateStr: today,
                        type: 'task-late'
                    } );
                    console.log( `⚠️ Notificación retraso enviada: ${task.title}` );
                }
            }

            await cleanupNotifLog( userId );
        }

        console.log( '✅ Verificación completada' );

    } catch ( error ) {
        console.error( '❌ Error verificando tareas:', error );
    }
} );

// 🔥 Enviar notificación FCM
async function sendNotification( token, data ) {
    const message = {
        notification: {
            title: data.title,
            body: data.body,
        },
        data: {
            taskId: data.taskId || '',
            dateStr: data.dateStr || '',
            tag: data.tag || `notification-${Date.now()}`,
            requiresAction: data.requiresAction || 'false',
            type: data.type || 'default',
            url: '/'
        },
        webpush: {
            notification: {
                icon: '/images/IconLogo.png',
                badge: '/images/favicon-192.png',
                vibrate: [ 200, 100, 200 ],
                requireInteraction: data.requiresAction === 'true'
            }
        },
        token: token
    };

    try {
        const response = await admin.messaging().send( message );
        return response;
    } catch ( error ) {
        console.error( '❌ Error enviando notificación:', error.code );
        throw error;
    }
}

// 🔥 Formatear fecha
function formatDate( date ) {
    const year = date.getFullYear();
    const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( date.getDate() ).padStart( 2, '0' );
    return `${year}-${month}-${day}`;
}

// 🔥 Función de prueba
exports.sendTestNotification = onCall( async ( request ) => {
    if ( !request.auth ) {
        throw new HttpsError( 'unauthenticated', 'Usuario no autenticado' );
    }

    const userId = request.auth.uid;

    const userDoc = await admin.firestore().collection( 'users' ).doc( userId ).get();
    const fcmToken = userDoc.data()?.fcmToken;

    if ( !fcmToken ) {
        throw new HttpsError( 'not-found', 'Token FCM no encontrado' );
    }

    await sendNotification( fcmToken, {
        title: '🧪 Notificación de Prueba',
        body: 'Si ves esto, las notificaciones funcionan correctamente',
        tag: 'test-notification',
        type: 'test'
    } );

    return { success: true, message: 'Notificación de prueba enviada' };
} );
