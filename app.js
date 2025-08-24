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


// ✅ CORREGIDO: Función única para obtener fecha actual en formato local
function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String( now.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( now.getDate() ).padStart( 2, '0' );
    return `${year}-${month}-${day}`;
}

// ✅ CORREGIDO: Función para comparar fechas correctamente
function isDatePast( dateStr ) {
    const today = new Date();
    const checkDate = new Date( dateStr + 'T00:00:00' );

    // Establecer ambas fechas a medianoche para comparación justa
    today.setHours( 0, 0, 0, 0 );
    checkDate.setHours( 0, 0, 0, 0 );

    return checkDate < today;
}

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
    setupDateInput();
} );

// Configurar input de fecha
function setupDateInput() {
    const taskDateInput = document.getElementById( 'taskDate' );
    const taskTimeInput = document.getElementById( 'taskTime' );

    if ( taskDateInput ) {
        const today = getTodayString();
        taskDateInput.setAttribute( 'min', today );
        // Establecer fecha actual por defecto
        taskDateInput.value = today;
    }

    if ( taskTimeInput ) {
        // Establecer hora actual por defecto
        const now = new Date();
        const currentHour = String( now.getHours() ).padStart( 2, '0' );
        const currentMinute = String( now.getMinutes() ).padStart( 2, '0' );
        taskTimeInput.value = `${currentHour}:${currentMinute}`;
    }
}

