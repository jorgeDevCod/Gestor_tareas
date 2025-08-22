// Configuración de Firebase (DEBES REEMPLAZAR CON TUS CREDENCIALES)
const firebaseConfig = {
    apiKey: "AIzaSyD9Lwkgd9NqJ5I0termPqVZxNxFk5Y-J4s",
    authDomain: "calendario-tareas-app.firebaseapp.com",
    projectId: "calendario-tareas-app",
    storageBucket: "calendario-tareas-app.firebasestorage.app",
    messagingSenderId: "646091363424",
    appId: "1:646091363424:web:d923bbcc0224bd1bed5f05"
};

// Variables globales
let tasks = {};
let currentDate = new Date();
let notificationsEnabled = false;
let draggedTask = null;
let draggedFromDate = null;
let currentEditingTask = null;
let currentEditingDate = null;
let lastDeletedTask = null;
let lastDeletedDate = null;
let isOnline = navigator.onLine;
let currentUser = null;
let db = null;
let auth = null;
let syncInProgress = false;
let selectedDateForPanel = null;
let notificationInterval = null;

// Inicialización
document.addEventListener( 'DOMContentLoaded', function () {
    initFirebase();
    loadTasks();
    renderCalendar();
    updateProgress();
    setupEventListeners();
    requestNotificationPermission();
    initNotifications();
    setupDragAndDrop();
    setupTaskTooltips();
    setupNetworkListeners();
} );

// Inicializar Firebase
function initFirebase() {
    try {
        firebase.initializeApp( firebaseConfig );
        db = firebase.firestore();
        auth = firebase.auth();

        // Configurar persistencia offline con mejor manejo de errores
        db.enablePersistence( {
            synchronizeTabs: true
        } ).catch( error => {
            if ( error.code == 'failed-precondition' ) {
                console.warn( 'Persistencia falló: múltiples tabs abiertas' );
            } else if ( error.code == 'unimplemented' ) {
                console.warn( 'Persistencia no soportada en este navegador' );
            } else {
                console.warn( 'Error en persistencia de Firebase:', error );
            }
        } );

        // Escuchar cambios de autenticación
        auth.onAuthStateChanged( user => {
            currentUser = user;
            updateUI();

            if ( user ) {
                showFirebaseStatus( 'Conectado', 'success' );
                // Delay para evitar múltiples sincronizaciones simultáneas
                setTimeout( () => {
                    if ( isOnline && !syncInProgress ) {
                        syncFromFirebase();
                    }
                }, 1000 );
            } else {
                showFirebaseStatus( 'Desconectado', 'offline' );
            }
        } );

        hideLoadingScreen();

    } catch ( error ) {
        console.error( 'Error initializing Firebase:', error );
        showFirebaseStatus( 'Error de conexión', 'error' );
        hideLoadingScreen();
    }
}

const taskDateInput = document.getElementById( 'taskDate' );
if ( taskDateInput ) {
    const taskDateInput = document.getElementById( 'taskDate' );
    if ( taskDateInput ) {
        // ✅ Usar zona local en lugar de UTC
        const now = new Date();
        const year = now.getFullYear();
        const month = String( now.getMonth() + 1 ).padStart( 2, '0' );
        const day = String( now.getDate() ).padStart( 2, '0' );
        const today = `${year}-${month}-${day}`;

        taskDateInput.setAttribute( 'min', today );
    }
}


function initNotifications() {
    // Verificar si el navegador soporta notificaciones
    if ( !( 'Notification' in window ) ) {
        console.warn( 'Este navegador no soporta notificaciones' );
        return;
    }

    // Si ya tiene permisos, activar notificaciones
    if ( Notification.permission === 'granted' ) {
        notificationsEnabled = true;
        updateNotificationButton();
        startNotificationService();
    }

    // Actualizar el botón independientemente del estado
    updateNotificationButton();
}
// Configurar listeners de red
function setupNetworkListeners() {
    window.addEventListener( 'online', () => {
        isOnline = true;
        showFirebaseStatus( 'En línea', 'success' );
        if ( currentUser ) {
            syncFromFirebase();
        }
    } );

    window.addEventListener( 'offline', () => {
        isOnline = false;
        showFirebaseStatus( 'Sin conexión', 'offline' );
    } );
}

// Mostrar/ocultar loading screen
function hideLoadingScreen() {
    const loadingScreen = document.getElementById( 'loadingScreen' );
    loadingScreen.style.opacity = '0';
    setTimeout( () => {
        loadingScreen.style.display = 'none';
    }, 300 );
}

// Mostrar estado de Firebase
function showFirebaseStatus( text, type ) {
    const statusEl = document.getElementById( 'firebaseStatus' );
    const iconEl = document.getElementById( 'statusIcon' );
    const textEl = document.getElementById( 'statusText' );

    const statusConfig = {
        success: { class: 'bg-green-500 text-white', icon: 'fa-check-circle' },
        error: { class: 'bg-red-500 text-white', icon: 'fa-exclamation-triangle' },
        offline: { class: 'bg-gray-500 text-white', icon: 'fa-wifi' },
        syncing: { class: 'bg-blue-500 text-white', icon: 'fa-sync-alt fa-spin' }
    };

    const config = statusConfig[ type ] || statusConfig.offline;

    statusEl.className = `fixed top-4 left-4 px-3 py-2 rounded-lg text-sm font-medium z-40 ${config.class}`;
    iconEl.className = `fas ${config.icon} mr-2`;
    textEl.textContent = text;
    statusEl.classList.remove( 'hidden' );

    // Auto-hide después de 3 segundos (excepto para offline)
    if ( type !== 'offline' ) {
        setTimeout( () => {
            if ( type !== 'syncing' ) {
                statusEl.classList.add( 'hidden' );
            }
        }, 3000 );
    }
}

// Actualizar UI según estado de autenticación
function updateUI() {
    const loginBtn = document.getElementById( 'loginBtn' );
    const userInfo = document.getElementById( 'userInfo' );
    const syncBtn = document.getElementById( 'syncBtn' );

    if ( currentUser ) {
        loginBtn.classList.add( 'hidden' );
        userInfo.classList.remove( 'hidden' );
        syncBtn.disabled = false;

        document.getElementById( 'userName' ).textContent = currentUser.displayName || 'Usuario';
        document.getElementById( 'userEmail' ).textContent = currentUser.email;
        document.getElementById( 'userPhoto' ).src = currentUser.photoURL || 'https://via.placeholder.com/32';
    } else {
        loginBtn.classList.remove( 'hidden' );
        userInfo.classList.add( 'hidden' );
        syncBtn.disabled = true;
    }
}

// Iniciar sesión con Google
function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope( 'profile' );
    provider.addScope( 'email' );

    auth.signInWithPopup( provider )
        .then( result => {
            showNotification( 'Sesión iniciada correctamente', 'success' );
            closeLoginModal();
        } )
        .catch( error => {
            console.error( 'Error signing in:', error );
            showNotification( 'Error al iniciar sesión', 'error' );
        } );
}

// Cerrar sesión
function signOut() {
    if ( confirm( '¿Estás seguro de que quieres cerrar sesión?' ) ) {
        auth.signOut()
            .then( () => {
                showNotification( 'Sesión cerrada', 'info' );
            } )
            .catch( error => {
                console.error( 'Error signing out:', error );
            } );
    }
}

