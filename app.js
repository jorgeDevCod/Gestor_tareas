// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyD9Lwkgd9NqJ5I0termPqVZxNxFk5Y-J4s",
  authDomain: "calendario-tareas-app.firebaseapp.com",
  projectId: "calendario-tareas-app",
  storageBucket: "calendario-tareas-app.firebasestorage.app",
  messagingSenderId: "646091363424",
  appId: "1:646091363424:web:d923bbcc0224bd1bed5f05",
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
let selectedDateForPanel = null;
let notificationInterval = null;
let lastNotificationCheck = 0;
let sentNotifications = new Set();
let notificationStatus = {
  morning: false,
  midday: false,
  evening: false,
  taskReminders: new Set(),
};
//Sistema de registro de cambios
let taskChangeLog = JSON.parse( localStorage.getItem( "taskChangeLog" ) ) || [];

// Sistema de sincronización automática optimizada
let syncQueue = new Map(); // Cola de operaciones pendientes
let syncTimeout = null; // Timeout para batch sync
let isSyncing = false; // Flag para evitar múltiples syncs
let lastSyncTime = 0; // Timestamp del último sync
const SYNC_DEBOUNCE_TIME = 2000; // 2 segundos de debounce
const MIN_SYNC_INTERVAL = 5000; // Mínimo 5 segundos entre syncs

// constantes para estados y prioridades
const TASK_STATES = {
  pending: {
    label: "Pendiente",
    class: "bg-gray-200 text-gray-800",
    icon: "fa-clock",
  },
  inProgress: {
    label: "En Proceso",
    class: "bg-blue-200 text-blue-800",
    icon: "fa-play",
  },
  paused: {
    label: "Pausada",
    class: "bg-orange-200 text-orange-800",
    icon: "fa-pause",
  },
  completed: {
    label: "Completada",
    class: "bg-green-200 text-green-800",
    icon: "fa-check",
  },
};

const PRIORITY_LEVELS = {
  1: {
    label: "Muy Importante",
    class: "bg-red-500 text-white",
    color: "#EF4444",
  },
  2: {
    label: "Importante",
    class: "bg-orange-400 text-white",
    color: "#F97316",
  },
  3: { label: "Moderado", class: "bg-blue-400 text-white", color: "#3B82F6" },
  4: {
    label: "No Prioritario",
    class: "bg-gray-400 text-white",
    color: "#6B7280",
  },
};

// Estructura mejorada para registro por día
let dailyTaskLogs = JSON.parse( localStorage.getItem( "dailyTaskLogs" ) || "{}" );

function addToChangeLog(
  action,
  taskTitle,
  dateStr,
  oldState = null,
  newState = null,
  taskId = null
) {
  const now = new Date();
  const logEntry = {
    id: Date.now().toString(),
    action,
    taskTitle,
    taskId,
    oldState,
    newState,
    timestamp: now.toISOString(),
    time: now.toLocaleTimeString( "es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    } ),
    date: dateStr,
    readableDate: new Date( dateStr + "T12:00:00" ).toLocaleDateString( "es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    } ),
  };

  // Registro por día específico
  if ( !dailyTaskLogs[ dateStr ] ) {
    dailyTaskLogs[ dateStr ] = [];
  }
  dailyTaskLogs[ dateStr ].unshift( logEntry );

  // Mantener solo los últimos 50 registros por día
  if ( dailyTaskLogs[ dateStr ].length > 50 ) {
    dailyTaskLogs[ dateStr ] = dailyTaskLogs[ dateStr ].slice( 0, 50 );
  }

  // Calcular tiempo de proceso a completado si aplica
  if ( action === "stateChanged" && newState === "completed" && taskId ) {
    calculateTaskDuration( dateStr, taskId, taskTitle );
  }

  localStorage.setItem( "dailyTaskLogs", JSON.stringify( dailyTaskLogs ) );

  // Mantener registro global solo para estadísticas (opcional)
  taskChangeLog.unshift( logEntry );
  if ( taskChangeLog.length > 200 ) {
    taskChangeLog = taskChangeLog.slice( 0, 200 );
  }
  localStorage.setItem( "taskChangeLog", JSON.stringify( taskChangeLog ) );
}

function calculateTaskDuration( dateStr, taskId, taskTitle ) {
  const dayLogs = dailyTaskLogs[ dateStr ] || [];
  const completedLog = dayLogs.find(
    ( log ) =>
      log.taskId === taskId &&
      log.action === "stateChanged" &&
      log.newState === "completed"
  );

  const startLog = dayLogs
    .slice()
    .reverse()
    .find(
      ( log ) =>
        log.taskId === taskId &&
        log.action === "stateChanged" &&
        log.newState === "inProgress"
    );

  if ( completedLog && startLog && !completedLog.duration ) {
    const startTime = new Date( startLog.timestamp );
    const endTime = new Date( completedLog.timestamp );
    const durationMs = endTime - startTime;

    if ( durationMs > 0 ) {
      const hours = Math.floor( durationMs / ( 1000 * 60 * 60 ) );
      const minutes = Math.floor( ( durationMs % ( 1000 * 60 * 60 ) ) / ( 1000 * 60 ) );

      let durationText = "";
      if ( hours > 0 ) {
        durationText = `${hours}h ${minutes}min`;
      } else {
        durationText = `${minutes}min`;
      }

      // Actualizar el log con la duración
      completedLog.duration = durationText;
      completedLog.durationMs = durationMs;

      // Guardar cambios
      localStorage.setItem( "dailyTaskLogs", JSON.stringify( dailyTaskLogs ) );
    }
  }
}

function showDayChangeLog( dateStr ) {
  const dayLogs = dailyTaskLogs[ dateStr ] || [];
  const date = new Date( dateStr + "T12:00:00" );

  const modal = document.createElement( "div" );
  modal.id = "dayChangeLogModal";
  modal.className =
    "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div class="sticky top-0 bg-white border-b p-6 flex justify-between items-center">
                <h3 class="text-lg font-semibold text-gray-800">
                    <i class="fas fa-history text-blue-500 mr-2"></i>
                    Registro de actividad del ${date.toLocaleDateString( "es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  } )}
                </h3>
                <button onclick="closeAllModals()" class="text-gray-500 hover:text-gray-700 transition">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="p-6 overflow-y-auto max-h-96">
                ${dayLogs.length === 0
      ? `
                    <div class="text-center py-8 text-gray-500">
                        <i class="fas fa-clipboard-list text-4xl mb-3 opacity-50"></i>
                        <p>No hay registros para este día</p>
                    </div>
                `
      : `
                    <div class="space-y-3">
                        ${dayLogs
        .map(
          ( log ) => `
                            <div class="bg-gray-50 rounded-lg p-4 border-l-4 ${getDayLogColor( log.action )}">
                                <div class="flex justify-between items-start">
                                    <div class="flex-1">
                                        <div class="font-medium text-sm text-gray-800">
                                            ${getDayLogIcon( log.action )} ${getDayLogMessage( log )}
                                        </div>
                                        <div class="text-xs text-gray-500 mt-1 flex items-center space-x-3">
                                            <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded font-mono">
                                                ${log.time}
                                            </span>
                                            ${log.taskId ? `<span class="text-gray-400">ID: ${log.taskId.substring( 0, 8 )}...</span>` : ""}
                                        </div>
                                        ${getStateChangeInfo( log )}
                                        ${log.duration
              ? `
                                            <div class="mt-2 bg-green-100 text-green-800 px-2 py-1 rounded text-xs inline-block">
                                                <i class="fas fa-stopwatch mr-1"></i>
                                                Tiempo total: ${log.duration}
                                            </div>
                                        `
              : ""
            }
                                    </div>
                                </div>
                            </div>
                        `
        )
        .join( "" )}
                    </div>
                `
    }
                <div class="mt-6 flex justify-end space-x-3">
                    ${dayLogs.length > 0
      ? `
                        <button onclick="clearDayChangeLog('${dateStr}')" 
                                class="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">
                            <i class="fas fa-trash mr-2"></i>Limpiar Registro
                        </button>
                    `
      : ""
    }
                    <button onclick="closeAllModals()" 
                            class="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    `;

  document.body.appendChild( modal );
}

function getDayLogColor( action ) {
  const colors = {
    created: "border-green-500",
    stateChanged: "border-blue-500",
    paused: "border-orange-500",
    resumed: "border-blue-500",
    edited: "border-yellow-500",
    deleted: "border-red-500",
    moved: "border-purple-500",
  };
  return colors[ action ] || "border-gray-500";
}

function getDayLogIcon( action ) {
  const icons = {
    created: '<i class="fas fa-plus text-green-600"></i>',
    stateChanged: '<i class="fas fa-sync-alt text-blue-600"></i>',
    paused: '<i class="fas fa-pause text-orange-600"></i>',
    resumed: '<i class="fas fa-play text-blue-600"></i>',
    edited: '<i class="fas fa-edit text-yellow-600"></i>',
    deleted: '<i class="fas fa-trash text-red-600"></i>',
    moved: '<i class="fas fa-arrows-alt text-purple-600"></i>',
  };
  return icons[ action ] || '<i class="fas fa-info text-gray-600"></i>';
}

function getDayLogMessage( log ) {
  const messages = {
    created: `Tarea creada: "${log.taskTitle}"`,
    stateChanged: `"${log.taskTitle}": cambio de estado`,
    paused: `"${log.taskTitle}": pausada temporalmente`,
    resumed: `"${log.taskTitle}": reanudada`,
    edited: `Tarea editada: "${log.taskTitle}"`,
    deleted: `Tarea eliminada: "${log.taskTitle}"`,
    moved: `Tarea movida: "${log.taskTitle}"`,
  };
  return messages[ log.action ] || `Cambio en: "${log.taskTitle}"`;
}

function getStateChangeInfo( log ) {
  if (
    ( log.action === "stateChanged" ||
      log.action === "paused" ||
      log.action === "resumed" ) &&
    log.oldState &&
    log.newState
  ) {
    const stateNames = {
      pending: "Pendiente",
      inProgress: "En Proceso",
      paused: "Pausada",
      completed: "Completada",
    };

    const oldStateName = stateNames[ log.oldState ] || log.oldState;
    const newStateName = stateNames[ log.newState ] || log.newState;

    return `
            <div class="text-xs text-blue-600 mt-1 bg-blue-50 px-2 py-1 rounded">
                ${oldStateName} → ${newStateName}
            </div>
        `;
  }
  return "";
}

function clearDayChangeLog( dateStr ) {
  if (
    confirm( "¿Estás seguro de que quieres limpiar el registro de este día?" )
  ) {
    delete dailyTaskLogs[ dateStr ];
    localStorage.setItem( "dailyTaskLogs", JSON.stringify( dailyTaskLogs ) );
    showNotification( "Registro del día limpiado", "success" );
    closeAllModals();
  }
}

//Encolar operaciones para sync automático
function enqueueSync( operation, dateStr, task = null ) {
  if ( !currentUser || !isOnline ) return;

  const operationKey = `${dateStr}_${task?.id || "batch"}`;

  syncQueue.set( operationKey, {
    operation,
    dateStr,
    task: task ? { ...task } : null,
    timestamp: Date.now(),
  } );

  // Cancelar timeout anterior si existe
  if ( syncTimeout ) {
    clearTimeout( syncTimeout );
  }

  // Programar sync con debounce
  syncTimeout = setTimeout( () => {
    processSyncQueue();
  }, SYNC_DEBOUNCE_TIME );

  updateSyncIndicator( "pending" );
}

//Procesar cola de sincronización
async function processSyncQueue() {
  if ( !currentUser || !isOnline || isSyncing || syncQueue.size === 0 ) {
    return;
  }

  // Verificar intervalo mínimo entre syncs
  const now = Date.now();
  if ( now - lastSyncTime < MIN_SYNC_INTERVAL ) {
    // Re-programar sync
    syncTimeout = setTimeout(
      () => {
        processSyncQueue();
      },
      MIN_SYNC_INTERVAL - ( now - lastSyncTime )
    );
    return;
  }

  isSyncing = true;
  updateSyncIndicator( "syncing" );

  try {
    const operations = Array.from( syncQueue.values() );
    const userTasksRef = db
      .collection( "users" )
      .doc( currentUser.uid )
      .collection( "tasks" );
    const batch = db.batch();

    let operationsCount = 0;

    for ( const op of operations ) {
      const taskDocId = `${op.dateStr}_${op.task?.id}`;
      const taskRef = userTasksRef.doc( taskDocId );

      switch ( op.operation ) {
        case "upsert":
          if ( op.task ) {
            batch.set(
              taskRef,
              {
                ...op.task,
                date: op.dateStr,
                lastModified: new Date(),
              },
              { merge: true }
            );
            operationsCount++;
          }
          break;

        case "delete":
          batch.delete( taskRef );
          operationsCount++;
          break;
      }
    }

    if ( operationsCount > 0 ) {
      await batch.commit();
      console.log( `Sincronizadas ${operationsCount} operaciones` );

      // Solo mostrar notificación si hay muchas operaciones
      if ( operationsCount >= 5 ) {
        showNotification( `${operationsCount} cambios sincronizados`, "success" );
      }
    }

    // Limpiar cola
    syncQueue.clear();
    lastSyncTime = Date.now();
    updateSyncIndicator( "success" );
  } catch ( error ) {
    console.error( "❌ Error en sync automático:", error );
    updateSyncIndicator( "error" );

    // Re-intentar después de un tiempo
    setTimeout( () => {
      processSyncQueue();
    }, 10000 );
  } finally {
    isSyncing = false;
  }
}

//indicador visual de sync
function updateSyncIndicator( status ) {
  const statusEl = document.getElementById( "firebaseStatus" );
  const iconEl = document.getElementById( "statusIcon" );
  const textEl = document.getElementById( "statusText" );

  if ( !statusEl || !iconEl || !textEl ) return;

  const statusConfig = {
    success: {
      class: "bg-green-500 text-white",
      icon: "fa-check-circle",
      text: "Sincronizado",
    },
    error: {
      class: "bg-red-500 text-white",
      icon: "fa-exclamation-triangle",
      text: "Error de sync",
    },
    syncing: {
      class: "bg-blue-500 text-white",
      icon: "fa-sync-alt fa-spin",
      text: "Sincronizando...",
    },
    pending: {
      class: "bg-orange-500 text-white",
      icon: "fa-clock",
      text: "Cambios pendientes",
    },
    offline: {
      class: "bg-gray-500 text-white",
      icon: "fa-wifi",
      text: "Off line",
    },
  };

  const config = statusConfig[ status ] || statusConfig.offline;

  statusEl.className = `fixed top-4 left-4 px-3 py-2 rounded-lg text-sm font-medium z-40 ${config.class}`;
  iconEl.className = `fas ${config.icon} mr-2`;
  textEl.textContent = config.text;
  statusEl.classList.remove( "hidden" );

  // Auto-ocultar después de 3 segundos (excepto offline y pending)
  if ( ![ "offline", "pending" ].includes( status ) ) {
    setTimeout( () => {
      if ( textEl.textContent === config.text ) {
        // Solo ocultar si no cambió
        statusEl.classList.add( "hidden" );
      }
    }, 3000 );
  }
}

//Sync manual mejorado (mantener para botón)
async function syncToFirebase() {
  if ( !currentUser || !isOnline ) {
    showNotification( "No hay conexión disponible", "error" );
    return;
  }

  if ( isSyncing ) {
    showNotification( "Sincronización en progreso...", "info" );
    return;
  }

  const syncBtn = document.getElementById( "syncBtn" );
  const originalHTML = syncBtn ? syncBtn.innerHTML : "";

  try {
    // Cambiar visual del botón
    if ( syncBtn ) {
      syncBtn.disabled = true;
      syncBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin mr-2"></i>Sincronizando...';
    }

    // Primero procesar cola pendiente
    if ( syncQueue.size > 0 ) {
      console.log( "🔄 Procesando cola pendiente antes del sync manual" );
      await processSyncQueue();
    }

    // Hacer sync completo bidireccional
    isSyncing = true;
    updateSyncIndicator( "syncing" );

    // 1. Sync local → remoto (subir cambios)
    const userTasksRef = db
      .collection( "users" )
      .doc( currentUser.uid )
      .collection( "tasks" );
    const allLocalTasks = [];

    Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
      dayTasks.forEach( ( task ) => {
        allLocalTasks.push( {
          ...task,
          date,
          lastModified: new Date(),
        } );
      } );
    } );

    if ( allLocalTasks.length > 0 ) {
      const uploadBatch = db.batch();
      allLocalTasks.forEach( ( task ) => {
        const taskRef = userTasksRef.doc( `${task.date}_${task.id}` );
        uploadBatch.set( taskRef, task, { merge: true } );
      } );

      await uploadBatch.commit();
      console.log( `📤 ${allLocalTasks.length} tareas locales subidas` );
    }

    // 2. Sync remoto → local (bajar cambios)
    const snapshot = await userTasksRef.get();
    let tasksDownloaded = 0;

    if ( !snapshot.empty ) {
      const remoteTasks = {};
      snapshot.forEach( ( doc ) => {
        const task = doc.data();
        const date = task.date;

        if ( !remoteTasks[ date ] ) {
          remoteTasks[ date ] = [];
        }

        remoteTasks[ date ].push( {
          id: task.id,
          title: task.title,
          description: task.description || "",
          time: task.time || "",
          completed: task.completed || false,
        } );
      } );

      // Mergear con tareas locales
      Object.keys( remoteTasks ).forEach( ( date ) => {
        if ( !tasks[ date ] ) {
          tasks[ date ] = [];
        }

        remoteTasks[ date ].forEach( ( remoteTask ) => {
          const existsLocally = tasks[ date ].some(
            ( localTask ) =>
              localTask.id === remoteTask.id ||
              ( localTask.title === remoteTask.title &&
                localTask.time === remoteTask.time )
          );

          if ( !existsLocally ) {
            tasks[ date ].push( remoteTask );
            tasksDownloaded++;
          }
        } );
      } );

      if ( tasksDownloaded > 0 ) {
        saveTasks();
        renderCalendar();
        updateProgress();
      }
    }

    updateSyncIndicator( "success" );

    const totalSynced = allLocalTasks.length + tasksDownloaded;
    if ( totalSynced > 0 ) {
      showNotification(
        `Sincronización completa: ${allLocalTasks.length} subidas, ${tasksDownloaded} descargadas`,
        "success"
      );
    } else {
      showNotification( "Todo está sincronizado", "success" );
    }

    // Reiniciar notificaciones si están habilitadas
    if ( notificationsEnabled && Notification.permission === "granted" ) {
      stopNotificationService();
      setTimeout( () => startNotificationService(), 1000 );
    }
  } catch ( error ) {
    console.error( "Error en sync manual:", error );
    updateSyncIndicator( "error" );
    showNotification( "Error en sincronización: " + error.message, "error" );
  } finally {
    isSyncing = false;

    // Restaurar botón
    if ( syncBtn ) {
      syncBtn.disabled = false;
      syncBtn.innerHTML =
        originalHTML || '<i class="fas fa-sync-alt mr-2"></i>Sincronizar';
    }
  }
}

// función para mostrar estadísticas de sync (OPCIONAL)
function showSyncStats() {
  const totalTasks = Object.values( tasks ).reduce(
    ( sum, dayTasks ) => sum + dayTasks.length,
    0
  );
  const pendingOps = syncQueue.size;
  const lastSync = lastSyncTime
    ? new Date( lastSyncTime ).toLocaleTimeString()
    : "Nunca";

  const statsModal = document.createElement( "div" );
  statsModal.className =
    "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";
  statsModal.innerHTML = `
        <div class="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-800">
                    <i class="fas fa-chart-bar text-blue-500 mr-2"></i>Estadísticas de Sync
                </h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="space-y-3 text-sm">
                <div class="flex justify-between">
                    <span>Total de tareas:</span>
                    <span class="font-medium">${totalTasks}</span>
                </div>
                <div class="flex justify-between">
                    <span>Operaciones pendientes:</span>
                    <span class="font-medium ${pendingOps > 0 ? "text-orange-600" : "text-green-600"}">${pendingOps}</span>
                </div>
                <div class="flex justify-between">
                    <span>Última sincronización:</span>
                    <span class="font-medium">${lastSync}</span>
                </div>
                <div class="flex justify-between">
                    <span>Estado de conexión:</span>
                    <span class="font-medium ${isOnline ? "text-green-600" : "text-red-600"}">
                        ${isOnline ? "Conectado" : "Desconectado"}
                    </span>
                </div>
                <div class="flex justify-between">
                    <span>Usuario activo:</span>
                    <span class="font-medium ${currentUser ? "text-green-600" : "text-red-600"}">
                        ${currentUser ? "Sí" : "No"}
                    </span>
                </div>
            </div>
            <div class="mt-6 flex space-x-3">
                <button onclick="syncToFirebase(); this.closest('.fixed').remove();" 
                        class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition">
                    <i class="fas fa-sync-alt mr-2"></i>Sync Ahora
                </button>
                <button onclick="this.closest('.fixed').remove()" 
                        class="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition">
                    Cerrar
                </button>
            </div>
        </div>
    `;

  document.body.appendChild( statsModal );
}

// FUNCIÓN única para obtener fecha actual en formato local
function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String( now.getMonth() + 1 ).padStart( 2, "0" );
  const day = String( now.getDate() ).padStart( 2, "0" );
  return `${year}-${month}-${day}`;
}

// FUNCIÓN para comparar fechas correctamente
function isDatePast( dateStr ) {
  const today = new Date();
  const checkDate = new Date( dateStr + "T00:00:00" );

  today.setHours( 0, 0, 0, 0 );
  checkDate.setHours( 0, 0, 0, 0 );

  return checkDate < today;
}

// Inicialización
document.addEventListener( "DOMContentLoaded", function () {
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
  const taskDateInput = document.getElementById( "taskDate" );
  const taskTimeInput = document.getElementById( "taskTime" );

  if ( taskDateInput ) {
    const today = getTodayString();
    taskDateInput.setAttribute( "min", today );
    taskDateInput.value = today;
  }

  if ( taskTimeInput ) {
    const now = new Date();
    const currentHour = String( now.getHours() ).padStart( 2, "0" );
    const currentMinute = String( now.getMinutes() ).padStart( 2, "0" );
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
      synchronizeTabs: true,
    } ).catch( ( error ) => {
      if ( error.code == "failed-precondition" ) {
        console.warn( "Persistencia falló: múltiples tabs abiertas" );
      } else if ( error.code == "unimplemented" ) {
        console.warn( "Persistencia no soportada en este navegador" );
      } else {
        console.warn( "Error en persistencia de Firebase:", error );
      }
    } );

    auth.onAuthStateChanged( ( user ) => {
      currentUser = user;
      updateUI();

      if ( user ) {
        updateSyncIndicator( "success" );
        setTimeout( () => {
          if ( isOnline && !isSyncing ) {
            syncFromFirebase();
          }
        }, 1000 );
      } else {
        updateSyncIndicator( "offline" );
      }
    } );

    hideLoadingScreen();
  } catch ( error ) {
    console.error( "Error initializing Firebase:", error );
    updateSyncIndicator( "error" );
    hideLoadingScreen();
  }
}

