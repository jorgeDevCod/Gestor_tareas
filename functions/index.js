const { onCall, HttpsError } = require( 'firebase-functions/v2/https' );
const admin = require( 'firebase-admin' );

admin.initializeApp();

// Idempotencia: reclama el tag en notifLog con create() (falla si existe).
// Evita duplicados si Cloud Tasks reintenta una alerta.
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

// ============================================================
// MODELO PUSH (reemplaza al scheduler minutal: ~10k invocaciones/sem
// → solo se ejecuta en las horas programadas de cada alerta).
// - Triggers de Firestore programan cada alerta exacta en Cloud Tasks.
// - dispatchAlert la envía al llegar su hora (valida + idempotente).
// - backfillAlerts programa lo ya existente (llamar una vez tras deploy).
// Requiere: cola Cloud Tasks `task-alerts` en la misma región y
// secreto ALERT_SECRET (`firebase functions:secrets:set ALERT_SECRET`).
// ============================================================
const { onDocumentWritten } = require( 'firebase-functions/v2/firestore' );
const { onRequest } = require( 'firebase-functions/v2/https' );
const ALERTS_LOCATION = 'us-central1'; // misma región que las functions
const ALERTS_QUEUE = 'task-alerts';
let tasksClient = null;
// Lazy-require: @google-cloud/tasks pesa mucho al importar; cargarlo solo
// en ejecución evita timeouts en el análisis del deploy.
function getTasksClient() {
    if ( !tasksClient ) {
        const { CloudTasksClient } = require( '@google-cloud/tasks' );
        tasksClient = new CloudTasksClient();
    }
    return tasksClient;
}
function alertsParent() {
    const project = process.env.GCLOUD_PROJECT;
    return getTasksClient().queuePath( project, ALERTS_LOCATION, ALERTS_QUEUE );
}
function sanitizeTaskName( s ) {
    return String( s ).replace( /[^A-Za-z0-9-_]/g, '-' ).slice( 0, 400 );
}
function alertTaskName( uid, docId, kind ) {
    return `${alertsParent()}/tasks/${sanitizeTaskName( `a-${uid}-${docId}-${kind}` )}`;
}

// 'YYYY-MM-DD' + 'HH:MM' en la zona del usuario → instante UTC
function tzOffsetMs( tz, utcMs ) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat( 'en-US', {
            timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
            day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        } ).formatToParts( new Date( utcMs ) ).map( p => [ p.type, p.value ] )
    );
    const asUTC = Date.UTC( parts.year, parts.month - 1, parts.day, ( parts.hour % 24 ), parts.minute, parts.second );
    return asUTC - utcMs;
}
function zonedTimeToUtc( dateStr, timeStr, tz ) {
    const [ Y, M, D ] = dateStr.split( '-' ).map( Number );
    const [ h, mi ] = String( timeStr ).split( ':' ).map( Number );
    const guess = Date.UTC( Y, M - 1, D, h || 0, mi || 0 );
    // utc = guess - offset; se refina contra el guess original (si se
    // restara dos veces seguidas, el offset se aplicaría doble).
    let utc = guess - tzOffsetMs( tz, guess );
    utc = guess - tzOffsetMs( tz, utc );
    return new Date( utc );
}

async function enqueueAlert( uid, name, atDate, payload ) {
    if ( atDate.getTime() <= Date.now() + 30000 ) return false; // ya pasó
    await getTasksClient().createTask( {
        parent: alertsParent(),
        task: {
            name,
            httpRequest: {
                httpMethod: 'POST',
                url: `https://${ALERTS_LOCATION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/dispatchAlert`,
                headers: { 'Content-Type': 'application/json', 'x-alert-secret': process.env.ALERT_SECRET || '' },
                body: Buffer.from( JSON.stringify( payload ) ).toString( 'base64' ),
            },
            scheduleTime: { seconds: Math.floor( atDate.getTime() / 1000 ) },
        },
    } );
    return true;
}

