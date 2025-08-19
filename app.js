// Global variables
let tasks = JSON.parse( localStorage.getItem( 'tasks' ) ) || {};
let currentDate = new Date();
let isGoogleAuthenticated = false;
let notificationsEnabled = false;

// Google API Configuration
const GOOGLE_CLIENT_ID = '583249299949-2sfolo5ob7akbj52jiomkcjnl07lapdt.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'AIzaSyDJxwEdCpVdC6SjOuETQm061C0FTAUyutQ';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar';

// Initialize the app
document.addEventListener( 'DOMContentLoaded', function () {
    renderCalendar();
    updateProgress();
    setupEventListeners();
    requestNotificationPermission();
} );

// Setup event listeners
function setupEventListeners() {
    document.getElementById( 'taskForm' ).addEventListener( 'submit', addTask );
    document.getElementById( 'prevMonth' ).addEventListener( 'click', () => changeMonth( -1 ) );
    document.getElementById( 'nextMonth' ).addEventListener( 'click', () => changeMonth( 1 ) );
    document.getElementById( 'closeModal' ).addEventListener( 'click', closeModal );
    document.getElementById( 'taskRepeat' ).addEventListener( 'change', toggleCustomDays );
    document.getElementById( 'clearWeekBtn' ).addEventListener( 'click', clearWeek );
    document.getElementById( 'clearMonthBtn' ).addEventListener( 'click', clearMonth );
    document.getElementById( 'exportExcelBtn' ).addEventListener( 'click', exportToExcel );
    document.getElementById( 'googleAuthBtn' ).addEventListener( 'click', handleGoogleAuth );
    document.getElementById( 'syncGoogleBtn' ).addEventListener( 'click', syncWithGoogle );
    document.getElementById( 'notificationsBtn' ).addEventListener( 'click', toggleNotifications );
}

// Toggle custom days visibility
function toggleCustomDays() {
    const select = document.getElementById( 'taskRepeat' );
    const customDays = document.getElementById( 'customDays' );
    customDays.classList.toggle( 'hidden', select.value !== 'custom' );
}

// Add task function
function addTask( e ) {
    e.preventDefault();

    const title = document.getElementById( 'taskTitle' ).value;
    const description = document.getElementById( 'taskDescription' ).value;
    const date = document.getElementById( 'taskDate' ).value;
    const time = document.getElementById( 'taskTime' ).value;
    const repeat = document.getElementById( 'taskRepeat' ).value;

    if ( !title ) return;

    const task = {
        id: Date.now().toString(),
        title,
        description,
        time,
        completed: false
    };

    if ( date && repeat === 'none' ) {
        // Single date task
        addTaskToDate( date, task );
    } else if ( repeat !== 'none' ) {
        // Recurring task
        const startDate = date ? new Date( date ) : new Date();
        addRecurringTasks( task, repeat, startDate );
    }

    saveTasks();
    renderCalendar();
    updateProgress();
    document.getElementById( 'taskForm' ).reset();

    showNotification( 'Tarea agregada exitosamente' );
}

// Add task to specific date
function addTaskToDate( dateStr, task ) {
    if ( !tasks[ dateStr ] ) {
        tasks[ dateStr ] = [];
    }
    tasks[ dateStr ].push( { ...task, id: `${dateStr}-${Date.now()}` } );
}

// Add recurring tasks
function addRecurringTasks( task, repeatType, startDate ) {
    const endDate = new Date( startDate );
    endDate.setMonth( endDate.getMonth() + 1 ); // Next month

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
                const selectedDays = Array.from( document.querySelectorAll( '#customDays input:checked' ) ).map( cb => parseInt( cb.value ) );
                shouldAdd = selectedDays.includes( dayOfWeek );
                break;
        }

        if ( shouldAdd ) {
            addTaskToDate( dateStr, task );
        }

        currentDate.setDate( currentDate.getDate() + 1 );
    }
}