function initNotifications() {
  if ( !( "Notification" in window ) ) {
    console.warn( "Este navegador no soporta notificaciones" );
    return;
  }

  // Detectar dispositivo móvil
  const isMobile =
    /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

  if ( Notification.permission === "granted" ) {
    notificationsEnabled = true;
    updateNotificationButton();
    startNotificationService();
  }

  updateNotificationButton();
}

function setupNetworkListeners() {
  window.addEventListener( "online", () => {
    isOnline = true;
    updateSyncIndicator( "success" );
    if ( currentUser ) {
      // Procesar cola pendiente al reconectar
      setTimeout( () => processSyncQueue(), 1000 );
      syncFromFirebase();
    }
  } );

  window.addEventListener( "offline", () => {
    isOnline = false;
    updateSyncIndicator( "offline" );
  } );
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById( "loadingScreen" );
  loadingScreen.style.opacity = "0";
  setTimeout( () => {
    loadingScreen.style.display = "none";
  }, 300 );
}

function updateUI() {
  const loginBtn = document.getElementById( "loginBtn" );
  const userInfo = document.getElementById( "userInfo" );
  const syncBtn = document.getElementById( "syncBtn" );

  if ( currentUser ) {
    loginBtn.classList.add( "hidden" );
    userInfo.classList.remove( "hidden" );
    syncBtn.disabled = false;

    document.getElementById( "userName" ).textContent =
      currentUser.displayName || "Usuario";
    document.getElementById( "userEmail" ).textContent = currentUser.email;
    document.getElementById( "userPhoto" ).src =
      currentUser.photoURL || "https://via.placeholder.com/32";
  } else {
    loginBtn.classList.remove( "hidden" );
    userInfo.classList.add( "hidden" );
    syncBtn.disabled = true;
  }
}

function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope( "profile" );
  provider.addScope( "email" );

  auth
    .signInWithPopup( provider )
    .then( ( result ) => {
      showNotification( "Sesión iniciada correctamente", "success" );
      closeLoginModal();
    } )
    .catch( ( error ) => {
      console.error( "Error signing in:", error );
      showNotification( "Error al iniciar sesión", "error" );
    } );
}

function signOut() {
  if ( confirm( "¿Estás seguro de que quieres cerrar sesión?" ) ) {
    auth
      .signOut()
      .then( () => {
        showNotification( "Sesión cerrada", "info" );
      } )
      .catch( ( error ) => {
        console.error( "Error signing out:", error );
      } );
  }
}