async function cancelAlerts( uid, names ) {
    for ( const name of names ) {
        try {
            await getTasksClient().deleteTask( { name } );
        } catch ( e ) {
            if ( e.code !== 5 ) throw e; // 5 = NOT_FOUND → ya no existía, ok
        }
    }
}

const TASK_ALERT_KINDS = [ '5min', 'start', 'late' ];
function taskAlertNames( uid, docId ) {
    return TASK_ALERT_KINDS.map( ( k ) => alertTaskName( uid, docId, k ) );
}

// Programa (o cancela si se borró/completó) las 3 alertas de una tarea
async function scheduleForTask( uid, docId, task, userTz ) {
    const names = taskAlertNames( uid, docId );
    await cancelAlerts( uid, names );
    if ( !task || !task.time || task.state === 'completed' ) return;
    const tz = userTz || 'America/Lima';
    const at = ( mins ) => new Date( zonedTimeToUtc( task.date, task.time, tz ).getTime() + mins * 60000 );
    const jobs = [
        [ '5min', -5, { title: `⏰ Recordatorio: ${task.title}`, body: `Tu tarea inicia en 5 minutos (${task.time})`, type: 'task-reminder' } ],
        [ 'start', 0, { title: `🔔 Es hora de: ${task.title}`, body: `Tu tarea programada para ${task.time}`, type: 'task-start', requiresAction: 'true' } ],
        [ 'late', 30, { title: `⚠️ Tarea Retrasada: ${task.title}`, body: 'Han pasado 30 minutos desde la hora programada', type: 'task-late' } ],
    ];
    for ( const [ kind, offset, text ] of jobs ) {
        await enqueueAlert( uid, alertTaskName( uid, docId, kind ), at( offset ), {
            uid, kind: `task-${kind}`, docId, dateStr: task.date, taskId: task.id || '',
            title: text.title, body: text.body, type: text.type,
            requiresAction: text.requiresAction || 'false',
            tag: `${task.id}-${kind === '5min' ? '5min' : kind}`,
            expectTime: task.time,
        } );
    }
}

// Programa alertas de un recordatorio (pago/festividad; horario = espejos)
async function scheduleForReminder( uid, rem, userTz ) {
    const prefix = `rem-${rem.id}`;
    const names = [ `${prefix}-due`, `${prefix}-late` ].map( ( k ) => `${alertsParent()}/tasks/${sanitizeTaskName( `a-${uid}-${k}` )}` );
    await cancelAlerts( uid, names );
    if ( !rem ) return;
    const tz = userTz || 'America/Lima';
    const dates = rem.kind === 'pago'
        ? ( rem.cuotas || [] ).map( ( c ) => ( { fecha: c.fecha, title: `💰 Vence hoy: ${rem.title}`, body: `${c.etiqueta} por S/ ${c.monto}`, type: 'task-reminder' } ) )
        : ( rem.dates || [] ).map( ( d ) => ( { fecha: d, title: rem.kind === 'festividad' ? `🎉 Hoy: ${rem.title}` : `🔔 ${rem.title}`, body: rem.description || '', type: 'task-reminder' } ) );
    const first = dates.filter( ( x ) => x.fecha ).sort( ( a, b ) => ( a.fecha < b.fecha ? -1 : 1 ) )[ 0 ];
    if ( !first ) return;
    // Aviso el mismo día 09:00 + primer día de retraso 09:00
    await enqueueAlert( uid, names[ 0 ], zonedTimeToUtc( first.fecha, '09:00', tz ), {
        uid, kind: 'rem-due', docId: rem.id, dateStr: first.fecha, taskId: '',
        title: first.title, body: first.body, type: first.type,
        tag: `rem-${rem.id}-${first.fecha}`,
    } );
    const lateDay = new Date( zonedTimeToUtc( first.fecha, '09:00', tz ).getTime() + 24 * 3600 * 1000 );
    await enqueueAlert( uid, names[ 1 ], lateDay, {
        uid, kind: 'rem-late', docId: rem.id, dateStr: first.fecha, taskId: '',
        title: `⚠️ Atrasado: ${rem.title}`, body: 'Ya pasó su fecha programada',
        type: 'task-late', tag: `rem-${rem.id}-${first.fecha}-late`,
    } );
}

