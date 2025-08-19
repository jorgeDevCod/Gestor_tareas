// Variables globales optimizadas
let tasks = {};
let currentDate = new Date();
let notificationsEnabled = false;
let draggedTask = null;
let draggedFromDate = null;
let currentEditingTask = null;
let currentEditingDate = null;
let lastDeletedTask = null;
let lastDeletedDate = null;

// Inicialización
document.addEventListener( 'DOMContentLoaded', function () {
    loadTasks();
    renderCalendar();
    updateProgress();
    setupEventListeners();
    requestNotificationPermission();
    setupDragAndDrop();
    setupTaskTooltips();
} );

// Cargar tareas desde localStorage (compatible con el antiguo)
function loadTasks() {
    try {
        const storedTasks = localStorage.getItem( 'tasks' );
        tasks = storedTasks ? JSON.parse( storedTasks ) : {};
    } catch ( error ) {
        tasks = {};
        console.warn( 'Error loading tasks from localStorage:', error );
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
        'notificationsBtn': toggleNotifications
    };

    Object.entries( elements ).forEach( ( [ id, handler ] ) => {
        const element = document.getElementById( id );
        if ( element ) {
            element.addEventListener( element.tagName === 'FORM' ? 'submit' : 'click', handler );
        }
    } );
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

// Crear elemento de día
function createDayElement( day, dateStr, dayTasks ) {
    const dayElement = document.createElement( 'div' );
    const isToday = dateStr === new Date().toISOString().split( 'T' )[ 0 ];

    dayElement.className = `h-24 border border-gray-200 p-1 cursor-pointer hover:bg-blue-50 transition relative calendar-day group ${isToday ? 'bg-blue-100 border-blue-300' : ''}`;
    dayElement.dataset.date = dateStr;

    dayElement.innerHTML = `
        <div class="font-semibold text-sm mb-1">${day}</div>
        <div class="space-y-1">
            ${dayTasks.slice( 0, 2 ).map( task => createTaskElement( task, dateStr ) ).join( '' )}
            ${dayTasks.length > 2 ? `
                <div class="text-xs text-gray-500 cursor-pointer hover:text-blue-600 transition-colors" 
                     onclick="showDayTasks('${dateStr}', ${day})">
                    +${dayTasks.length - 2} más
                </div>
            ` : ''}
        </div>
        <button onclick="event.stopPropagation(); showQuickAddTask('${dateStr}')"
                class="absolute bottom-1 right-1 w-6 h-6 bg-green-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-green-600 flex items-center justify-center"
                title="Agregar tarea rápida">
            <i class="fas fa-plus"></i>
        </button>
    `;

    dayElement.addEventListener( 'click', ( e ) => {
        if ( !e.target.closest( '.task-item' ) && !e.target.closest( 'button' ) ) {
            showDayTasks( dateStr, day );
        }
    } );

    return dayElement;
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
    const title = prompt( 'Nueva tarea para ' + new Date( dateStr ).toLocaleDateString( 'es-ES' ) + ':' );
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
    }
}

// Eliminar tarea con deshacer
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
        tasks[ lastDeletedDate ].push( lastDeletedTask );

        saveTasks();
        renderCalendar();
        updateProgress();

        lastDeletedTask = null;
        lastDeletedDate = null;

        showNotification( 'Tarea restaurada' );
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
}

// Actualizar progreso
function updateProgress() {
    const today = new Date().toISOString().split( 'T' )[ 0 ];
    const todayTasks = tasks[ today ] || [];
    const completedTasks = todayTasks.filter( task => task.completed ).length;
    const progress = todayTasks.length === 0 ? 0 : Math.round( ( completedTasks / todayTasks.length ) * 100 );

    const progressBar = document.getElementById( 'progressBar' );
    const progressText = document.getElementById( 'progressText' );

    if ( progressBar ) progressBar.style.width = `${progress}%`;
    if ( progressText ) progressText.textContent = `${progress}% (${completedTasks}/${todayTasks.length})`;
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
    if ( 'Notification' in window ) {
        Notification.requestPermission().then( permission => {
            if ( permission === 'granted' ) {
                notificationsEnabled = true;
                checkDailyTasks();
            }
        } );
    }
}

// Alternar notificaciones
function toggleNotifications() {
    if ( !( 'Notification' in window ) ) {
        alert( 'Este navegador no soporta notificaciones' );
        return;
    }

    if ( Notification.permission === 'granted' ) {
        notificationsEnabled = !notificationsEnabled;
        updateNotificationButton();
        if ( notificationsEnabled ) checkDailyTasks();
    } else {
        Notification.requestPermission().then( permission => {
            if ( permission === 'granted' ) {
                notificationsEnabled = true;
                updateNotificationButton();
                checkDailyTasks();
            }
        } );
    }
}

// Actualizar botón de notificaciones
function updateNotificationButton() {
    const btn = document.getElementById( 'notificationsBtn' );
    if ( !btn ) return;

    if ( notificationsEnabled ) {
        btn.className = 'bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition';
        btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Notificaciones ON';
    } else {
        btn.className = 'bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition';
        btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Notificaciones OFF';
    }
}

// Verificar tareas diarias
function checkDailyTasks() {
    if ( !notificationsEnabled ) return;

    const today = new Date().toISOString().split( 'T' )[ 0 ];
    const todayTasks = tasks[ today ] || [];
    const pendingTasks = todayTasks.filter( task => !task.completed );

    // Notificación general de tareas pendientes
    if ( pendingTasks.length > 0 ) {
        new Notification( 'Recordatorio de Tareas', {
            body: `Tienes ${pendingTasks.length} tareas pendientes para hoy`,
            icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjQiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiIHJ5PSIyIj48L3JlY3Q+PGxpbmUgeDE9IjE2IiB5MT0iMiIgeDI9IjE2IiB5Mj0iNiI+PC9saW5lPjxsaW5lIHgxPSI4IiB5MT0iMiIgeDI9IjgiIHkyPSI2Ij48L2xpbmU+PGxpbmUgeDE9IjMiIHkxPSIxMCIgeDI9IjIxIiB5Mj0iMTAiPjwvbGluZT48L3N2Zz4='
        } );
    }

    // Notificaciones específicas por horario
    pendingTasks.forEach( task => {
        if ( task.time ) {
            const taskTime = new Date( `${today}T${task.time}` );
            const now = new Date();
            const timeDiff = taskTime.getTime() - now.getTime();

            // Notificar 15 minutos antes
            if ( timeDiff > 0 && timeDiff <= 15 * 60 * 1000 ) {
                new Notification( `Recordatorio: ${task.title}`, {
                    body: `Tu tarea comienza en 15 minutos (${task.time})`,
                    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIj48L2NpcmNsZT48cG9seWxpbmUgcG9pbnRzPSIxMiw2IDEyLDEyIDE2LDE0Ij48L3BvbHlsaW5lPjwvc3ZnPg=='
                } );
            }
        }
    } );
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