async function syncFromFirebase() {
  if ( !currentUser || !isOnline || isSyncing ) return;

  isSyncing = true;
  updateSyncIndicator( "syncing" );

  try {
    const userTasksRef = db
      .collection( "users" )
      .doc( currentUser.uid )
      .collection( "tasks" );
    const snapshot = await userTasksRef.get();

    if ( snapshot.empty ) {
      console.log( "No hay tareas remotas para sincronizar" );
      updateSyncIndicator( "success" );
      return;
    }

    const remoteTasks = {};
    snapshot.forEach( ( doc ) => {
      const task = doc.data();
      const date = task.date;

      if ( !remoteTasks[ date ] ) {
        remoteTasks[ date ] = [];
      }

      remoteTasks[ date ].push( {
        id: task.id,
        title: task.title,
        description: task.description || "",
        time: task.time || "",
        completed: task.completed || false,
      } );
    } );

    let tasksAdded = 0;
    Object.keys( remoteTasks ).forEach( ( date ) => {
      if ( !tasks[ date ] ) {
        tasks[ date ] = [];
      }

      remoteTasks[ date ].forEach( ( remoteTask ) => {
        const existsLocally = tasks[ date ].some(
          ( localTask ) =>
            localTask.id === remoteTask.id ||
            ( localTask.title === remoteTask.title &&
              localTask.time === remoteTask.time )
        );

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
      showNotification( `${tasksAdded} tareas sincronizadas`, "success" );
    }

    updateSyncIndicator( "success" );

    if ( notificationsEnabled && Notification.permission === "granted" ) {
      stopNotificationService();
      setTimeout( () => {
        startNotificationService();
      }, 1000 );
    }
  } catch ( error ) {
    console.error( "Error syncing from Firebase:", error );
    updateSyncIndicator( "error" );
    showNotification( "Error al sincronizar", "error" );
  } finally {
    isSyncing = false;
  }
}

// CONFIGURACIÓN de eventos con botón reset
function setupEventListeners() {
  const elements = {
    taskForm: addTask,
    prevMonth: () => changeMonth( -1 ),
    nextMonth: () => changeMonth( 1 ),
    closeModal: closeModal,
    taskRepeat: toggleCustomDays,
    clearWeekBtn: clearWeek,
    clearMonthBtn: clearMonth,
    exportExcelBtn: exportToExcel,
    notificationsBtn: toggleNotifications,
    syncBtn: syncToFirebase,
    loginBtn: showLoginModal,
    logoutBtn: signOut,
    googleSignInBtn: signInWithGoogle,
    closeLoginModal: closeLoginModal,
    resetFormBtn: resetForm,
    clearAllBtn: clearAll,
  };

  Object.entries( elements ).forEach( ( [ id, handler ] ) => {
    const element = document.getElementById( id );
    if ( element ) {
      element.addEventListener(
        element.tagName === "FORM" ? "submit" : "click",
        handler
      );
    }
  } );

  const closePanelBtn = document.getElementById( "closePanelBtn" );
  const addQuickTaskBtn = document.getElementById( "addQuickTaskBtn" );

  if ( closePanelBtn ) {
    closePanelBtn.addEventListener( "click", closeDailyTaskPanel );
  }

  if ( addQuickTaskBtn ) {
    addQuickTaskBtn.addEventListener( "click", addQuickTaskToSelectedDay );
  }

  const repeatDurationSelect = document.getElementById( "repeatDuration" );
  const customDaysInputs = document.querySelectorAll(
    '#customDays input[type="checkbox"]'
  );
  const taskDateInput = document.getElementById( "taskDate" );

  if ( repeatDurationSelect ) {
    repeatDurationSelect.addEventListener( "change", updateRepeatPreview );
  }

  if ( taskDateInput ) {
    taskDateInput.addEventListener( "change", updateRepeatPreview );
  }

  customDaysInputs.forEach( ( input ) => {
    input.addEventListener( "change", updateRepeatPreview );
  } );
}

function resetForm() {
  const form = document.getElementById( "taskForm" );
  const advancedConfig = document.getElementById( "advancedRepeatConfig" );
  const customDays = document.getElementById( "customDays" );
  const repeatDuration = document.getElementById( "repeatDuration" );

  form.reset();
  advancedConfig?.classList.add( "hidden" );
  customDays?.classList.add( "hidden" );

  if ( repeatDuration ) {
    repeatDuration.value = "2";
  }

  const customDaysCheckboxes = document.querySelectorAll(
    '#customDays input[type="checkbox"]'
  );
  customDaysCheckboxes.forEach( ( checkbox ) => {
    checkbox.checked = false;
  } );

  setupDateInput();
  showNotification( "Formulario reiniciado", "info" );

  const taskTimeInput = document.getElementById( "taskTime" );
  if ( taskTimeInput ) {
    taskTimeInput.addEventListener( "change", () => {
      setTimeout( () => {
        taskTimeInput.blur();
      }, 100 );
    } );

    taskTimeInput.addEventListener( "keydown", ( e ) => {
      if ( e.key === "Enter" ) {
        taskTimeInput.blur();
      }
    } );
  }

  document.addEventListener( "change", ( e ) => {
    if ( e.target.type === "time" ) {
      setTimeout( () => {
        e.target.blur();
      }, 100 );
    }
  } );

  document.addEventListener( "keydown", ( e ) => {
    if ( e.target.type === "time" && e.key === "Enter" ) {
      e.target.blur();
    }
  } );
}

function showLoginModal() {
  document.getElementById( "loginModal" ).classList.remove( "hidden" );
}

function closeLoginModal() {
  document.getElementById( "loginModal" ).classList.add( "hidden" );
}

function loadTasks() {
  try {
    const storedTasks = localStorage.getItem( "tasks" );
    tasks = storedTasks ? JSON.parse( storedTasks ) : {};
  } catch ( error ) {
    tasks = {};
    console.warn( "Error loading tasks from localStorage:", error );
  }
}

function toggleCustomDays() {
  const select = document.getElementById( "taskRepeat" );
  const advancedConfig = document.getElementById( "advancedRepeatConfig" );
  const customDays = document.getElementById( "customDays" );

  if ( select.value === "none" ) {
    advancedConfig?.classList.add( "hidden" );
  } else {
    advancedConfig?.classList.remove( "hidden" );
    customDays?.classList.toggle( "hidden", select.value !== "custom" );
    updateRepeatPreview();
  }
}

function updateRepeatPreview() {
  const repeatType = document.getElementById( "taskRepeat" ).value;
  const duration = document.getElementById( "repeatDuration" ).value;
  const previewText = document.getElementById( "previewText" );
  const taskDate = document.getElementById( "taskDate" ).value;

  if ( !previewText || repeatType === "none" ) return;

  const durationText = {
    1: "lo que resta del mes actual",
    2: "lo que resta del mes actual y todo el mes siguiente",
    3: "los próximos 3 meses",
    6: "los próximos 6 meses",
    12: "el próximo año",
  };

  const typeText = {
    daily: "todos los días",
    weekdays: "días de semana (Lun-Vie)",
    weekends: "fines de semana (Sáb-Dom)",
    weekly: "cada semana (mismo día)",
    custom: "días personalizados",
  };

  let preview = `Se creará ${typeText[ repeatType ]} durante ${durationText[ duration ]}`;

  if ( repeatType === "custom" ) {
    const selectedDays = Array.from(
      document.querySelectorAll( "#customDays input:checked" )
    );
    if ( selectedDays.length > 0 ) {
      const dayNames = [ "Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb" ];
      const selectedDayNames = selectedDays.map(
        ( cb ) => dayNames[ parseInt( cb.value ) ]
      );
      preview = `Se creará los ${selectedDayNames.join( ", " )} durante ${durationText[ duration ]}`;
    } else {
      preview = "Selecciona al menos un día";
    }
  }

  const approxTasks = calculateExactTaskCount(
    repeatType,
    parseInt( duration ),
    taskDate
  );

  if ( approxTasks > 0 ) {
    preview += ` (~${approxTasks} tareas)`;
  }

  previewText.textContent = preview;
}

function calculateExactTaskCount( repeatType, durationMonths, startDateStr ) {
  const startDate = startDateStr
    ? new Date( startDateStr + "T00:00:00" )
    : new Date();

  let endDate;
  if ( durationMonths === 1 ) {
    endDate = new Date( startDate.getFullYear(), startDate.getMonth() + 1, 0 );
  } else {
    endDate = new Date( startDate );
    endDate.setMonth( endDate.getMonth() + durationMonths );
    endDate = new Date( endDate.getFullYear(), endDate.getMonth(), 0 );
  }

  let count = 0;
  let currentDate = new Date( startDate );

  let selectedDays = [];
  if ( repeatType === "custom" ) {
    selectedDays = Array.from(
      document.querySelectorAll( "#customDays input:checked" )
    ).map( ( cb ) => parseInt( cb.value ) );
    if ( selectedDays.length === 0 ) return 0;
  }

  while ( currentDate <= endDate ) {
    const dayOfWeek = currentDate.getDay();
    let shouldCount = false;

    switch ( repeatType ) {
      case "daily":
        shouldCount = true;
        break;
      case "weekdays":
        shouldCount = dayOfWeek >= 1 && dayOfWeek <= 5;
        break;
      case "weekends":
        shouldCount = dayOfWeek === 0 || dayOfWeek === 6;
        break;
      case "weekly":
        shouldCount = dayOfWeek === startDate.getDay();
        break;
      case "custom":
        shouldCount = selectedDays.includes( dayOfWeek );
        break;
    }

    const currentDateStr = currentDate.toISOString().split( "T" )[ 0 ];
    if ( shouldCount && !isDatePast( currentDateStr ) ) {
      count++;
    }

    currentDate.setDate( currentDate.getDate() + 1 );
  }

  return count;
}

//addTask con sync automático
function addTask( e ) {
  e.preventDefault();

  const formData = {
    title: document.getElementById( "taskTitle" ).value.trim(),
    description: document.getElementById( "taskDescription" ).value.trim(),
    date: document.getElementById( "taskDate" ).value,
    time: document.getElementById( "taskTime" ).value,
    repeat: document.getElementById( "taskRepeat" ).value,
    priority: parseInt( document.getElementById( "taskPriority" ).value ) || 3,
    initialState:
      document.getElementById( "taskInitialState" )?.value || "pending", // NUEVO
  };

  if ( !formData.title ) return;

  if ( formData.date && isDatePast( formData.date ) ) {
    showNotification(
      "No puedes agregar tareas a fechas anteriores. Por favor selecciona hoy o una fecha futura.",
      "error"
    );
    return;
  }

  const task = {
    id: Date.now().toString(),
    title: formData.title,
    description: formData.description,
    time: formData.time,
    priority: formData.priority,
    state: formData.initialState, // NUEVO
    completed: formData.initialState === "completed", // Mantener compatibilidad
  };

  if ( formData.date && formData.repeat === "none" ) {
    addTaskToDate( formData.date, task );
    enqueueSync( "upsert", formData.date, task );

    // NUEVO: Registrar creación de tarea
    addToChangeLog( "created", task.title, formData.date );
  } else if ( formData.repeat !== "none" ) {
    const startDate = formData.date
      ? new Date( formData.date + "T00:00:00" )
      : new Date();
    addRecurringTasks( task, formData.repeat, startDate );
  }

  saveTasks();
  renderCalendar();
  updateProgress();
  document.getElementById( "taskForm" ).reset();
  setupDateInput();
  showNotification( "Tarea agregada exitosamente" );

  const advancedConfig = document.getElementById( "advancedRepeatConfig" );
  const customDays = document.getElementById( "customDays" );
  const repeatDuration = document.getElementById( "repeatDuration" );

  advancedConfig?.classList.add( "hidden" );
  customDays?.classList.add( "hidden" );

  if ( repeatDuration ) {
    repeatDuration.value = "2";
  }

  // Reset priority and state to default
  const prioritySelect = document.getElementById( "taskPriority" );
  const stateSelect = document.getElementById( "taskInitialState" );
  if ( prioritySelect ) prioritySelect.value = "3";
  if ( stateSelect ) stateSelect.value = "pending";
}

function addTaskToDate( dateStr, task ) {
  if ( !tasks[ dateStr ] ) tasks[ dateStr ] = [];
  const newTask = { ...task, id: `${dateStr}-${Date.now()}` };
  tasks[ dateStr ].push( newTask );

  // Actualizar panel si está abierto para este día
  if ( selectedDateForPanel === dateStr ) {
    const day = new Date( dateStr + "T12:00:00" ).getDate();
    showDailyTaskPanel( dateStr, day );
  }

  return newTask;
}

//addRecurringTasks con sync automático optimizado
function addRecurringTasks( task, repeatType, startDate ) {
  const durationSelect = document.getElementById( "repeatDuration" );
  const durationMonths = durationSelect ? parseInt( durationSelect.value ) : 2;

  let endDate;
  let currentDate = new Date( startDate );
  let tasksAdded = 0;

  if ( durationMonths === 1 ) {
    endDate = new Date( startDate.getFullYear(), startDate.getMonth() + 1, 0 );
  } else {
    endDate = new Date( startDate );
    endDate.setMonth( endDate.getMonth() + durationMonths );
    endDate = new Date( endDate.getFullYear(), endDate.getMonth(), 0 );
  }

  let selectedDays = [];
  if ( repeatType === "custom" ) {
    selectedDays = Array.from(
      document.querySelectorAll( "#customDays input:checked" )
    ).map( ( cb ) => parseInt( cb.value ) );
  }

  // Recopilar todas las tareas antes de sincronizar
  const newTasks = [];

  while ( currentDate <= endDate ) {
    const dateStr = currentDate.toISOString().split( "T" )[ 0 ];
    const dayOfWeek = currentDate.getDay();
    let shouldAdd = false;

    switch ( repeatType ) {
      case "daily":
        shouldAdd = true;
        break;
      case "weekdays":
        shouldAdd = dayOfWeek >= 1 && dayOfWeek <= 5;
        break;
      case "weekends":
        shouldAdd = dayOfWeek === 0 || dayOfWeek === 6;
        break;
      case "weekly":
        shouldAdd = dayOfWeek === startDate.getDay();
        break;
      case "custom":
        shouldAdd = selectedDays.includes( dayOfWeek ) && selectedDays.length > 0;
        break;
    }

    if ( shouldAdd && !isDatePast( dateStr ) ) {
      const newTask = addTaskToDate( dateStr, task );
      newTasks.push( { dateStr, task: newTask } );
      tasksAdded++;
    }

    currentDate.setDate( currentDate.getDate() + 1 );
  }

  // Sync automático batch para todas las tareas recurrentes
  newTasks.forEach( ( { dateStr, task } ) => {
    enqueueSync( "upsert", dateStr, task );
  } );

  const durationText = {
    1: "lo que resta del mes actual",
    2: "lo que resta del mes actual y todo el mes siguiente",
    3: "los próximos 3 meses",
    6: "los próximos 6 meses",
    12: "el próximo año",
  };

  showNotification(
    `${tasksAdded} tareas agregadas para ${durationText[ durationMonths.toString() ] || `${durationMonths} meses`}`,
    "success"
  );
}

function renderCalendar() {
  const calendar = document.getElementById( "calendar" );
  const monthYear = document.getElementById( "currentMonth" );

  if ( !calendar || !monthYear ) return;

  calendar.innerHTML = "";
  monthYear.textContent = currentDate
    .toLocaleDateString( "es-ES", {
      month: "long",
      year: "numeric",
    } )
    .replace( /^\w/, ( c ) => c.toUpperCase() );

  const dayHeaders = [ "Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb" ];
  dayHeaders.forEach( ( day ) => {
    const dayElement = document.createElement( "div" );
    dayElement.className = "text-center font-semibold text-gray-600 py-2";
    dayElement.textContent = day;
    calendar.appendChild( dayElement );
  } );

  const firstDay = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  );
  const lastDay = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  );
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  for ( let i = 0; i < startingDayOfWeek; i++ ) {
    const emptyDay = document.createElement( "div" );
    emptyDay.className = "h-24 border border-gray-200";
    calendar.appendChild( emptyDay );
  }

  for ( let day = 1; day <= daysInMonth; day++ ) {
    const date = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      day
    );
    const dateStr = date.toISOString().split( "T" )[ 0 ];
    const dayTasks = tasks[ dateStr ] || [];

    calendar.appendChild( createDayElement( day, dateStr, dayTasks ) );
  }
}