// Render calendar
function renderCalendar() {
    const calendar = document.getElementById( 'calendar' );
    const monthYear = document.getElementById( 'currentMonth' );

    // Clear calendar
    calendar.innerHTML = '';

    // Set month/year display
    monthYear.textContent = currentDate.toLocaleDateString( 'es-ES', {
        month: 'long',
        year: 'numeric'
    } ).replace( /^\w/, c => c.toUpperCase() );

    // Add day headers
    const dayHeaders = [ 'Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb' ];
    dayHeaders.forEach( day => {
        const dayElement = document.createElement( 'div' );
        dayElement.className = 'text-center font-semibold text-gray-600 py-2';
        dayElement.textContent = day;
        calendar.appendChild( dayElement );
    } );

    // Get first day of month and number of days
    const firstDay = new Date( currentDate.getFullYear(), currentDate.getMonth(), 1 );
    const lastDay = new Date( currentDate.getFullYear(), currentDate.getMonth() + 1, 0 );
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    // Add empty cells for days before month starts
    for ( let i = 0; i < startingDayOfWeek; i++ ) {
        const emptyDay = document.createElement( 'div' );
        emptyDay.className = 'h-24 border border-gray-200';
        calendar.appendChild( emptyDay );
    }

    // Add days of the month
    for ( let day = 1; day <= daysInMonth; day++ ) {
        const date = new Date( currentDate.getFullYear(), currentDate.getMonth(), day );
        const dateStr = date.toISOString().split( 'T' )[ 0 ];
        const dayTasks = tasks[ dateStr ] || [];

        const dayElement = document.createElement( 'div' );
        dayElement.className = 'h-24 border border-gray-200 p-1 cursor-pointer hover:bg-blue-50 transition relative';

        const isToday = dateStr === new Date().toISOString().split( 'T' )[ 0 ];
        if ( isToday ) {
            dayElement.classList.add( 'bg-blue-100', 'border-blue-300' );
        }

        dayElement.innerHTML = `
            <div class="font-semibold text-sm mb-1">${day}</div>
            <div class="space-y-1">
                ${dayTasks.slice( 0, 2 ).map( task => `
                    <div class="text-xs p-1 rounded ${task.completed ? 'bg-green-200 text-green-800 line-through' : 'bg-blue-200 text-blue-800'} truncate">
                        ${task.title}
                    </div>
                `).join( '' )}
                ${dayTasks.length > 2 ? `<div class="text-xs text-gray-500">+${dayTasks.length - 2} más</div>` : ''}
            </div>
        `;

        dayElement.addEventListener( 'click', () => showDayTasks( dateStr, day ) );
        calendar.appendChild( dayElement );
    }
}

// Show day tasks in modal
function showDayTasks( dateStr, day ) {
    const modal = document.getElementById( 'taskModal' );
    const content = document.getElementById( 'modalContent' );
    const dayTasks = tasks[ dateStr ] || [];

    content.innerHTML = `
        <div class="mb-4">
            <h4 class="font-medium text-gray-800">Día ${day}</h4>
            <p class="text-sm text-gray-600">${new Date( dateStr ).toLocaleDateString( 'es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } )}</p>
        </div>
        <div class="space-y-2 max-h-60 overflow-y-auto">
            ${dayTasks.length === 0 ?
            '<p class="text-gray-500">No hay tareas para este día</p>' :
            dayTasks.map( task => `
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
                        <button onclick="deleteTask('${dateStr}', '${task.id}')" 
                                class="text-red-500 hover:text-red-700 ml-2">
                            <i class="fas fa-trash text-sm"></i>
                        </button>
                    </div>
                `).join( '' )
        }
        </div>
    `;

    modal.classList.remove( 'hidden' );
}

// Close modal
function closeModal() {
    document.getElementById( 'taskModal' ).classList.add( 'hidden' );
}

// Toggle task completion
function toggleTask( dateStr, taskId ) {
    const dayTasks = tasks[ dateStr ];
    const task = dayTasks.find( t => t.id === taskId );
    if ( task ) {
        task.completed = !task.completed;
        saveTasks();
        renderCalendar();
        updateProgress();
        showDayTasks( dateStr, new Date( dateStr ).getDate() );
    }
}

// Enhanced task management with undo functionality
let lastDeletedTask = null;
let lastDeletedDate = null;