// Sincronizar tareas a Firebase
async function syncToFirebase() {
    if ( !currentUser || !isOnline || syncInProgress ) return;

    syncInProgress = true;
    showFirebaseStatus( 'Sincronizando...', 'syncing' );

    try {
        const userTasksRef = db.collection( 'users' ).doc( currentUser.uid ).collection( 'tasks' );

        // Obtener todas las tareas locales
        const allLocalTasks = [];
        Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
            dayTasks.forEach( task => {
                allLocalTasks.push( {
                    ...task,
                    date,
                    lastModified: new Date()
                } );
            } );
        } );

        // Subir tareas en lotes
        const batch = db.batch();
        allLocalTasks.forEach( task => {
            const taskRef = userTasksRef.doc( `${task.date}_${task.id}` );
            batch.set( taskRef, task, { merge: true } );
        } );

        await batch.commit();
        showFirebaseStatus( 'Sincronizado', 'success' );
        showNotification( 'Tareas sincronizadas', 'success' );

    } catch ( error ) {
        console.error( 'Error syncing to Firebase:', error );
        showFirebaseStatus( 'Error al sincronizar', 'error' );
        showNotification( 'Error al sincronizar con Firebase', 'error' );
    } finally {
        syncInProgress = false;
    }
}

// Sincronizar tareas desde Firebase
async function syncFromFirebase() {
    if ( !currentUser || !isOnline || syncInProgress ) return;

    syncInProgress = true;
    showFirebaseStatus( 'Descargando...', 'syncing' );

    try {
        const userTasksRef = db.collection( 'users' ).doc( currentUser.uid ).collection( 'tasks' );
        const snapshot = await userTasksRef.get();

        const firebaseTasks = {};
        const firebaseTaskIds = new Set(); // Para trackear qué tareas existen en Firebase

        snapshot.forEach( doc => {
            const task = doc.data();
            const date = task.date;

            firebaseTaskIds.add( `${date}_${task.id}` );

            if ( !firebaseTasks[ date ] ) {
                firebaseTasks[ date ] = [];
            }

            firebaseTasks[ date ].push( {
                id: task.id,
                title: task.title,
                description: task.description || '',
                time: task.time || '',
                completed: task.completed || false
            } );
        } );

        // ✅ NUEVO: Eliminar tareas locales que no existen en Firebase
        Object.keys( tasks ).forEach( date => {
            tasks[ date ] = tasks[ date ].filter( localTask => {
                const taskKey = `${date}_${localTask.id}`;
                return firebaseTaskIds.has( taskKey );
            } );

            // Limpiar fechas vacías
            if ( tasks[ date ].length === 0 ) {
                delete tasks[ date ];
            }
        } );

        // Agregar/actualizar tareas desde Firebase
        Object.keys( firebaseTasks ).forEach( date => {
            if ( !tasks[ date ] ) {
                tasks[ date ] = [];
            }

            firebaseTasks[ date ].forEach( firebaseTask => {
                const existingTaskIndex = tasks[ date ].findIndex( t => t.id === firebaseTask.id );
                if ( existingTaskIndex === -1 ) {
                    tasks[ date ].push( firebaseTask );
                } else {
                    // Actualizar tarea existente
                    tasks[ date ][ existingTaskIndex ] = { ...tasks[ date ][ existingTaskIndex ], ...firebaseTask };
                }
            } );
        } );

        saveTasks();
        renderCalendar();
        updateProgress();

        showFirebaseStatus( 'Sincronizado', 'success' );
        showNotification( 'Tareas sincronizadas', 'success' );

    } catch ( error ) {
        console.error( 'Error syncing from Firebase:', error );
        showFirebaseStatus( 'Error al descargar', 'error' );
        showNotification( 'Error al sincronizar', 'error' );
    } finally {
        syncInProgress = false;
    }
}

async function deleteTaskFromFirebase( dateStr, taskId ) {
    if ( !currentUser || !isOnline ) return;

    try {
        const userTasksRef = db.collection( 'users' ).doc( currentUser.uid ).collection( 'tasks' );
        const taskDocId = `${dateStr}_${taskId}`;

        await userTasksRef.doc( taskDocId ).delete();
        console.log( 'Tarea eliminada de Firebase:', taskDocId );
    } catch ( error ) {
        console.error( 'Error eliminando tarea de Firebase:', error );
    }
}

async function syncTaskToFirebase( dateStr, task ) {
    if ( !currentUser || !isOnline ) return;

    try {
        const userTasksRef = db.collection( 'users' ).doc( currentUser.uid ).collection( 'tasks' );
        const taskDocId = `${dateStr}_${task.id}`;

        await userTasksRef.doc( taskDocId ).set( {
            ...task,
            date: dateStr,
            lastModified: new Date()
        }, { merge: true } );

        console.log( 'Tarea sincronizada a Firebase:', taskDocId );
    } catch ( error ) {
        console.error( 'Error sincronizando tarea a Firebase:', error );
    }
}

// Configuración de eventos
function setupEventListeners() {
    const elements = {
        'taskForm': addTask,
        'prevMonth': () => changeMonth( -1 ),
        'nextMonth': () => changeMonth( 1 ),
        'closeModal': closeModal,
        'taskRepeat': toggleCustomDays,
        'clearWeekBtn': clearWeek,
        'clearMonthBtn': clearMonth,
        'exportExcelBtn': exportToExcel,
        'notificationsBtn': toggleNotifications,
        'syncBtn': syncToFirebase,
        'loginBtn': showLoginModal,
        'logoutBtn': signOut,
        'googleSignInBtn': signInWithGoogle,
        'closeLoginModal': closeLoginModal
    };

    Object.entries( elements ).forEach( ( [ id, handler ] ) => {
        const element = document.getElementById( id );
        if ( element ) {
            element.addEventListener( element.tagName === 'FORM' ? 'submit' : 'click', handler );
        }
    } );

    const closePanelBtn = document.getElementById( 'closePanelBtn' );
    const addQuickTaskBtn = document.getElementById( 'addQuickTaskBtn' );

    if ( closePanelBtn ) {
        closePanelBtn.addEventListener( 'click', closeDailyTaskPanel );
    }

    if ( addQuickTaskBtn ) {
        addQuickTaskBtn.addEventListener( 'click', addQuickTaskToSelectedDay );
    }
}

// Mostrar/cerrar modal de login
function showLoginModal() {
    document.getElementById( 'loginModal' ).classList.remove( 'hidden' );
}

function closeLoginModal() {
    document.getElementById( 'loginModal' ).classList.add( 'hidden' );
}

// Cargar tareas desde localStorage
function loadTasks() {
    try {
        const storedTasks = localStorage.getItem( 'tasks' );
        tasks = storedTasks ? JSON.parse( storedTasks ) : {};
    } catch ( error ) {
        tasks = {};
        console.warn( 'Error loading tasks from localStorage:', error );
    }
}

// Mostrar/ocultar días personalizados
function toggleCustomDays() {
    const select = document.getElementById( 'taskRepeat' );
    const customDays = document.getElementById( 'customDays' );
    customDays?.classList.toggle( 'hidden', select.value !== 'custom' );
}