function createDayElement( day, dateStr, dayTasks ) {
  const dayElement = document.createElement( "div" );

  const todayStr = getTodayString();
  const isToday = dateStr === todayStr;
  const isPastDate = isDatePast( dateStr );

  dayElement.className = `h-24 border border-gray-200 p-1 cursor-pointer hover:bg-blue-50 transition relative calendar-day group ${isToday ? "bg-blue-100 border-blue-300 ring-2 ring-blue-200" : ""} ${isPastDate ? "opacity-75" : ""}`;
  dayElement.dataset.date = dateStr;

  dayElement.innerHTML = `
        <div class="font-semibold text-sm mb-1 ${isToday ? "text-blue-700" : ""}">${day}</div>
        <div class="space-y-1">
            ${dayTasks
      .slice( 0, 2 )
      .map( ( task ) => createTaskElement( task, dateStr ) )
      .join( "" )}
            ${dayTasks.length > 2
      ? `
                <div class="text-xs text-gray-500 cursor-pointer hover:text-blue-600 transition-colors" 
                     onclick="showDailyTaskPanel('${dateStr}', ${day})">
                    +${dayTasks.length - 2} más
                </div>
            `
      : ""
    }
        </div>
        ${!isPastDate
      ? `
            <button onclick="event.stopPropagation(); showQuickAddTask('${dateStr}')"
                    class="absolute bottom-1 right-1 w-6 h-6 bg-green-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-green-600 flex items-center justify-center"
                    title="Agregar tarea rápida">
                <i class="fas fa-plus"></i>
            </button>
        `
      : ""
    }
    `;

  dayElement.addEventListener( "click", ( e ) => {
    if ( !e.target.closest( ".task-item" ) && !e.target.closest( "button" ) ) {
      showDailyTaskPanel( dateStr, day );
    }
  } );

  return dayElement;
}

function updatePanelDateHeader( dateStr, day, dayTasks ) {
  const panelDate = document.getElementById( 'panelDate' );
  const actionButtons = document.getElementById( 'panelActionButtons' );
  const date = new Date( dateStr + 'T12:00:00' );
  const dayLogs = dailyTaskLogs[ dateStr ] || [];

  const dateOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };

  // SOLO actualizar el título - mantenerlo simple y limpio
  panelDate.innerHTML = `
        <i class="fas fa-tasks text-indigo-600 mr-2"></i>
        Tareas del ${date.toLocaleDateString( 'es-ES', dateOptions )}
    `;

  // Limpiar botones existentes (excepto el botón de cierre)
  const existingButtons = actionButtons.querySelectorAll( 'button:not(#closePanelBtn)' );
  existingButtons.forEach( btn => btn.remove() );

  // Crear contenedor para los nuevos botones
  const buttonContainer = document.createElement( 'div' );
  buttonContainer.className = 'flex items-center space-x-2';

  // Botón de limpiar día (solo si hay tareas)
  if ( dayTasks.length > 0 ) {
    const clearBtn = document.createElement( 'button' );
    clearBtn.onclick = () => clearDayTasks( dateStr );
    clearBtn.className = 'flex items-center space-x-1 text-red-600 hover:text-red-700 text-sm px-2 py-1 rounded hover:bg-red-50 transition';
    clearBtn.title = 'Eliminar todas las tareas del día';
    clearBtn.innerHTML = `
            <i class="fas fa-trash-alt"></i>
            <span class="hidden sm:inline">Limpiar Día</span>
        `;
    buttonContainer.appendChild( clearBtn );
  }

  // Botón de registro
  const logBtn = document.createElement( 'button' );
  logBtn.onclick = () => showDayChangeLog( dateStr );
  logBtn.className = 'flex items-center space-x-1 text-purple-600 hover:text-purple-700 text-sm px-2 py-1 rounded hover:bg-purple-50 transition';
  logBtn.title = 'Ver registro de cambios del día';
  logBtn.innerHTML = `
        <i class="fas fa-history"></i>
        <span class="hidden sm:inline">Registro</span>
        ${dayLogs.length > 0 ? `<span class="bg-purple-100 text-purple-700 text-xs px-1.5 py-0.5 rounded-full ml-1">${dayLogs.length}</span>` : ''}
    `;
  buttonContainer.appendChild( logBtn );

  // Insertar los botones ANTES del botón de cierre
  const closePanelBtn = document.getElementById( 'closePanelBtn' );
  actionButtons.insertBefore( buttonContainer, closePanelBtn );
}

function showDailyTaskPanel( dateStr, day ) {
  const panel = document.getElementById( "dailyTaskPanel" );
  const panelDate = document.getElementById( "panelDate" );
  const taskList = document.getElementById( "panelTaskList" );

  if ( !panel || !panelDate || !taskList ) return;

  selectedDateForPanel = dateStr;
  const dayTasks = tasks[ dateStr ] || [];

  const date = new Date( dateStr + "T12:00:00" );
  const isPastDate = isDatePast( dateStr );

  const dateOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };

  updatePanelDateHeader( dateStr, day, dayTasks );

  if ( dayTasks.length === 0 ) {
    taskList.innerHTML = `
            <div class="text-center py-8 text-gray-500">
                <i class="fas fa-calendar-plus text-4xl mb-3 opacity-50"></i>
                <p>No hay tareas para este día</p>
                ${!isPastDate ? '<p class="text-sm mt-2">¡Agrega tu primera tarea!</p>' : ""}
            </div>
        `;
  } else {
    const sortedTasks = sortTasksByPriority( dayTasks );
    taskList.innerHTML = sortedTasks
      .map( ( task ) => createPanelTaskElement( task, dateStr ) )
      .join( "" );
  }

  updatePanelProgress( dayTasks );

  const addQuickTaskBtn = document.getElementById( "addQuickTaskBtn" );
  if ( addQuickTaskBtn ) {
    addQuickTaskBtn.style.display = isPastDate ? "none" : "flex";
  }

  panel.classList.remove( "hidden" );

  if ( window.innerWidth < 768 ) {
    setTimeout( () => {
      panel.scrollIntoView( { behavior: "smooth", block: "start" } );
    }, 100 );
  }
}

function sortTasksByPriority( tasks ) {
  return tasks.sort( ( a, b ) => {
    // Primero por prioridad (1=más importante, 4=menos importante)
    if ( a.priority !== b.priority ) {
      return a.priority - b.priority;
    }
    // Luego por hora si tienen la misma prioridad
    if ( a.time && b.time ) {
      return a.time.localeCompare( b.time );
    }
    if ( a.time && !b.time ) return -1;
    if ( !a.time && b.time ) return 1;
    // Finalmente por título
    return a.title.localeCompare( b.title );
  } );
}

function createPanelTaskElement( task, dateStr ) {
  const isPastDate = isDatePast( dateStr );
  const priority = PRIORITY_LEVELS[ task.priority ] || PRIORITY_LEVELS[ 3 ];
  const state = TASK_STATES[ task.state ] || TASK_STATES.pending;

  const canPause = task.state === "inProgress";
  const canResume = task.state === "paused";

  return `
        <div class="panel-task-item bg-white rounded-lg shadow-md p-4 mb-4 border-l-4 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5" 
             style="border-left-color: ${priority.color}" 
             data-priority="${task.priority}">
            <div class="flex sm:items-center sm:justify-between">
                <div class="flex-1 sm:flex sm:items-start sm:space-x-3">
                    <!-- Select de estado y prioridad -->
                    <div class="flex flex-col space-y-2 mb-3 sm:mb-0">
                        ${!isPastDate
      ? `
                            <select onchange="changeTaskStateDirect('${dateStr}', '${task.id}', this.value)" 
                                    class="text-xs p-2 rounded-lg border ${state.class} font-medium cursor-pointer transition-colors duration-200"
                                    title="Cambiar estado de la tarea">
                                <option value="pending" ${task.state === "pending" ? "selected" : ""}>⏸ Pendiente</option>
                                <option value="inProgress" ${task.state === "inProgress" ? "selected" : ""}>▶ En Proceso</option>
                                <option value="paused" ${task.state === "paused" ? "selected" : ""}>⏸ Pausada</option>
                                <option value="completed" ${task.state === "completed" ? "selected" : ""}>✓ Completada</option>
                            </select>
                        `
      : `
                            <div class="text-xs p-2 rounded-lg ${state.class} font-medium">
                                <i class="fas ${state.icon}"></i> ${state.label}
                            </div>
                        `
    }
                        <div class="flex items-center space-x-2">
                            <span class="task-priority-dot inline-block w-3 h-3 rounded-full shadow-sm" 
                                  style="background-color: ${priority.color}" 
                                  title="Prioridad: ${priority.label}"></span>
                            <span class="text-xs text-gray-600 font-medium">${priority.label}</span>
                        </div>
                    </div>
                    
                    <!-- Información de la tarea -->
                    <div class="flex-1">
                        <div class="task-title font-semibold text-base ${task.state === "completed" ? "line-through text-gray-500" : "text-gray-800"}">${task.title}</div>
                        ${task.description ? `<div class="task-description text-sm text-gray-600 mt-1">${task.description}</div>` : '<div class="task-description text-sm text-gray-400 mt-1 italic">Sin descripción</div>'}
                        <div class="task-meta flex flex-wrap items-center gap-3 mt-2 text-xs">
                            ${task.time ? `<div class="text-indigo-600"><i class="far fa-clock mr-1"></i>${task.time}</div>` : ""}
                            <div class="text-gray-500">${state.label}</div>
                        </div>
                    </div>
                </div>
                
                <!-- Botones de acción: Verticales en móvil, horizontales en desktop -->
                ${!isPastDate
      ? `
                    <div class="task-actions flex flex-col space-y-1 ml-4 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-1 sm:ml-0">
                        ${canPause
        ? `
                            <button onclick="pauseTask('${dateStr}', '${task.id}')"
                                    class="flex items-center space-x-1 bg-orange-100 text-orange-700 px-3 py-2 rounded-lg hover:bg-orange-200 transition-colors duration-200 text-xs font-medium shadow-sm"
                                    title="Pausar tarea activa">
                                <i class="fas fa-pause"></i>
                                <span>Pausar</span>
                            </button>
                        `
        : ""
      }
                        ${canResume
        ? `
                            <button onclick="resumeTask('${dateStr}', '${task.id}')"
                                    class="flex items-center space-x-1 bg-blue-100 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-200 transition-colors duration-200 text-xs font-medium shadow-sm"
                                    title="Reanudar tarea pausada">
                                <i class="fas fa-play"></i>
                                <span>Reanudar</span>
                            </button>
                        `
        : ""
      }
                        <button onclick="showAdvancedEditModal('${dateStr}', '${task.id}')"
                                class="text-blue-500 hover:text-blue-700 p-2 rounded-lg hover:bg-blue-50 transition-colors duration-200"
                                title="Editar título, descripción, hora y prioridad">
                            <i class="fas fa-edit text-sm"></i>
                        </button>
                        <button onclick="showDayChangeLog('${dateStr}')"
                                class="text-purple-500 hover:text-purple-700 p-2 rounded-lg hover:bg-purple-50 transition-colors duration-200"
                                title="Ver registro de cambios del día">
                            <i class="fas fa-history text-sm"></i>
                        </button>
                        <button onclick="deleteTaskFromPanel('${dateStr}', '${task.id}')"
                                class="text-red-500 hover:text-red-700 p-2 rounded-lg hover:bg-red-50 transition-colors duration-200"
                                title="Eliminar tarea permanentemente">
                            <i class="fas fa-trash text-sm"></i>
                        </button>
                    </div>
                `
      : ""
    }
            </div>
        </div>
    `;
}