function deleteTaskWithUndo( dateStr, taskId ) {
    const dayTasks = tasks[ dateStr ];
    const taskIndex = dayTasks.findIndex( t => t.id === taskId );

    if ( taskIndex !== -1 ) {
        lastDeletedTask = { ...dayTasks[ taskIndex ] };
        lastDeletedDate = dateStr;

        tasks[ dateStr ] = tasks[ dateStr ].filter( t => t.id !== taskId );
        if ( tasks[ dateStr ].length === 0 ) {
            delete tasks[ dateStr ];
        }

        saveTasks();
        renderCalendar();
        updateProgress();
        showDayTasks( dateStr, new Date( dateStr ).getDate() );

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

    setTimeout( () => {
        if ( document.body.contains( notification ) ) {
            document.body.removeChild( notification );
        }
    }, 5000 );
}

function undoDelete() {
    if ( lastDeletedTask && lastDeletedDate ) {
        if ( !tasks[ lastDeletedDate ] ) {
            tasks[ lastDeletedDate ] = [];
        }
        tasks[ lastDeletedDate ].push( lastDeletedTask );

        saveTasks();
        renderCalendar();
        updateProgress();

        lastDeletedTask = null;
        lastDeletedDate = null;

        showNotification( 'Tarea restaurada' );

        // Remove undo notification
        const undoNotification = document.querySelector( '.fixed.bottom-4.left-4' );
        if ( undoNotification ) {
            undoNotification.remove();
        }
    }
}

// Delete task
function deleteTask( dateStr, taskId ) {
    deleteTaskWithUndo( dateStr, taskId );
}

// Change month
function changeMonth( delta ) {
    currentDate.setMonth( currentDate.getMonth() + delta );
    renderCalendar();
    updateProgress();
}

// Clear week
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
}

// Clear month
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
}

// Update progress
function updateProgress() {
    const today = new Date().toISOString().split( 'T' )[ 0 ];
    const todayTasks = tasks[ today ] || [];
    const completedTasks = todayTasks.filter( task => task.completed ).length;
    const progress = todayTasks.length === 0 ? 0 : Math.round( ( completedTasks / todayTasks.length ) * 100 );

    document.getElementById( 'progressBar' ).style.width = `${progress}%`;
    document.getElementById( 'progressText' ).textContent = `${progress}% (${completedTasks}/${todayTasks.length})`;
}