// Agregar tarea
function addTask( e ) {
    e.preventDefault();

    const formData = {
        title: document.getElementById( 'taskTitle' ).value.trim(),
        description: document.getElementById( 'taskDescription' ).value.trim(),
        date: document.getElementById( 'taskDate' ).value,
        time: document.getElementById( 'taskTime' ).value,
        repeat: document.getElementById( 'taskRepeat' ).value
    };

    if ( !formData.title ) return;

    // Validar que no sea una fecha pasada
    if ( formData.date ) {
        const selectedDate = new Date( formData.date );
        const today = new Date();
        today.setHours( 0, 0, 0, 0 );

        if ( selectedDate < today ) {
            showNotification( 'No puedes agregar tareas a fechas anteriores. Por favor selecciona hoy o una fecha futura.', 'error' );
            return;
        }
    }

    const task = {
        id: Date.now().toString(),
        title: formData.title,
        description: formData.description,
        time: formData.time,
        completed: false
    };

    if ( formData.date && formData.repeat === 'none' ) {
        addTaskToDate( formData.date, task );
    } else if ( formData.repeat !== 'none' ) {
        const startDate = formData.date ? new Date( formData.date ) : new Date();
        addRecurringTasks( task, formData.repeat, startDate );
    }

    saveTasks();
    renderCalendar();
    updateProgress();
    document.getElementById( 'taskForm' ).reset();
    showNotification( 'Tarea agregada exitosamente' );

    // Sincronizar automáticamente si el usuario está logueado
    if ( currentUser && isOnline ) {
        setTimeout( () => syncToFirebase(), 1000 );
    }
}


// Agregar tarea a fecha específica
function addTaskToDate( dateStr, task ) {
    if ( !tasks[ dateStr ] ) tasks[ dateStr ] = [];
    tasks[ dateStr ].push( { ...task, id: `${dateStr}-${Date.now()}` } );
}

// Agregar tareas recurrentes
function addRecurringTasks( task, repeatType, startDate ) {
    const endDate = new Date( startDate );
    endDate.setMonth( endDate.getMonth() + 1 );
    let currentDate = new Date( startDate );

    while ( currentDate <= endDate ) {
        const dateStr = currentDate.toISOString().split( 'T' )[ 0 ];
        const dayOfWeek = currentDate.getDay();
        let shouldAdd = false;

        switch ( repeatType ) {
            case 'daily':
                shouldAdd = true;
                break;
            case 'weekdays':
                shouldAdd = dayOfWeek >= 1 && dayOfWeek <= 5;
                break;
            case 'weekends':
                shouldAdd = dayOfWeek === 0 || dayOfWeek === 6;
                break;
            case 'weekly':
                shouldAdd = dayOfWeek === startDate.getDay();
                break;
            case 'custom':
                const selectedDays = Array.from( document.querySelectorAll( '#customDays input:checked' ) )
                    .map( cb => parseInt( cb.value ) );
                shouldAdd = selectedDays.includes( dayOfWeek );
                break;
        }

        if ( shouldAdd ) addTaskToDate( dateStr, task );
        currentDate.setDate( currentDate.getDate() + 1 );
    }
}

// Renderizar calendario
function renderCalendar() {
    const calendar = document.getElementById( 'calendar' );
    const monthYear = document.getElementById( 'currentMonth' );

    if ( !calendar || !monthYear ) return;

    calendar.innerHTML = '';
    monthYear.textContent = currentDate.toLocaleDateString( 'es-ES', {
        month: 'long',
        year: 'numeric'
    } ).replace( /^\w/, c => c.toUpperCase() );

    // Agregar headers de días
    const dayHeaders = [ 'Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb' ];
    dayHeaders.forEach( day => {
        const dayElement = document.createElement( 'div' );
        dayElement.className = 'text-center font-semibold text-gray-600 py-2';
        dayElement.textContent = day;
        calendar.appendChild( dayElement );
    } );

    // Generar días del mes
    const firstDay = new Date( currentDate.getFullYear(), currentDate.getMonth(), 1 );
    const lastDay = new Date( currentDate.getFullYear(), currentDate.getMonth() + 1, 0 );
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    // Días vacíos al inicio
    for ( let i = 0; i < startingDayOfWeek; i++ ) {
        const emptyDay = document.createElement( 'div' );
        emptyDay.className = 'h-24 border border-gray-200';
        calendar.appendChild( emptyDay );
    }

    // Días del mes
    for ( let day = 1; day <= daysInMonth; day++ ) {
        const date = new Date( currentDate.getFullYear(), currentDate.getMonth(), day );
        const dateStr = date.toISOString().split( 'T' )[ 0 ];
        const dayTasks = tasks[ dateStr ] || [];

        calendar.appendChild( createDayElement( day, dateStr, dayTasks ) );
    }
}

// REEMPLAZAR completamente la función createDayElement:
function createDayElement( day, dateStr, dayTasks ) {
    const dayElement = document.createElement( 'div' );

    // ✅ CORRECCIÓN: Usar función local para obtener fecha actual
    const todayStr = getTodayString();
    const isToday = dateStr === todayStr;

    // Para fechas pasadas, comparar directamente con la fecha actual
    const today = new Date();
    const dayDate = new Date( dateStr );

    // Establecer ambas fechas a medianoche para comparación justa
    today.setHours( 0, 0, 0, 0 );
    dayDate.setHours( 0, 0, 0, 0 );

    const isPastDate = dayDate < today;

    // DEBUG detallado para días problemáticos
    if ( day >= 20 && day <= 25 ) {
        console.log( `📅 DEBUG día ${day}:`, {
            dateStr,
            todayStr,
            isToday,
            isPastDate,
            dayDate: dayDate.toLocaleDateString( 'es-PE' ),
            today: today.toLocaleDateString( 'es-PE' ),
            comparison: `${dayDate.getTime()} vs ${today.getTime()}`
        } );
    }

    dayElement.className = `h-24 border border-gray-200 p-1 cursor-pointer hover:bg-blue-50 transition relative calendar-day group ${isToday ? 'bg-blue-100 border-blue-300 ring-2 ring-blue-200' : ''} ${isPastDate ? 'opacity-75' : ''}`;
    dayElement.dataset.date = dateStr;

    dayElement.innerHTML = `
        <div class="font-semibold text-sm mb-1 ${isToday ? 'text-blue-700' : ''}">${day}</div>
        ${isToday ? '<div class="absolute top-0 right-1 text-blue-600 text-xs font-bold">HOY</div>' : ''}
        <div class="space-y-1">
            ${dayTasks.slice( 0, 2 ).map( task => createTaskElement( task, dateStr ) ).join( '' )}
            ${dayTasks.length > 2 ? `
                <div class="text-xs text-gray-500 cursor-pointer hover:text-blue-600 transition-colors" 
                     onclick="showDailyTaskPanel('${dateStr}', ${day})">
                    +${dayTasks.length - 2} más
                </div>
            ` : ''}
        </div>
        ${!isPastDate ? `
            <button onclick="event.stopPropagation(); showQuickAddTask('${dateStr}')"
                    class="absolute bottom-1 right-1 w-6 h-6 bg-green-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-green-600 flex items-center justify-center"
                    title="Agregar tarea rápida">
                <i class="fas fa-plus"></i>
            </button>
        ` : ''}
    `;

    dayElement.addEventListener( 'click', ( e ) => {
        if ( !e.target.closest( '.task-item' ) && !e.target.closest( 'button' ) ) {
            showDailyTaskPanel( dateStr, day );
        }
    } );

    return dayElement;
}