// FUNCIONES PARA PAUSAR Y REANUDAR
function pauseTask( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task || task.state !== "inProgress" ) {
    showNotification( "Solo se pueden pausar tareas en proceso", "error" );
    return;
  }

  const oldState = task.state;
  task.state = "paused";
  task.completed = false;

  // Registrar pausa específica
  addToChangeLog( "paused", task.title, dateStr, oldState, "paused", taskId );

  saveTasks();
  renderCalendar();
  updateProgress();
  enqueueSync( "upsert", dateStr, task );

  // Actualizar panel si está abierto
  if ( selectedDateForPanel === dateStr ) {
    const day = new Date( dateStr + "T12:00:00" ).getDate();
    showDailyTaskPanel( dateStr, day );
  }

  showNotification( "Tarea pausada", "info" );
}

function resumeTask( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task || task.state !== "paused" ) {
    showNotification( "Solo se pueden reanudar tareas pausadas", "error" );
    return;
  }

  const oldState = task.state;
  task.state = "inProgress";
  task.completed = false;

  // Registrar reanudación específica
  addToChangeLog(
    "resumed",
    task.title,
    dateStr,
    oldState,
    "inProgress",
    taskId
  );

  saveTasks();
  renderCalendar();
  updateProgress();
  enqueueSync( "upsert", dateStr, task );

  // Actualizar panel si está abierto
  if ( selectedDateForPanel === dateStr ) {
    const day = new Date( dateStr + "T12:00:00" ).getDate();
    showDailyTaskPanel( dateStr, day );
  }

  showNotification( "Tarea reanudada", "success" );
}

function showDeletedTasksModal() {
  closeAllModals();

  const deletedTasks = JSON.parse( localStorage.getItem( "deletedTasks" ) || "[]" );

  const modal = document.createElement( "div" );
  modal.id = "deletedTasksModal";
  modal.className =
    "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div class="sticky top-0 bg-white border-b p-6 flex justify-between items-center">
                <h3 class="text-lg font-semibold text-gray-800">
                    <i class="fas fa-trash text-red-500 mr-2"></i>Tareas Eliminadas
                </h3>
                <button onclick="closeAllModals()" class="text-gray-500 hover:text-gray-700 transition">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="p-6 overflow-y-auto max-h-96">
                ${deletedTasks.length === 0
      ? `
                    <div class="text-center py-8 text-gray-500">
                        <i class="fas fa-check-circle text-4xl mb-3 opacity-50"></i>
                        <p>No hay tareas eliminadas</p>
                    </div>
                `
      : `
                    <div class="space-y-3">
                        ${deletedTasks
        .map(
          ( task, index ) => `
                            <div class="bg-red-50 rounded-lg p-3 border-l-4 border-red-500">
                                <div class="flex justify-between items-start">
                                    <div class="flex-1">
                                        <div class="font-medium text-sm text-gray-800">
                                            <i class="fas fa-trash text-red-600 mr-1"></i>
                                            "${task.title}"
                                        </div>
                                        <div class="text-xs text-gray-500 mt-1">
                                            Fecha: ${task.date} • Eliminada: ${task.formattedDeleteTime}
                                        </div>
                                        <div class="text-xs text-red-600 mt-1">
                                            ID: ${task.id}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `
        )
        .join( "" )}
                    </div>
                `
    }
                <div class="mt-6 flex justify-end space-x-3">
                    ${deletedTasks.length > 0
      ? `
                        <button onclick="clearDeletedTasks()" class="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">
                            <i class="fas fa-eraser mr-2"></i>Limpiar Lista
                        </button>
                    `
      : ""
    }
                    <button onclick="closeAllModals()" class="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    `;

  document.body.appendChild( modal );
}

// FUNCIÓN PARA LIMPIAR TAREAS ELIMINADAS
function clearDeletedTasks() {
  if (
    confirm(
      "¿Estás seguro de que quieres limpiar la lista de tareas eliminadas?"
    )
  ) {
    localStorage.removeItem( "deletedTasks" );
    showNotification( "Lista de tareas eliminadas limpiada", "success" );
    closeAllModals();
  }
}

function clearDayTasks( dateStr ) {
  const dayTasks = tasks[ dateStr ] || [];

  if ( dayTasks.length === 0 ) {
    showNotification( "No hay tareas para eliminar en este día", "info" );
    return;
  }

  const date = new Date( dateStr + "T12:00:00" );
  const formattedDate = date.toLocaleDateString( "es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  } );

  if ( !confirm( `¿Estás seguro de que quieres eliminar todas las ${dayTasks.length} tareas del ${formattedDate}?` ) ) {
    return;
  }

  // Registrar eliminación masiva
  dayTasks.forEach( task => {
    addToChangeLog( "deleted", task.title, dateStr, null, null, task.id );
  } );

  // Guardar para sync
  const tasksToDelete = [ ...dayTasks ];

  // Eliminar del estado local
  delete tasks[ dateStr ];

  // Auto-sync: eliminar todas las tareas del día
  tasksToDelete.forEach( task => {
    enqueueSync( "delete", dateStr, { id: task.id } );
  } );

  saveTasks();
  renderCalendar();
  updateProgress();

  // Cerrar panel
  closeDailyTaskPanel();

  showNotification( `${tasksToDelete.length} tareas eliminadas del ${formattedDate}`, "success" );
}

function createTaskElement( task, dateStr ) {
  const priority = PRIORITY_LEVELS[ task.priority ] || PRIORITY_LEVELS[ 3 ];
  const state = TASK_STATES[ task.state ] || TASK_STATES.pending;

  return `
        <div class="task-item-wrapper relative group/task">
            <div class="text-xs p-1 rounded ${state.class} truncate task-item cursor-move pr-8 border-l-4" 
                 data-task-id="${task.id}"
                 data-date="${dateStr}"
                 draggable="true"
                 style="border-left-color: ${priority.color}"
                 title="${task.title}${task.time ? " - " + task.time : ""} | ${state.label} | ${priority.label}">
                <i class="fas ${state.icon} mr-1 opacity-75"></i>
                ${task.title}
                ${task.time ? `<span class="text-xs opacity-75 ml-1">${task.time}</span>` : ""}
            </div>
            <div class="absolute right-0 top-0 h-full flex items-center opacity-0 group-hover/task:opacity-100 transition-opacity duration-200 bg-gradient-to-l from-white via-white to-transparent pl-2">
                <button onclick="event.stopPropagation(); quickEditTaskAdvanced('${dateStr}', '${task.id}')"
                        class="text-blue-500 hover:text-blue-700 text-xs p-1 rounded hover:bg-blue-100"
                        title="Editar tarea completa">
                    <i class="fas fa-edit"></i>
                </button>
                <button onclick="event.stopPropagation(); quickDeleteTask('${dateStr}', '${task.id}')"
                        class="text-red-500 hover:text-red-700 text-xs p-1 rounded hover:bg-red-100 ml-1"
                        title="Eliminar tarea permanentemente">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

function updatePanelProgress( dayTasks ) {
  const progressBar = document.getElementById( "panelProgressBar" );
  const progressText = document.getElementById( "panelProgressText" );

  if ( !progressBar || !progressText ) return;

  const completedTasks = dayTasks.filter(
    ( task ) => task.state === "completed"
  ).length;
  const inProgressTasks = dayTasks.filter(
    ( task ) => task.state === "inProgress"
  ).length;
  const pausedTasks = dayTasks.filter( ( task ) => task.state === "paused" ).length;
  const pendingTasks = dayTasks.filter(
    ( task ) => task.state === "pending"
  ).length;

  const progress =
    dayTasks.length === 0
      ? 0
      : Math.round( ( completedTasks / dayTasks.length ) * 100 );

  progressBar.style.width = `${progress}%`;
  progressText.innerHTML = `
        ${progress}% | 
        <span class="text-green-600">${completedTasks} ✓</span> 
        <span class="text-blue-600">${inProgressTasks} ▶</span> 
        <span class="text-orange-600">${pausedTasks} ⏸</span>
        <span class="text-gray-600">${pendingTasks} ⏸</span>
    `;
}

//toggleTaskFromPanel con sync automático
function toggleTaskFromPanel( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( task ) {
    task.completed = !task.completed;

    // Limpiar notificaciones si se completa la tarea
    if ( task.completed ) {
      clearTaskNotifications( taskId );
    }

    saveTasks();
    renderCalendar();
    updateProgress();

    // Auto-sync
    enqueueSync( "upsert", dateStr, task );

    if ( selectedDateForPanel === dateStr ) {
      const dayTasks = tasks[ dateStr ] || [];
      updatePanelProgress( dayTasks );

      const taskElement = document.querySelector(
        `input[onchange="toggleTaskFromPanel('${dateStr}', '${taskId}')"]`
      );
      if ( taskElement ) {
        const container = taskElement.closest( "div.border" );
        if ( container ) {
          container.className = container.className.replace(
            task.completed
              ? "bg-gray-50 border-gray-200"
              : "bg-green-50 border-green-200",
            task.completed
              ? "bg-green-50 border-green-200"
              : "bg-gray-50 border-gray-200"
          );

          const titleElement = container.querySelector( ".font-medium" );
          if ( titleElement ) {
            titleElement.className = `font-medium ${task.completed ? "line-through text-green-600" : "text-gray-800"}`;
          }
        }
      }
    }
  }
}

//deleteTaskFromPanel con sync automático
function deleteTaskFromPanel( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task ) return;

  if ( confirm( `¿Eliminar la tarea "${task.title}"?` ) ) {
    // Usar la función mejorada que registra la eliminación
    deleteTaskWithUndoImproved( dateStr, taskId );

    if ( selectedDateForPanel === dateStr ) {
      const day = new Date( dateStr + "T12:00:00" ).getDate();
      showDailyTaskPanel( dateStr, day );
    }
  }
}

// Función para cambiar estados de tarea
function toggleTaskState( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task ) return;

  const oldState = task.state || "pending";
  let newState;

  // Lógica especial para pausar/reanudar
  if ( oldState === "inProgress" ) {
    newState = "paused";
  } else if ( oldState === "paused" ) {
    // Si está pausada, vuelve a proceso
    newState = "inProgress";
  } else {
    // Flujo normal: pendiente -> proceso -> completada
    const stateOrder = [ "pending", "inProgress", "completed" ];
    const currentIndex = stateOrder.indexOf( oldState );
    const nextIndex = ( currentIndex + 1 ) % stateOrder.length;
    newState = stateOrder[ nextIndex ];
  }

  task.state = newState;
  task.completed = task.state === "completed";

  // Registrar cambio
  addToChangeLog( "stateChanged", task.title, dateStr, oldState, newState );

  // Limpiar notificaciones si se completa
  if ( task.state === "completed" ) {
    clearTaskNotifications( taskId );
  }

  saveTasks();
  renderCalendar();
  updateProgress();
  enqueueSync( "upsert", dateStr, task );

  // Actualizar panel si está abierto
  if ( selectedDateForPanel === dateStr ) {
    const day = new Date( dateStr + "T12:00:00" ).getDate();
    showDailyTaskPanel( dateStr, day );
  }

  const stateInfo = TASK_STATES[ task.state ];
  showNotification( `Tarea cambiada a: ${stateInfo.label}`, "success" );
}

// Modal de edición avanzada
function showAdvancedEditModal( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task ) {
    showNotification( "Tarea no encontrada", "error" );
    return;
  }

  if ( isDatePast( dateStr ) ) {
    showNotification( "No puedes editar tareas de fechas pasadas", "error" );
    return;
  }

  // Cerrar cualquier modal existente
  closeAllModals();

  const modal = document.createElement( "div" );
  modal.id = "advancedEditModal";
  modal.className =
    "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-800">
                    <i class="fas fa-edit text-blue-500 mr-2"></i>Editar Tarea
                </h3>
                <button onclick="closeAllModals()" class="text-gray-500 hover:text-gray-700 transition">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <form id="advancedEditTaskForm" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Título <span class="text-red-500">*</span></label>
                    <input type="text" id="advancedEditTaskTitle" value="${task.title || ""}" required 
                           class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
                    <textarea id="advancedEditTaskDescription" rows="3" 
                              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">${task.description || ""}</textarea>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Hora <span class="text-red-500">*</span></label>
                        <input type="time" id="advancedEditTaskTime" value="${task.time || ""}" required
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Prioridad <span class="text-red-500">*</span></label>
                        <select id="advancedEditTaskPriority" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            <option value="" disabled>Selecciona una prioridad</option>
                            <option value="1" ${task.priority === 1 ? "selected" : ""}>🔴 Muy Importante</option>
                            <option value="2" ${task.priority === 2 ? "selected" : ""}>🟠 Importante</option>
                            <option value="3" ${task.priority === 3 ? "selected" : ""}>🔵 Moderado</option>
                            <option value="4" ${task.priority === 4 ? "selected" : ""}>⚫ No Prioritario</option>
                        </select>
                    </div>
                </div>
                <div class="bg-blue-50 p-3 rounded-lg">
                    <p class="text-sm text-blue-700">
                        <i class="fas fa-info-circle mr-1"></i>
                        Estado actual: <strong>${TASK_STATES[ task.state ].label}</strong>
                        <br>
                        <span class="text-xs">Usa los controles en el panel principal para cambiar el estado.</span>
                    </p>
                </div>
                <div class="flex space-x-3 pt-4 border-t">
                    <button type="submit" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition">
                        <i class="fas fa-save mr-2"></i>Guardar Cambios
                    </button>
                    <button type="button" onclick="closeAllModals()" 
                            class="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition">
                        Cancelar
                    </button>
                </div>
            </form>
        </div>
    `;

  document.body.appendChild( modal );

  // Event listener para el formulario
  document
    .getElementById( "advancedEditTaskForm" )
    .addEventListener( "submit", ( e ) => {
      e.preventDefault();
      updateAdvancedTaskFromPanelImproved( dateStr, taskId );
    } );
}

function canMoveTask( task ) {
  return task.priority > 2; // Solo prioridad 3 (Moderado) y 4 (No Prioritario) pueden moverse
}

function changeTaskStateDirect( dateStr, taskId, newState ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task ) return;

  const oldState = task.state || "pending";

  if ( oldState === newState ) {
    return; // No hacer nada si es el mismo estado
  }

  // Validaciones de transición de estados
  if ( oldState === "completed" && newState !== "completed" ) {
    if (
      !confirm( "¿Estás seguro de que quieres cambiar una tarea completada?" )
    ) {
      // Revertir el dropdown
      const dropdown = document.querySelector( `select[onchange*="${taskId}"]` );
      if ( dropdown ) dropdown.value = oldState;
      return;
    }
  }

  task.state = newState;
  task.completed = task.state === "completed";

  // Registrar cambio de estado con tipo específico
  let actionType = "stateChanged";
  if ( oldState === "inProgress" && newState === "paused" ) {
    actionType = "paused";
  } else if ( oldState === "paused" && newState === "inProgress" ) {
    actionType = "resumed";
  }

  addToChangeLog( actionType, task.title, dateStr, oldState, newState, taskId );

  // Limpiar notificaciones si se completa
  if ( task.state === "completed" ) {
    clearTaskNotifications( taskId );
  }

  saveTasks();
  renderCalendar();
  updateProgress();
  enqueueSync( "upsert", dateStr, task );

  // Actualizar panel si está abierto
  if ( selectedDateForPanel === dateStr ) {
    const day = new Date( dateStr + "T12:00:00" ).getDate();
    showDailyTaskPanel( dateStr, day );
  }

  const stateInfo = TASK_STATES[ task.state ];
  showNotification( `Tarea cambiada a: ${stateInfo.label}`, "success" );
}