// Export to Excel
function exportToExcel() {
    const wb = XLSX.utils.book_new();
    const data = [];

    // Header
    data.push( [ 'Fecha', 'Título', 'Descripción', 'Hora', 'Completada' ] );

    // Tasks data
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

// Google Authentication (simplified version)
function handleGoogleAuth() {
    if ( !isGoogleAuthenticated ) {
        // Simulate authentication
        isGoogleAuthenticated = true;
        document.getElementById( 'googleAuthBtn' ).innerHTML = '<i class="fab fa-google mr-2"></i>Desconectar Google';
        document.getElementById( 'googleAuthBtn' ).className = 'bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition';
        document.getElementById( 'syncGoogleBtn' ).disabled = false;
        showNotification( 'Conectado a Google Calendar' );
    } else {
        isGoogleAuthenticated = false;
        document.getElementById( 'googleAuthBtn' ).innerHTML = '<i class="fab fa-google mr-2"></i>Conectar Google';
        document.getElementById( 'googleAuthBtn' ).className = 'bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition';
        document.getElementById( 'syncGoogleBtn' ).disabled = true;
        showNotification( 'Desconectado de Google Calendar' );
    }
}

// Sync with Google Calendar (simplified)
// Función mejorada para autenticación real con Google
async function handleGoogleAuth() {
    try {
        if ( !isGoogleAuthenticated ) {
            const authInstance = gapi.auth2.getAuthInstance();
            const user = await authInstance.signIn();

            if ( user.isSignedIn() ) {
                isGoogleAuthenticated = true;
                document.getElementById( 'googleAuthBtn' ).innerHTML = '<i class="fab fa-google mr-2"></i>Desconectar Google';
                document.getElementById( 'googleAuthBtn' ).className = 'bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition';
                document.getElementById( 'syncGoogleBtn' ).disabled = false;

                showNotification( 'Conectado a Google Calendar exitosamente' );
            }
        } else {
            const authInstance = gapi.auth2.getAuthInstance();
            await authInstance.signOut();

            isGoogleAuthenticated = false;
            document.getElementById( 'googleAuthBtn' ).innerHTML = '<i class="fab fa-google mr-2"></i>Conectar Google';
            document.getElementById( 'googleAuthBtn' ).className = 'bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition';
            document.getElementById( 'syncGoogleBtn' ).disabled = true;

            showNotification( 'Desconectado de Google Calendar' );
        }
    } catch ( error ) {
        console.error( 'Error en autenticación de Google:', error );
        showNotification( 'Error al conectar con Google Calendar', 'error' );
    }
}

// Función mejorada para sincronización real
async function handleGoogleAuth() {
    try {
        if ( !isGoogleAuthenticated ) {
            const authInstance = gapi.auth2.getAuthInstance();
            const user = await authInstance.signIn();

            if ( user.isSignedIn() ) {
                isGoogleAuthenticated = true;
                document.getElementById( 'googleAuthBtn' ).innerHTML = '<i class="fab fa-google mr-2"></i>Desconectar Google';
                document.getElementById( 'googleAuthBtn' ).className = 'bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition';
                document.getElementById( 'syncGoogleBtn' ).disabled = false;

                showNotification( 'Conectado a Google Calendar exitosamente' );
            }
        } else {
            const authInstance = gapi.auth2.getAuthInstance();
            await authInstance.signOut();

            isGoogleAuthenticated = false;
            document.getElementById( 'googleAuthBtn' ).innerHTML = '<i class="fab fa-google mr-2"></i>Conectar Google';
            document.getElementById( 'googleAuthBtn' ).className = 'bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition';
            document.getElementById( 'syncGoogleBtn' ).disabled = true;

            showNotification( 'Desconectado de Google Calendar' );
        }
    } catch ( error ) {
        console.error( 'Error en autenticación de Google:', error );
        showNotification( 'Error al conectar con Google Calendar', 'error' );
    }
}

// Función mejorada para sincronización real
async function syncWithGoogle() {
    if ( !isGoogleAuthenticated ) {
        showNotification( 'Primero debes conectarte a Google Calendar', 'error' );
        return;
    }

    try {
        let syncCount = 0;
        let errorCount = 0;

        // Mostrar indicador de carga
        const syncBtn = document.getElementById( 'syncGoogleBtn' );
        const originalText = syncBtn.innerHTML;
        syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Sincronizando...';
        syncBtn.disabled = true;

        for ( const [ dateStr, dayTasks ] of Object.entries( tasks ) ) {
            for ( const task of dayTasks ) {
                if ( !task.googleEventId ) { // Solo sincronizar tareas no sincronizadas
                    try {
                        const eventId = await syncTaskWithGoogleCalendar( task, dateStr );
                        if ( eventId ) {
                            task.googleEventId = eventId;
                            task.synced = true;
                            syncCount++;
                        } else {
                            errorCount++;
                        }
                    } catch ( error ) {
                        console.error( 'Error sincronizando tarea:', error );
                        errorCount++;
                    }
                }
            }
        }

        // Restaurar botón
        syncBtn.innerHTML = originalText;
        syncBtn.disabled = false;

        // Guardar cambios
        saveTasks();

        // Mostrar resultado
        if ( syncCount > 0 ) {
            showNotification( `${syncCount} tareas sincronizadas con Google Calendar` );
        }
        if ( errorCount > 0 ) {
            showNotification( `${errorCount} tareas no se pudieron sincronizar`, 'error' );
        }
        if ( syncCount === 0 && errorCount === 0 ) {
            showNotification( 'Todas las tareas ya están sincronizadas' );
        }

    } catch ( error ) {
        console.error( 'Error en sincronización:', error );
        showNotification( 'Error durante la sincronización', 'error' );

        // Restaurar botón en caso de error
        const syncBtn = document.getElementById( 'syncGoogleBtn' );
        syncBtn.innerHTML = '<i class="fab fa-google mr-2"></i>Sincronizar con Google';
        syncBtn.disabled = false;
    }
}


// Función mejorada para crear eventos en Google Calendar
async function syncTaskWithGoogleCalendar( task, dateStr ) {
    try {
        const event = {
            'summary': task.title,
            'description': task.description || '',
        };

        if ( task.time ) {
            // Tarea con hora específica
            const startDateTime = `${dateStr}T${task.time}:00`;
            const endTime = new Date( `${dateStr}T${task.time}:00` );
            endTime.setHours( endTime.getHours() + 1 ); // 1 hora de duración por defecto

            event.start = {
                'dateTime': startDateTime,
                'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
            };
            event.end = {
                'dateTime': endTime.toISOString().slice( 0, 19 ),
                'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
            };
        } else {
            // Tarea de día completo
            event.start = {
                'date': dateStr,
            };
            event.end = {
                'date': dateStr,
            };
        }

        // Agregar color según estado de completado
        if ( task.completed ) {
            event.colorId = '10'; // Verde para completadas
        } else {
            event.colorId = '9'; // Azul para pendientes
        }

        const request = gapi.client.calendar.events.insert( {
            'calendarId': 'primary',
            'resource': event
        } );

        const response = await request.execute();
        return response.id;

    } catch ( error ) {
        console.error( 'Error creando evento en Google Calendar:', error );
        return null;
    }
}

// Función para actualizar eventos existentes cuando se marca como completado
async function updateGoogleCalendarEvent( task, dateStr ) {
    if ( !task.googleEventId || !isGoogleAuthenticated ) return;

    try {
        const event = await gapi.client.calendar.events.get( {
            'calendarId': 'primary',
            'eventId': task.googleEventId
        } ).execute();

        // Actualizar color según estado
        event.colorId = task.completed ? '10' : '9';

        const request = gapi.client.calendar.events.update( {
            'calendarId': 'primary',
            'eventId': task.googleEventId,
            'resource': event
        } );

        await request.execute();

    } catch ( error ) {
        console.error( 'Error actualizando evento en Google Calendar:', error );
    }
}

// Función para eliminar eventos de Google Calendar
async function deleteGoogleCalendarEvent( task ) {
    if ( !task.googleEventId || !isGoogleAuthenticated ) return;

    try {
        await gapi.client.calendar.events.delete( {
            'calendarId': 'primary',
            'eventId': task.googleEventId
        } ).execute();

    } catch ( error ) {
        console.error( 'Error eliminando evento de Google Calendar:', error );
    }
}

// Función para eliminar eventos de Google Calendar
async function deleteGoogleCalendarEvent( task ) {
    if ( !task.googleEventId || !isGoogleAuthenticated ) return;

    try {
        await gapi.client.calendar.events.delete( {
            'calendarId': 'primary',
            'eventId': task.googleEventId
        } ).execute();

    } catch ( error ) {
        console.error( 'Error eliminando evento de Google Calendar:', error );
    }
}

// Modificar la función toggleTask para actualizar Google Calendar
function toggleTask( dateStr, taskId ) {
    const dayTasks = tasks[ dateStr ];
    const task = dayTasks.find( t => t.id === taskId );
    if ( task ) {
        task.completed = !task.completed;

        // Actualizar en Google Calendar si está sincronizado
        if ( task.googleEventId ) {
            updateGoogleCalendarEvent( task, dateStr );
        }

        saveTasks();
        renderCalendar();
        updateProgress();
        showDayTasks( dateStr, new Date( dateStr ).getDate() );
    }
}

// Modificar la función de eliminación para también eliminar de Google Calendar
async function deleteTaskWithUndo( dateStr, taskId ) {
    const dayTasks = tasks[ dateStr ];
    const taskIndex = dayTasks.findIndex( t => t.id === taskId );

    if ( taskIndex !== -1 ) {
        const task = dayTasks[ taskIndex ];
        lastDeletedTask = { ...task };
        lastDeletedDate = dateStr;

        // Eliminar de Google Calendar si está sincronizado
        if ( task.googleEventId ) {
            await deleteGoogleCalendarEvent( task );
        }

        tasks[ dateStr ] = tasks[ dateStr ].filter( t => t.id !== taskId );
        if ( tasks[ dateStr ].length === 0 ) {
            delete tasks[ dateStr ];
        }

        saveTasks();
        renderCalendar();
        updateProgress();
        showDayTasks( dateStr, new Date( dateStr ).getDate() );

        showUndoNotification();
    }
}

// Enhanced Google Calendar Integration
async function initializeGoogleAPI() {
    try {
        await gapi.load( 'auth2', () => {
            gapi.auth2.init( {
                client_id: GOOGLE_CLIENT_ID,
            } );
        } );
        await gapi.load( 'client', () => {
            gapi.client.init( {
                apiKey: GOOGLE_API_KEY,
                clientId: GOOGLE_CLIENT_ID,
                discoveryDocs: [ DISCOVERY_DOC ],
                scope: SCOPES
            } );
        } );
    } catch ( error ) {
        console.log( 'Google API initialization error:', error );
    }
}

// Real Google Calendar sync function
async function syncTaskWithGoogleCalendar( task, dateStr ) {
    if ( !isGoogleAuthenticated ) return false;

    try {
        const event = {
            'summary': task.title,
            'description': task.description || '',
            'start': {
                'date': dateStr,
                'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            'end': {
                'date': dateStr,
                'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
            }
        };

        if ( task.time ) {
            const startDateTime = `${dateStr}T${task.time}:00`;
            const endTime = new Date( `${dateStr}T${task.time}:00` );
            endTime.setHours( endTime.getHours() + 1 ); // 1 hour duration by default

            event.start = {
                'dateTime': startDateTime,
                'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
            };
            event.end = {
                'dateTime': endTime.toISOString().slice( 0, 19 ),
                'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
            };
        }

        const request = gapi.client.calendar.events.insert( {
            'calendarId': 'primary',
            'resource': event
        } );

        const response = await request;
        return response.result.id;
    } catch ( error ) {
        console.error( 'Error syncing with Google Calendar:', error );
        return false;
    }
}

// Request notification permission
function requestNotificationPermission() {
    if ( 'Notification' in window ) {
        Notification.requestPermission().then( permission => {
            if ( permission === 'granted' ) {
                notificationsEnabled = true;
                checkDailyTasks();
            }
        } );
    }
}

// Toggle notifications
function toggleNotifications() {
    if ( !( 'Notification' in window ) ) {
        alert( 'Este navegador no soporta notificaciones' );
        return;
    }

    if ( Notification.permission === 'granted' ) {
        notificationsEnabled = !notificationsEnabled;
        const btn = document.getElementById( 'notificationsBtn' );
        if ( notificationsEnabled ) {
            btn.className = 'bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition';
            btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Notificaciones ON';
            checkDailyTasks();
        } else {
            btn.className = 'bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition';
            btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Notificaciones OFF';
        }
    } else {
        Notification.requestPermission().then( permission => {
            if ( permission === 'granted' ) {
                notificationsEnabled = true;
                checkDailyTasks();
            }
        } );
    }
}

// Check daily tasks for notifications
function checkDailyTasks() {
    if ( !notificationsEnabled ) return;

    const today = new Date().toISOString().split( 'T' )[ 0 ];
    const todayTasks = tasks[ today ] || [];
    const pendingTasks = todayTasks.filter( task => !task.completed );

    if ( pendingTasks.length > 0 ) {
        new Notification( 'Recordatorio de Tareas', {
            body: `Tienes ${pendingTasks.length} tareas pendientes para hoy`,
            icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjQiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiIHJ5PSIyIj48L3JlY3Q+PGxpbmUgeDE9IjE2IiB5MT0iMiIgeDI9IjE2IiB5Mj0iNiI+PC9saW5lPjxsaW5lIHgxPSI4IiB5MT0iMiIgeDI9IjgiIHkyPSI2Ij48L2xpbmU+PGxpbmUgeDE9IjMiIHkxPSIxMCIgeDI9IjIxIiB5Mj0iMTAiPjwvbGluZT48L3N2Zz4='
        } );
    }

    // Check for tasks with time reminders
    pendingTasks.forEach( task => {
        if ( task.time ) {
            const taskTime = new Date( `${today}T${task.time}` );
            const now = new Date();
            const timeDiff = taskTime.getTime() - now.getTime();

            // Notify 15 minutes before
            if ( timeDiff > 0 && timeDiff <= 15 * 60 * 1000 ) {
                new Notification( `Recordatorio: ${task.title}`, {
                    body: `Tu tarea comienza en 15 minutos (${task.time})`,
                    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIj48L2NpcmNsZT48cG9seWxpbmUgcG9pbnRzPSIxMiw2IDEyLDEyIDE2LDE0Ij48L3BvbHlsaW5lPjwvc3ZnPg=='
                } );
            }
        }
    } );
}

// Show notification
function showNotification( message, type = 'success' ) {
    const notification = document.createElement( 'div' );
    notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-x-full ${type === 'success' ? 'bg-green-500 text-white' :
        type === 'error' ? 'bg-red-500 text-white' :
            'bg-blue-500 text-white'
        }`;
    notification.innerHTML = `
        <div class="flex items-center space-x-2">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;

    document.body.appendChild( notification );

    // Animate in
    setTimeout( () => {
        notification.classList.remove( 'translate-x-full' );
    }, 100 );

    // Remove after 3 seconds
    setTimeout( () => {
        notification.classList.add( 'translate-x-full' );
        setTimeout( () => {
            if ( document.body.contains( notification ) ) {
                document.body.removeChild( notification );
            }
        }, 300 );
    }, 3000 );
}

// Save tasks to localStorage
function saveTasks() {
    localStorage.setItem( 'tasks', JSON.stringify( tasks ) );
}

// Task search and filter functionality
function addSearchAndFilter() {
    const searchContainer = document.createElement( 'div' );
    searchContainer.className = 'mb-4';
    searchContainer.innerHTML = `
        <div class="flex space-x-2">
            <input type="text" id="taskSearch" placeholder="Buscar tareas..." 
                   class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <select id="taskFilter" class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="all">Todas</option>
                <option value="pending">Pendientes</option>
                <option value="completed">Completadas</option>
            </select>
        </div>
    `;

    const quickActions = document.querySelector( '.bg-white.rounded-xl.shadow-lg.p-6.mt-6' );
    quickActions.parentNode.insertBefore( searchContainer, quickActions );

    document.getElementById( 'taskSearch' ).addEventListener( 'input', filterTasks );
    document.getElementById( 'taskFilter' ).addEventListener( 'change', filterTasks );
}

function filterTasks() {
    const searchTerm = document.getElementById( 'taskSearch' )?.value.toLowerCase() || '';
    const filterType = document.getElementById( 'taskFilter' )?.value || 'all';
}

// Set up periodic notification check
setInterval( checkDailyTasks, 5 * 60 * 1000 ); // Check every 5 minutes

// Click outside modal to close
document.getElementById( 'taskModal' ).addEventListener( 'click', function ( e ) {
    if ( e.target === this ) {
        closeModal();
    }
} );

// Keyboard shortcuts
document.addEventListener( 'keydown', function ( e ) {
    if ( e.key === 'Escape' ) {
        closeModal();
    }
    if ( e.ctrlKey && e.key === 'n' ) {
        e.preventDefault();
        document.getElementById( 'taskTitle' ).focus();
    }
    if ( e.ctrlKey && e.key === 'z' ) {
        e.preventDefault();
        undoDelete();
    }
} );

// Initialize Google API when page loads
initializeGoogleAPI();

// Initialize today's progress check on load
setTimeout( () => {
    checkDailyTasks();
    updateProgress();
}, 2000 );

// Override deleteTask function to use undo functionality
window.deleteTask = deleteTaskWithUndo;
window.undoDelete = undoDelete;