// Inicializar Firebase
function initFirebase() {
    try {
        firebase.initializeApp( firebaseConfig );
        db = firebase.firestore();
        auth = firebase.auth();

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

        auth.onAuthStateChanged( user => {
            currentUser = user;
            updateUI();

            if ( user ) {
                showFirebaseStatus( 'Conectado', 'success' );
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

function initNotifications() {
    if ( !( 'Notification' in window ) ) {
        console.warn( 'Este navegador no soporta notificaciones' );
        return;
    }

    if ( Notification.permission === 'granted' ) {
        notificationsEnabled = true;
        updateNotificationButton();
        startNotificationService();
    }

    updateNotificationButton();
}

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

function hideLoadingScreen() {
    const loadingScreen = document.getElementById( 'loadingScreen' );
    loadingScreen.style.opacity = '0';
    setTimeout( () => {
        loadingScreen.style.display = 'none';
    }, 300 );
}

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

    if ( type !== 'offline' ) {
        setTimeout( () => {
            if ( type !== 'syncing' ) {
                statusEl.classList.add( 'hidden' );
            }
        }, 3000 );
    }
}

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

async function syncToFirebase() {
    if ( !currentUser || !isOnline || syncInProgress ) return;

    syncInProgress = true;
    showFirebaseStatus( 'Sincronizando...', 'syncing' );

    try {
        const userTasksRef = db.collection( 'users' ).doc( currentUser.uid ).collection( 'tasks' );

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

async function syncFromFirebase() {
    if ( !currentUser || !isOnline || syncInProgress ) return;

    syncInProgress = true;
    updateSyncButtonState();
    showFirebaseStatus( 'Descargando...', 'syncing' );

    try {
        const userTasksRef = db.collection( 'users' ).doc( currentUser.uid ).collection( 'tasks' );
        const snapshot = await userTasksRef.get();

        if ( snapshot.empty ) {
            console.log( 'No hay tareas remotas para sincronizar' );
            lastTasksSnapshot = generateTasksSnapshot();
            syncButtonBlocked = true;
            showFirebaseStatus( 'Sincronizado', 'success' );
            updateSyncButtonState();
            return;
        }

        // Obtener tareas remotas
        const remoteTasks = {};
        snapshot.forEach( doc => {
            const task = doc.data();
            const date = task.date;

            if ( !remoteTasks[ date ] ) {
                remoteTasks[ date ] = [];
            }

            remoteTasks[ date ].push( {
                id: task.id,
                title: task.title,
                description: task.description || '',
                time: task.time || '',
                completed: task.completed || false
            } );
        } );

        // Solo agregar tareas que no existen localmente
        let tasksAdded = 0;
        Object.keys( remoteTasks ).forEach( date => {
            if ( !tasks[ date ] ) {
                tasks[ date ] = [];
            }

            remoteTasks[ date ].forEach( remoteTask => {
                // Verificar si la tarea ya existe localmente
                const existsLocally = tasks[ date ].some( localTask =>
                    localTask.id === remoteTask.id ||
                    ( localTask.title === remoteTask.title && localTask.time === remoteTask.time )
                );

                // Solo agregar si no existe localmente
                if ( !existsLocally ) {
                    tasks[ date ].push( remoteTask );
                    tasksAdded++;
                }
            } );
        } );

        if ( tasksAdded > 0 ) {
            saveTasks();
            renderCalendar();
            updateProgress();
            showNotification( `${tasksAdded} tareas nuevas sincronizadas`, 'success' );
        } else {
            showNotification( 'Tareas ya están actualizadas', 'info' );
        }

        lastTasksSnapshot = generateTasksSnapshot();
        syncButtonBlocked = true;
        showFirebaseStatus( 'Sincronizado', 'success' );

        // Reiniciar notificaciones si están habilitadas
        if ( notificationsEnabled && Notification.permission === 'granted' ) {
            stopNotificationService();
            setTimeout( () => {
                startNotificationService();
            }, 1000 );
        }

    } catch ( error ) {
        console.error( 'Error syncing from Firebase:', error );
        showFirebaseStatus( 'Error al descargar', 'error' );
        showNotification( 'Error al sincronizar', 'error' );
    } finally {
        syncInProgress = false;
        updateSyncButtonState();
    }
}}

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

// ✅ MEJORADO: Configuración de eventos con botón reset
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
        'closeLoginModal': closeLoginModal,
        'resetFormBtn': resetForm,
        'clearAllBtn': clearAll
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

    // Event listeners para configuración avanzada
    const repeatDurationSelect = document.getElementById( 'repeatDuration' );
    const customDaysInputs = document.querySelectorAll( '#customDays input[type="checkbox"]' );
    const taskDateInput = document.getElementById( 'taskDate' ); // ✅ NUEVO

    if ( repeatDurationSelect ) {
        repeatDurationSelect.addEventListener( 'change', updateRepeatPreview );
    }

    // ✅ NUEVO: Recalcular cuando cambie la fecha de inicio
    if ( taskDateInput ) {
        taskDateInput.addEventListener( 'change', updateRepeatPreview );
    }

    customDaysInputs.forEach( input => {
        input.addEventListener( 'change', updateRepeatPreview );
    } );
}

// Función para resetear formulario
function resetForm() {
    const form = document.getElementById( 'taskForm' );
    const advancedConfig = document.getElementById( 'advancedRepeatConfig' );
    const customDays = document.getElementById( 'customDays' );
    const repeatDuration = document.getElementById( 'repeatDuration' );

    // Resetear formulario
    form.reset();

    // Ocultar configuración avanzada
    advancedConfig?.classList.add( 'hidden' );
    customDays?.classList.add( 'hidden' );

    // Resetear duración a valor por defecto
    if ( repeatDuration ) {
        repeatDuration.value = '2'; // Este mes y el siguiente
    }

    // Desmarcar todos los checkboxes de días personalizados
    const customDaysCheckboxes = document.querySelectorAll( '#customDays input[type="checkbox"]' );
    customDaysCheckboxes.forEach( checkbox => {
        checkbox.checked = false;
    } );

    // Restablecer valores por defecto de fecha y hora
    setupDateInput();

    showNotification( 'Formulario reiniciado', 'info' );

    // Auto-cerrar selector de hora
    const taskTimeInput = document.getElementById( 'taskTime' );
    if ( taskTimeInput ) {
        taskTimeInput.addEventListener( 'change', () => {
            setTimeout( () => {
                taskTimeInput.blur();
            }, 100 );
        } );

        // Para cerrar con Enter
        taskTimeInput.addEventListener( 'keydown', ( e ) => {
            if ( e.key === 'Enter' ) {
                taskTimeInput.blur();
            }
        } );
    }

    // Para inputs de tiempo dinámicos (como el modal de edición)
    document.addEventListener( 'change', ( e ) => {
        if ( e.target.type === 'time' ) {
            setTimeout( () => {
                e.target.blur();
            }, 100 );
        }
    } );

    document.addEventListener( 'keydown', ( e ) => {
        if ( e.target.type === 'time' && e.key === 'Enter' ) {
            e.target.blur();
        }
    } );
}

function showLoginModal() {
    document.getElementById( 'loginModal' ).classList.remove( 'hidden' );
}

function closeLoginModal() {
    document.getElementById( 'loginModal' ).classList.add( 'hidden' );
}

function loadTasks() {
    try {
        const storedTasks = localStorage.getItem( 'tasks' );
        tasks = storedTasks ? JSON.parse( storedTasks ) : {};
    } catch ( error ) {
        tasks = {};
        console.warn( 'Error loading tasks from localStorage:', error );
    }
}

function toggleCustomDays() {
    const select = document.getElementById( 'taskRepeat' );
    const advancedConfig = document.getElementById( 'advancedRepeatConfig' );
    const customDays = document.getElementById( 'customDays' );

    if ( select.value === 'none' ) {
        advancedConfig?.classList.add( 'hidden' );
    } else {
        advancedConfig?.classList.remove( 'hidden' );
        customDays?.classList.toggle( 'hidden', select.value !== 'custom' );
        updateRepeatPreview();
    }
}

// Actualizar vista previa de repetición
function updateRepeatPreview() {
    const repeatType = document.getElementById( 'taskRepeat' ).value;
    const duration = document.getElementById( 'repeatDuration' ).value;
    const previewText = document.getElementById( 'previewText' );
    const taskDate = document.getElementById( 'taskDate' ).value;

    if ( !previewText || repeatType === 'none' ) return;

    const durationText = {
        '1': 'lo que resta del mes actual',
        '2': 'lo que resta del mes actual y todo el mes siguiente',
        '3': 'los próximos 3 meses',
        '6': 'los próximos 6 meses',
        '12': 'el próximo año'
    };

    const typeText = {
        'daily': 'todos los días',
        'weekdays': 'días de semana (Lun-Vie)',
        'weekends': 'fines de semana (Sáb-Dom)',
        'weekly': 'cada semana (mismo día)',
        'custom': 'días personalizados'
    };

    let preview = `Se creará ${typeText[ repeatType ]} durante ${durationText[ duration ]}`;

    if ( repeatType === 'custom' ) {
        const selectedDays = Array.from( document.querySelectorAll( '#customDays input:checked' ) );
        if ( selectedDays.length > 0 ) {
            const dayNames = [ 'Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb' ];
            const selectedDayNames = selectedDays.map( cb => dayNames[ parseInt( cb.value ) ] );
            preview = `Se creará los ${selectedDayNames.join( ', ' )} durante ${durationText[ duration ]}`;
        } else {
            preview = 'Selecciona al menos un día';
        }
    }

    // ✅ NUEVO: Cálculo preciso de tareas basado en fechas reales
    const approxTasks = calculateExactTaskCount( repeatType, parseInt( duration ), taskDate );

    if ( approxTasks > 0 ) {
        preview += ` (~${approxTasks} tareas)`;
    }

    previewText.textContent = preview;
}

// ✅ NUEVA: Función para calcular cantidad exacta de tareas
function calculateExactTaskCount( repeatType, durationMonths, startDateStr ) {
    // Usar fecha actual si no hay fecha específica
    const startDate = startDateStr ? new Date( startDateStr + 'T00:00:00' ) : new Date();

    // ✅ CORREGIDO: Calcular fecha final igual que en addRecurringTasks
    let endDate;
    if ( durationMonths === 1 ) {
        // Solo este mes: hasta el último día del mes actual
        endDate = new Date( startDate.getFullYear(), startDate.getMonth() + 1, 0 );
    } else {
        // Otros casos: agregar meses completos
        endDate = new Date( startDate );
        endDate.setMonth( endDate.getMonth() + durationMonths );
        // Ajustar al último día del mes final
        endDate = new Date( endDate.getFullYear(), endDate.getMonth(), 0 );
    }

    let count = 0;
    let currentDate = new Date( startDate );

    // Obtener días seleccionados para opción custom
    let selectedDays = [];
    if ( repeatType === 'custom' ) {
        selectedDays = Array.from( document.querySelectorAll( '#customDays input:checked' ) )
            .map( cb => parseInt( cb.value ) );
        if ( selectedDays.length === 0 ) return 0;
    }

    // Contar día por día
    while ( currentDate <= endDate ) {
        const dayOfWeek = currentDate.getDay();
        let shouldCount = false;

        switch ( repeatType ) {
            case 'daily':
                shouldCount = true;
                break;
            case 'weekdays':
                shouldCount = dayOfWeek >= 1 && dayOfWeek <= 5;
                break;
            case 'weekends':
                shouldCount = dayOfWeek === 0 || dayOfWeek === 6;
                break;
            case 'weekly':
                shouldCount = dayOfWeek === startDate.getDay();
                break;
            case 'custom':
                shouldCount = selectedDays.includes( dayOfWeek );
                break;
        }

        // Solo contar si no es fecha pasada
        const currentDateStr = currentDate.toISOString().split( 'T' )[ 0 ];
        if ( shouldCount && !isDatePast( currentDateStr ) ) {
            count++;
        }

        currentDate.setDate( currentDate.getDate() + 1 );
    }

    return count;
}

// ✅ CORREGIDO: Validación de fechas mejorada
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

    // ✅ CORREGIDO: Validación de fecha usando función local
    if ( formData.date && isDatePast( formData.date ) ) {
        showNotification( 'No puedes agregar tareas a fechas anteriores. Por favor selecciona hoy o una fecha futura.', 'error' );
        return;
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
        const startDate = formData.date ? new Date( formData.date + 'T00:00:00' ) : new Date();
        addRecurringTasks( task, formData.repeat, startDate );
    }

    saveTasks();
    renderCalendar();
    updateProgress();
    document.getElementById( 'taskForm' ).reset();
    setupDateInput(); // 
    showNotification( 'Tarea agregada exitosamente' );

    if ( currentUser && isOnline ) {
        setTimeout( () => syncToFirebase(), 1000 );
    }

    const advancedConfig = document.getElementById( 'advancedRepeatConfig' );
    const customDays = document.getElementById( 'customDays' );
    const repeatDuration = document.getElementById( 'repeatDuration' );

    advancedConfig?.classList.add( 'hidden' );
    customDays?.classList.add( 'hidden' );

    // Resetear duración a valor por defecto
    if ( repeatDuration ) {
        repeatDuration.value = '2';
    }

    // Desmarcar checkboxes de días personalizados
    const customDaysCheckboxes = document.querySelectorAll( '#customDays input[type="checkbox"]' );
    customDaysCheckboxes.forEach( checkbox => {
        checkbox.checked = false;
    } );
}

function addTaskToDate( dateStr, task ) {
    if ( !tasks[ dateStr ] ) tasks[ dateStr ] = [];
    tasks[ dateStr ].push( { ...task, id: `${dateStr}-${Date.now()}` } );
}

function addRecurringTasks( task, repeatType, startDate ) {
    // Obtener duración configurada por el usuario
    const durationSelect = document.getElementById( 'repeatDuration' );
    const durationMonths = durationSelect ? parseInt( durationSelect.value ) : 2;

    let endDate;
    let currentDate = new Date( startDate );
    let tasksAdded = 0;

    // ✅ CORREGIDO: Calcular fecha final correctamente según duración seleccionada
    if ( durationMonths === 1 ) {
        // Solo este mes: hasta el último día del mes actual
        endDate = new Date( startDate.getFullYear(), startDate.getMonth() + 1, 0 );
    } else {
        // Otros casos: agregar meses completos
        endDate = new Date( startDate );
        endDate.setMonth( endDate.getMonth() + durationMonths );
        // Ajustar al último día del mes final
        endDate = new Date( endDate.getFullYear(), endDate.getMonth(), 0 );
    }

    // ✅ NUEVO: Obtener días seleccionados para custom antes del loop
    let selectedDays = [];
    if ( repeatType === 'custom' ) {
        selectedDays = Array.from( document.querySelectorAll( '#customDays input:checked' ) )
            .map( cb => parseInt( cb.value ) );
    }

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
                shouldAdd = selectedDays.includes( dayOfWeek ) && selectedDays.length > 0;
                break;
        }

        if ( shouldAdd && !isDatePast( dateStr ) ) {
            addTaskToDate( dateStr, task );
            tasksAdded++;
        }

        currentDate.setDate( currentDate.getDate() + 1 );
    }

    // ✅ MEJORADO: Mostrar resumen más detallado y preciso
    const durationText = {
        '1': 'lo que resta del mes actual',
        '2': 'lo que resta del mes actual y todo el mes siguiente',
        '3': 'los próximos 3 meses',
        '6': 'los próximos 6 meses',
        '12': 'el próximo año'
    };

    showNotification(
        `${tasksAdded} tareas agregadas para ${durationText[ durationMonths.toString() ] || `${durationMonths} meses`}`,
        'success'
    );
}

function renderCalendar() {
    const calendar = document.getElementById( 'calendar' );
    const monthYear = document.getElementById( 'currentMonth' );

    if ( !calendar || !monthYear ) return;

    calendar.innerHTML = '';
    monthYear.textContent = currentDate.toLocaleDateString( 'es-ES', {
        month: 'long',
        year: 'numeric'
    } ).replace( /^\w/, c => c.toUpperCase() );

    const dayHeaders = [ 'Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb' ];
    dayHeaders.forEach( day => {
        const dayElement = document.createElement( 'div' );
        dayElement.className = 'text-center font-semibold text-gray-600 py-2';
        dayElement.textContent = day;
        calendar.appendChild( dayElement );
    } );

    const firstDay = new Date( currentDate.getFullYear(), currentDate.getMonth(), 1 );
    const lastDay = new Date( currentDate.getFullYear(), currentDate.getMonth() + 1, 0 );
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    for ( let i = 0; i < startingDayOfWeek; i++ ) {
        const emptyDay = document.createElement( 'div' );
        emptyDay.className = 'h-24 border border-gray-200';
        calendar.appendChild( emptyDay );
    }

    for ( let day = 1; day <= daysInMonth; day++ ) {
        const date = new Date( currentDate.getFullYear(), currentDate.getMonth(), day );
        const dateStr = date.toISOString().split( 'T' )[ 0 ];
        const dayTasks = tasks[ dateStr ] || [];

        calendar.appendChild( createDayElement( day, dateStr, dayTasks ) );
    }
}

// ✅ CORREGIDO: Elemento del día sin etiqueta "HOY"
function createDayElement( day, dateStr, dayTasks ) {
    const dayElement = document.createElement( 'div' );

    const todayStr = getTodayString();
    const isToday = dateStr === todayStr;
    const isPastDate = isDatePast( dateStr );

    dayElement.className = `h-24 border border-gray-200 p-1 cursor-pointer hover:bg-blue-50 transition relative calendar-day group ${isToday ? 'bg-blue-100 border-blue-300 ring-2 ring-blue-200' : ''} ${isPastDate ? 'opacity-75' : ''}`;
    dayElement.dataset.date = dateStr;

    dayElement.innerHTML = `
        <div class="font-semibold text-sm mb-1 ${isToday ? 'text-blue-700' : ''}">${day}</div>
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

// ✅ CORREGIDO: Panel de tareas con mejor manejo de fechas
function showDailyTaskPanel( dateStr, day ) {
    const panel = document.getElementById( 'dailyTaskPanel' );
    const panelDate = document.getElementById( 'panelDate' );
    const taskList = document.getElementById( 'panelTaskList' );

    if ( !panel || !panelDate || !taskList ) return;

    selectedDateForPanel = dateStr;
    const dayTasks = tasks[ dateStr ] || [];

    const date = new Date( dateStr + 'T12:00:00' );
    const isPastDate = isDatePast( dateStr );

    const dateOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };

    panelDate.innerHTML = `
        <i class="fas fa-tasks text-indigo-600 mr-2"></i>
        Tareas del ${day} - ${date.toLocaleDateString( 'es-ES', dateOptions )}
    `;

    if ( dayTasks.length === 0 ) {
        taskList.innerHTML = `
            <div class="text-center py-8 text-gray-500">
                <i class="fas fa-calendar-plus text-4xl mb-3 opacity-50"></i>
                <p>No hay tareas para este día</p>
                ${!isPastDate ? '<p class="text-sm mt-2">¡Agrega tu primera tarea!</p>' : ''}
            </div>
        `;
    } else {
        taskList.innerHTML = dayTasks.map( task => createPanelTaskElement( task, dateStr ) ).join( '' );
    }

    updatePanelProgress( dayTasks );

    const addQuickTaskBtn = document.getElementById( 'addQuickTaskBtn' );
    if ( addQuickTaskBtn ) {
        addQuickTaskBtn.style.display = isPastDate ? 'none' : 'flex';
    }

    panel.classList.remove( 'hidden' );

    if ( window.innerWidth < 768 ) {
        setTimeout( () => {
            panel.scrollIntoView( { behavior: 'smooth', block: 'start' } );
        }, 100 );
    }
}

function createPanelTaskElement( task, dateStr ) {
    const isPastDate = isDatePast( dateStr );

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

function updatePanelProgress( dayTasks ) {
    const progressBar = document.getElementById( 'panelProgressBar' );
    const progressText = document.getElementById( 'panelProgressText' );

    if ( !progressBar || !progressText ) return;

    const completedTasks = dayTasks.filter( task => task.completed ).length;
    const progress = dayTasks.length === 0 ? 0 : Math.round( ( completedTasks / dayTasks.length ) * 100 );

    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${progress}% (${completedTasks}/${dayTasks.length})`;
}

function toggleTaskFromPanel( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( task ) {
        task.completed = !task.completed;
        saveTasks();
        renderCalendar();
        updateProgress();

        if ( selectedDateForPanel === dateStr ) {
            const dayTasks = tasks[ dateStr ] || [];
            updatePanelProgress( dayTasks );

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

        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

function deleteTaskFromPanel( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( !task ) return;

    if ( confirm( `¿Eliminar la tarea "${task.title}"?` ) ) {
        deleteTaskWithUndo( dateStr, taskId );

        if ( selectedDateForPanel === dateStr ) {
            const day = new Date( dateStr + 'T12:00:00' ).getDate();
            showDailyTaskPanel( dateStr, day );
        }
    }
}

// ✅ CORREGIDO: Validación mejorada para tareas rápidas
function addQuickTaskToSelectedDay() {
    if ( !selectedDateForPanel ) return;

    if ( isDatePast( selectedDateForPanel ) ) {
        showNotification( 'No puedes agregar tareas a fechas anteriores', 'error' );
        return;
    }

    const date = new Date( selectedDateForPanel + 'T12:00:00' );
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

        const day = date.getDate();
        showDailyTaskPanel( selectedDateForPanel, day );

        showNotification( 'Tarea agregada exitosamente', 'success' );

        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

function closeDailyTaskPanel() {
    const panel = document.getElementById( 'dailyTaskPanel' );
    if ( panel ) {
        panel.classList.add( 'hidden' );
        selectedDateForPanel = null;
    }
}

function quickEditTask( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( !task ) return;

    const newTitle = prompt( 'Editar título de la tarea:', task.title );
    if ( newTitle !== null && newTitle.trim() ) {
        task.title = newTitle.trim();
        saveTasks();
        renderCalendar();
        showNotification( 'Tarea actualizada', 'success' );

        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

function quickDeleteTask( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( !task ) return;

    if ( confirm( `¿Eliminar la tarea "${task.title}"?` ) ) {
        deleteTaskWithUndo( dateStr, taskId );
    }
}

// ✅ CORREGIDO: Validación de fecha en tarea rápida
function showQuickAddTask( dateStr ) {
    if ( isDatePast( dateStr ) ) {
        showNotification( 'No puedes agregar tareas a fechas anteriores', 'error' );
        return;
    }

    const date = new Date( dateStr + 'T12:00:00' );
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

        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

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

function createTaskTooltip() {
    const tooltip = document.createElement( 'div' );
    tooltip.id = 'task-tooltip';
    tooltip.className = 'fixed bg-gray-800 text-white text-xs rounded px-2 py-1 z-50 pointer-events-none opacity-0 transition-opacity duration-200 max-w-xs';
    document.body.appendChild( tooltip );
    return tooltip;
}

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

        // Verificar si la fecha destino es anterior a hoy
        if ( isDatePast( targetDate ) ) {
            showNotification( 'No puedes mover tareas a fechas anteriores', 'error' );

            // Remover efectos visuales
            document.querySelectorAll( '.bg-yellow-100' ).forEach( el => {
                el.classList.remove( 'bg-yellow-100' );
            } );
            return;
        }

        if ( targetDate !== draggedFromDate ) {
            moveTask( draggedFromDate, targetDate, draggedTask );
            showNotification( 'Tarea movida exitosamente', 'success' );
        }
    }

    document.querySelectorAll( '.bg-yellow-100' ).forEach( el => {
        el.classList.remove( 'bg-yellow-100' );
    } );
}

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

        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

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
        showNotification( 'Tarea actualizada exitosamente', 'success' );

        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

function closeEditModal() {
    const modal = document.getElementById( 'editTaskModal' );
    modal?.remove();
    currentEditingTask = null;
    currentEditingDate = null;
}

function closeModal() {
    const modal = document.getElementById( 'taskModal' );
    if ( modal ) {
        modal.classList.add( 'opacity-0' );
        modal.querySelector( '#modal-content-wrapper' ).classList.add( 'scale-95' );
        setTimeout( () => modal.classList.add( 'hidden' ), 300 );
    }
}

function toggleTask( dateStr, taskId ) {
    const task = tasks[ dateStr ]?.find( t => t.id === taskId );
    if ( task ) {
        task.completed = !task.completed;
        saveTasks();
        renderCalendar();
        updateProgress();

        if ( currentUser && isOnline ) {
            setTimeout( () => syncToFirebase(), 500 );
        }
    }
}

function deleteTaskWithUndo( dateStr, taskId ) {
    const dayTasks = tasks[ dateStr ];
    const taskIndex = dayTasks?.findIndex( t => t.id === taskId );

    if ( taskIndex !== -1 ) {
        lastDeletedTask = { ...dayTasks[ taskIndex ] };
        lastDeletedDate = dateStr;

        tasks[ dateStr ] = tasks[ dateStr ].filter( t => t.id !== taskId );
        if ( tasks[ dateStr ].length === 0 ) {
            delete tasks[ dateStr ];
        }

        if ( currentUser && isOnline ) {
            deleteTaskFromFirebase( dateStr, taskId );
        }

        saveTasks();
        renderCalendar();
        updateProgress();
        showUndoNotification();
    }
}

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

function undoDelete() {
    if ( lastDeletedTask && lastDeletedDate ) {
        if ( !tasks[ lastDeletedDate ] ) tasks[ lastDeletedDate ] = [];

        tasks[ lastDeletedDate ].push( lastDeletedTask );

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

function deleteTask( dateStr, taskId ) {
    deleteTaskWithUndo( dateStr, taskId );
}

function changeMonth( delta ) {
    currentDate.setMonth( currentDate.getMonth() + delta );
    renderCalendar();
    updateProgress();
}

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

    if ( currentUser && isOnline ) {
        setTimeout( () => syncToFirebase(), 500 );
    }
}

function clearMonth() {
    if ( !confirm( '¿Estás seguro de que quieres limpiar todas las tareas de este mes?' ) ) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    Object.keys( tasks ).forEach( dateStr => {
        const date = new Date( dateStr + 'T12:00:00' );
        if ( date.getFullYear() === year && date.getMonth() === month ) {
            delete tasks[ dateStr ];
        }
    } );

    saveTasks();
    renderCalendar();
    updateProgress();
    showNotification( 'Mes limpiado exitosamente' );

    if ( currentUser && isOnline ) {
        setTimeout( () => syncToFirebase(), 500 );
    }
}

// ✅ CORREGIDO: Progreso usando función local
function updateProgress() {
    const today = getTodayString();
    const todayTasks = tasks[ today ] || [];
    const completedTasks = todayTasks.filter( task => task.completed ).length;
    const progress = todayTasks.length === 0 ? 0 : Math.round( ( completedTasks / todayTasks.length ) * 100 );

    const progressBar = document.getElementById( 'progressBar' );
    const progressText = document.getElementById( 'progressText' );

    if ( progressBar ) progressBar.style.width = `${progress}%`;
    if ( progressText ) progressText.textContent = `${progress}% (${completedTasks}/${todayTasks.length})`;
}

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
    XLSX.writeFile( wb, `tareas_${getTodayString()}.xlsx` );

    showNotification( 'Excel exportado exitosamente' );
}

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

function startNotificationService() {
    if ( notificationInterval ) {
        clearInterval( notificationInterval );
        notificationInterval = null;
    }

    if ( !notificationsEnabled || Notification.permission !== 'granted' ) {
        console.log( '❌ Notificaciones no habilitadas o sin permisos' );
        return;
    }

    console.log( '✅ Iniciando servicio de notificaciones' );

    setTimeout( () => {
        try {
            checkDailyTasks();
        } catch ( error ) {
            console.error( 'Error en checkDailyTasks inicial:', error );
        }
    }, 2000 );

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
    }, 30000 );
}

function stopNotificationService() {
    if ( notificationInterval ) {
        clearInterval( notificationInterval );
        notificationInterval = null;
        console.log( 'Servicio de notificaciones detenido' );
    }
}

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

// ✅ CORREGIDO: Verificación de tareas usando función local
function checkDailyTasks() {
    if ( !notificationsEnabled || Notification.permission !== 'granted' ) {
        console.log( 'Notificaciones no habilitadas o sin permisos' );
        return;
    }

    const now = new Date();
    const today = getTodayString();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentSeconds = now.getSeconds();

    const todayTasks = tasks[ today ] || [];
    const pendingTasks = todayTasks.filter( task => !task.completed );

    if ( currentSeconds === 0 ) {
        if ( currentHour === 9 && currentMinute === 0 && pendingTasks.length > 0 ) {
            console.log( '🌅 Enviando notificación matutina' );
            showDesktopNotification( '¡Buenos días! 🌅',
                `Tienes ${pendingTasks.length} tarea${pendingTasks.length > 1 ? 's' : ''} pendiente${pendingTasks.length > 1 ? 's' : ''} para hoy`,
                'morning-reminder'
            );
        }

        if ( currentHour === 12 && currentMinute === 0 && pendingTasks.length > 0 ) {
            console.log( '🌞 Enviando notificación de medio día' );
            showDesktopNotification( 'Recordatorio de medio día 🌞',
                `Aún tienes ${pendingTasks.length} tarea${pendingTasks.length > 1 ? 's' : ''} por completar`,
                'midday-reminder'
            );
        }

        if ( currentHour === 18 && currentMinute === 0 && pendingTasks.length > 0 ) {
            console.log( '🌇 Enviando notificación vespertina' );
            showDesktopNotification( 'Recordatorio vespertino 🌇',
                `No olvides completar tus ${pendingTasks.length} tarea${pendingTasks.length > 1 ? 's' : ''} restante${pendingTasks.length > 1 ? 's' : ''}`,
                'evening-reminder'
            );
        }
    }

    pendingTasks.forEach( task => {
        if ( task.time ) {
            const [ taskHours, taskMinutes ] = task.time.split( ':' ).map( Number );

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

        notification.onclick = function () {
            window.focus();
            notification.close();
        };

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

function getFaviconAsDataUrl() {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="12" fill="#3B82F6"/>
            <path d="M20 32l8 8 16-16" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <circle cx="48" cy="16" r="6" fill="#EF4444"/>
        </svg>
    `;
    return `data:image/svg+xml;base64,${btoa( svg )}`;
}

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

    setTimeout( () => notification.classList.remove( 'translate-x-full' ), 100 );

    setTimeout( () => {
        notification.classList.add( 'translate-x-full' );
        setTimeout( () => notification.remove(), 300 );
    }, 3000 );
}

function saveTasks() {
    try {
        localStorage.setItem( 'tasks', JSON.stringify( tasks ) );
    } catch ( error ) {
        console.error( 'Error saving tasks to localStorage:', error );
        showNotification( 'Error al guardar tareas', 'error' );
    }
}

function clearAll() {
    const totalTasks = Object.values( tasks ).reduce( ( sum, dayTasks ) => sum + dayTasks.length, 0 );

    if ( totalTasks === 0 ) {
        showNotification( 'No hay tareas para eliminar', 'info' );
        return;
    }

    if ( !confirm( `¿Estás seguro de que quieres eliminar TODAS las tareas del calendario? (${totalTasks} tareas)` ) ) {
        return;
    }

    // Confirmación adicional para evitar eliminación accidental
    if ( !confirm( '⚠️ ESTA ACCIÓN NO SE PUEDE DESHACER. ¿Continuar?' ) ) {
        return;
    }

    tasks = {};
    saveTasks();
    renderCalendar();
    updateProgress();
    closeDailyTaskPanel(); // Cerrar panel si está abierto

    showNotification( `${totalTasks} tareas eliminadas del calendario`, 'success' );

    if ( currentUser && isOnline ) {
        setTimeout( () => syncToFirebase(), 500 );
    }
}

// Auto-sincronización cada 5 minutos si está logueado y online
setInterval( () => {
    if ( currentUser && isOnline && !syncInProgress ) {
        syncFromFirebase();
    }
}, 5 * 60 * 1000 );