//función para actualizar tareas desde el panel
function updateAdvancedTaskFromPanelImproved( dateStr, taskId ) {
  const title = document.getElementById( "advancedEditTaskTitle" ).value.trim();
  const description = document
    .getElementById( "advancedEditTaskDescription" )
    .value.trim();
  const time = document.getElementById( "advancedEditTaskTime" ).value;
  const priority = parseInt(
    document.getElementById( "advancedEditTaskPriority" ).value
  );

  if ( !title || !time || !priority ) {
    showNotification(
      "Por favor completa todos los campos obligatorios",
      "error"
    );
    return;
  }

  if ( !tasks[ dateStr ] ) {
    showNotification( "Error: No se encontró la fecha de la tarea", "error" );
    return;
  }

  const taskIndex = tasks[ dateStr ].findIndex( ( t ) => t.id === taskId );
  if ( taskIndex === -1 ) {
    showNotification( "Error: No se encontró la tarea", "error" );
    return;
  }

  const oldTask = { ...tasks[ dateStr ][ taskIndex ] }; // Copia para registro

  // Actualizar la tarea manteniendo el estado actual
  const updatedTask = {
    ...tasks[ dateStr ][ taskIndex ],
    title: title,
    description: description,
    time: time,
    priority: priority,
    // NO cambiar el estado aquí
  };

  // Guardar la tarea actualizada
  tasks[ dateStr ][ taskIndex ] = updatedTask;

  // Registrar edición
  addToChangeLog( "edited", title, dateStr, null, null, taskId );

  // Persistir cambios
  saveTasks();
  renderCalendar();
  updateProgress();
  enqueueSync( "upsert", dateStr, updatedTask );

  // Cerrar modal y actualizar UI
  closeAllModals();
  showNotification( "Tarea actualizada exitosamente", "success" );

  // Actualizar panel si está abierto para esta fecha
  if ( selectedDateForPanel === dateStr ) {
    const day = new Date( dateStr + "T12:00:00" ).getDate();
    showDailyTaskPanel( dateStr, day );
  }
}

// Edición rápida mejorada
function quickEditTaskAdvanced( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task ) {
    showNotification( "Tarea no encontrada", "error" );
    return;
  }

  if ( isDatePast( dateStr ) ) {
    showNotification( "No puedes editar tareas de fechas pasadas", "error" );
    return;
  }

  // Cerrar cualquier modal existente
  closeAllModals();

  const modal = document.createElement( "div" );
  modal.id = "quickEditModal";
  modal.className =
    "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
        <div class="bg-white rounded-lg p-4 max-w-sm w-full">
            <h4 class="font-medium mb-3"><i class="fas fa-edit text-blue-500 mr-2"></i>Edición Rápida</h4>
            <form id="quickEditForm" class="space-y-3">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Título <span class="text-red-500">*</span></label>
                    <input type="text" id="quickEditTitle" value="${task.title}" required
                           class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
                    <textarea id="quickEditDescription" rows="3" 
                              class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">${task.description || ""}</textarea>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Hora <span class="text-red-500">*</span></label>
                    <input type="time" id="quickEditTime" value="${task.time || ""}" required
                           class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Prioridad <span class="text-red-500">*</span></label>
                    <select id="quickEditPriority" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        <option value="" disabled>Selecciona una prioridad</option>
                        <option value="1" ${task.priority === 1 ? "selected" : ""}>🔴 Muy Importante</option>
                        <option value="2" ${task.priority === 2 ? "selected" : ""}>🟠 Importante</option>
                        <option value="3" ${task.priority === 3 ? "selected" : ""}>🔵 Moderado</option>
                        <option value="4" ${task.priority === 4 ? "selected" : ""}>⚫ No Prioritario</option>
                    </select>
                </div>
                <div class="flex space-x-2">
                    <button type="submit" class="flex-1 bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-700 transition">
                        <i class="fas fa-save mr-2"></i>Guardar
                    </button>
                    <button type="button" onclick="closeAllModals()" 
                            class="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400 transition">
                        Cancelar
                    </button>
                </div>
            </form>
        </div>
    `;

  document.body.appendChild( modal );

  // Event listener para el formulario
  document.getElementById( "quickEditForm" ).addEventListener( "submit", ( e ) => {
    e.preventDefault();
    saveQuickEditImproved( dateStr, taskId );
  } );
}

function saveQuickEditImproved( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task ) {
    showNotification( "Error: No se encontró la tarea", "error" );
    return;
  }

  const newTitle = document.getElementById( "quickEditTitle" ).value.trim();
  const newDescription = document
    .getElementById( "quickEditDescription" )
    .value.trim();
  const newTime = document.getElementById( "quickEditTime" ).value;
  const newPriority = parseInt(
    document.getElementById( "quickEditPriority" ).value
  );

  if ( !newTitle || !newTime || !newPriority ) {
    showNotification(
      "Por favor completa todos los campos obligatorios",
      "error"
    );
    return;
  }

  // Actualizar la tarea
  task.title = newTitle;
  task.description = newDescription;
  task.time = newTime;
  task.priority = newPriority;

  // Persistir cambios
  saveTasks();
  renderCalendar();
  updateProgress();
  enqueueSync( "upsert", dateStr, task );

  // Cerrar modal y mostrar notificación
  closeAllModals();
  showNotification( "Tarea actualizada exitosamente", "success" );

  // Actualizar panel si está abierto
  if ( selectedDateForPanel === dateStr ) {
    const day = new Date( dateStr + "T12:00:00" ).getDate();
    showDailyTaskPanel( dateStr, day );
  }
}

//addQuickTaskToSelectedDay con sync automático
function addQuickTaskToSelectedDay() {
  if ( !selectedDateForPanel ) return;

  if ( isDatePast( selectedDateForPanel ) ) {
    showNotification( "No puedes agregar tareas a fechas anteriores", "error" );
    return;
  }

  showQuickAddTask( selectedDateForPanel );
}

function closeDailyTaskPanel() {
  const panel = document.getElementById( "dailyTaskPanel" );
  if ( panel ) {
    panel.classList.add( "hidden" );
    selectedDateForPanel = null;
  }
}

function quickDeleteTask( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task ) return;

  if ( confirm( `¿Eliminar la tarea "${task.title}"?` ) ) {
    deleteTaskWithUndoImproved( dateStr, taskId );
  }
}

//showQuickAddTask con sync automático
function showQuickAddTask( dateStr ) {
  if ( isDatePast( dateStr ) ) {
    showNotification( "No puedes agregar tareas a fechas anteriores", "error" );
    return;
  }

  // Cerrar cualquier modal existente
  closeAllModals();

  const modal = document.createElement( "div" );
  modal.id = "quickAddTaskModal";
  modal.className =
    "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-800">
                    <i class="fas fa-plus text-blue-500 mr-2"></i>Agregar Nueva Tarea
                </h3>
                <button onclick="closeAllModals()" class="text-gray-500 hover:text-gray-700 transition">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <form id="quickAddTaskForm" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Título <span class="text-red-500">*</span></label>
                    <input type="text" id="quickAddTaskTitle" required 
                           class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
                    <textarea id="quickAddTaskDescription" rows="3" 
                              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"></textarea>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Hora <span class="text-red-500">*</span></label>
                        <input type="time" id="quickAddTaskTime" required
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Prioridad <span class="text-red-500">*</span></label>
                        <select id="quickAddTaskPriority" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            <option value="" disabled selected>Selecciona una prioridad</option>
                            <option value="1">🔴 Muy Importante</option>
                            <option value="2">🟠 Importante</option>
                            <option value="3">🔵 Moderado</option>
                            <option value="4">⚫ No Prioritario</option>
                        </select>
                    </div>
                </div>
                <div class="flex space-x-3 pt-4 border-t">
                    <button type="submit" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition">
                        <i class="fas fa-save mr-2"></i>Agregar Tarea
                    </button>
                    <button type="button" onclick="closeAllModals()" 
                            class="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition">
                        Cancelar
                    </button>
                </div>
            </form>
        </div>
    `;

  document.body.appendChild( modal );

  // 🔹 Establecer hora actual por defecto
  const now = new Date();
  document.getElementById( "quickAddTaskTime" ).value = now
    .toTimeString()
    .slice( 0, 5 );

  // Event listener para el formulario
  document
    .getElementById( "quickAddTaskForm" )
    .addEventListener( "submit", ( e ) => {
      e.preventDefault();
      const title = document.getElementById( "quickAddTaskTitle" ).value.trim();
      const description = document
        .getElementById( "quickAddTaskDescription" )
        .value.trim();
      const time = document.getElementById( "quickAddTaskTime" ).value;
      const priority = parseInt(
        document.getElementById( "quickAddTaskPriority" ).value
      );

      if ( !title || !time || !priority ) {
        showNotification(
          "Por favor completa todos los campos obligatorios",
          "error"
        );
        return;
      }

      const task = {
        id: `${dateStr}-${Date.now()}`,
        title,
        description,
        time,
        priority,
        state: "pending",
        completed: false,
      };

      addTaskToDate( dateStr, task );
      saveTasks();
      renderCalendar();
      updateProgress();
      enqueueSync( "upsert", dateStr, task );

      closeAllModals();
      showNotification( "Tarea agregada exitosamente", "success" );

      // Actualizar panel si está abierto
      if ( selectedDateForPanel === dateStr ) {
        const day = new Date( dateStr + "T12:00:00" ).getDate();
        showDailyTaskPanel( dateStr, day );
      }
    } );
}

// NUEVA función para cerrar todos los modales
function closeAllModals() {
  const modals = [
    "advancedEditModal",
    "quickEditModal",
    "quickAddTaskModal",
    "editTaskModal",
    "taskModal",
  ];

  modals.forEach( ( modalId ) => {
    const modal = document.getElementById( modalId );
    if ( modal ) {
      modal.remove();
    }
  } );

  // También cerrar modales por clase
  document
    .querySelectorAll( ".fixed.inset-0.bg-black.bg-opacity-50" )
    .forEach( ( modal ) => {
      modal.remove();
    } );
}

function setupTaskTooltips() {
  let tooltip = createTaskTooltip();

  document.addEventListener( "mouseover", function ( e ) {
    if ( e.target.classList.contains( "task-item" ) ) {
      const taskId = e.target.dataset.taskId;
      const dateStr = e.target.dataset.date;
      const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );

      if ( task ) {
        showTooltip( tooltip, e.target, task );
      }
    }
  } );

  document.addEventListener( "mouseout", function ( e ) {
    if ( e.target.classList.contains( "task-item" ) ) {
      tooltip.classList.add( "opacity-0" );
    }
  } );
}