async function userTz( uid ) {
    try {
        const doc = await admin.firestore().collection( 'users' ).doc( uid ).get();
        return doc.data()?.timezone || 'America/Lima';
    } catch ( e ) {
        return 'America/Lima';
    }
}

exports.onTaskWrite = onDocumentWritten( 'users/{uid}/tasks/{taskId}', async ( event ) => {
    const uid = event.params.uid;
    const after = event.data?.after?.data() || null;
    await scheduleForTask( uid, event.params.taskId, after, await userTz( uid ) );
} );

exports.onReminderWrite = onDocumentWritten( 'users/{uid}/reminders/{remId}', async ( event ) => {
    const uid = event.params.uid;
    const after = event.data?.after?.data() || null;
    await scheduleForReminder( uid, after ? { ...after, id: event.params.remId } : null, await userTz( uid ) );
} );

// Ejecuta la alerta programada: valida estado actual + idempotencia y envía
exports.dispatchAlert = onRequest( async ( req, res ) => {
    if ( req.method !== 'POST' ) {
        res.status( 405 ).send( 'Method Not Allowed' );
        return;
    }
    if ( !process.env.ALERT_SECRET || req.get( 'x-alert-secret' ) !== process.env.ALERT_SECRET ) {
        res.status( 403 ).send( 'Forbidden' );
        return;
    }
    const p = req.body || {};
    try {
        const userDoc = await admin.firestore().collection( 'users' ).doc( p.uid ).get();
        const token = userDoc.data()?.fcmToken;
        if ( !token ) {
            res.status( 200 ).send( 'no-token' );
            return;
        }
        // Revalidar contra el dato actual (evita avisos obsoletos)
        if ( p.kind?.startsWith( 'task-' ) ) {
            const snap = await admin.firestore().collection( 'users' ).doc( p.uid ).collection( 'tasks' ).doc( p.docId ).get();
            const t = snap.data();
            if ( !t || t.state === 'completed' ) {
                res.status( 200 ).send( 'stale' );
                return;
            }
            if ( t.time !== p.expectTime ) {
                res.status( 200 ).send( 'rescheduled' );
                return;
            }
        }
        const claimed = await claimNotification( p.uid, p.tag );
        if ( !claimed ) {
            res.status( 200 ).send( 'duplicate' );
            return;
        }
        await sendNotification( token, p );
        res.status( 200 ).send( 'sent' );
    } catch ( e ) {
        console.error( '❌ dispatchAlert:', e.message );
        res.status( 500 ).send( 'error' );
    }
} );

// Backfill único tras el deploy: programa lo ya existente (llamar 1 vez)
exports.backfillAlerts = onCall( async ( request ) => {
    if ( !request.auth ) {
        throw new HttpsError( 'unauthenticated', 'Usuario no autenticado' );
    }
    const usersSnap = await admin.firestore().collection( 'users' ).get();
    let n = 0;
    for ( const userDoc of usersSnap.docs ) {
        const uid = userDoc.id;
        const tz = userDoc.data()?.timezone || 'America/Lima';
        const tasksSnap = await admin.firestore().collection( 'users' ).doc( uid ).collection( 'tasks' ).get();
        for ( const d of tasksSnap.docs ) {
            await scheduleForTask( uid, d.id, d.data(), tz );
            n++;
        }
        const remSnap = await admin.firestore().collection( 'users' ).doc( uid ).collection( 'reminders' ).get();
        for ( const d of remSnap.docs ) {
            await scheduleForReminder( uid, { ...d.data(), id: d.id }, tz );
            n++;
        }
    }
    return { success: true, scheduled: n };
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
