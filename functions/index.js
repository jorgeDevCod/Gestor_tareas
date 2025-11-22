const { onSchedule } = require( 'firebase-functions/v2/scheduler' );
const { onCall, HttpsError } = require( 'firebase-functions/v2/https' );
const admin = require( 'firebase-admin' );

admin.initializeApp();

// 🔥 FUNCIÓN PRINCIPAL: Verifica y envía notificaciones cada minuto
exports.checkTaskNotifications = onSchedule( 'every 1 minutes', async ( event ) => {
    console.log( '⏰ Verificando tareas programadas...' );

    const now = new Date();
    const today = formatDate( now );
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

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

                // 🔔 15 minutos antes
                if ( currentTimeInMinutes === taskTimeInMinutes - 15 ) {
                    await sendNotification( fcmToken, {
                        title: `⏰ Recordatorio: ${task.title}`,
                        body: `Tu tarea inicia en 15 minutos (${task.time})`,
                        tag: `${task.id}-15min`,
                        taskId: task.id,
                        dateStr: today,
                        type: 'task-reminder'
                    } );
                    console.log( `✅ Notificación 15min enviada: ${task.title}` );
                }

                // 🔔 Hora exacta
                if ( currentTimeInMinutes === taskTimeInMinutes ) {
                    await sendNotification( fcmToken, {
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
                    await sendNotification( fcmToken, {
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