function createTaskTooltip() {
  const tooltip = document.createElement( "div" );
  tooltip.id = "task-tooltip";
  tooltip.className =
    "fixed bg-gray-800 text-white text-xs rounded px-2 py-1 z-50 pointer-events-none opacity-0 transition-opacity duration-200 max-w-xs";
  document.body.appendChild( tooltip );
  return tooltip;
}

function showTooltip( tooltip, target, task ) {
  const rect = target.getBoundingClientRect();
  tooltip.innerHTML = `
        <div class="font-semibold">${task.title}</div>
        ${task.description ? `<div class="text-gray-300">${task.description}</div>` : ""}
        ${task.time ? `<div class="text-blue-300"><i class="far fa-clock mr-1"></i>${task.time}</div>` : ""}
        <div class="text-gray-400 text-xs mt-1">
            ${task.completed ? "✓ Completada" : "Pendiente"} • Arrastra para mover
        </div>
    `;

  tooltip.style.left =
    Math.min( rect.left, window.innerWidth - tooltip.offsetWidth - 10 ) + "px";
  tooltip.style.top = rect.top - tooltip.offsetHeight - 5 + "px";
  tooltip.classList.remove( "opacity-0" );
}

function setupDragAndDrop() {
  const calendar = document.getElementById( "calendar" );
  if ( !calendar ) return;

  calendar.addEventListener( "dragstart", handleDragStart );
  calendar.addEventListener( "dragend", handleDragEnd );
  calendar.addEventListener( "dragover", handleDragOver );
  calendar.addEventListener( "dragleave", handleDragLeave );
  calendar.addEventListener( "drop", handleDrop );
}

function handleDragStart( e ) {
  if ( e.target.classList.contains( "task-item" ) ) {
    e.stopPropagation();
    draggedTask = e.target.dataset.taskId;
    draggedFromDate = e.target.dataset.date;
    e.target.style.opacity = "0.5";
  }
}

function handleDragEnd( e ) {
  if ( e.target.classList.contains( "task-item" ) ) {
    e.target.style.opacity = "1";
    draggedTask = null;
    draggedFromDate = null;
  }
}

function handleDragOver( e ) {
  e.preventDefault();
  const dayElement = e.target.closest( ".calendar-day" );
  if ( dayElement ) {
    dayElement.classList.add( "bg-yellow-100" );
  }
}

function handleDragLeave( e ) {
  const dayElement = e.target.closest( ".calendar-day" );
  if ( dayElement ) {
    dayElement.classList.remove( "bg-yellow-100" );
  }
}

function handleDrop( e ) {
  e.preventDefault();
  const dropTarget = e.target.closest( ".calendar-day" );

  if ( dropTarget && draggedTask && draggedFromDate ) {
    const targetDate = dropTarget.dataset.date;

    // Verificar si la fecha destino es pasada
    if ( isDatePast( targetDate ) ) {
      showNotification( "No puedes mover tareas a fechas anteriores", "error" );
      document.querySelectorAll( ".bg-yellow-100" ).forEach( ( el ) => {
        el.classList.remove( "bg-yellow-100" );
      } );
      return;
    }

    // NUEVA RESTRICCIÓN: Verificar si la tarea puede moverse
    const task = tasks[ draggedFromDate ]?.find( ( t ) => t.id === draggedTask );
    if ( task && !canMoveTask( task ) ) {
      const priority = PRIORITY_LEVELS[ task.priority ] || PRIORITY_LEVELS[ 3 ];
      showNotification(
        `Las tareas "${priority.label}" no se pueden mover. Solo se pueden editar o eliminar.`,
        "error"
      );
      document.querySelectorAll( ".bg-yellow-100" ).forEach( ( el ) => {
        el.classList.remove( "bg-yellow-100" );
      } );
      return;
    }

    if ( targetDate !== draggedFromDate ) {
      moveTask( draggedFromDate, targetDate, draggedTask );
      showNotification( "Tarea movida exitosamente", "success" );
    }
  }

  document.querySelectorAll( ".bg-yellow-100" ).forEach( ( el ) => {
    el.classList.remove( "bg-yellow-100" );
  } );
}

// 5. ACTUALIZAR función handleDragStart para mostrar indicador visual de restricción
function handleDragStart( e ) {
  if ( e.target.classList.contains( "task-item" ) ) {
    e.stopPropagation();
    draggedTask = e.target.dataset.taskId;
    draggedFromDate = e.target.dataset.date;

    // Verificar si la tarea puede moverse
    const task = tasks[ draggedFromDate ]?.find( ( t ) => t.id === draggedTask );
    if ( task && !canMoveTask( task ) ) {
      e.target.style.opacity = "0.3";
      e.target.style.cursor = "not-allowed";
      // Mostrar tooltip temporal
      const tooltip = document.createElement( "div" );
      tooltip.className =
        "fixed bg-red-600 text-white text-xs px-2 py-1 rounded z-50 pointer-events-none";
      tooltip.textContent = "Esta tarea no se puede mover";
      const rect = e.target.getBoundingClientRect();
      tooltip.style.left = rect.left + "px";
      tooltip.style.top = rect.top - 30 + "px";
      document.body.appendChild( tooltip );

      setTimeout( () => tooltip.remove(), 2000 );
    } else {
      e.target.style.opacity = "0.5";
    }
  }
}

//moveTask con sync automático
function moveTask( fromDate, toDate, taskId ) {
  const fromTasks = tasks[ fromDate ];
  const taskIndex = fromTasks?.findIndex( ( t ) => t.id === taskId );

  if ( taskIndex !== -1 ) {
    const task = fromTasks.splice( taskIndex, 1 )[ 0 ];
    const taskTitle = task.title; // Guardar título para registro

    if ( fromTasks.length === 0 ) {
      delete tasks[ fromDate ];
    }

    if ( !tasks[ toDate ] ) tasks[ toDate ] = [];

    task.id = `${toDate}-${Date.now()}`;
    tasks[ toDate ].push( task );

    // NUEVO: Registrar movimiento
    addToChangeLog( "moved", taskTitle, toDate, fromDate, toDate );

    saveTasks();
    renderCalendar();
    updateProgress();

    // Auto-sync: eliminar de fecha origen y agregar a fecha destino
    enqueueSync( "delete", fromDate, { id: taskId } );
    enqueueSync( "upsert", toDate, task );
  }
}

function closeModal() {
  const modal = document.getElementById( "taskModal" );
  if ( modal ) {
    modal.classList.add( "opacity-0" );
    modal.querySelector( "#modal-content-wrapper" ).classList.add( "scale-95" );
    setTimeout( () => modal.classList.add( "hidden" ), 300 );
  }
}

function toggleTask( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( task ) {
    task.completed = !task.completed;
    saveTasks();
    renderCalendar();
    updateProgress();

    // Auto-sync
    enqueueSync( "upsert", dateStr, task );
  }
}

//deleteTaskWithUndoImprovedcon sync automático
function deleteTaskWithUndoImproved( dateStr, taskId ) {
  const dayTasks = tasks[ dateStr ];
  const taskIndex = dayTasks?.findIndex( ( t ) => t.id === taskId );

  if ( taskIndex !== -1 ) {
    const task = dayTasks[ taskIndex ];
    lastDeletedTask = { ...task };
    lastDeletedDate = dateStr;

    // Registrar eliminación con ID
    addToChangeLog( "deleted", task.title, dateStr, null, null, taskId );

    tasks[ dateStr ] = tasks[ dateStr ].filter( ( t ) => t.id !== taskId );
    if ( tasks[ dateStr ].length === 0 ) {
      delete tasks[ dateStr ];
    }

    // Auto-sync delete
    enqueueSync( "delete", dateStr, { id: taskId } );

    saveTasks();
    renderCalendar();
    updateProgress();
    showUndoNotification();
  }
}

function showUndoNotification() {
  const notification = document.createElement( "div" );
  notification.className =
    "fixed bottom-4 left-4 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center space-x-3";
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

//undoDelete con sync automático
function undoDelete() {
  if ( lastDeletedTask && lastDeletedDate ) {
    if ( !tasks[ lastDeletedDate ] ) tasks[ lastDeletedDate ] = [];

    tasks[ lastDeletedDate ].push( lastDeletedTask );

    // Auto-sync restore
    enqueueSync( "upsert", lastDeletedDate, lastDeletedTask );

    saveTasks();
    renderCalendar();
    updateProgress();

    lastDeletedTask = null;
    lastDeletedDate = null;

    showNotification( "Tarea restaurada exitosamente", "success" );
    document.querySelector( ".fixed.bottom-4.left-4" )?.remove();
  }
}

function changeMonth( delta ) {
  currentDate.setMonth( currentDate.getMonth() + delta );
  renderCalendar();
  updateProgress();
}

//clearWeek con sync automático optimizado
function clearWeek() {
  if (
    !confirm(
      "¿Estás seguro de que quieres limpiar todas las tareas de esta semana?"
    )
  )
    return;

  const today = new Date();
  const startOfWeek = new Date( today );
  startOfWeek.setDate( today.getDate() - today.getDay() );

  const deletedTasks = [];

  for ( let i = 0; i < 7; i++ ) {
    const date = new Date( startOfWeek );
    date.setDate( startOfWeek.getDate() + i );
    const dateStr = date.toISOString().split( "T" )[ 0 ];

    if ( tasks[ dateStr ] ) {
      // Guardar tareas para sync
      tasks[ dateStr ].forEach( ( task ) => {
        deletedTasks.push( { dateStr, taskId: task.id } );
      } );
      delete tasks[ dateStr ];
    }
  }

  // Auto-sync batch delete
  deletedTasks.forEach( ( { dateStr, taskId } ) => {
    enqueueSync( "delete", dateStr, { id: taskId } );
  } );

  saveTasks();
  renderCalendar();
  updateProgress();
  showNotification( "Semana limpiada exitosamente" );
}

//clearMonth con sync automático optimizado
function clearMonth() {
  if (
    !confirm(
      "¿Estás seguro de que quieres limpiar todas las tareas de este mes?"
    )
  )
    return;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const deletedTasks = [];

  Object.keys( tasks ).forEach( ( dateStr ) => {
    const date = new Date( dateStr + "T12:00:00" );
    if ( date.getFullYear() === year && date.getMonth() === month ) {
      // Guardar tareas para sync
      tasks[ dateStr ].forEach( ( task ) => {
        deletedTasks.push( { dateStr, taskId: task.id } );
      } );
      delete tasks[ dateStr ];
    }
  } );

  // Auto-sync batch delete
  deletedTasks.forEach( ( { dateStr, taskId } ) => {
    enqueueSync( "delete", dateStr, { id: taskId } );
  } );

  saveTasks();
  renderCalendar();
  updateProgress();
  showNotification( "Mes limpiado exitosamente" );
}

function updateProgress() {
  const today = getTodayString();
  const todayTasks = tasks[ today ] || [];
  const completedTasks = todayTasks.filter(
    ( task ) => task.state === "completed"
  ).length;
  const inProgressTasks = todayTasks.filter(
    ( task ) => task.state === "inProgress"
  ).length;
  const pausedTasks = todayTasks.filter(
    ( task ) => task.state === "paused"
  ).length;
  const pendingTasks = todayTasks.filter(
    ( task ) => task.state === "pending"
  ).length;

  const progress =
    todayTasks.length === 0
      ? 0
      : Math.round( ( completedTasks / todayTasks.length ) * 100 );

  const progressBar = document.getElementById( "progressBar" );
  const progressText = document.getElementById( "progressText" );

  if ( progressBar ) progressBar.style.width = `${progress}%`;
  if ( progressText ) {
    progressText.innerHTML = `
            ${progress}% | 
            <span class="text-green-600">${completedTasks} ✓</span> 
            <span class="text-blue-600">${inProgressTasks} ▶</span> 
            <span class="text-orange-600">${pausedTasks} ⏸</span>
            <span class="text-gray-600">${pendingTasks} ⏸</span>
        `;
  }
}

function exportToExcel() {
  if ( typeof XLSX === "undefined" ) {
    showNotification( "Error: XLSX library not loaded", "error" );
    return;
  }

  const wb = XLSX.utils.book_new();
  const data = [ [ "Fecha", "Título", "Descripción", "Hora", "Completada" ] ];

  Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
    dayTasks.forEach( ( task ) => {
      data.push( [
        date,
        task.title,
        task.description || "",
        task.time || "",
        task.completed ? "Sí" : "No",
      ] );
    } );
  } );

  const ws = XLSX.utils.aoa_to_sheet( data );
  XLSX.utils.book_append_sheet( wb, ws, "Tareas" );
  XLSX.writeFile( wb, `tareas_${getTodayString()}.xlsx` );

  showNotification( "Excel exportado exitosamente" );
}

function requestNotificationPermission() {
  if ( !( "Notification" in window ) ) {
    showNotification( "Este navegador no soporta notificaciones", "error" );
    return Promise.resolve( "denied" );
  }

  if ( Notification.permission === "granted" ) {
    notificationsEnabled = true;
    updateNotificationButton();
    startNotificationService();
    return Promise.resolve( "granted" );
  }

  return Notification.requestPermission().then( ( permission ) => {
    if ( permission === "granted" ) {
      notificationsEnabled = true;
      updateNotificationButton();
      startNotificationService();
      showNotification( "Notificaciones activadas correctamente", "success" );
    } else {
      showNotification( "Permisos de notificación denegados", "error" );
    }
    return permission;
  } );
}

