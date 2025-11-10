// firebase-messaging-sw.js
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js' );
importScripts( 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js' );

// Configuración de Firebase (la misma que en app.js)
const firebaseConfig = {
    apiKey: "AIzaSyD9Lwkgd9NqJ5I0termPqVZxNxFk5Y-J4s",
    authDomain: "calendario-tareas-app.firebaseapp.com",
    projectId: "calendario-tareas-app",
    storageBucket: "calendario-tareas-app.firebasestorage.app",
    messagingSenderId: "646091363424",
    appId: "1:646091363424:web:d923bbcc0224bd1bed5f05",
};

// Inicializar Firebase
firebase.initializeApp( firebaseConfig );

// Inicializar Messaging
const messaging = firebase.messaging();

// Manejar notificaciones en segundo plano
messaging.onBackgroundMessage( ( payload ) => {
    console.log( '📬 Notificación en segundo plano recibida:', payload );

    const notificationTitle = payload.notification?.title || 'Recordatorio de Tarea';
    const notificationOptions = {
        body: payload.notification?.body || 'Tienes tareas pendientes',
        icon: '/images/IconLogo.png',
        badge: '/images/favicon-192.png',
        tag: payload.data?.tag || 'default-notification',
        requireInteraction: true,
        vibrate: [ 200, 100, 200 ],
        data: payload.data || {}
    };

    return self.registration.showNotification( notificationTitle, notificationOptions );
} );

// Manejar clics en notificaciones
self.addEventListener( 'notificationclick', ( event ) => {
    console.log( '🖱️ Notificación clickeada:', event.notification.tag );

    event.notification.close();

    event.waitUntil(
        clients.matchAll( { type: 'window', includeUncontrolled: true } )
            .then( ( clientList ) => {
                // Si ya hay una ventana abierta, enfocarla
                for ( const client of clientList ) {
                    if ( client.url === self.registration.scope && 'focus' in client ) {
                        return client.focus();
                    }
                }

                // Si no hay ventana abierta, abrir una nueva
                if ( clients.openWindow ) {
                    return clients.openWindow( '/' );
                }
            } )
    );
} );

console.log( '✅ firebase-messaging-sw.js cargado correctamente' );