function getTodayString() {
    // Crear fecha actual en zona horaria local del navegador
    const now = new Date();

    // Obtener componentes de fecha locales
    const year = now.getFullYear();
    const month = String( now.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( now.getDate() ).padStart( 2, '0' );

    const todayStr = `${year}-${month}-${day}`;

    console.log( '🕐 Fecha actual (local):', {
        dateObject: now,
        formatted: todayStr,
        locale: now.toLocaleDateString( 'es-PE' ),
        time: now.toLocaleTimeString( 'es-PE' )
    } );

    return todayStr;
}

function showDailyTaskPanel( dateStr, day ) {
    const panel = document.getElementById( 'dailyTaskPanel' );
    const panelDate = document.getElementById( 'panelDate' );
    const taskList = document.getElementById( 'panelTaskList' );

    if ( !panel || !panelDate || !taskList ) return;

    selectedDateForPanel = dateStr;
    const dayTasks = tasks[ dateStr ] || [];

    // ✅ CORREGIDO: Usar directamente dateStr para crear la fecha
    const date = new Date( dateStr + 'T12:00:00' ); // Agregar tiempo para evitar problemas de zona horaria
    const today = new Date();
    today.setHours( 0, 0, 0, 0 );
    const selectedDate = new Date( date );
    selectedDate.setHours( 0, 0, 0, 0 );
    const isPastDate = selectedDate < today;

    // ✅ CORREGIDO: Mostrar la fecha correcta
    const dateOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/Lima' // Ajustar a tu zona horaria
    };

    console.log( '📅 Panel Info:', {
        dateStr,
        day,
        formattedDate: date.toLocaleDateString( 'es-ES', dateOptions ),
        tasksCount: dayTasks.length
    } );

    // Actualizar título del panel
    panelDate.innerHTML = `
        <i class="fas fa-tasks text-indigo-600 mr-2"></i>
        Tareas del ${day} - ${date.toLocaleDateString( 'es-ES', dateOptions )}
    `;

    // Actualizar lista de tareas
    if ( dayTasks.length === 0 ) {
        taskList.innerHTML = `
            <div class="text-center py-8 text-gray-500">
                <i class="fas fa-calendar-plus text-4xl mb-3 opacity-50"></i>
                <p>No hay tareas para este día</p>
                <p class="text-xs text-gray-400 mt-2">Fecha: ${dateStr}</p>
                ${!isPastDate ? '<p class="text-sm mt-2">¡Agrega tu primera tarea!</p>' : ''}
            </div>
        `;
    } else {
        taskList.innerHTML = dayTasks.map( task => createPanelTaskElement( task, dateStr ) ).join( '' );
    }

    // Actualizar progreso del día
    updatePanelProgress( dayTasks );

    // Mostrar/ocultar botón de agregar tarea según si es fecha pasada
    const addQuickTaskBtn = document.getElementById( 'addQuickTaskBtn' );
    if ( addQuickTaskBtn ) {
        if ( isPastDate ) {
            addQuickTaskBtn.style.display = 'none';
        } else {
            addQuickTaskBtn.style.display = 'flex';
        }
    }

    // Mostrar el panel
    panel.classList.remove( 'hidden' );

    // Scroll suave hacia el panel en dispositivos móviles
    if ( window.innerWidth < 768 ) {
        setTimeout( () => {
            panel.scrollIntoView( { behavior: 'smooth', block: 'start' } );
        }, 100 );
    }
}