function toggleNotifications() {
  if ( !( "Notification" in window ) ) {
    showNotification( "Este navegador no soporta notificaciones", "error" );
    return;
  }

  if ( Notification.permission === "granted" ) {
    notificationsEnabled = !notificationsEnabled;
    updateNotificationButton();

    if ( notificationsEnabled ) {
      startNotificationService();
      showNotification( "Notificaciones activadas", "success" );
    } else {
      stopNotificationService();
      showNotification( "Notificaciones desactivadas", "info" );
    }
  } else if ( Notification.permission === "default" ) {
    requestNotificationPermission();
  } else {
    showNotification(
      "Los permisos de notificación fueron denegados. Actívalos en la configuración del navegador.",
      "error"
    );
  }
}

function startNotificationService() {
  if ( notificationInterval ) {
    clearInterval( notificationInterval );
    notificationInterval = null;
  }

  if ( !notificationsEnabled || Notification.permission !== "granted" ) {
    console.log( "❌ Notificaciones no habilitadas o sin permisos" );
    return;
  }

  console.log( "Iniciando servicio de notificaciones mejorado" );

  // Reset de estado diario a las 00:01
  resetDailyNotificationStatus();

  // Verificación inmediata
  setTimeout( () => {
    try {
      checkDailyTasksImproved();
    } catch ( error ) {
      console.error( "Error en checkDailyTasks inicial:", error );
    }
  }, 1000 );

  // Intervalo más frecuente pero inteligente (cada 30 segundos)
  notificationInterval = setInterval( () => {
    try {
      if ( notificationsEnabled && Notification.permission === "granted" ) {
        checkDailyTasksImproved();
      } else {
        console.log( "⚠️ Notificaciones deshabilitadas en intervalo" );
        stopNotificationService();
      }
    } catch ( error ) {
      console.error( "Error en intervalo de notificaciones:", error );
    }
  }, 30000 ); // 30 segundos

  // Verificación adicional cada 5 minutos para mayor seguridad
  setInterval(
    () => {
      if ( notificationsEnabled && Notification.permission === "granted" ) {
        checkDailyTasksImproved( true ); // Forzar verificación
      }
    },
    5 * 60 * 1000
  ); // 5 minutos
}

// función mejorada para reset diario
function resetDailyNotificationStatus() {
  const now = new Date();
  if ( now.getHours() === 0 && now.getMinutes() <= 1 ) {
    notificationStatus = {
      morning: false,
      midday: false,
      evening: false,
      taskReminders: new Set(),
    };
    checkDailyTasksImproved;
    sentNotifications.clear();
    console.log( "🔄 Estado de notificaciones diarias reseteado" );
  }
}

function stopNotificationService() {
  if ( notificationInterval ) {
    clearInterval( notificationInterval );
    notificationInterval = null;
    console.log( "Servicio de notificaciones detenido" );
  }
}

function updateNotificationButton() {
  const btn = document.getElementById( "notificationsBtn" );
  if ( !btn ) return;

  const hasPermission = Notification.permission === "granted";

  if ( notificationsEnabled && hasPermission ) {
    btn.className =
      "bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition duration-300";
    btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Notificaciones ON';
    btn.title = "Notificaciones activadas - Click para desactivar";
  } else if ( hasPermission ) {
    btn.className =
      "bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition duration-300";
    btn.innerHTML = '<i class="fas fa-bell-slash mr-2"></i>Notificaciones OFF';
    btn.title = "Notificaciones desactivadas - Click para activar";
  } else {
    btn.className =
      "bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition duration-300";
    btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Permitir Notificaciones';
    btn.title = "Click para solicitar permisos de notificación";
  }
}

function checkDailyTasksImproved( forceCheck = false ) {
  if ( !notificationsEnabled || Notification.permission !== "granted" ) {
    return;
  }

  const now = new Date();
  const today = getTodayString();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = `${String( currentHour ).padStart( 2, "0" )}:${String( currentMinute ).padStart( 2, "0" )}`;

  const todayTasks = tasks[ today ] || [];
  const pendingTasks = todayTasks.filter( ( task ) => task.state === "pending" );
  const inProgressTasks = todayTasks.filter(
    ( task ) => task.state === "inProgress"
  );

  resetDailyNotificationStatus();

  // Notificaciones de tareas con hora específica
  todayTasks.forEach( ( task ) => {
    if ( !task.time || task.state === "completed" ) return;

    const [ taskHours, taskMinutes ] = task.time.split( ":" ).map( Number );
    const taskTime = taskHours * 60 + taskMinutes;
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    // Notificación de inicio - cambiar automáticamente a "en proceso"
    const nowKey = `${task.id}-now`;
    if (
      !notificationStatus.taskReminders.has( nowKey ) &&
      currentTimeInMinutes >= taskTime &&
      currentTimeInMinutes <= taskTime + 2 &&
      task.state === "pending"
    ) {
      // Cambiar estado a "en proceso" automáticamente
      task.state = "inProgress";
      task.completed = false;
      saveTasks();
      renderCalendar();
      enqueueSync( "upsert", today, task );

      const priority = PRIORITY_LEVELS[ task.priority ] || PRIORITY_LEVELS[ 3 ];
      showDesktopNotification(
        `🚀 Iniciando: ${task.title}`,
        `Tarea ${priority.label.toLowerCase()} comenzó. Estado: En Proceso`,
        nowKey,
        true
      );
      notificationStatus.taskReminders.add( nowKey );
    }
  } );

  // Notificaciones generales con información de estados
  const totalPending = pendingTasks.length;
  const totalInProgress = inProgressTasks.length;

  if (
    !notificationStatus.morning &&
    currentHour === 9 &&
    currentMinute <= 30 &&
    ( totalPending > 0 || totalInProgress > 0 )
  ) {
    let message = "";
    if ( totalPending > 0 )
      message += `${totalPending} pendiente${totalPending > 1 ? "s" : ""}`;
    if ( totalInProgress > 0 ) {
      if ( message ) message += " y ";
      message += `${totalInProgress} en proceso`;
    }

    showDesktopNotification(
      "¡Buenos días! 🌅",
      `Tienes ${message} para hoy`,
      "morning-reminder"
    );
    notificationStatus.morning = true;
  }
}

// función para limpiar notificaciones cuando se completa una tarea
function clearTaskNotifications( taskId ) {
  const keysToRemove = [
    `${taskId}-reminder-15`,
    `${taskId}-now`,
    `${taskId}-late`,
  ];

  keysToRemove.forEach( ( key ) => {
    notificationStatus.taskReminders.delete( key );
  } );
}

function showDesktopNotification( title, body, tag, requireInteraction = false ) {
  try {
    // Evitar notificaciones duplicadas
    if ( sentNotifications.has( tag ) ) {
      console.log( "⏭️ Notificación duplicada evitada:", tag );
      return;
    }

    // Configuración específica para móviles
    const isMobile =
      /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );

    const notificationOptions = {
      body: body,
      icon: getFaviconAsDataUrl(),
      tag: tag,
      requireInteraction: isMobile ? true : requireInteraction, // Móviles requieren interacción
      silent: false,
      badge: getFaviconAsDataUrl(),
      timestamp: Date.now(),
      vibrate: isMobile ? [ 200, 100, 200 ] : undefined, // Vibración en móviles
      renotify: true, // Permitir re-notificación con mismo tag
      actions: isMobile
        ? [
          {
            action: "view",
            title: "Ver tareas",
          },
          {
            action: "close",
            title: "Cerrar",
          },
        ]
        : undefined,
    };

    const notification = new Notification( title, notificationOptions );

    // Marcar como enviada
    sentNotifications.add( tag );

    // Para móviles, mostrar también alerta visual en la app
    if ( isMobile ) {
      showInAppNotification( title, body );
    }

    // Limpiar del set después de 3 minutos para móviles, 5 para desktop
    setTimeout(
      () => {
        sentNotifications.delete( tag );
      },
      isMobile ? 3 * 60 * 1000 : 5 * 60 * 1000
    );

    notification.onclick = function () {
      window.focus();
      notification.close();
    };

    // Auto-close más rápido en móviles
    if ( !requireInteraction && !isMobile ) {
      setTimeout( () => {
        notification.close();
      }, 8000 );
    }

    console.log(
      "Notificación enviada:",
      title,
      "- Tag:",
      tag,
      "- Móvil:",
      isMobile
    );
  } catch ( error ) {
    console.error( "❌ Error enviando notificación:", error );
    // Fallback para móviles problemáticos
    showInAppNotification( title, body );
  }
}

function showInAppNotification( title, body ) {
  const notification = document.createElement( "div" );
  notification.className =
    "fixed top-20 left-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-2xl z-50 transform -translate-y-full transition-transform duration-500";
  notification.innerHTML = `
        <div class="flex items-start justify-between">
            <div class="flex-1">
                <div class="font-semibold text-sm">${title}</div>
                <div class="text-xs mt-1 opacity-90">${body}</div>
            </div>
            <button onclick="this.closest('.fixed').remove()" class="ml-2 text-white hover:text-gray-200">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

  document.body.appendChild( notification );

  // Mostrar animación
  setTimeout( () => {
    notification.classList.remove( "-translate-y-full" );
  }, 100 );

  // Auto-ocultar después de 8 segundos
  setTimeout( () => {
    notification.classList.add( "-translate-y-full" );
    setTimeout( () => notification.remove(), 500 );
  }, 8000 );
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

function showNotification( message, type = "success" ) {
  const notification = document.createElement( "div" );
  const typeClasses = {
    success: "bg-green-500 text-white fa-check-circle",
    error: "bg-red-500 text-white fa-exclamation-circle",
    info: "bg-blue-500 text-white fa-info-circle",
  };

  const { className, icon } =
    type in typeClasses
      ? {
        className: typeClasses[ type ].split( " " ).slice( 0, -1 ).join( " " ),
        icon: typeClasses[ type ].split( " " ).pop(),
      }
      : { className: "bg-blue-500 text-white", icon: "fa-info-circle" };

  notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-x-full ${className}`;
  notification.innerHTML = `
        <div class="flex items-center space-x-2">
            <i class="fas ${icon}"></i>
            <span>${message}</span>
        </div>
    `;

  document.body.appendChild( notification );

  setTimeout( () => notification.classList.remove( "translate-x-full" ), 100 );

  setTimeout( () => {
    notification.classList.add( "translate-x-full" );
    setTimeout( () => notification.remove(), 300 );
  }, 3000 );
}

function saveTasks() {
  try {
    localStorage.setItem( "tasks", JSON.stringify( tasks ) );
  } catch ( error ) {
    console.error( "Error saving tasks to localStorage:", error );
    showNotification( "Error al guardar tareas", "error" );
  }
}

//clearAll con sync automático optimizado
function clearAll() {
  const totalTasks = Object.values( tasks ).reduce(
    ( sum, dayTasks ) => sum + dayTasks.length,
    0
  );

  if ( totalTasks === 0 ) {
    showNotification( "No hay tareas para eliminar", "info" );
    return;
  }

  if (
    !confirm(
      `¿Estás seguro de que quieres eliminar TODAS las tareas del calendario? (${totalTasks} tareas)`
    )
  ) {
    return;
  }

  if ( !confirm( "⚠️ ESTA ACCIÓN NO SE PUEDE DESHACER. ¿Continuar?" ) ) {
    return;
  }

  const deletedTasks = [];

  // Recopilar todas las tareas para sync
  Object.entries( tasks ).forEach( ( [ dateStr, dayTasks ] ) => {
    dayTasks.forEach( ( task ) => {
      deletedTasks.push( { dateStr, taskId: task.id } );
    } );
  } );

  tasks = {};
  saveTasks();
  renderCalendar();
  updateProgress();
  closeDailyTaskPanel();

  // Auto-sync batch delete
  deletedTasks.forEach( ( { dateStr, taskId } ) => {
    enqueueSync( "delete", dateStr, { id: taskId } );
  } );

  showNotification( `${totalTasks} tareas eliminadas del calendario`, "success" );
}

//Auto-sincronización periódica más inteligente
setInterval(
  () => {
    if ( currentUser && isOnline && !isSyncing ) {
      // Solo hacer sync completo cada 10 minutos si no hay cambios pendientes
      if ( syncQueue.size === 0 ) {
        console.log( "🔄 Sync periódico: verificando cambios remotos" );
        syncFromFirebase();
      } else {
        console.log(
          "⏳ Sync periódico: hay cambios pendientes, procesando cola"
        );
        processSyncQueue();
      }
    }
  },
  10 * 60 * 1000
); // Cada 10 minutos

// Procesar cola al cerrar/recargar página
window.addEventListener( "beforeunload", () => {
  if ( syncQueue.size > 0 && currentUser && isOnline ) {
    // Intentar sync inmediato antes de cerrar
    navigator.sendBeacon &&
      navigator.sendBeacon(
        "/sync-beacon",
        JSON.stringify( {
          uid: currentUser.uid,
          operations: Array.from( syncQueue.values() ),
        } )
      );
  }
} );

// Manejar cambios de visibilidad de página
document.addEventListener( "visibilitychange", () => {
  if ( !document.hidden && syncQueue.size > 0 && currentUser && isOnline ) {
    // Procesar cola cuando la página vuelva a ser visible
    setTimeout( () => processSyncQueue(), 1000 );
  }
} );