// Crear elemento de tarea para el panel
function createPanelTaskElement( task, dateStr ) {
    const isPastDate = new Date( dateStr ) < new Date().setHours( 0, 0, 0, 0 );

    return `
        <div class="flex items-center justify-between p-4 border rounded-lg ${task.completed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'} hover:shadow-md transition-shadow">
            <div class="flex items-center space-x-3 flex-1">
                <input type="checkbox" ${task.completed ? 'checked' : ''}
                       onchange="toggleTaskFromPanel('${dateStr}', '${task.id}')"
                       class="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                <div class="flex-1">
                    <div class="font-medium ${task.completed ? 'line-through text-green-600' : 'text-gray-800'}">${task.title}</div>
                    ${task.description ? `<div class="text-sm text-gray-600 mt-1">${task.description}</div>` : ''}
                    ${task.time ? `<div class="text-xs text-indigo-600 mt-1"><i class="far fa-clock mr-1"></i>${task.time}</div>` : ''}
                </div>
            </div>
            ${!isPastDate ? `
                <div class="flex space-x-2">
                    <button onclick="showEditTaskModal('${dateStr}', '${task.id}')"
                            class="text-blue-500 hover:text-blue-700 p-2 rounded hover:bg-blue-50 transition">
                        <i class="fas fa-edit text-sm"></i>
                    </button>
                    <button onclick="deleteTaskFromPanel('${dateStr}', '${task.id}')"
                            class="text-red-500 hover:text-red-700 p-2 rounded hover:bg-red-50 transition">
                        <i class="fas fa-trash text-sm"></i>
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

// Crear elemento de tarea
function createTaskElement( task, dateStr ) {
    return `
                <div class="task-item-wrapper relative group/task">
                    <div class="text-xs p-1 rounded ${task.completed ? 'bg-green-200 text-green-800 line-through' : 'bg-blue-200 text-blue-800'} truncate task-item cursor-move pr-8"
                         data-task-id="${task.id}"
                         data-date="${dateStr}"
                         draggable="true"
                         title="${task.title}${task.time ? ' - ' + task.time : ''}">
                        <i class="fas fa-grip-lines mr-1 opacity-50"></i>
                        ${task.title}
                    </div>
                    <div class="absolute right-0 top-0 h-full flex items-center opacity-0 group-hover/task:opacity-100 transition-opacity duration-200 bg-gradient-to-l from-white via-white to-transparent pl-2">
                        <button onclick="event.stopPropagation(); quickEditTask('${dateStr}', '${task.id}')"
                                class="text-blue-500 hover:text-blue-700 text-xs p-1 rounded hover:bg-blue-100"
                                title="Editar tarea">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="event.stopPropagation(); quickDeleteTask('${dateStr}', '${task.id}')"
                                class="text-red-500 hover:text-red-700 text-xs p-1 rounded hover:bg-red-100 ml-1"
                                title="Eliminar tarea">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
}



// Actualizar progreso del panel
function updatePanelProgress( dayTasks ) {
    const progressBar = document.getElementById( 'panelProgressBar' );
    const progressText = document.getElementById( 'panelProgressText' );

    if ( !progressBar || !progressText ) return;

    const completedTasks = dayTasks.filter( task => task.completed ).length;
    const progress = dayTasks.length === 0 ? 0 : Math.round( ( completedTasks / dayTasks.length ) * 100 );

    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${progress}% (${completedTasks}/${dayTasks.length})`;
}

// Toggle task desde el panel
function toggleTaskFromPanel( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( task ) {
        task.completed = !task.completed;
        saveTasks();
        renderCalendar();
        updateProgress();

        // Actualizar el panel
        if ( selectedDateForPanel === dateStr ) {
            const dayTasks = tasks[ dateStr ] || [];
            updatePanelProgress( dayTasks );

            // Actualizar el elemento específico
            const taskElement = document.querySelector( `input[onchange="toggleTaskFromPanel('${dateStr}', '${taskId}')"]` );
            if ( taskElement ) {
                const container = taskElement.closest( 'div.border' );
                if ( container ) {
                    container.className = container.className.replace(
                        task.completed ? 'bg-gray-50 border-gray-200' : 'bg-green-50 border-green-200',
                        task.completed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                    );

                    const titleElement = container.querySelector( '.font-medium' );
                    if ( titleElement ) {
                        titleElement.className = `font-medium ${task.completed ? 'line-through text-green-600' : 'text-gray-800'}`;
                    }
                }
            }
        }

        // Sincronizar si está logueado
        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

// Eliminar tarea desde el panel
function deleteTaskFromPanel( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( !task ) return;

    if ( confirm( `¿Eliminar la tarea "${task.title}"?` ) ) {
        deleteTaskWithUndo( dateStr, taskId );

        // Actualizar el panel
        if ( selectedDateForPanel === dateStr ) {
            const day = new Date( dateStr ).getDate();
            showDailyTaskPanel( dateStr, day );
        }
    }
}

// Agregar tarea rápida al día seleccionado
function addQuickTaskToSelectedDay() {
    if ( !selectedDateForPanel ) return;

    const date = new Date( selectedDateForPanel );
    const today = new Date();
    today.setHours( 0, 0, 0, 0 );

    if ( date < today ) {
        showNotification( 'No puedes agregar tareas a fechas anteriores', 'error' );
        return;
    }

    const title = prompt( `Nueva tarea para ${date.toLocaleDateString( 'es-ES' )}:` );
    if ( title?.trim() ) {
        const task = {
            id: `${selectedDateForPanel}-${Date.now()}`,
            title: title.trim(),
            description: '',
            time: '',
            completed: false
        };

        addTaskToDate( selectedDateForPanel, task );
        saveTasks();
        renderCalendar();
        updateProgress();

        // Actualizar el panel
        const day = date.getDate();
        showDailyTaskPanel( selectedDateForPanel, day );

        showNotification( 'Tarea agregada exitosamente', 'success' );

        // Sincronizar si está logueado
        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

// Cerrar panel de tareas diarias
function closeDailyTaskPanel() {
    const panel = document.getElementById( 'dailyTaskPanel' );
    if ( panel ) {
        panel.classList.add( 'hidden' );
        selectedDateForPanel = null;
    }
}

// Edición rápida
function quickEditTask( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( !task ) return;

    const newTitle = prompt( 'Editar título de la tarea:', task.title );
    if ( newTitle !== null && newTitle.trim() ) {
        task.title = newTitle.trim();
        saveTasks();
        renderCalendar();
        showNotification( 'Tarea actualizada', 'success' );

        // Sincronizar si está logueado
        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

// Eliminación rápida
function quickDeleteTask( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( !task ) return;

    if ( confirm( `¿Eliminar la tarea "${task.title}"?` ) ) {
        deleteTaskWithUndo( dateStr, taskId );
    }
}

// Agregar tarea rápida
function showQuickAddTask( dateStr ) {
    const date = new Date( dateStr );
    const today = new Date();
    today.setHours( 0, 0, 0, 0 );

    if ( date < today ) {
        showNotification( 'No puedes agregar tareas a fechas anteriores', 'error' );
        return;
    }

    const title = prompt( 'Nueva tarea para ' + date.toLocaleDateString( 'es-ES' ) + ':' );
    if ( title?.trim() ) {
        const task = {
            id: `${dateStr}-${Date.now()}`,
            title: title.trim(),
            description: '',
            time: '',
            completed: false
        };

        addTaskToDate( dateStr, task );
        saveTasks();
        renderCalendar();
        updateProgress();
        showNotification( 'Tarea agregada rápidamente', 'success' );

        // Sincronizar si está logueado
        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

// Configurar tooltips
function setupTaskTooltips() {
    let tooltip = createTaskTooltip();

    document.addEventListener( 'mouseover', function ( e ) {
        if ( e.target.classList.contains( 'task-item' ) ) {
            const taskId = e.target.dataset.taskId;
            const dateStr = e.target.dataset.date;
            const task = tasks[ dateStr ]?.find( t => t.id === taskId );

            if ( task ) {
                showTooltip( tooltip, e.target, task );
            }
        }
    } );

    document.addEventListener( 'mouseout', function ( e ) {
        if ( e.target.classList.contains( 'task-item' ) ) {
            tooltip.classList.add( 'opacity-0' );
        }
    } );
}

// Crear tooltip
function createTaskTooltip() {
    const tooltip = document.createElement( 'div' );
    tooltip.id = 'task-tooltip';
    tooltip.className = 'fixed bg-gray-800 text-white text-xs rounded px-2 py-1 z-50 pointer-events-none opacity-0 transition-opacity duration-200 max-w-xs';
    document.body.appendChild( tooltip );
    return tooltip;
}

// Mostrar tooltip
function showTooltip( tooltip, target, task ) {
    const rect = target.getBoundingClientRect();
    tooltip.innerHTML = `
                <div class="font-semibold">${task.title}</div>
                ${task.description ? `<div class="text-gray-300">${task.description}</div>` : ''}
                ${task.time ? `<div class="text-blue-300"><i class="far fa-clock mr-1"></i>${task.time}</div>` : ''}
                <div class="text-gray-400 text-xs mt-1">
                    ${task.completed ? '✓ Completada' : 'Pendiente'} • Arrastra para mover
                </div>
            `;

    tooltip.style.left = Math.min( rect.left, window.innerWidth - tooltip.offsetWidth - 10 ) + 'px';
    tooltip.style.top = ( rect.top - tooltip.offsetHeight - 5 ) + 'px';
    tooltip.classList.remove( 'opacity-0' );
}

// Configurar drag and drop
function setupDragAndDrop() {
    const calendar = document.getElementById( 'calendar' );
    if ( !calendar ) return;

    calendar.addEventListener( 'dragstart', handleDragStart );
    calendar.addEventListener( 'dragend', handleDragEnd );
    calendar.addEventListener( 'dragover', handleDragOver );
    calendar.addEventListener( 'dragleave', handleDragLeave );
    calendar.addEventListener( 'drop', handleDrop );
}

function handleDragStart( e ) {
    if ( e.target.classList.contains( 'task-item' ) ) {
        e.stopPropagation();
        draggedTask = e.target.dataset.taskId;
        draggedFromDate = e.target.dataset.date;
        e.target.style.opacity = '0.5';
    }
}

function handleDragEnd( e ) {
    if ( e.target.classList.contains( 'task-item' ) ) {
        e.target.style.opacity = '1';
        draggedTask = null;
        draggedFromDate = null;
    }
}

function handleDragOver( e ) {
    e.preventDefault();
    const dayElement = e.target.closest( '.calendar-day' );
    if ( dayElement ) {
        dayElement.classList.add( 'bg-yellow-100' );
    }
}

function handleDragLeave( e ) {
    const dayElement = e.target.closest( '.calendar-day' );
    if ( dayElement ) {
        dayElement.classList.remove( 'bg-yellow-100' );
    }
}

function handleDrop( e ) {
    e.preventDefault();
    const dropTarget = e.target.closest( '.calendar-day' );

    if ( dropTarget && draggedTask && draggedFromDate ) {
        const targetDate = dropTarget.dataset.date;
        if ( targetDate !== draggedFromDate ) {
            moveTask( draggedFromDate, targetDate, draggedTask );
            showNotification( 'Tarea movida exitosamente', 'success' );
        }
    }

    // Limpiar estilos
    document.querySelectorAll( '.bg-yellow-100' ).forEach( el => {
        el.classList.remove( 'bg-yellow-100' );
    } );
}

// Mover tarea
function moveTask( fromDate, toDate, taskId ) {
    const fromTasks = tasks[ fromDate ];
    const taskIndex = fromTasks?.findIndex( t => t.id === taskId );

    if ( taskIndex !== -1 ) {
        const task = fromTasks.splice( taskIndex, 1 )[ 0 ];

        if ( fromTasks.length === 0 ) {
            delete tasks[ fromDate ];
        }

        if ( !tasks[ toDate ] ) tasks[ toDate ] = [];

        task.id = `${toDate}-${Date.now()}`;
        tasks[ toDate ].push( task );

        saveTasks();
        renderCalendar();
        updateProgress();

        // Sincronizar si está logueado
        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

// Mostrar tareas del día
function showDayTasks( dateStr, day ) {
    const modal = document.getElementById( 'taskModal' );
    const content = document.getElementById( 'modalContent' );
    const dayTasks = tasks[ dateStr ] || [];

    if ( !modal || !content ) return;

    content.innerHTML = `
                <div class="mb-4">
                    <h4 class="font-medium text-gray-800">Día ${day}</h4>
                    <p class="text-sm text-gray-600">${new Date( dateStr ).toLocaleDateString( 'es-ES', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    } )}</p>
                </div>
                <div class="space-y-2 max-h-60 overflow-y-auto">
                    ${dayTasks.length === 0 ?
            '<p class="text-gray-500">No hay tareas para este día</p>' :
            dayTasks.map( task => createModalTaskElement( task, dateStr ) ).join( '' )
        }
                </div>
            `;

    modal.classList.remove( 'hidden' );
    setTimeout( () => {
        modal.classList.remove( 'opacity-0' );
        modal.querySelector( '#modal-content-wrapper' ).classList.remove( 'scale-95' );
    }, 10 );
}

// Crear elemento de tarea para modal
function createModalTaskElement( task, dateStr ) {
    return `
                <div class="flex items-center justify-between p-3 border rounded-lg ${task.completed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}">
                    <div class="flex items-center space-x-3">
                        <input type="checkbox" ${task.completed ? 'checked' : ''}
                               onchange="toggleTask('${dateStr}', '${task.id}')"
                               class="rounded border-gray-300">
                        <div>
                            <div class="font-medium ${task.completed ? 'line-through text-green-600' : ''}">${task.title}</div>
                            ${task.description ? `<div class="text-sm text-gray-600">${task.description}</div>` : ''}
                            ${task.time ? `<div class="text-xs text-blue-600"><i class="far fa-clock mr-1"></i>${task.time}</div>` : ''}
                        </div>
                    </div>
                    <div class="flex space-x-2">
                        <button onclick="showEditTaskModal('${dateStr}', '${task.id}')"
                                class="text-blue-500 hover:text-blue-700">
                            <i class="fas fa-edit text-sm"></i>
                        </button>
                        <button onclick="deleteTask('${dateStr}', '${task.id}')"
                                class="text-red-500 hover:text-red-700">
                            <i class="fas fa-trash text-sm"></i>
                        </button>
                    </div>
                </div>
            `;
}

// Modal de edición
function showEditTaskModal( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( !task ) return;

    currentEditingTask = taskId;
    currentEditingDate = dateStr;

    const modal = document.createElement( 'div' );
    modal.id = 'editTaskModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    modal.innerHTML = `
                <div class="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold text-gray-800">
                            <i class="fas fa-edit text-blue-500 mr-2"></i>Editar Tarea
                        </h3>
                        <button onclick="closeEditModal()" class="text-gray-500 hover:text-gray-700">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <form id="editTaskForm" class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Título</label>
                            <input type="text" id="editTaskTitle" value="${task.title}" required 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
                            <textarea id="editTaskDescription" rows="3" 
                                      class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">${task.description || ''}</textarea>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Hora</label>
                            <input type="time" id="editTaskTime" value="${task.time || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        </div>
                        <div class="flex space-x-3">
                            <button type="submit" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition">
                                <i class="fas fa-save mr-2"></i>Guardar
                            </button>
                            <button type="button" onclick="closeEditModal()" class="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition">
                                Cancelar
                            </button>
                        </div>
                    </form>
                </div>
            `;

    document.body.appendChild( modal );
    document.getElementById( 'editTaskForm' ).addEventListener( 'submit', updateTask );
}

// Actualizar tarea
function updateTask( e ) {
    e.preventDefault();
    if ( !currentEditingTask || !currentEditingDate ) return;

    const formData = {
        title: document.getElementById( 'editTaskTitle' ).value.trim(),
        description: document.getElementById( 'editTaskDescription' ).value.trim(),
        time: document.getElementById( 'editTaskTime' ).value
    };

    const task = tasks[ currentEditingDate ]?.find( t => t.id === currentEditingTask );
    if ( task ) {
        Object.assign( task, formData );
        saveTasks();
        renderCalendar();
        updateProgress();
        closeEditModal();
        showDayTasks( currentEditingDate, new Date( currentEditingDate ).getDate() );
        showNotification( 'Tarea actualizada exitosamente', 'success' );

        // Sincronizar si está logueado
        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

// Cerrar modal de edición
function closeEditModal() {
    const modal = document.getElementById( 'editTaskModal' );
    modal?.remove();
    currentEditingTask = null;
    currentEditingDate = null;
}

// Cerrar modal principal
function closeModal() {
    const modal = document.getElementById( 'taskModal' );
    if ( modal ) {
        modal.classList.add( 'opacity-0' );
        modal.querySelector( '#modal-content-wrapper' ).classList.add( 'scale-95' );
        setTimeout( () => modal.classList.add( 'hidden' ), 300 );
    }
}

// Alternar completado de tarea
function toggleTask( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( task ) {
        task.completed = !task.completed;
        saveTasks();
        renderCalendar();
        updateProgress();
        showDayTasks( dateStr, new Date( dateStr ).getDate() );

        // Sincronizar si está logueado
        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

// Eliminar tarea con deshacer
function deleteTaskWithUndo( dateStr, taskId ) {
    const dayTasks = tasks[ dateStr ];
    const taskIndex = dayTasks?.findIndex( t => t.id === taskId );

    if ( taskIndex !== -1 ) {
        lastDeletedTask = { ...dayTasks[ taskIndex ] };
        lastDeletedDate = dateStr;

        // Eliminar localmente
        tasks[ dateStr ] = tasks[ dateStr ].filter( t => t.id !== taskId );
        if ( tasks[ dateStr ].length === 0 ) {
            delete tasks[ dateStr ];
        }

        // ✅ NUEVO: Eliminar también de Firebase
        if ( currentUser && isOnline ) {
            deleteTaskFromFirebase( dateStr, taskId );
        }

        saveTasks();
        renderCalendar();
        updateProgress();
        showDayTasks( dateStr, new Date( dateStr ).getDate() );
        showUndoNotification();
    }
}

// Mostrar notificación de deshacer
function showUndoNotification() {
    const notification = document.createElement( 'div' );
    notification.className = 'fixed bottom-4 left-4 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center space-x-3';
    notification.innerHTML = `
                <span>Tarea eliminada</span>
                <button onclick="undoDelete()" class="bg-blue-500 px-3 py-1 rounded text-sm hover:bg-blue-600 transition">
                    Deshacer
                </button>
                <button onclick="this.parentElement.remove()" class="text-gray-400 hover:text-white">
                    <i class="fas fa-times"></i>
                </button>
            `;

    document.body.appendChild( notification );
    setTimeout( () => notification.remove(), 5000 );
}

// Deshacer eliminación
function undoDelete() {
    if ( lastDeletedTask && lastDeletedDate ) {
        if ( !tasks[ lastDeletedDate ] ) tasks[ lastDeletedDate ] = [];

        // Restaurar localmente
        tasks[ lastDeletedDate ].push( lastDeletedTask );

        // ✅ NUEVO: Restaurar también en Firebase
        if ( currentUser && isOnline ) {
            syncTaskToFirebase( lastDeletedDate, lastDeletedTask );
        }

        saveTasks();
        renderCalendar();
        updateProgress();

        lastDeletedTask = null;
        lastDeletedDate = null;

        showNotification( 'Tarea restaurada exitosamente', 'success' );
        document.querySelector( '.fixed.bottom-4.left-4' )?.remove();
    }
}

// Alias para deleteTaskWithUndo
function deleteTask( dateStr, taskId ) {
    deleteTaskWithUndo( dateStr, taskId );
}

// Cambiar mes
function changeMonth( delta ) {
    currentDate.setMonth( currentDate.getMonth() + delta );
    renderCalendar();
    updateProgress();
}

// Limpiar semana
function clearWeek() {
    if ( !confirm( '¿Estás seguro de que quieres limpiar todas las tareas de esta semana?' ) ) return;

    const today = new Date();
    const startOfWeek = new Date( today );
    startOfWeek.setDate( today.getDate() - today.getDay() );

    for ( let i = 0; i < 7; i++ ) {
        const date = new Date( startOfWeek );
        date.setDate( startOfWeek.getDate() + i );
        const dateStr = date.toISOString().split( 'T' )[ 0 ];
        delete tasks[ dateStr ];
    }

    saveTasks();
    renderCalendar();
    updateProgress();
    showNotification( 'Semana limpiada exitosamente' );

    // Sincronizar si está logueado
    if ( currentUser && isOnline ) {
        setTimeout( () => syncToFirebase(), 500 );
    }
}

// Limpiar mes
function clearMonth() {
    if ( !confirm( '¿Estás seguro de que quieres limpiar todas las tareas de este mes?' ) ) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    Object.keys( tasks ).forEach( dateStr => {
        const date = new Date( dateStr );
        if ( date.getFullYear() === year && date.getMonth() === month ) {
            delete tasks[ dateStr ];
        }
    } );

    saveTasks();
    renderCalendar();
    updateProgress();
    showNotification( 'Mes limpiado exitosamente' );

    // Sincronizar si está logueado
    if ( currentUser && isOnline ) {
        setTimeout( () => syncToFirebase(), 500 );
    }
}

// Actualizar progreso
function updateProgress() {
    const today = getTodayString(); // Usar la nueva función
    const todayTasks = tasks[ today ] || [];
    const completedTasks = todayTasks.filter( task => task.completed ).length;
    const progress = todayTasks.length === 0 ? 0 : Math.round( ( completedTasks / todayTasks.length ) * 100 );

    const progressBar = document.getElementById( 'progressBar' );
    const progressText = document.getElementById( 'progressText' );

    if ( progressBar ) progressBar.style.width = `${progress}%`;
    if ( progressText ) progressText.textContent = `${progress}% (${completedTasks}/${todayTasks.length})`;

    console.log( '📊 Progreso actualizado:', {
        today,
        totalTasks: todayTasks.length,
        completedTasks,
        progress: `${progress}%`
    } );
}

// Exportar a Excel
function exportToExcel() {
    if ( typeof XLSX === 'undefined' ) {
        showNotification( 'Error: XLSX library not loaded', 'error' );
        return;
    }

    const wb = XLSX.utils.book_new();
    const data = [ [ 'Fecha', 'Título', 'Descripción', 'Hora', 'Completada' ] ];

    Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
        dayTasks.forEach( task => {
            data.push( [
                date,
                task.title,
                task.description || '',
                task.time || '',
                task.completed ? 'Sí' : 'No'
            ] );
        } );
    } );

    const ws = XLSX.utils.aoa_to_sheet( data );
    XLSX.utils.book_append_sheet( wb, ws, 'Tareas' );
    XLSX.writeFile( wb, `tareas_${new Date().toISOString().split( 'T' )[ 0 ]}.xlsx` );

    showNotification( 'Excel exportado exitosamente' );
}

// Solicitar permisos de notificación
function requestNotificationPermission() {
    if ( !( 'Notification' in window ) ) {
        showNotification( 'Este navegador no soporta notificaciones', 'error' );
        return Promise.resolve( 'denied' );
    }

    if ( Notification.permission === 'granted' ) {
        notificationsEnabled = true;
        updateNotificationButton();
        startNotificationService();
        return Promise.resolve( 'granted' );
    }

    return Notification.requestPermission().then( permission => {
        if ( permission === 'granted' ) {
            notificationsEnabled = true;
            updateNotificationButton();
            startNotificationService();
            showNotification( 'Notificaciones activadas correctamente', 'success' );
        } else {
            showNotification( 'Permisos de notificación denegados', 'error' );
        }
        return permission;
    } );
}

// Alternar notificaciones
function toggleNotifications() {
    if ( !( 'Notification' in window ) ) {
        showNotification( 'Este navegador no soporta notificaciones', 'error' );
        return;
    }

    if ( Notification.permission === 'granted' ) {
        notificationsEnabled = !notificationsEnabled;
        updateNotificationButton();

        if ( notificationsEnabled ) {
            startNotificationService();
            showNotification( 'Notificaciones activadas', 'success' );
        } else {
            stopNotificationService();
            showNotification( 'Notificaciones desactivadas', 'info' );
        }
    } else if ( Notification.permission === 'default' ) {
        requestNotificationPermission();
    } else {
        showNotification( 'Los permisos de notificación fueron denegados. Actívalos en la configuración del navegador.', 'error' );
    }
}

// Iniciar servicio de notificaciones
function startNotificationService() {
    // Limpiar intervalo anterior si existe
    if ( notificationInterval ) {
        clearInterval( notificationInterval );
        notificationInterval = null;
    }

    // Verificar que las notificaciones estén habilitadas y tengamos permisos
    if ( !notificationsEnabled || Notification.permission !== 'granted' ) {
        console.log( '❌ Notificaciones no habilitadas o sin permisos' );
        return;
    }

    console.log( '✅ Iniciando servicio de notificaciones' );

    // Verificar inmediatamente
    setTimeout( () => {
        try {
            checkDailyTasks();
        } catch ( error ) {
            console.error( 'Error en checkDailyTasks inicial:', error );
        }
    }, 2000 ); // Delay de 2 segundos para asegurar que todo esté cargado

    // ✅ CORREGIDO: Verificar cada 30 segundos para mejor precisión
    notificationInterval = setInterval( () => {
        try {
            if ( notificationsEnabled && Notification.permission === 'granted' ) {
                checkDailyTasks();
            } else {
                console.log( '⚠️ Notificaciones deshabilitadas en intervalo' );
                stopNotificationService();
            }
        } catch ( error ) {
            console.error( 'Error en intervalo de notificaciones:', error );
        }
    }, 30000 ); // 30 segundos para mejor precisión
}

// Detener servicio de notificaciones
function stopNotificationService() {
    if ( notificationInterval ) {
        clearInterval( notificationInterval );
        notificationInterval = null;
        console.log( 'Servicio de notificaciones detenido' );
    }
}

// Actualizar botón de notificaciones
function updateNotificationButton() {
    const btn = document.getElementById( 'notificationsBtn' );
    if ( !btn ) return;

    const hasPermission = Notification.permission === 'granted';

    if ( notificationsEnabled && hasPermission ) {
        btn.className = 'bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition duration-300';
        btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Notificaciones ON';
        btn.title = 'Notificaciones activadas - Click para desactivar';
    } else if ( hasPermission ) {
        btn.className = 'bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition duration-300';
        btn.innerHTML = '<i class="fas fa-bell-slash mr-2"></i>Notificaciones OFF';
        btn.title = 'Notificaciones desactivadas - Click para activar';
    } else {
        btn.className = 'bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition duration-300';
        btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Permitir Notificaciones';
        btn.title = 'Click para solicitar permisos de notificación';
    }
}

// Verificar tareas diarias
function checkDailyTasks() {
    if ( !notificationsEnabled || Notification.permission !== 'granted' ) {
        console.log( 'Notificaciones no habilitadas o sin permisos' );
        return;
    }

    const now = new Date();
    const today = now.toISOString().split( 'T' )[ 0 ];
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = `${currentHour.toString().padStart( 2, '0' )}:${currentMinute.toString().padStart( 2, '0' )}`;

    const todayTasks = tasks[ today ] || [];
    const pendingTasks = todayTasks.filter( task => !task.completed );

    console.log( '🔔 Verificando notificaciones:', {
        today,
        currentTime,
        pendingTasks: pendingTasks.length,
        totalTasks: todayTasks.length
    } );

    // ✅ CORREGIDO: Notificaciones en horarios específicos (verificar segundos también)
    const currentSeconds = now.getSeconds();

    // Solo notificar en el primer segundo del minuto para evitar spam
    if ( currentSeconds === 0 ) {
        // Notificación matutina (9:00 AM)
        if ( currentHour === 9 && currentMinute === 0 && pendingTasks.length > 0 ) {
            console.log( '🌅 Enviando notificación matutina' );
            showDesktopNotification( '¡Buenos días! 🌅',
                `Tienes ${pendingTasks.length} tarea${pendingTasks.length > 1 ? 's' : ''} pendiente${pendingTasks.length > 1 ? 's' : ''} para hoy`,
                'morning-reminder'
            );
        }

        // Notificación de medio día (12:00 PM)
        if ( currentHour === 12 && currentMinute === 0 && pendingTasks.length > 0 ) {
            console.log( '🌞 Enviando notificación de medio día' );
            showDesktopNotification( 'Recordatorio de medio día 🌞',
                `Aún tienes ${pendingTasks.length} tarea${pendingTasks.length > 1 ? 's' : ''} por completar`,
                'midday-reminder'
            );
        }

        // Notificación vespertina (6:00 PM)
        if ( currentHour === 18 && currentMinute === 0 && pendingTasks.length > 0 ) {
            console.log( '🌇 Enviando notificación vespertina' );
            showDesktopNotification( 'Recordatorio vespertino 🌇',
                `No olvides completar tus ${pendingTasks.length} tarea${pendingTasks.length > 1 ? 's' : ''} restante${pendingTasks.length > 1 ? 's' : ''}`,
                'evening-reminder'
            );
        }
    }

    // ✅ CORREGIDO: Notificaciones específicas por tiempo de tarea
    pendingTasks.forEach( task => {
        if ( task.time ) {
            const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );

            // Notificar 15 minutos antes (solo en el segundo 0)
            const reminderTime = new Date();
            reminderTime.setHours( taskHours, taskMinutes - 15, 0, 0 );

            if ( currentSeconds === 0 &&
                currentHour === reminderTime.getHours() &&
                currentMinute === reminderTime.getMinutes() ) {

                console.log( '⏰ Enviando recordatorio 15 min antes:', task.title );
                showDesktopNotification( `⏰ Recordatorio: ${task.title}`,
                    `Tu tarea comienza en 15 minutos (${task.time})`,
                    `task-reminder-${task.id}`,
                    true
                );
            }

            // Notificar al momento exacto (solo en el segundo 0)
            if ( currentSeconds === 0 &&
                currentHour === taskHours &&
                currentMinute === taskMinutes ) {

                console.log( '🚀 Enviando notificación de inicio:', task.title );
                showDesktopNotification( `🚀 Es hora: ${task.title}`,
                    task.description || `Tu tarea programada para las ${task.time}`,
                    `task-now-${task.id}`,
                    true
                );
            }
        }
    } );
}

function showDesktopNotification( title, body, tag, requireInteraction = false ) {
    try {
        const notification = new Notification( title, {
            body: body,
            icon: getFaviconAsDataUrl(),
            tag: tag,
            requireInteraction: requireInteraction,
            silent: false,
            badge: getFaviconAsDataUrl()
        } );

        // Agregar click handler
        notification.onclick = function () {
            window.focus();
            notification.close();
        };

        // Auto-close después de 10 segundos si no requiere interacción
        if ( !requireInteraction ) {
            setTimeout( () => {
                notification.close();
            }, 10000 );
        }

        console.log( '✅ Notificación enviada:', title );
    } catch ( error ) {
        console.error( '❌ Error enviando notificación:', error );
    }
}

// Obtener favicon como data URL para las notificaciones
function getFaviconAsDataUrl() {
    // Crear un ícono simple SVG como data URL
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="12" fill="#3B82F6"/>
            <path d="M20 32l8 8 16-16" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <circle cx="48" cy="16" r="6" fill="#EF4444"/>
        </svg>
    `;
    return `data:image/svg+xml;base64,${btoa( svg )}`;
}

// Mostrar notificación
function showNotification( message, type = 'success' ) {
    const notification = document.createElement( 'div' );
    const typeClasses = {
        success: 'bg-green-500 text-white fa-check-circle',
        error: 'bg-red-500 text-white fa-exclamation-circle',
        info: 'bg-blue-500 text-white fa-info-circle'
    };

    const { className, icon } = type in typeClasses ?
        { className: typeClasses[ type ].split( ' ' ).slice( 0, -1 ).join( ' ' ), icon: typeClasses[ type ].split( ' ' ).pop() } :
        { className: 'bg-blue-500 text-white', icon: 'fa-info-circle' };

    notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-x-full ${className}`;
    notification.innerHTML = `
                <div class="flex items-center space-x-2">
                    <i class="fas ${icon}"></i>
                    <span>${message}</span>
                </div>
            `;

    document.body.appendChild( notification );

    // Animación de entrada
    setTimeout( () => notification.classList.remove( 'translate-x-full' ), 100 );

    // Animación de salida
    setTimeout( () => {
        notification.classList.add( 'translate-x-full' );
        setTimeout( () => notification.remove(), 300 );
    }, 3000 );
}

// Guardar tareas en localStorage
function saveTasks() {
    try {
        localStorage.setItem( 'tasks', JSON.stringify( tasks ) );
    } catch ( error ) {
        console.error( 'Error saving tasks to localStorage:', error );
        showNotification( 'Error al guardar tareas', 'error' );
    }
}

// Verificar tareas cada minuto
setInterval( checkDailyTasks, 60000 );

// Auto-sincronización cada 5 minutos si está logueado y online
setInterval( () => {
    if ( currentUser && isOnline && !syncInProgress ) {
        syncFromFirebase();
    }
}, 5 * 60 * 1000 );
