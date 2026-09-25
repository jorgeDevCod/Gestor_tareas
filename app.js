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
let lastDeletedTask = null;
let lastDeletedDate = null;
let taskTimers = new Map()
let isOnline = navigator.onLine;
let currentUser = null;
let deletedTasksRegistry = JSON.parse( localStorage.getItem( 'deleted_tasks_registry' ) || '{}' );
let db = null;
let auth = null;
let authReady = false;
let messaging = null;
let fcmToken = null;
let firestoreListener = null;
let lastFullSyncTime = 0;
let syncInProgress = false;
let localTaskFingerprint = ''; // Hash de las tareas locales
let notificationInterval = null;
let sentNotifications = new Set();
// install sw
let deferredPrompt;
let installButtonShown = false;
let notificationStatus = {
  morning: false,
  midday: false,
  evening: false,
  taskReminders: new Set(),
};


// Sistema de sincronización automática optimizada
let syncQueue = new Map(); // Cola de operaciones pendientes
let syncTimeout = null; // Timeout para batch sync
let isSyncing = false; // Flag para evitar múltiples syncs
let lastSyncTime = 0; // Timestamp del último sync
const SYNC_DEBOUNCE_TIME = 2000; // 2 segundos de debounce
let dailyTaskLogs = JSON.parse( localStorage.getItem( "dailyTaskLogs" ) || "{}" );
const PERMISSIONS_KEY = 'app_permissions';
const USER_PREFERENCES_KEY = 'user_preferences';


// constantes para estados y prioridades
const TASK_STATES = {
  pending: {
    label: "Pendiente",
    class: "bg-indigo-100 text-indigo-900",
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

// REGISTRO DEL SERVICE WORKER - Evitar duplicados + auto-actualización.
// Si hay un SW nuevo (v5.1+), al tomar control recarga UNA vez para
// garantizar HTML+JS frescos y no mezclar versiones cacheadas.
let swControllerChanged = false;
if ( 'serviceWorker' in navigator ) {
  navigator.serviceWorker.addEventListener( 'controllerchange', () => {
    if ( swControllerChanged ) return;
    swControllerChanged = true;
    console.log( '🔄 Nuevo SW tomó control, recargando...' );
    window.location.reload();
  } );

  window.addEventListener( 'load', async () => {
    try {
      // Verificar si ya hay un SW registrado
      const existingRegistration = await navigator.serviceWorker.getRegistration( '/firebase-messaging-sw.js' );

      const registration = existingRegistration || await navigator.serviceWorker.register( '/firebase-messaging-sw.js', {
        scope: '/',
        updateViaCache: 'none' // Forzar actualización sin caché
      } );

      console.log( existingRegistration ? 'Service Worker ya registrado:' : 'Service Worker registrado con éxito:', registration.scope );

      // Chequeo inicial + polling: vital en PWA instalada móvil, donde el
      // SW puede quedar desactualizado y servir JS viejo (funciones "muertas").
      const checkSwUpdate = () => {
        registration.update().then( () => {
          console.log( '🔄 Chequeo de SW completado' );
        } ).catch( () => {} );
      };
      checkSwUpdate();
      setInterval( checkSwUpdate, 30 * 60 * 1000 );
      document.addEventListener( 'visibilitychange', () => {
        if ( document.visibilityState === 'visible' ) checkSwUpdate();
      } );

    } catch ( error ) {
      console.error( '❌ Error al registrar el Service Worker:', error );
    }
  } );
}

window.addEventListener( 'beforeinstallprompt', ( e ) => {
  // Verificar si ya está instalado ANTES de manejar el evento
  if ( isPWAInstalled() ) {
    console.log( '🚀 PWA ya instalada - ignorando prompt' );
    return;
  }

  e.preventDefault();
  deferredPrompt = e;

  const installButton = document.getElementById( 'install-button' );
  if ( installButton && !installButtonShown ) {
    console.log( '📱 Mostrando botón de instalación' );
    installButton.style.display = 'block';
    installButton.classList.remove( 'hidden' );
    installButtonShown = true;

    installButton.addEventListener( 'click', handleInstallClick );
  }
} );

function handleInstallClick() {
  if ( !deferredPrompt ) {
    console.warn( 'No hay prompt de instalación disponible' );
    return;
  }

  const installButton = document.getElementById( 'install-button' );

  // Deshabilitar botón temporalmente
  if ( installButton ) {
    installButton.disabled = true;
    installButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Instalando...';
  }

  deferredPrompt.prompt();

  deferredPrompt.userChoice.then( ( choiceResult ) => {
    if ( choiceResult.outcome === 'accepted' ) {
      console.log( ' Usuario instaló la PWA' );
      // Ocultar botón permanentemente
      if ( installButton ) {
        installButton.style.display = 'none';
        installButton.classList.add( 'hidden' );
      }
    } else {
      console.log( '❌ Usuario rechazó la instalación' );
      // Restaurar botón
      if ( installButton ) {
        installButton.disabled = false;
        installButton.innerHTML = '<i class="fas fa-download mr-2"></i>Instalar App';
      }
    }
    deferredPrompt = null;
  } );
}

let selectedDateForPanel = getTodayString();

function showDesktopNotificationPWA( title, message, tag, requiresAction = false, notificationType = 'default' ) {
  if ( !notificationsEnabled || Notification.permission !== 'granted' ) {
    console.log( '❌ Notificaciones PWA no habilitadas' );
    showInAppNotification( title, message, 'info' ); // Fallback visual
    return false;
  }

  // Evitar duplicados
  if ( tag && sentNotifications.has( tag ) ) {
    console.log( `⚠️ Notificación duplicada evitada: ${tag}` );
    return false;
  }

  const options = {
    body: message,
    icon: '/images/IconLogo.png',
    badge: '/images/favicon-192.png',
    tag: tag || `notification-${Date.now()}`,
    renotify: true,
    requireInteraction: requiresAction,
    silent: false,
    vibrate: getVibrationPattern( notificationType ),
    data: {
      timestamp: Date.now(),
      tag: tag,
      requiresAction: requiresAction,
      type: notificationType
    }
  };

  try {
    // Detectar si es PWA instalada
    const isPWA = window.matchMedia( '(display-mode: standalone)' ).matches ||
      window.navigator.standalone === true;

    if ( isPWA && 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
      // Usar Service Worker para PWA
      navigator.serviceWorker.controller.postMessage( {
        type: 'SHOW_NOTIFICATION',
        title: title,
        body: message,
        tag: tag,
        requiresAction: requiresAction,
        notificationType: notificationType
      } );
      console.log( ' Notificación PWA enviada via SW:', title );
    } else {
      // Notificación directa para navegador
      const notification = new Notification( title, options );

      notification.onclick = () => {
        window.focus();
        notification.close();

        // Manejar click según tipo
        if ( tag && tag.includes( '-now' ) ) {
          const today = getTodayString();
          showDailyTaskPanel( today, new Date().getDate() );
        }
      };

      // Auto-cerrar si no requiere interacción
      if ( !requiresAction ) {
        setTimeout( () => notification.close(), 8000 );
      }

      console.log( ' Notificación web enviada:', title );
    }

    if ( tag ) sentNotifications.add( tag );

    // Vibración física si está disponible
    if ( 'vibrate' in navigator ) {
      navigator.vibrate( getVibrationPattern( notificationType ) );
    }

    return true;
  } catch ( error ) {
    console.error( '❌ Error en showDesktopNotificationPWA:', error );
    showInAppNotification( title, message, 'info' ); // Fallback visual
    return false;
  }
}

// FUNCIÓN para patrones de vibración (también en app.js)
function getVibrationPattern( type ) {
  const patterns = {
    'default': [ 200, 100, 200 ],
    'task-reminder': [ 300, 100, 300 ],
    'task-start': [ 200, 50, 200, 50, 400 ],
    'task-late': [ 100, 100, 100, 100, 100 ],
    'success': [ 200, 100, 200 ],
    'morning': [ 300, 200, 300 ],
    'midday': [ 200, 100, 200 ],
    'evening': [ 400, 200, 400 ]
  };
  return patterns[ type ] || patterns.default;
}

// Vibración + sonido de alerta para avisos de tareas (previas y atrasadas).
// El contexto de audio se desbloquea con el primer gesto del usuario
// (los navegadores móviles lo exigen).
let alertAudioCtx = null;
function ensureAlertAudio() {
  try {
    if ( !alertAudioCtx ) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if ( !AC ) return;
      alertAudioCtx = new AC();
    }
    if ( alertAudioCtx.state === 'suspended' ) alertAudioCtx.resume();
  } catch ( e ) { /* audio no disponible */ }
}
document.addEventListener( 'pointerdown', ensureAlertAudio, { passive: true } );

function playAlertSound( kind = 'reminder' ) {
  try {
    ensureAlertAudio();
    if ( !alertAudioCtx ) return;
    const urgent = kind === 'late';
    const seq = urgent ? [ 0, 220, 440 ] : [ 0, 280 ];
    seq.forEach( ( t ) => {
      const osc = alertAudioCtx.createOscillator();
      const gain = alertAudioCtx.createGain();
      osc.type = urgent ? 'square' : 'sine';
      osc.frequency.value = urgent ? 620 : 880;
      const t0 = alertAudioCtx.currentTime + t / 1000;
      gain.gain.setValueAtTime( 0.0001, t0 );
      gain.gain.exponentialRampToValueAtTime( 0.22, t0 + 0.02 );
      gain.gain.exponentialRampToValueAtTime( 0.0001, t0 + 0.2 );
      osc.connect( gain );
      gain.connect( alertAudioCtx.destination );
      osc.start( t0 );
      osc.stop( t0 + 0.24 );
    } );
  } catch ( e ) { /* silencioso */ }
}

// Alerta completa: vibra (móvil) + suena. kind: 'reminder' | 'late'
function alertTask( type = 'default' ) {
  const kind = ( type === 'task-late' || type === 'late' ) ? 'late' : 'reminder';
  if ( 'vibrate' in navigator ) {
    try {
      navigator.vibrate( getVibrationPattern( type ) );
    } catch ( e ) { /* sin vibración */ }
  }
  playAlertSound( kind );
}

// Función auxiliar para notificaciones web fallback
function showInAppNotification( title, message, type = 'info', options = null ) {
  const notification = document.createElement( 'div' );

  const typeIcons = {
    success: 'fa-check-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle',
    task: 'fa-tasks',
  };

  const typeColors = {
    success: 'bg-green-500',
    warning: 'bg-orange-500',
    info: 'bg-blue-500',
    task: 'bg-indigo-600',
  };

  const safeType = typeColors[ type ] ? type : 'info';
  notification.className = `fixed top-20 right-4 ${typeColors[ safeType ]} text-white px-4 py-3 rounded-lg shadow-lg z-[100] transition-all duration-300 transform translate-x-full max-w-sm`;
  if ( options?.taskId ) notification.dataset.taskId = options.taskId;
  if ( options?.dateStr ) notification.dataset.dateStr = options.dateStr;

  notification.innerHTML = `
    <div class="flex items-start space-x-3">
      <i class="fas ${typeIcons[ safeType ]} text-xl mt-1"></i>
      <div class="flex-1">
        <div class="font-semibold text-sm">${title}</div>
        <div class="text-xs opacity-90 mt-1">${message}</div>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" class="text-white hover:text-gray-200">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;

  document.body.appendChild( notification );
  setTimeout( () => notification.classList.remove( 'translate-x-full' ), 100 );

  setTimeout( () => {
    notification.classList.add( 'translate-x-full' );
    setTimeout( () => notification.remove(), 300 );
  }, 5000 );
}

function goToTask( dateStr, taskId ) {
  if ( !dateStr || !taskId ) return;

  // Cerrar notificación
  document.querySelectorAll( '.fixed.top-20.right-4' ).forEach( n => n.remove() );

  // Abrir panel de tareas del día
  const date = new Date( dateStr + 'T12:00:00' );
  showDailyTaskPanel( dateStr, date.getDate() );

  // Scroll hacia el panel y highlight de la tarea DENTRO del panel
  // (acotado a #panelTaskList: el query global caía en la píldora del calendario)
  setTimeout( () => {
    const panel = document.getElementById( 'dailyTaskPanel' );
    if ( panel && typeof panel.scrollIntoView === 'function' ) {
      panel.scrollIntoView( { behavior: 'smooth', block: 'start' } );
    }

    const taskElement = document.querySelector( `#panelTaskList [data-task-id="${taskId}"]` );
    if ( taskElement ) {
      setTimeout( () => {
        if ( typeof taskElement.scrollIntoView === 'function' ) {
          taskElement.scrollIntoView( { behavior: 'smooth', block: 'center' } );
        }
        taskElement.classList.add( 'ring-4', 'ring-blue-400', 'animate-pulse' );

        setTimeout( () => {
          taskElement.classList.remove( 'animate-pulse' );
        }, 2000 );
      }, 350 );
    }
  }, 150 );
}

// Función para generar hash único de tarea
function getTaskHash( dateStr, title, time ) {
  return `${dateStr}:${title}:${time}`;
}

// Registrar tarea eliminada
function registerDeletedTask( dateStr, task ) {
  const hash = getTaskHash( dateStr, task.title, task.time );
  deletedTasksRegistry[ hash ] = {
    taskId: task.id,
    title: task.title,
    dateStr: dateStr,
    deletedAt: Date.now()
  };

  // Limpiar registros antiguos (más de 30 días)
  const thirtyDaysAgo = Date.now() - ( 30 * 24 * 60 * 60 * 1000 );
  Object.keys( deletedTasksRegistry ).forEach( key => {
    if ( deletedTasksRegistry[ key ].deletedAt < thirtyDaysAgo ) {
      delete deletedTasksRegistry[ key ];
    }
  } );

  localStorage.setItem( 'deleted_tasks_registry', JSON.stringify( deletedTasksRegistry ) );
}

// Verificar si una tarea fue eliminada
function wasTaskDeleted( dateStr, task ) {
  const hash = getTaskHash( dateStr, task.title, task.time );
  return deletedTasksRegistry.hasOwnProperty( hash );
}

function isPWAInstalled() {
  return window.matchMedia( '(display-mode: standalone)' ).matches ||
    window.navigator.standalone === true ||
    document.referrer.includes( 'android-app://' );
}

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
                            class="bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition">
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
  if ( !dailyTaskLogs[ dateStr ] || dailyTaskLogs[ dateStr ].length === 0 ) {
    showNotification( "No hay registros para eliminar", "info" );
    return;
  }

  if ( !confirm( `¿Eliminar todos los registros de cambios de este día?` ) ) {
    return;
  }

  // CRÍTICO: Solo eliminar de localStorage, NO de Firebase
  delete dailyTaskLogs[ dateStr ];
  saveTaskLogs(); // Solo guarda local, no sincroniza

  // Actualizar header si el panel está abierto
  if ( selectedDateForPanel === dateStr ) {
    const date = new Date( dateStr + "T12:00:00" );
    const dayTasks = tasks[ dateStr ] || [];
    updatePanelDateHeader( dateStr, date.getDate(), dayTasks );
  }

  showNotification( "Registros de cambios eliminados", "success" );
  closeAllModals();
}


// Borrados pendientes persistentes: si se elimina offline o se cierra la
// app antes del sync, el delete se guarda en localStorage y se reintenta
// al volver la conexión. Sin esto, esos borrados nunca llegaban a otros
// dispositivos.
const PENDING_DELETES_KEY = 'pending_deletes';

function queuePendingDelete( dateStr, taskId ) {
  try {
    const list = JSON.parse( localStorage.getItem( PENDING_DELETES_KEY ) || '[]' );
    const docId = `${dateStr}_${taskId}`;
    if ( !list.some( ( d ) => d.docId === docId ) ) {
      list.push( { docId, dateStr, taskId, ts: Date.now() } );
      localStorage.setItem( PENDING_DELETES_KEY, JSON.stringify( list ) );
    }
  } catch ( e ) {
    console.warn( '⚠️ No se pudo persistir delete pendiente:', e );
  }
}

async function flushPendingDeletes() {
  let list = [];
  try {
    list = JSON.parse( localStorage.getItem( PENDING_DELETES_KEY ) || '[]' );
  } catch ( e ) {
    list = [];
  }
  if ( list.length === 0 || !currentUser || !isOnline || !db ) return;

  const userTasksRef = db.collection( 'users' ).doc( currentUser.uid ).collection( 'tasks' );

  try {
    for ( let i = 0; i < list.length; i += 400 ) {
      const batch = db.batch();
      list.slice( i, i + 400 ).forEach( ( d ) => batch.delete( userTasksRef.doc( d.docId ) ) );
      await batch.commit();
    }
    localStorage.setItem( PENDING_DELETES_KEY, '[]' );
    console.log( `🧹 ${list.length} borrados pendientes sincronizados` );
  } catch ( e ) {
    console.error( '❌ Error en flushPendingDeletes:', e );
  }
}

//Encolar operaciones para sync automático
function enqueueSync( operation, dateStr, task ) {
  if ( !task || !task.id ) {
    console.error( '❌ enqueueSync: task o task.id faltante', { operation, dateStr, task } );
    return;
  }

  // Los deletes siempre se persisten (aunque esté offline) para reintentarlos
  if ( operation === 'delete' ) {
    queuePendingDelete( dateStr, task.id );
  }

  // NUEVO: No encolar si no hay usuario o está offline
  if ( !currentUser || !isOnline ) {
    console.log( '⚠️ Usuario offline o no logueado, sincronización diferida' );
    return;
  }

  const key = `${operation}-${dateStr}-${task.id}`;
  const now = Date.now();

  // Evitar duplicados recientes (aumentar tiempo para evitar spam)
  const existing = syncQueue.get( key );
  if ( existing && ( now - existing.timestamp ) < 2000 ) { // 2 segundos en lugar de 1
    console.log( '⚠️ Operación duplicada ignorada:', key );
    return;
  }

  // NUEVO: Limpiar operaciones muy antiguas (más de 10 minutos)
  for ( const [ existingKey, existingOp ] of syncQueue ) {
    if ( now - existingOp.timestamp > 600000 ) { // 10 minutos
      syncQueue.delete( existingKey );
      console.log( '🧹 Operación antigua eliminada:', existingKey );
    }
  }

  syncQueue.set( key, {
    operation,
    dateStr,
    task: { ...task },
    timestamp: now,
    attempts: 0
  } );

  console.log( `📝 Operación encolada:`, {
    key,
    operation,
    queueSize: syncQueue.size,
    taskTitle: task.title
  } );

  updateSyncIndicator( "pending" );

  // Debounce inteligente: más rápido en PWA
  const debounceTime = isPWAInstalled() ?
    window.PWA_SYNC_DEBOUNCE_TIME || 1000 :
    SYNC_DEBOUNCE_TIME || 2000;

  if ( syncTimeout ) {
    clearTimeout( syncTimeout );
  }

  syncTimeout = setTimeout( () => {
    if ( syncQueue.size > 0 && !isSyncing && currentUser && isOnline ) {
      processSyncQueue();
    }
  }, debounceTime );
}


//Procesar cola de sincronización
async function processSyncQueue() {
  if ( !currentUser || !isOnline || isSyncing ) {
    console.log( '⚠️ Sync cancelado' );
    return;
  }

  if ( syncQueue.size === 0 ) {
    updateSyncIndicator( "success" );
    return;
  }

  isSyncing = true;
  updateSyncIndicator( "syncing" );

  try {
    // Primero: borrados que quedaron pendientes (offline o app cerrada)
    await flushPendingDeletes();

    const userTasksRef = db.collection( "users" ).doc( currentUser.uid ).collection( "tasks" );

    // NUEVO: Obtener snapshot actual de Firebase
    const currentSnapshot = await userTasksRef.get();
    const existingTaskIds = new Set();

    currentSnapshot.forEach( doc => {
      const task = doc.data();
      existingTaskIds.add( `${task.date}_${task.id}` );
    } );

    console.log( `📊 Firebase tiene ${existingTaskIds.size} tareas actualmente` );

    const operations = Array.from( syncQueue.values() );
    console.log( `📤 Procesando ${operations.length} operaciones` );

    const BATCH_SIZE = 150;
    let processedCount = 0;
    const processedInThisBatch = new Set();

    for ( let i = 0; i < operations.length; i += BATCH_SIZE ) {
      const batch = db.batch();
      const batchOps = operations.slice( i, i + BATCH_SIZE );

      for ( const op of batchOps ) {
        const taskDocId = `${op.dateStr}_${op.task?.id}`;

        // Evitar duplicados en el mismo batch
        if ( processedInThisBatch.has( taskDocId ) ) {
          console.warn( `⚠️ Operación duplicada en batch: ${taskDocId}` );
          continue;
        }

        const taskRef = userTasksRef.doc( taskDocId );

        switch ( op.operation ) {
          case "upsert":
            if ( op.task ) {
              // Upsert real: crear si no existe y ACTUALIZAR si ya existe,
              // para que los cambios de título/hora/estado se propaguen.
              // Se usa merge:true igual que en el sync manual.
              batch.set( taskRef, {
                ...op.task,
                date: op.dateStr,
                lastModified: new Date(),
                syncVersion: Date.now()
              }, { merge: true } );

              processedInThisBatch.add( taskDocId );
              processedCount++;
              console.log( `✅ Upsert: ${op.task.title}` );
            }
            break;

          case "delete":
            batch.delete( taskRef );
            processedInThisBatch.add( taskDocId );
            processedCount++;
            console.log( `🗑️ Delete: ${taskDocId}` );
            break;
        }
      }

      if ( processedInThisBatch.size > 0 ) {
        await batch.commit();
        console.log( `✅ Batch completado: ${batchOps.length} operaciones` );
      }
    }

    // Limpiar cola solo si TODO fue exitoso
    syncQueue.clear();
    lastSyncTime = Date.now();

    console.log( `🎉 Sync completado: ${processedCount} operaciones` );

    updateSyncIndicator( "success" );

    if ( processedCount > 0 ) {
      showNotification( `✅ ${processedCount} cambios sincronizados`, "success" );
    }

  } catch ( error ) {
    console.error( "❌ Error en processSyncQueue:", error );
    updateSyncIndicator( "error" );
    showNotification( "Error de sincronización: " + error.message, "error" );
  } finally {
    isSyncing = false;
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

    // Borrados que quedaron pendientes (offline o app cerrada)
    await flushPendingDeletes();

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
          endTime: task.endTime || null,
          duration: task.duration ?? computeMinutesFromRange( task.time, task.endTime ),
          priority: task.priority || 3,
          state: task.state || "pending",
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
    refreshEndTimeMin( 'taskTime', 'taskEndTime', false );
    refreshStartTimeMin( taskDateInput ? taskDateInput.value : '', 'taskTime', 'taskEndTime', false );
  }
}

// Firebase solo se inicializa al hacer login
let firebaseInitialized = false;

async function initFirebase() {
  if ( firebaseInitialized ) {
    console.log( '⚠️ Firebase ya inicializado' );
    return;
  }

  try {
    console.log( '🔥 Inicializando Firebase...' );

    if ( !navigator.onLine ) {
      console.log( '📴 Sin conexión - modo offline' );
      initOfflineMode();
      return;
    }

    // ✅ TIMEOUT: Si Firebase no responde en 5 segundos, continuar offline
    const timeoutPromise = new Promise( ( _, reject ) =>
      setTimeout( () => reject( new Error( 'Firebase timeout' ) ), 5000 )
    );

    const initPromise = ( async () => {
      if ( !firebase.apps.length ) {
        firebase.initializeApp( firebaseConfig );
        console.log( '✅ Firebase App inicializada' );
      }

      db = firebase.firestore();
      auth = firebase.auth();

      try {
        await auth.setPersistence( firebase.auth.Auth.Persistence.LOCAL );
        console.log( '✅ Persistencia LOCAL configurada' );
      } catch ( e ) {
        console.warn( '⚠️ Persistencia falló:', e );
      }

      try {
        await db.enablePersistence( { synchronizeTabs: true } );
        console.log( '✅ Cache de Firestore habilitado' );
      } catch ( e ) {
        console.warn( '⚠️ Cache Firestore falló:', e );
      }

      if ( typeof firebase.messaging !== 'undefined' && firebase.messaging.isSupported() ) {
        try {
          messaging = firebase.messaging();
          console.log( '✅ FCM inicializado' );
        } catch ( e ) {
          console.warn( '⚠️ FCM falló:', e );
          messaging = null;
        }
      }
    } )();

    // Esperar Firebase PERO con timeout
    await Promise.race( [ initPromise, timeoutPromise ] );

    firebaseInitialized = true;

    // ✅ Esperar restauración de sesión CON timeout
    const authPromise = new Promise( resolve => {
      const unsubscribe = auth.onAuthStateChanged( user => {
        unsubscribe();
        resolve( user );
      } );
    } );

    const authTimeout = new Promise( resolve =>
      setTimeout( () => resolve( null ), 3000 )
    );

    currentUser = await Promise.race( [ authPromise, authTimeout ] );

    if ( currentUser ) {
      console.log( '✅ Sesión restaurada:', currentUser.email );

      if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
        navigator.serviceWorker.controller.postMessage( {
          type: 'SET_USER_ID',
          data: {
            userId: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL
          }
        } );
      }

      updateUI();
      updateSyncIndicator( 'success' );

      // Listener en tiempo real también en sesión restaurada (si no,
      // este dispositivo nunca recibe borrados/cambios de otros).
      setupRealtimeSync();

      // Sync con delay
      setTimeout( () => {
        if ( isOnline && !isSyncing ) {
          syncFromFirebase();
        }
      }, 2000 );
    } else {
      console.log( '❌ No hay sesión guardada' );
      currentUser = null;
      updateUI();
    }

  } catch ( error ) {
    console.error( '❌ Error/Timeout en Firebase:', error.message );

    // ✅ CRÍTICO: No bloquear la app, continuar offline
    firebaseInitialized = false;
    initOfflineMode();
  } finally {
    hideLoadingScreen();
  }
}

//Modificar función de login para inicializar Firebase
async function signInWithGoogle() {
  try {
    console.log( '🔑 Iniciando login con Google...' );

    if ( !firebaseInitialized ) {
      await initFirebase();
    }

    const loginBtn = document.getElementById( "loginBtn" );
    if ( loginBtn ) {
      loginBtn.disabled = true;
      loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Conectando...';
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope( 'profile' );
    provider.addScope( 'email' );
    provider.setCustomParameters( { prompt: 'select_account' } );

    try {
      const result = await auth.signInWithPopup( provider );

      if ( result.user ) {
        console.log( '✅ Login exitoso:', result.user.email );

        currentUser = result.user;

        // ✅ CRÍTICO: Marcar sesión como persistente
        localStorage.setItem( 'firebase_auth_active', 'true' );
        localStorage.setItem( 'firebase_user_email', result.user.email );
        localStorage.setItem( 'firebase_user_uid', result.user.uid );
        localStorage.setItem( 'firebase_session_timestamp', Date.now().toString() );

        // ✅ NUEVO: Notificar al Service Worker INMEDIATAMENTE
        if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
          navigator.serviceWorker.controller.postMessage( {
            type: 'SET_USER_ID',
            data: {
              userId: result.user.uid,
              email: result.user.email,
              displayName: result.user.displayName,
              photoURL: result.user.photoURL
            }
          } );
          console.log( '📤 Usuario enviado al Service Worker' );
        }

        // Enviar tareas actuales al SW
        if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
          navigator.serviceWorker.controller.postMessage( {
            type: 'UPDATE_TASKS',
            data: { tasks, timestamp: Date.now() }
          } );
          console.log( '📤 Tareas enviadas al Service Worker' );
        }

        updateUI();
        closeLoginModal();

        showNotification( `¡Bienvenido ${result.user.displayName || 'Usuario'}!`, 'success' );

        // Sync después de login
        setTimeout( () => {
          if ( isOnline && !isSyncing ) {
            syncFromFirebase();
          }
        }, 3000 );

        // Configurar FCM y notificaciones
        if ( messaging ) {
          setTimeout( async () => {
            try {
              await promptForNotifications();
              setupFCMListeners();
            } catch ( error ) {
              console.warn( '⚠️ No se pudo configurar FCM:', error );
            }
          }, 3000 );
        }
      }

    } catch ( popupError ) {
      console.warn( '⚠️ Popup bloqueado, intentando redirect:', popupError.code );

      if ( popupError.code === 'auth/popup-blocked' ||
        popupError.code === 'auth/cancelled-popup-request' ) {

        localStorage.setItem( 'pending_google_login', 'true' );
        await auth.signInWithRedirect( provider );
      } else {
        throw popupError;
      }
    }

  } catch ( error ) {
    console.error( '❌ Error en login:', error );
    localStorage.removeItem( 'pending_google_login' );

    let errorMessage = 'Error al iniciar sesión';

    switch ( error.code ) {
      case 'auth/popup-closed-by-user':
        errorMessage = 'Ventana de login cerrada';
        break;
      case 'auth/network-request-failed':
        errorMessage = 'Error de conexión';
        break;
      case 'auth/too-many-requests':
        errorMessage = 'Demasiados intentos. Intenta más tarde';
        break;
      default:
        errorMessage = error.message || 'Error desconocido';
    }

    showNotification( errorMessage, 'error' );

    const loginBtn = document.getElementById( "loginBtn" );
    if ( loginBtn ) {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<i class="fab fa-google mr-2"></i>Iniciar Sesión';
    }
  }
}


async function waitForServiceWorker( timeout = 10000 ) {
  if ( !( 'serviceWorker' in navigator ) ) {
    console.warn( '⚠️ Service Workers no soportados' );
    return null;
  }

  console.log( '⏳ Esperando Service Worker activo...' );

  try {
    // Esperar a que haya un SW registrado
    const registration = await navigator.serviceWorker.ready;

    // Verificar que esté activo
    if ( registration.active ) {
      console.log( 'Service Worker activo:', registration.active.state );
      return registration;
    }

    // Si no está activo, esperar con timeout
    return await new Promise( ( resolve, reject ) => {
      const timeoutId = setTimeout( () => {
        reject( new Error( 'Timeout esperando SW activo' ) );
      }, timeout );

      // Escuchar cambios de estado
      const checkState = () => {
        if ( registration.active ) {
          clearTimeout( timeoutId );
          console.log( 'SW ahora activo' );
          resolve( registration );
        } else if ( registration.installing ) {
          registration.installing.addEventListener( 'statechange', function () {
            if ( this.state === 'activated' ) {
              clearTimeout( timeoutId );
              resolve( registration );
            }
          } );
        }
      };

      checkState();
    } );

  } catch ( error ) {
    console.error( '❌ Error esperando SW:', error );
    return null;
  }
}

// FUNCIÓN: Solicitar token FCM
async function requestFCMToken() {
  if ( !messaging ) {
    console.warn( '⚠️ Messaging no inicializado' );
    return null;
  }

  if ( !currentUser || currentUser.isOffline ) {
    console.log( '⚠️ No hay usuario logueado para FCM' );
    return null;
  }

  try {
    // CRÍTICO: Esperar a que el SW esté activo
    console.log( '🔍 Verificando Service Worker antes de FCM...' );
    const registration = await waitForServiceWorker();

    if ( !registration ) {
      console.error( '❌ No hay Service Worker disponible para FCM' );
      return null;
    }

    // Verificar permisos de notificación
    if ( Notification.permission !== 'granted' ) {
      console.log( '📢 Solicitando permisos de notificación...' );
      const permission = await Notification.requestPermission();

      if ( permission !== 'granted' ) {
        console.warn( '❌ Permisos de notificación denegados' );
        return null;
      }
    }

    // AHORA SÍ: Obtener token con SW activo
    console.log( '🔑 Solicitando token FCM...' );
    const token = await messaging.getToken( {
      vapidKey: 'BCqZPBWf51RsALY4R4_O7teHw10TCL1fAlWlKoQB4fI8WvMCfnUePvo2Lk9VnzPR8NsNyjMdcSShGEXbi_2PWH0',
      serviceWorkerRegistration: registration // ← IMPORTANTE: Pasar el registration
    } );

    if ( token ) {
      console.log( 'Token FCM obtenido:', token.substring( 0, 20 ) + '...' );
      fcmToken = token;

      // Guardar token en Firestore
      await saveFCMToken( token );

      // Enviar al Service Worker
      if ( navigator.serviceWorker.controller ) {
        navigator.serviceWorker.controller.postMessage( {
          type: 'FCM_TOKEN',
          data: { token }
        } );
      }

      return token;
    } else {
      console.warn( '⚠️ No se pudo obtener token FCM' );
      return null;
    }

  } catch ( error ) {
    console.error( '❌ Error obteniendo token FCM:', error );

    // Mensajes específicos de error
    if ( error.code === 'messaging/permission-blocked' ) {
      console.error( '💡 Usuario bloqueó notificaciones' );
    } else if ( error.code === 'messaging/token-subscribe-failed' ) {
      console.error( '💡 Error de suscripción FCM - verifica VAPID key y SW' );
    } else if ( error.name === 'AbortError' ) {
      console.error( '💡 Service Worker no está activo o accesible' );
    } else if ( error.code === 'messaging/unsupported-browser' ) {
      console.error( '💡 Navegador no soporta FCM' );
    }

    return null;
  }
}

// NUEVA FUNCIÓN: Solicitar permisos FCM de forma amigable
async function promptForNotifications() {
  // Solo ejecutar si:
  // 1. El usuario está logueado
  // 2. Los permisos están en 'default'
  // 3. No se han solicitado recientemente

  if ( !currentUser || currentUser.isOffline ) return;

  const permission = Notification.permission;
  const lastPrompt = localStorage.getItem( 'last_notification_prompt' );
  const now = Date.now();

  // No molestar si ya se pidió en las últimas 24 horas
  if ( lastPrompt && ( now - parseInt( lastPrompt ) ) < 24 * 60 * 60 * 1000 ) {
    console.log( '⏰ Ya se solicitaron permisos recientemente' );
    return;
  }

  if ( permission === 'default' ) {
    // Mostrar modal explicativo primero
    const shouldAsk = await showNotificationPromptModal();

    if ( shouldAsk ) {
      localStorage.setItem( 'last_notification_prompt', now.toString() );
      await requestFCMToken();
    }
  } else if ( permission === 'granted' ) {
    // Ya tiene permisos, solo obtener token
    await requestFCMToken();
  }
}

// Modal amigable para solicitar permisos
function showNotificationPromptModal() {
  return new Promise( ( resolve ) => {
    const modal = document.createElement( 'div' );
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 animate-fade-in">
        <div class="text-center mb-4">
          <div class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-bell text-blue-600 text-3xl"></i>
          </div>
          <h3 class="text-xl font-bold text-gray-800 mb-2">
            ¿Activar recordatorios?
          </h3>
          <p class="text-gray-600 text-sm">
            Te enviaremos notificaciones para recordarte tus tareas programadas, incluso si cierras la app.
          </p>
        </div>
        
        <div class="space-y-3">
          <button id="acceptNotifications" 
                  class="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-medium">
            <i class="fas fa-check mr-2"></i>
            Sí, activar recordatorios
          </button>
          <button id="declineNotifications" 
                  class="w-full bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300 transition font-medium">
            Ahora no
          </button>
        </div>
      </div>
    `;

    document.body.appendChild( modal );

    document.getElementById( 'acceptNotifications' ).onclick = () => {
      modal.remove();
      resolve( true );
    };

    document.getElementById( 'declineNotifications' ).onclick = () => {
      modal.remove();
      resolve( false );
    };
  } );
}

// FUNCIÓN: Guardar token en Firestore
async function saveFCMToken( token ) {
  if ( !currentUser || !db ) return;

  try {
    let timezone = 'America/Lima';
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
    } catch ( e ) { /* valor por defecto */ }

    await db.collection( 'users' )
      .doc( currentUser.uid )
      .set( {
        fcmToken: token,
        lastTokenUpdate: new Date(),
        email: currentUser.email,
        timezone
      }, { merge: true } );

    console.log( '💾 Token FCM guardado en Firestore' );
  } catch ( error ) {
    console.error( '❌ Error guardando token FCM:', error );
  }
}

// FUNCIÓN: Escuchar mensajes en foreground
function setupFCMListeners() {
  if ( !messaging ) {
    console.warn( '⚠️ Messaging no disponible para listeners' );
    return;
  }

  // LISTENER PRINCIPAL: Mensajes cuando la app está abierta
  messaging.onMessage( ( payload ) => {
    console.log( '📨 Mensaje FCM recibido (app abierta):', payload );

    const { notification, data } = payload;

    if ( notification ) {
      const title = notification.title || 'Notificación';
      const body = notification.body || '';
      const taskId = data?.taskId;
      const dateStr = data?.dateStr;

      // Mostrar notificación visual en la app
      showInAppNotification( title, body, 'task', {
        taskId,
        dateStr,
        icon: notification.icon || '/images/IconLogo.png'
      } );

      // Vibración + sonido según tipo (previa o atrasada)
      alertTask( data?.type || 'default' );

      // Si es PWA o navegador con permisos, mostrar también notificación del sistema
      if ( Notification.permission === 'granted' ) {
        showDesktopNotificationPWA(
          title,
          body,
          data?.tag || `fcm-${Date.now()}`,
          data?.requiresAction === 'true',
          data?.type || 'default'
        );
      }

      // Actualizar UI si corresponde
      if ( dateStr && taskId ) {
        updateTaskUIFromNotification( dateStr, taskId );
      }
    }
  } );

  // LISTENER: renovación de token (onTokenRefresh está deprecado en Firebase 10+;
  // se conserva por compatibilidad solo si existe, si no se re-obtiene bajo demanda)
  try {
    if ( typeof messaging.onTokenRefresh === 'function' ) {
      messaging.onTokenRefresh( async () => {
        console.log( '🔄 Token FCM necesita renovación' );
        try {
          const newToken = await requestFCMToken();
          if ( newToken ) {
            console.log( 'Token FCM renovado' );
          }
        } catch ( error ) {
          console.error( '❌ Error renovando token FCM:', error );
        }
      } );
    } else {
      console.log( 'ℹ️ messaging.onTokenRefresh no disponible: se renovará token bajo demanda' );
    }
  } catch ( error ) {
    console.warn( '⚠️ No se pudo registrar onTokenRefresh:', error );
  }

  console.log( 'FCM listeners configurados (foreground)' );
}

function updateTaskUIFromNotification( dateStr, taskId ) {
  // Si el panel está abierto y es del mismo día, actualizarlo
  if ( selectedDateForPanel === dateStr ) {
    const date = new Date( dateStr + 'T12:00:00' );
    showDailyTaskPanel( dateStr, date.getDate() );
  }

  // Actualizar calendario si está en el mes actual
  const today = new Date();
  const taskDate = new Date( dateStr + 'T12:00:00' );

  if ( taskDate.getMonth() === currentDate.getMonth() &&
    taskDate.getFullYear() === currentDate.getFullYear() ) {
    renderCalendar();
  }

  // Actualizar progreso si es hoy
  if ( dateStr === getTodayString() ) {
    updateProgress();
  }
}

// Registrar sincronización periódica (Solo Chrome/Edge)
async function registerPeriodicSync() {
  if ( 'serviceWorker' in navigator && 'periodicSync' in navigator.serviceWorker ) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.periodicSync.register( 'check-tasks', {
        minInterval: 30 * 60 * 1000 // 30 minutos
      } );
      console.log( ' Periodic Sync registrado para notificaciones' );
    } catch ( error ) {
      console.warn( '⚠️ Periodic Sync no disponible:', error );
    }
  }
}

// Sistema de sincronización de notificaciones
let lastNotificationSync = 0;
const NOTIFICATION_SYNC_INTERVAL = 30000; // 30 segundos


function initOfflineMode() {
  console.log( "🔧 Iniciando modo offline" );

  isOnline = false;
  currentUser = null; // Sin usuario offline ficticio

  // Ocultar indicadores de Firebase
  const statusEl = document.getElementById( "firebaseStatus" );
  if ( statusEl ) {
    statusEl.classList.add( "force-hidden" );
  }

  updateUI();
  hideLoadingScreen();

  // Mensaje discreto (opcional)
  const offlineMsg = document.createElement( 'div' );
  offlineMsg.className = 'fixed bottom-4 left-4 bg-gray-700 text-white text-xs px-3 py-2 rounded shadow-lg z-30';
  offlineMsg.innerHTML = '<i class="fas fa-wifi-slash mr-2"></i>Modo offline activo';
  document.body.appendChild( offlineMsg );

  setTimeout( () => offlineMsg.remove(), 3000 );
}

function shouldShowSyncIndicators() {
  return currentUser && !currentUser.isOffline && isOnline;
}

function updateOfflineUI() {
  const isOffline = !navigator.onLine;
  const loginBtn = document.getElementById( 'loginBtn' );
  const installBtn = document.getElementById( 'install-button' );
  const syncBtn = document.getElementById( 'syncBtn' );

  console.log( '📡 Estado de conexión:', isOffline ? 'OFFLINE' : 'ONLINE' );

  if ( isOffline ) {
    // Ocultar botones que requieren conexión
    loginBtn?.classList.add( 'hidden' );
    installBtn?.classList.add( 'hidden' );
    syncBtn?.classList.add( 'hidden' );

    // Mostrar indicador offline
    const statusEl = document.getElementById( 'firebaseStatus' );
    if ( statusEl && !currentUser ) {
      statusEl.classList.remove( 'hidden', 'force-hidden' );
      statusEl.className = 'fixed top-4 left-4 px-3 py-2 rounded-lg text-sm font-medium z-40 bg-orange-500 text-white';
      document.getElementById( 'statusIcon' ).className = 'fas fa-wifi-slash mr-2';
      document.getElementById( 'statusText' ).textContent = 'Sin conexión';
    }
  } else {
    // Restaurar visibilidad de botones
    if ( !currentUser || currentUser.isOffline ) {
      loginBtn?.classList.remove( 'hidden' );
    }

    if ( deferredPrompt && !isPWAInstalled() ) {
      installBtn?.classList.remove( 'hidden' );
    }

    if ( currentUser && !currentUser.isOffline ) {
      syncBtn?.classList.remove( 'hidden' );
    }

    // Ocultar indicador offline
    const statusEl = document.getElementById( 'firebaseStatus' );
    if ( statusEl && !currentUser ) {
      statusEl.classList.add( 'hidden' );
    }
  }
}

// Escuchar cambios de conexión
window.addEventListener( 'online', () => {
  const loginModal = document.getElementById( 'loginModal' );
  const isModalOpen = loginModal && !loginModal.classList.contains( 'hidden' );

  if ( isModalOpen ) {
    console.log( '🟢 Conexión restaurada - Actualizando modal de login' );

    const googleSignInBtn = document.getElementById( 'googleSignInBtn' );
    if ( googleSignInBtn ) {
      // Rehabilitar botón
      googleSignInBtn.disabled = false;
      googleSignInBtn.classList.remove( 'opacity-50', 'cursor-not-allowed' );
      googleSignInBtn.classList.add( 'hover:bg-blue-700' );
      googleSignInBtn.title = 'Iniciar sesión con Google';
      googleSignInBtn.innerHTML = '<i class="fab fa-google mr-2"></i>Iniciar sesión con Google';

      // Agregar evento
      const newBtn = googleSignInBtn.cloneNode( true );
      googleSignInBtn.parentNode.replaceChild( newBtn, googleSignInBtn );
      newBtn.addEventListener( 'click', signInWithGoogle );

      showNotification( '🌐 Conexión restaurada - Puedes iniciar sesión', 'success' );
    }
  }
} );

window.addEventListener( 'offline', () => {
  const loginModal = document.getElementById( 'loginModal' );
  const isModalOpen = loginModal && !loginModal.classList.contains( 'hidden' );

  if ( isModalOpen ) {
    console.log( '🔴 Conexión perdida - Deshabilitando login' );

    const googleSignInBtn = document.getElementById( 'googleSignInBtn' );
    if ( googleSignInBtn ) {
      // Deshabilitar botón
      googleSignInBtn.disabled = true;
      googleSignInBtn.classList.add( 'opacity-50', 'cursor-not-allowed' );
      googleSignInBtn.classList.remove( 'hover:bg-blue-700' );
      googleSignInBtn.title = '🔌 Solo se puede ingresar con conexión a internet';
      googleSignInBtn.innerHTML = '<i class="fas fa-wifi-slash mr-2"></i>🔴 Sin conexión - Login deshabilitado';

      showNotification( '🔴 Sin conexión - Login deshabilitado', 'error' );
    }
  }
} );

// Ejecutar al cargar
updateOfflineUI();

function showOfflineMessage() {
  const offlineMessage = document.createElement( 'div' );
  offlineMessage.id = 'offlineMessage';
  offlineMessage.className = 'fixed top-16 left-4 right-4 bg-orange-100 border-l-4 border-orange-500 text-orange-700 p-4 rounded-lg shadow-lg z-40';
  offlineMessage.innerHTML = `
    <div class="flex items-start">
      <div class="flex-shrink-0">
        <i class="fas fa-wifi-slash text-orange-500"></i>
      </div>
      <div class="ml-3 flex-1">
        <p class="text-sm font-medium">
          Modo Sin Conexión Activo
        </p>
        <p class="text-xs mt-1">
          • Tus tareas se guardan localmente<br>
          • Se sincronizarán cuando vuelva la conexión<br>
          • Funcionalidad limitada disponible
        </p>
        <div class="mt-2 flex items-center space-x-2 text-xs">
          <span class="flex items-center">
            <i class="fas fa-check text-green-600 mr-1"></i>
            Crear/editar tareas
          </span>
          <span class="flex items-center">
            <i class="fas fa-times text-red-600 mr-1"></i>
            Sync en tiempo real
          </span>
        </div>
      </div>
      <button onclick="hideOfflineMessage()" class="flex-shrink-0 ml-4 text-orange-400 hover:text-orange-600">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;

  // Remover mensaje anterior si existe
  const existing = document.getElementById( 'offlineMessage' );
  if ( existing ) existing.remove();

  document.body.appendChild( offlineMessage );

  // Auto-ocultar después de 10 segundos
  setTimeout( () => {
    if ( document.getElementById( 'offlineMessage' ) ) {
      hideOfflineMessage();
    }
  }, 10000 );
}

function hideOfflineMessage() {
  const message = document.getElementById( 'offlineMessage' );
  if ( message ) {
    message.remove();
  }
}

function savePermissions() {
  const permissions = {
    notifications: {
      permission: Notification.permission,
      enabled: notificationsEnabled,
      timestamp: Date.now()
    }
  };

  try {
    localStorage.setItem( PERMISSIONS_KEY, JSON.stringify( permissions ) );
    console.log( '💾 Permisos guardados:', permissions );
  } catch ( error ) {
    console.error( 'Error guardando permisos:', error );
  }
}

function loadPermissions() {
  try {
    const stored = localStorage.getItem( PERMISSIONS_KEY );
    if ( stored ) {
      const permissions = JSON.parse( stored );

      // Solo restaurar si los permisos del navegador coinciden
      if ( Notification.permission === 'granted' &&
        permissions.notifications?.permission === 'granted' ) {

        notificationsEnabled = permissions.notifications.enabled !== false; // Default true
        console.log( ' Permisos de notificaciones restaurados:', notificationsEnabled );
        return true;
      }
    }

    // Si no hay permisos guardados pero el navegador los tiene, usar defaults
    if ( Notification.permission === 'granted' ) {
      notificationsEnabled = true;
      savePermissions(); // Guardar para próxima vez
    }

  } catch ( error ) {
    console.error( 'Error cargando permisos:', error );
    // Valores por defecto en caso de error
    notificationsEnabled = ( Notification.permission === 'granted' );
  }

  return false;
}

function initNotifications() {
  if ( !( "Notification" in window ) ) {
    console.warn( "Este navegador no soporta notificaciones" );
    return;
  }

  // Cargar permisos guardados
  loadPermissions();

  if ( Notification.permission === "granted" ) {
    if ( typeof notificationsEnabled === 'undefined' ) {
      notificationsEnabled = true;
    }

    updateNotificationButton();

    // NUEVO: Forzar verificación inmediata en el SW
    if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
      navigator.serviceWorker.controller.postMessage( {
        type: 'FORCE_CHECK'
      } );
      console.log( 'Service Worker notificado para verificación' );
    }

  } else if ( Notification.permission === "default" ) {
    const isPWA = window.matchMedia( '(display-mode: standalone)' ).matches ||
      window.navigator.standalone === true;

    if ( isPWA ) {
      setTimeout( () => {
        requestNotificationPermissionWithVibration();
      }, 2000 );
    }
  }

  updateNotificationButton();
}

function setupNetworkListeners() {
  window.addEventListener( "online", handleOnline );
  window.addEventListener( "offline", handleOffline );

  // NUEVO: Cuando la PWA vuelve del background, verificar notificaciones
  document.addEventListener( 'visibilitychange', () => {
    if ( !document.hidden && notificationsEnabled && Notification.permission === 'granted' ) {
      console.log( '📱 PWA volvió del background - sincronizando notificaciones' );

    }
  } );

  // Verificación adicional cada 30 segundos
  setInterval( () => {
    const actuallyOnline = navigator.onLine;
    if ( actuallyOnline !== isOnline ) {
      if ( actuallyOnline ) {
        handleOnline();
      } else {
        handleOffline();
      }
    }
  }, 30000 );
}

function handleOnline() {
  console.log( "🌐 Conexión restaurada" );
  isOnline = true;
  hideOfflineMessage();

  // ✅ Inicializar Firebase si no está listo
  if ( !firebaseInitialized ) {
    console.log( '🔥 Iniciando Firebase tras reconexión...' );
    initFirebase().then( () => {
      if ( firebaseInitialized ) {
        setupAuthListeners();
      }
    } );
    return;
  }

  if ( currentUser && currentUser.isOffline ) {
    initFirebase();
  } else if ( currentUser ) {
    updateSyncIndicator( "success" );
    updateOfflineUI();

    // Re-suscribir realtime al reconectar (el listener pudo caer offline)
    setupRealtimeSync();

    const syncDelay = isPWAInstalled() ? 500 : 1000;
    setTimeout( () => {
      if ( syncQueue.size > 0 ) {
        processSyncQueue().then( () => {
          setTimeout( syncFromFirebase, 1000 );
        } );
      } else {
        syncFromFirebase();
      }
    }, syncDelay );

    if ( isPWAInstalled() ) {
      showDesktopNotificationPWA(
        "Conexión restaurada",
        "Sincronizando tareas...",
        "connection-restored"
      );
    } else {
      showNotification( "Conexión restaurada. Sincronizando...", "success" );
    }
  }
}

function handleOffline() {
  console.log( "📵 Conexión perdida" );
  isOnline = false;
  updateOfflineUI();

  // Solo mostrar mensaje offline si hay un usuario activo
  if ( currentUser && !currentUser.isOffline ) {
    updateSyncIndicator( "offline" );
    showOfflineMessage();
    showNotification( "Trabajando sin conexión. Los cambios se sincronizarán cuando vuelva internet.", "info" );
  }
}

// Manejar mensajes del Service Worker específicos para Firebase
function handleServiceWorkerMessages() {
  if ( 'serviceWorker' in navigator ) {
    navigator.serviceWorker.addEventListener( 'message', event => {
      const { type, data } = event.data;

      switch ( type ) {
        case 'NOTIFICATION_CLICKED':
          window.focus();
          if ( data.taskId && data.dateStr ) {
            goToTask( data.dateStr, data.taskId );
          }
          break;

        case 'NOTIFICATION_SENT':
          // Sincronizar que una notificación fue enviada desde el SW
          if ( data.tag ) {
            sentNotifications.add( data.tag );
            notificationStatus.taskReminders.add( data.tag );
            console.log( '📡 Notificación sincronizada desde SW:', data.tag );
          }
          break;

        case 'SYNC_REQUIRED':
          if ( currentUser && isOnline ) {
            processSyncQueue();
          }
          break;
      }
    } );
  }
}

function cleanupUIOnLogout() {
  // Limpiar indicadores
  const statusEl = document.getElementById( "firebaseStatus" );
  if ( statusEl ) {
    statusEl.classList.add( "hidden", "force-hidden" );
  }

  // Limpiar notificaciones
  const existingNotifications = document.querySelectorAll( '.notification' );
  existingNotifications.forEach( notification => {
    const text = notification.textContent.toLowerCase();
    if ( text.includes( 'sincroniz' ) || text.includes( 'firebase' ) || text.includes( 'conexión' ) ) {
      notification.remove();
    }
  } );

  // Detener servicios
  if ( syncTimeout ) {
    clearTimeout( syncTimeout );
    syncTimeout = null;
  }

}

function updateSyncIndicator( status ) {
  const statusEl = document.getElementById( "firebaseStatus" );
  const iconEl = document.getElementById( "statusIcon" );
  const textEl = document.getElementById( "statusText" );

  // No mostrar indicador si no hay usuario logueado
  if ( !currentUser || currentUser.isOffline || !statusEl || !iconEl || !textEl ) {
    if ( statusEl ) statusEl.classList.add( "hidden" );
    return;
  }

  // Solo mostrar si el elemento no está forzado a oculto
  if ( statusEl.classList.contains( "force-hidden" ) ) {
    return;
  }

  const pendingCount = syncQueue.size;
  console.log( `🔄 Actualizando indicador: ${status}, pendientes: ${pendingCount}` );

  const statusConfig = {
    success: {
      class: "bg-green-500 text-white",
      icon: "fa-check-circle",
      text: pendingCount > 0 ? `${pendingCount} pendientes` : "Sincronizado",
      autoHide: pendingCount === 0
    },
    error: {
      class: "bg-red-500 text-white",
      icon: "fa-exclamation-triangle",
      text: "Error de sincronización",
      autoHide: false
    },
    syncing: {
      class: "bg-blue-500 text-white",
      icon: "fa-sync-alt fa-spin",
      text: `Sincronizando...`,
      autoHide: false
    },
    pending: {
      class: "bg-orange-500 text-white",
      icon: "fa-clock",
      text: `${pendingCount} cambios pendientes`,
      autoHide: false
    }
  };

  const config = statusConfig[ status ] || statusConfig.success;

  // Aplicar cambios con mejor posicionamiento
  statusEl.className = `fixed top-4 left-4 px-3 py-2 rounded-lg text-sm font-medium z-40 transition-all duration-300 ${config.class}`;
  iconEl.className = `fas ${config.icon} mr-2`;
  textEl.textContent = config.text;
  statusEl.classList.remove( "hidden" );

  // Auto-ocultar inteligente
  if ( config.autoHide ) {
    setTimeout( () => {
      if ( syncQueue.size === 0 && textEl.textContent === config.text ) {
        statusEl.classList.add( "hidden" );
      }
    }, 3000 );
  }
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById( "loadingScreen" );
  loadingScreen.style.opacity = "0";
  setTimeout( () => {
    loadingScreen.style.display = "none";
  }, 300 );
}

// Manejar resultado de Google Sign-In
async function handleRedirectResult() {
  if ( !auth ) {
    console.warn( '⚠️ Auth no disponible para redirect result' );
    return;
  }

  try {
    const pendingLogin = localStorage.getItem( 'pending_google_login' );

    if ( !pendingLogin ) {
      return; // No hay login pendiente
    }

    console.log( '🔍 Procesando resultado de redirect...' );

    // ⏳ Esperar resultado con timeout
    const resultPromise = auth.getRedirectResult();
    const timeoutPromise = new Promise( ( _, reject ) =>
      setTimeout( () => reject( new Error( 'Timeout' ) ), 8000 )
    );

    const result = await Promise.race( [ resultPromise, timeoutPromise ] );

    if ( result && result.user ) {
      console.log( 'Login vía redirect exitoso:', result.user.email );

      // Limpiar flag
      localStorage.removeItem( 'pending_google_login' );

      currentUser = result.user;

      localStorage.setItem( 'firebase_auth_active', 'true' );
      localStorage.setItem( 'firebase_user_email', result.user.email );
      localStorage.setItem( 'firebase_user_uid', result.user.uid );

      updateUI();
      closeLoginModal();

      showNotification( `¡Bienvenido ${result.user.displayName || 'Usuario'}!`, 'success' );

      if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
        navigator.serviceWorker.controller.postMessage( {
          type: 'SET_USER_ID',
          data: { userId: result.user.uid, email: result.user.email }
        } );
      }

      setTimeout( () => {
        if ( isOnline && !isSyncing ) {
          syncFromFirebase();
        }
      }, 2000 );

      if ( messaging ) {
        setTimeout( async () => {
          await promptForNotifications();
          setupFCMListeners();
        }, 2000 );
      }

    } else if ( pendingLogin ) {
      // Si hay flag pero no resultado, esperar un poco más
      console.log( '⏳ Esperando resultado de redirect...' );

      setTimeout( () => {
        if ( auth.currentUser ) {
          console.log( 'Usuario detectado después de espera' );
          currentUser = auth.currentUser;
          localStorage.removeItem( 'pending_google_login' );
          updateUI();
          closeLoginModal();
        } else {
          console.warn( '⚠️ No se detectó usuario, limpiando flag' );
          localStorage.removeItem( 'pending_google_login' );
        }
      }, 3000 );
    }

  } catch ( error ) {
    console.error( '❌ Error procesando redirect:', error );

    localStorage.removeItem( 'pending_google_login' );

    if ( error.code !== 'auth/popup-closed-by-user' && error.message !== 'Timeout' ) {
      showNotification( 'Error al procesar inicio de sesión', 'error' );
    }
  }
}

async function initializeNotificationSystem() {
  if ( !currentUser || !messaging ) return;

  try {

    // 2. Configurar listeners
    setupFCMListeners();

    console.log( 'Sistema de notificaciones inicializado' );

  } catch ( error ) {
    console.error( '❌ Error inicializando sistema de notificaciones:', error );
  }
}

function signOut() {
  if ( confirm( "¿Estás seguro de que quieres cerrar sesión?" ) ) {
    // NUEVO: Limpiar listener de Firestore
    if ( firestoreListener ) {
      firestoreListener();
      firestoreListener = null;
      console.log( '🔇 Listener de Firestore desconectado' );
    }

    // Limpiar token FCM
    if ( currentUser && fcmToken ) {
      db.collection( 'users' )
        .doc( currentUser.uid )
        .update( {
          fcmToken: firebase.firestore.FieldValue.delete()
        } )
        .catch( err => console.error( 'Error limpiando token FCM:', err ) );
    }

    fcmToken = null;

    cleanupUIOnLogout();
    updateUI();

    if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
      navigator.serviceWorker.controller.postMessage( { type: 'LOGOUT' } );
    }

    auth.signOut()
      .then( () => {
        console.log( 'Sesión cerrada correctamente' );
        showNotification( "Sesión cerrada", "info" );
      } )
      .catch( ( error ) => {
        console.error( "Error signing out:", error );
        showNotification( "Error al cerrar sesión", "error" );
      } );
  }
}

async function syncFromFirebase() {
  if ( !currentUser || !isOnline || isSyncing ) {
    console.log( '⚠️ syncFromFirebase cancelado' );
    return;
  }

  isSyncing = true;
  updateSyncIndicator( "syncing" );

  try {
    console.log( '🔄 Sync desde Firebase iniciado...' );

    const userTasksRef = db
      .collection( "users" )
      .doc( currentUser.uid )
      .collection( "tasks" );

    const snapshot = await userTasksRef.get();

    if ( snapshot.empty ) {
      console.log( "📭 No hay tareas remotas" );
      updateSyncIndicator( "success" );
      return;
    }

    const remoteTasks = {};
    const remoteTaskIds = new Set();

    // PASO 1: Recopilar tareas remotas
    snapshot.forEach( ( doc ) => {
      const task = doc.data();
      const date = task.date;

      if ( !remoteTasks[ date ] ) {
        remoteTasks[ date ] = [];
      }

      const taskData = {
        id: task.id,
        title: task.title,
        description: task.description || "",
        time: task.time || "",
        completed: task.completed || false,
        state: task.state || "pending",
        priority: task.priority || 3,
      };

      remoteTasks[ date ].push( taskData );
      remoteTaskIds.add( task.id );
    } );

    let tasksAdded = 0;
    let tasksUpdated = 0;
    let tasksDeleted = 0;

    // PASO 2: Descargar tareas que NO existen localmente
    Object.keys( remoteTasks ).forEach( ( date ) => {
      if ( !tasks[ date ] ) {
        tasks[ date ] = [];
      }

      remoteTasks[ date ].forEach( ( remoteTask ) => {
        // ✅ VERIFICACIÓN TRIPLE
        const existsById = tasks[ date ].some( t => t.id === remoteTask.id );
        const existsByContent = tasks[ date ].some( t =>
          t.title === remoteTask.title && t.time === remoteTask.time
        );
        const wasDeleted = wasTaskDeleted( date, remoteTask );

        // SOLO añadir si NO existe de ninguna forma
        if ( !existsById && !existsByContent && !wasDeleted ) {
          tasks[ date ].push( remoteTask );
          tasksAdded++;
          console.log( `📥 Descargada: ${remoteTask.title}` );
        } else {
          console.log( `⏭️ Ya existe: ${remoteTask.title}` );
        }
      } );
    } );

    // ✅ PASO 3: ELIMINAR tareas locales que NO existen en remoto
    Object.keys( tasks ).forEach( ( dateStr ) => {
      if ( !tasks[ dateStr ] ) return;

      const initialLength = tasks[ dateStr ].length;
      const tasksToRemove = [];

      tasks[ dateStr ].forEach( ( task, index ) => {
        const existsInRemote = remoteTaskIds.has( task.id ) ||
          remoteTasks[ dateStr ]?.some( t => t.title === task.title && t.time === task.time );

        // Si NO existe en remoto y NO fue eliminada localmente recientemente
        if ( !existsInRemote && !wasTaskDeleted( dateStr, task ) ) {
          console.log( `🔍 Eliminación remota detectada: ${task.title}` );
          tasksToRemove.push( index );

          registerDeletedTask( dateStr, task );
          addToChangeLog( "deleted", task.title, dateStr, null, null, task.id );
        }
      } );

      // Eliminar en orden inverso
      if ( tasksToRemove.length > 0 ) {
        tasksToRemove.reverse().forEach( index => {
          const removedTask = tasks[ dateStr ][ index ];
          console.log( `🗑️ Eliminando: ${removedTask.title}` );
          tasks[ dateStr ].splice( index, 1 );
          tasksDeleted++;
        } );

        if ( tasks[ dateStr ].length === 0 ) {
          delete tasks[ dateStr ];
        }
      }
    } );

    // Guardar cambios
    if ( tasksAdded > 0 || tasksUpdated > 0 || tasksDeleted > 0 ) {
      saveTasks();
      renderCalendar();
      updateProgress();

      const message = [];
      if ( tasksAdded > 0 ) message.push( `${tasksAdded} nuevas` );
      if ( tasksUpdated > 0 ) message.push( `${tasksUpdated} actualizadas` );
      if ( tasksDeleted > 0 ) message.push( `${tasksDeleted} eliminadas` );

      showNotification( `Sincronización: ${message.join( ', ' )}`, "success" );
    } else {
      console.log( '✅ Todo sincronizado' );
    }

    updateSyncIndicator( "success" );

  } catch ( error ) {
    console.error( "❌ Error en syncFromFirebase:", error );
    updateSyncIndicator( "error" );
    showNotification( "Error al sincronizar: " + error.message, "error" );
  } finally {
    isSyncing = false;
  }
}

function forceSyncNow() {
  console.log( 'Forzando sincronización inmediata...' );
  if ( syncTimeout ) {
    clearTimeout( syncTimeout );
    syncTimeout = null;
  }
  processSyncQueue();
}

window.addEventListener( 'appinstalled', () => {
  console.log( '🎉 PWA instalada exitosamente' );

  const installButton = document.getElementById( 'install-button' );
  if ( installButton ) {
    installButton.style.display = 'none';
    installButton.classList.add( 'hidden' );
  }

  installButtonShown = false;
  deferredPrompt = null;

  // Opcional: mostrar mensaje de éxito
  showNotification( 'Aplicación instalada correctamente', 'success' );
} );

// ===== DELEGACIÓN GLOBAL DE ACCIONES DINÁMICAS =====
// Un único listener a nivel document para [data-action]. El HTML solo
// aporta marcado estático + hooks inertes; toda la conducta vive aquí.
// Al registrarse una sola vez en la evaluación del script, es inmune
// al doble cableado del init.
document.addEventListener( 'click', ( e ) => {
  const el = e.target.closest( '[data-action]' );
  if ( !el ) return;

  const action = el.dataset.action;
  const date = el.dataset.date;
  const id = el.dataset.id;

  switch ( action ) {
    case 'close-modals':
      closeAllModals();
      break;
    case 'day-modal':
      e.stopPropagation();
      showDayTasksModal( date );
      break;
    case 'goto-task':
      closeAllModals();
      goToTask( date, id );
      break;
    case 'edit-task':
      closeAllModals();
      quickEditTaskAdvanced( date, id );
      break;
    case 'delete-task':
      quickDeleteTask( date, id );
      break;
    case 'quick-add':
      closeAllModals();
      showQuickAddTask( date );
      break;
    case 'clear-week':
      closeAllModals();
      clearWeek( true );
      break;
    case 'clear-month':
      closeAllModals();
      clearMonth( true );
      break;
    case 'clear-specific':
      showClearSpecificDaysModal();
      break;
    case 'confirm-clear-specific':
      confirmClearSpecificDays();
      break;
    case 'toggle-form':
      toggleTaskForm();
      break;
    case 'show-form':
      toggleTaskForm( true );
      break;
    case 'fab-create':
      openCreateTaskModal();
      break;
    case 'month-year-picker':
      showMonthYearPicker();
      break;
    case 'pick-month':
      pickMonthYear( parseInt( el.dataset.month, 10 ) );
      break;
    case 'picker-year-prev':
      shiftPickerYear( -1 );
      break;
    case 'picker-year-next':
      shiftPickerYear( 1 );
      break;
    case 'picker-today':
      pickerGoToday();
      break;
  }
} );

// ===== RANGO HORARIO INICIO/FIN =====
// La hora de fin solo puede elegirse después de la de inicio:
// fija `min` en el picker y limpia en vivo cualquier valor inválido.
function refreshEndTimeMin( startId, endId, notify = true ) {
  const start = document.getElementById( startId );
  const end = document.getElementById( endId );
  if ( !start || !end ) return;

  if ( start.value ) {
    end.min = start.value;
    if ( end.value && end.value <= start.value ) {
      end.value = '';
      if ( notify ) showNotification( 'La hora de fin debe ser posterior a la de inicio', 'error' );
    }
  } else {
    end.removeAttribute( 'min' );
  }
}

function wireTimeRangeValidation( startId, endId ) {
  const start = document.getElementById( startId );
  const end = document.getElementById( endId );
  if ( !start || !end ) return;
  start.addEventListener( 'change', () => refreshEndTimeMin( startId, endId ) );
  end.addEventListener( 'change', () => refreshEndTimeMin( startId, endId ) );
  refreshEndTimeMin( startId, endId, false );
}

// Hora de inicio: si el día es hoy, no admite valores anteriores a ahora.
// Deshabilita esas opciones en el picker (min) y limpia en vivo + al guardar.
function nowHM() {
  const n = new Date();
  return `${String( n.getHours() ).padStart( 2, '0' )}:${String( n.getMinutes() ).padStart( 2, '0' )}`;
}

function refreshStartTimeMin( dateValue, startId, endId, notify = true ) {
  const start = document.getElementById( startId );
  if ( !start ) return;

  if ( dateValue && dateValue === getTodayString() ) {
    const min = nowHM();
    start.min = min;
    if ( start.value && start.value < min ) {
      start.value = '';
      if ( notify ) showNotification( 'La hora de inicio no puede ser anterior a la hora actual', 'error' );
    }
  } else {
    start.removeAttribute( 'min' );
  }

  if ( endId ) refreshEndTimeMin( startId, endId, notify );
}

// opts: { dateId?, fixedDate?, startId, endId }
function wireStartTimeValidation( opts ) {
  const { dateId, fixedDate, startId, endId } = opts;
  const start = document.getElementById( startId );
  const dateEl = dateId ? document.getElementById( dateId ) : null;
  if ( !start ) return;

  const currentDateValue = () => dateEl ? dateEl.value : ( fixedDate || '' );
  if ( dateEl ) {
    dateEl.addEventListener( 'change', () => refreshStartTimeMin( currentDateValue(), startId, endId ) );
  }
  start.addEventListener( 'change', () => refreshStartTimeMin( currentDateValue(), startId, endId ) );
  refreshStartTimeMin( currentDateValue(), startId, endId, false );
}

// CONFIGURACIÓN de eventos
// Guard: el init se invoca desde el fallback por readyState Y desde
// DOMContentLoaded; sin esto cada botón quedaba con doble listener y
// acciones como el toggle se anulaban (abrir+cerrar en el mismo clic).
let eventListenersConfigured = false;
function setupEventListeners() {
  if ( eventListenersConfigured ) return;
  // Verificar que DOM esté listo
  if ( document.readyState === 'loading' ) {
    document.addEventListener( 'DOMContentLoaded', setupEventListeners );
    return;
  }
  if ( eventListenersConfigured ) return;

  const elements = {
    taskForm: addTask,
    prevMonth: () => changeMonth( -1 ),
    nextMonth: () => changeMonth( 1 ),
    taskRepeat: toggleCustomDays,
    clearOptionsBtn: showClearOptionsModal,
    exportExcelBtn: exportToExcel,
    notificationsBtn: toggleNotifications,
    syncBtn: syncToFirebase,
    loginBtn: showLoginModal,
    logoutBtn: signOut,

    closeLoginModal: closeLoginModal,
    resetFormBtn: resetForm,
    clearAllBtn: clearAll,
    // NOTA: formToggleBtn / showFormBtn / fabAddTask NO van aquí:
    // los gestiona la delegación global [data-action] (un solo listener
    // a nivel document, inmune a doble cableado).
  };

  // Configurar event listeners principales
  Object.entries( elements ).forEach( ( [ id, handler ] ) => {
    const element = document.getElementById( id );
    if ( element ) {
      element.addEventListener(
        element.tagName === 'FORM' ? 'submit' : 'click',
        handler
      );
    } else {
      console.warn( `Elemento '${id}' no encontrado` );
    }
  } );

  // Event listeners específicos del panel
  const closePanelBtn = document.getElementById( 'closePanelBtn' );
  const addQuickTaskBtn = document.getElementById( 'addQuickTaskBtn' );

  if ( closePanelBtn ) {
    closePanelBtn.addEventListener( 'click', closeDailyTaskPanel );
  }

  if ( addQuickTaskBtn ) {
    addQuickTaskBtn.addEventListener( 'click', addQuickTaskToSelectedDay );
  }

  // Event listeners para repetición de tareas
  const repeatDurationSelect = document.getElementById( 'repeatDuration' );
  const customDaysInputs = document.querySelectorAll( '#customDays input[type="checkbox"]' );
  const taskDateInput = document.getElementById( 'taskDate' );

  if ( repeatDurationSelect ) {
    repeatDurationSelect.addEventListener( 'change', updateRepeatPreview );
  }

  if ( taskDateInput ) {
    taskDateInput.addEventListener( 'change', updateRepeatPreview );
  }

  customDaysInputs.forEach( input => {
    input.addEventListener( 'change', updateRepeatPreview );
  } );

  // La hora de fin del formulario principal solo admite valores
  // posteriores a la hora de inicio (min dinámico + limpieza en vivo).
  wireTimeRangeValidation( 'taskTime', 'taskEndTime' );
  // La hora de inicio no admite valores anteriores a ahora si es hoy.
  wireStartTimeValidation( { dateId: 'taskDate', startId: 'taskTime', endId: 'taskEndTime' } );

  eventListenersConfigured = true;
  console.log( 'Event listeners configurados completamente' );
}

// Fallback para navegadores que ya tienen DOM listo
if ( document.readyState === 'complete' || document.readyState === 'interactive' ) {
  setupEventListeners();
}

// Configurar características específicas de PWA
function configurePWAFeatures() {
  // Prevenir zoom accidental en PWA
  document.addEventListener( 'gesturestart', ( e ) => e.preventDefault() );
  document.addEventListener( 'gesturechange', ( e ) => e.preventDefault() );
  document.addEventListener( 'gestureend', ( e ) => e.preventDefault() );

  // Mejorar rendimiento de scroll en PWA
  document.body.style.overscrollBehavior = 'contain';

  // Configurar viewport para PWA
  const viewport = document.querySelector( 'meta[name="viewport"]' );
  if ( viewport && isPWAInstalled() ) {
    viewport.content = 'width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover';
  }

  // Configurar sincronización más frecuente en PWA
  if ( syncTimeout ) {
    clearTimeout( syncTimeout );
  }

  // PWA sync más agresivo (1 segundo vs 2 segundos)
  const PWA_SYNC_DEBOUNCE_TIME = 1000;

  // Override del debounce time para PWA
  window.PWA_SYNC_DEBOUNCE_TIME = PWA_SYNC_DEBOUNCE_TIME;
}

// Función para abrir automáticamente el panel del día actual al cargar
function initializeTodayPanel() {
  const today = getTodayString();
  const todayDate = new Date();

  selectedDateForPanel = today;

  // Esperar a que las tareas estén cargadas
  setTimeout( () => {
    const todayTasks = tasks[ today ] || [];
    const isDesktop = window.innerWidth >= 768;
    const isPWA = window.matchMedia( '(display-mode: standalone)' ).matches ||
      window.navigator.standalone === true ||
      window.location.search.includes( 'pwa=true' );

    const hasPendingTasks = todayTasks.some( task =>
      task.state !== 'completed'
    );

    console.log( `📅 Inicializando panel - Tareas hoy: ${todayTasks.length}, Pendientes: ${hasPendingTasks}` );

    // SIEMPRE abrir el panel si hay tareas hoy O si es desktop
    const shouldShowPanel = todayTasks.length > 0 || ( isDesktop && !isPWA );

    if ( shouldShowPanel ) {
      console.log( `📱 Abriendo panel automático` );
      showDailyTaskPanel( today, todayDate.getDate() );
    } else {
      console.log( `⏭️ Panel no abierto - No hay tareas y no es desktop` );
    }

    // Aviso de atrasadas al ingresar (una vez por sesión)
    notifyOverdueOnEntry();
  }, 500 ); // Esperar 500ms para asegurar que las tareas estén cargadas
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
  console.log( '🔍 Ejecutando showLoginModal...' );

  const loginModal = document.getElementById( "loginModal" );

  if ( !loginModal ) {
    console.error( "❌ Elemento 'loginModal' no encontrado" );
    showNotification( "Error: Modal de login no disponible", "error" );
    return;
  }

  console.log( 'Modal encontrado, mostrando...' );

  // Mostrar modal
  loginModal.classList.remove( "hidden" );

  // ✅ NUEVO: Verificar estado de conexión y actualizar botón
  setTimeout( () => {
    const googleSignInBtn = document.getElementById( 'googleSignInBtn' );
    const isOffline = !navigator.onLine;

    if ( googleSignInBtn ) {
      // Remover listeners anteriores
      const newBtn = googleSignInBtn.cloneNode( true );
      googleSignInBtn.parentNode.replaceChild( newBtn, googleSignInBtn );

      if ( isOffline ) {
        // ❌ OFFLINE: Deshabilitar botón
        newBtn.disabled = true;
        newBtn.classList.add( 'opacity-50', 'cursor-not-allowed' );
        newBtn.classList.remove( 'hover:bg-blue-700' );
        newBtn.title = '🔌 Solo se puede ingresar con conexión a internet';
        newBtn.innerHTML = '<i class="fas fa-wifi-slash mr-2"></i>Sin conexión - Login deshabilitado';

        // Prevenir clicks
        newBtn.addEventListener( 'click', ( e ) => {
          e.preventDefault();
          showNotification( '🔌 Necesitas conexión a internet para iniciar sesión', 'error' );
        } );

        console.log( '🔴 Botón de login DESHABILITADO (offline)' );
      } else {
        // ✅ ONLINE: Habilitar botón
        newBtn.disabled = false;
        newBtn.classList.remove( 'opacity-50', 'cursor-not-allowed' );
        newBtn.classList.add( 'hover:bg-blue-700' );
        newBtn.title = 'Iniciar sesión con Google';
        newBtn.innerHTML = '<i class="fab fa-google mr-2"></i>Iniciar sesión con Google';

        // Agregar evento de login
        newBtn.addEventListener( 'click', signInWithGoogle );

        console.log( '🟢 Botón de login HABILITADO (online)' );
      }
    } else {
      console.error( '❌ Botón googleSignInBtn no encontrado' );
    }
  }, 100 );
}

function closeLoginModal() {
  const loginModal = document.getElementById( "loginModal" );
  if ( loginModal ) {
    loginModal.classList.add( "hidden" );
    console.log( '🚪 Modal de login cerrado' );
  }
}

function loadTasks() {
  try {
    const storedTasks = localStorage.getItem( "tasks" );
    tasks = storedTasks ? JSON.parse( storedTasks ) : {};

    // También cargar los logs
    loadTaskLogs();
  } catch ( error ) {
    tasks = {};
    dailyTaskLogs = {};
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

// Función para formatear duración
function formatDuration( hours ) {
  if ( !hours || hours === 0 ) return '';

  const h = Math.floor( hours );
  const m = Math.round( ( hours - h ) * 60 );

  if ( h === 0 ) return `${m}min`;
  if ( m === 0 ) return `${h}h`;
  return `${h}h ${m}min`;
}

// Función para calcular tiempo transcurrido
// Tiempo consumido en MINUTOS desde el acumulador persistido
// (se congela al pausar; ya no depende de los logs).
function calculateElapsedTime( task, dateStr ) {
  if ( !task.duration || task.state === 'completed' ) return null;

  const elapsedMin = currentElapsedMin( task );

  return {
    elapsed: elapsedMin,
    total: task.duration,
    percentage: task.duration > 0 ? Math.min( ( elapsedMin / task.duration ) * 100, 100 ) : 0,
    remaining: Math.max( task.duration - elapsedMin, 0 )
  };
}

// Función para obtener color según progreso
function getDurationColor( percentage ) {
  if ( percentage < 50 ) return 'bg-green-500';
  if ( percentage < 80 ) return 'bg-yellow-500';
  if ( percentage < 100 ) return 'bg-orange-500';
  return 'bg-red-500';
}

//addTask con sync automático
function addTask( e ) {
  e.preventDefault();

  const formData = {
    title: document.getElementById( "taskTitle" ).value.trim(),
    description: document.getElementById( "taskDescription" ).value.trim(),
    date: document.getElementById( "taskDate" ).value,
    time: document.getElementById( "taskTime" ).value,
    endTime: document.getElementById( "taskEndTime" ).value || null,
    repeat: document.getElementById( "taskRepeat" ).value,
    priority: parseInt( document.getElementById( "taskPriority" ).value ) || 3,
    initialState: "pending",
  };

  if ( !formData.title ) {
    showNotification( "Por favor ingresa un título", "error" );
    return;
  }

  if ( formData.endTime && formData.time && formData.endTime <= formData.time ) {
    showNotification( "La hora de fin debe ser posterior a la de inicio", "error" );
    return;
  }

  if ( formData.date && isDatePast( formData.date ) ) {
    showNotification(
      "No puedes agregar tareas a fechas anteriores. Por favor selecciona hoy o una fecha futura.",
      "error"
    );
    return;
  }

  if ( formData.date === getTodayString() && formData.time && formData.time < nowHM() ) {
    showNotification(
      "La hora de inicio no puede ser anterior a la hora actual",
      "error"
    );
    return;
  }

  const task = {
    id: Date.now().toString(),
    title: formData.title,
    description: formData.description,
    time: formData.time,
    endTime: formData.endTime,
    duration: computeMinutesFromRange( formData.time, formData.endTime ),
    priority: formData.priority,
    state: "pending",
    completed: false,
    lastModified: Date.now()
  };

  // ✅ Variable para rastrear si se creó en el día actual
  let createdToday = false;
  const today = getTodayString();
  // Fecha protagonista para llevar calendario+panel (una sola fecha o inicio)
  let focusDateStr = null;

  if ( formData.date && formData.repeat === "none" ) {
    addTaskToDate( formData.date, task );
    focusDateStr = formData.date;

    // ✅ Verificar si se creó hoy
    if ( formData.date === today ) {
      createdToday = true;
    }

    // Sync solo si hay conexión
    if ( currentUser && isOnline ) {
      enqueueSync( "upsert", formData.date, task );
    }

    addToChangeLog( "created", task.title, formData.date );
  } else if ( formData.repeat !== "none" ) {
    const startDate = formData.date
      ? new Date( formData.date + "T00:00:00" )
      : new Date();

    const createdDates = addRecurringTasks( task, formData.repeat, startDate );
    if ( createdDates.length > 0 ) focusDateStr = createdDates[ 0 ];

    // ✅ Verificar si alguna tarea recurrente es de hoy
    if ( createdDates.includes( today ) ) {
      createdToday = true;
    }
  }

  // Llevar el calendario al mes de la(s) tarea(s) creada(s)
  if ( focusDateStr ) {
    const focus = new Date( focusDateStr + "T12:00:00" );
    currentDate.setDate( 1 );
    currentDate.setFullYear( focus.getFullYear() );
    currentDate.setMonth( focus.getMonth() );
  }

  saveTasks();
  renderCalendar();
  updateProgress();

  // ✅ Resetear formulario
  document.getElementById( "taskForm" ).reset();
  setupDateInput();
  showNotification( "Tarea agregada exitosamente", "success" );

  // Resetear configuración avanzada
  const advancedConfig = document.getElementById( "advancedRepeatConfig" );
  const customDays = document.getElementById( "customDays" );
  const repeatDuration = document.getElementById( "repeatDuration" );

  advancedConfig?.classList.add( "hidden" );
  customDays?.classList.add( "hidden" );
  if ( repeatDuration ) repeatDuration.value = "2";

  const prioritySelect = document.getElementById( "taskPriority" );
  if ( prioritySelect ) prioritySelect.value = "3";

  // ✅ Abrir el panel en la fecha creada para verla de inmediato.
  // Tarea única: siempre. Recurrentes: solo si incluyen hoy (no marear).
  if ( focusDateStr && ( formData.repeat === "none" || createdToday ) ) {
    const focus = new Date( focusDateStr + "T12:00:00" );
    console.log( '📅 Abriendo panel en fecha creada' );
    showDailyTaskPanel( focusDateStr, focus.getDate() );
  } else if ( createdToday ) {
    console.log( '📅 Tarea creada para hoy - actualizando panel' );

    // Si el panel no está abierto, abrirlo
    const panel = document.getElementById( "dailyTaskPanel" );
    if ( panel && panel.classList.contains( 'hidden' ) ) {
      const todayDate = new Date();
      showDailyTaskPanel( today, todayDate.getDate() );
    } else if ( selectedDateForPanel === today ) {
      // Si ya está abierto para hoy, solo actualizarlo
      const todayDate = new Date();
      showDailyTaskPanel( today, todayDate.getDate() );
    }
  }
}

function addTaskToDate( dateStr, task ) {
  if ( !tasks[ dateStr ] ) tasks[ dateStr ] = [];

  const newTask = {
    ...task,
    id: `${dateStr}-${Date.now()}`,
    state: "pending",
    completed: false
  };

  tasks[ dateStr ].push( newTask );

  console.log( `✅ Tarea agregada a ${dateStr}:`, newTask.title );

  // ✅ CRÍTICO: Actualizar panel si está abierto para esta fecha
  if ( selectedDateForPanel === dateStr ) {
    console.log( '🔄 Panel abierto para esta fecha - actualizando...' );
    const day = new Date( dateStr + "T12:00:00" ).getDate();

    // Pequeño delay para que se renderice correctamente
    setTimeout( () => {
      showDailyTaskPanel( dateStr, day );
    }, 100 );
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
  const createdDates = []; // ✅ NUEVO: Array para rastrear fechas

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
      const taskToAdd = {
        ...task,
        state: "pending",
        completed: false
      };
      const newTask = addTaskToDate( dateStr, taskToAdd );
      newTasks.push( { dateStr, task: newTask } );
      createdDates.push( dateStr ); // ✅ NUEVO: Guardar fecha
      tasksAdded++;
    }

    currentDate.setDate( currentDate.getDate() + 1 );
  }

  // Sync automático batch para todas las tareas recurrentes
  if ( currentUser && isOnline ) {
    newTasks.forEach( ( { dateStr, task } ) => {
      enqueueSync( "upsert", dateStr, task );
    } );
  }

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

  return createdDates; // ✅ NUEVO: Retornar fechas creadas
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

  const fullMode = !isFormSidebarOpen;

  for ( let i = 0; i < startingDayOfWeek; i++ ) {
    const emptyDay = document.createElement( "div" );
    emptyDay.className = fullMode
      ? "min-h-32 border border-gray-200"
      : "h-32 border border-gray-200";
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
  // Modo full (sidebar oculta, calendario a pantalla completa): casillas
  // elásticas con todas las tareas y nombres completos.
  // Modo normal: dimensiones originales (h-32, 2 tareas + "+N más").
  const fullMode = !isFormSidebarOpen;

  dayElement.className = fullMode
    ? `min-h-32 border border-gray-200 p-1 cursor-pointer hover:bg-blue-50 transition relative calendar-day group ${isToday ? "bg-blue-100 border-blue-300 ring-2 ring-blue-200" : ""} ${isPastDate ? "opacity-75" : ""}`
    : `h-32 border border-gray-200 p-1 cursor-pointer hover:bg-blue-50 transition relative calendar-day group ${isToday ? "bg-blue-100 border-blue-300 ring-2 ring-blue-200" : ""} ${isPastDate ? "opacity-75" : ""}`;
  dayElement.dataset.date = dateStr;

  const visibleTasks = fullMode ? dayTasks : dayTasks.slice( 0, 2 );

  dayElement.innerHTML = `
    <div class="font-semibold text-sm mb-1 ${isToday ? "text-blue-700" : ""}">${day}</div>
    <div class="space-y-1">
      ${visibleTasks.map( ( task ) => createTaskElement( task, dateStr, fullMode ) ).join( "" )}
      ${!fullMode && dayTasks.length > 2
      ? `<div class="text-xs text-gray-500 cursor-pointer hover:text-blue-600 transition-colors"
             data-action="day-modal" data-date="${dateStr}">
            +${dayTasks.length - 2} más
          </div>`
      : ""}
    </div>
    ${!isPastDate
      ? `<button onclick="event.stopPropagation(); showQuickAddTask('${dateStr}')"
                class="absolute bottom-1 right-1 w-6 h-6 bg-green-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 max-lg:opacity-100 transition-opacity duration-200 hover:bg-green-600 flex items-center justify-center"
                title="Agregar tarea rápida">
            <i class="fas fa-plus"></i>
        </button>`
      : ""}
  `;

  dayElement.addEventListener( "click", ( e ) => {
    if ( !e.target.closest( ".task-item" ) && !e.target.closest( "button" ) && !e.target.closest( "[data-action]" ) ) {
      showDayTasksModal( dateStr );
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

  // Título del panel
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

  // Botón de limpiar día (SIEMPRE visible si hay tareas)
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

  // Botón de registro (SIEMPRE visible)
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
  const isToday = dateStr === getTodayString();

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
        ${!isPastDate ? `<p class="text-sm mt-2">${isToday ? '¡Agrega tu primera tarea de hoy!' : '¡Agrega tu primera tarea!'}</p>` : ""}
      </div>
    `;
  } else {
    const sortedTasks = sortTasksByPriority( dayTasks );
    const overdueCount = dayTasks.filter( ( t ) => isTaskOverdue( dateStr, t ) ).length;
    const overdueBanner = overdueCount > 0 ? `
      <div class="bg-red-500 text-white px-4 py-2 rounded-lg shadow mb-3 text-sm font-semibold flex items-center">
        <i class="fas fa-exclamation-triangle mr-2"></i>
        ${overdueCount} tarea(s) atrasada(s) sin iniciar
      </div>` : '';
    taskList.innerHTML = overdueBanner + sortedTasks
      .map( ( task ) => createPanelTaskElement( task, dateStr ) )
      .join( "" );
  }

  updatePanelProgress( dayTasks );

  const addQuickTaskBtn = document.getElementById( "addQuickTaskBtn" );
  if ( addQuickTaskBtn ) {
    addQuickTaskBtn.style.display = isPastDate ? "none" : "flex";
  }

  panel.classList.remove( "hidden" );
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

  const isLate = checkIfTaskIsLate( dateStr, task.time );
  // Pendientes atrasadas usan el cintillo rojo propio (overdue), no el naranja.
  const showLateWarning = isPastDate && task.state !== 'completed' && task.state !== 'pending';
  const overdue = isTaskOverdue( dateStr, task );

  // Timer display
  let timerDisplay = '';
  if ( task.duration && task.state === 'inProgress' ) {
    const remaining = formatMinutes( Math.max( task.duration - currentElapsedMin( task ), 0 ) );
    timerDisplay = `
            <div id="timer-${task.id}" class="timer-display timer-active text-sm font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                ⏱️ ${remaining} restantes
            </div>
        `;
  } else if ( task.duration ) {
    const hours = Math.floor( task.duration / 60 );
    const minutes = task.duration % 60;
    const display = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    timerDisplay = `
            <div class="text-purple-600 bg-purple-50 px-2 py-1 rounded-full font-medium text-xs">
                <i class="fas fa-clock mr-1"></i>
                Duración: ${display}
            </div>
        `;
  }

  return `
    <div class="panel-task-item bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-4 border-l-4 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 ${showLateWarning ? 'bg-orange-50 dark:bg-orange-900' : ''}"
         style="border-left-color: ${priority.color}"
         data-priority="${task.priority}"
         data-task-id="${task.id}">

        ${showLateWarning ? `
            <div class="bg-orange-100 dark:bg-orange-800 border-l-4 border-orange-500 text-orange-700 dark:text-orange-200 p-2 mb-3 rounded text-xs">
                <i class="fas fa-exclamation-triangle mr-1"></i>
                <strong>Completada con retraso</strong> - Se registrará el retraso
            </div>
        ` : ''}

        ${overdue ? `
            <div class="bg-red-500 text-white p-2 mb-3 rounded text-xs font-semibold flex items-center">
                <i class="fas fa-exclamation-triangle mr-2"></i>
                Atrasada — no iniciada y fuera de hora
            </div>
        ` : ''}

        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="flex items-start gap-2 sm:contents">
                <div class="flex-1 sm:flex-none sm:w-32 sm:flex-shrink-0 space-y-2 min-w-0">
                    <select onchange="changeTaskStateWithTimer('${dateStr}', '${task.id}', this.value)"
                            class="text-xs px-2 py-2 rounded-lg border ${state.class} font-medium cursor-pointer transition-colors duration-200 w-full">
                        <option value="pending" ${task.state === "pending" ? "selected" : ""}>⏸ Pendiente</option>
                        <option value="inProgress" ${task.state === "inProgress" ? "selected" : ""}>▶ En Proceso</option>
                        <option value="paused" ${task.state === "paused" ? "selected" : ""}>⏸ Pausada</option>
                        <option value="completed" ${task.state === "completed" ? "selected" : ""}>✓ Completada</option>
                    </select>
                    ${task.state === "paused" ? `
                        <div class="text-[11px] font-semibold text-orange-600 dark:text-orange-300 flex items-center">
                            <i class="fas fa-pause-circle mr-1"></i>Tarea pausada
                        </div>
                    ` : ""}

                    <div class="flex items-center space-x-2">
                        <span class="task-priority-dot inline-block w-3 h-3 rounded-full shadow-sm flex-shrink-0"
                              style="background-color: ${priority.color}"
                              title="Prioridad: ${priority.label}"></span>
                        <span class="text-xs text-gray-600 dark:text-gray-300 font-medium truncate">${priority.label}</span>
                    </div>
                </div>

                <div class="task-actions flex flex-row sm:flex-col gap-2 sm:order-3 justify-end items-center sm:items-end flex-shrink-0">
                    ${canPause ? `
                        <button onclick="pauseTaskWithTimer('${dateStr}', '${task.id}')"
                                class="flex items-center justify-center space-x-1 bg-orange-100 text-orange-700 p-2 sm:px-3 sm:py-2 rounded-lg hover:bg-orange-200 transition-colors duration-200 text-xs font-medium shadow-sm whitespace-nowrap">
                            <i class="fas fa-pause"></i>
                            <span class="hidden sm:inline">Pausar</span>
                        </button>
                    ` : ""}

                    ${canResume ? `
                        <button onclick="resumeTaskWithTimer('${dateStr}', '${task.id}')"
                                class="flex items-center justify-center space-x-1 bg-blue-100 text-blue-700 p-2 sm:px-3 sm:py-2 rounded-lg hover:bg-blue-200 transition-colors duration-200 text-xs font-medium shadow-sm whitespace-nowrap">
                            <i class="fas fa-play"></i>
                            <span class="hidden sm:inline">Reanudar</span>
                        </button>
                    ` : ""}

                    <button onclick="showAdvancedEditModal('${dateStr}', '${task.id}')"
                            class="text-blue-500 hover:text-blue-700 p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900 transition-colors duration-200">
                        <i class="fas fa-edit text-sm"></i>
                    </button>

                    <button onclick="deleteTaskFromPanel('${dateStr}', '${task.id}')"
                            class="text-red-500 hover:text-red-700 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900 transition-colors duration-200">
                        <i class="fas fa-trash text-sm"></i>
                    </button>
                </div>
            </div>

            <div class="flex-1 min-w-0 sm:order-2">
                <div class="task-title font-semibold text-base mb-1 ${task.state === "completed" ? "line-through text-gray-500" : "text-gray-800 dark:text-gray-200"} break-words">
                    ${task.title}
                </div>
                
                ${task.description
      ? `<div class="task-description text-sm text-gray-600 dark:text-gray-400 mt-1 break-words">${task.description}</div>`
      : '<div class="task-description text-sm text-gray-400 dark:text-gray-500 mt-1 italic">Sin descripción</div>'}
                
                <div class="task-meta flex flex-wrap items-center gap-3 mt-2 text-xs">
                    ${task.time || task.endTime ? `
                        <div class="text-indigo-600 dark:text-indigo-400 flex items-center">
                            <i class="far fa-clock mr-1"></i>
                            ${task.endTime ? `${task.time || ''} – ${task.endTime}` : task.time}
                        </div>
                    ` : ""}
                    ${timerDisplay}
                    <div class="text-gray-500 dark:text-gray-400">${state.label}</div>
                </div>
            </div>
        </div>
    </div>
    `;
}

function changeTaskStateWithTimer( dateStr, taskId, newState ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) return;

  const oldState = task.state || "pending";
  if ( oldState === newState ) return;

  // Manejar tiempo acumulado según estado (antes de persistir)
  if ( newState === 'inProgress' ) {
    markRunning( task );
  } else {
    accumulateElapsed( task );
  }

  // Manejar temporizador según estado
  if ( newState === 'inProgress' && task.duration ) {
    // Iniciar temporizador
    startTaskTimer( taskId, dateStr, task.duration );
  } else {
    // Detener temporizador si cambia a otro estado
    stopTaskTimer( taskId );
  }

  // Llamar a la función original
  changeTaskStateWithLateTracking( dateStr, taskId, newState );
}

// ===== FUNCIONES MODIFICADAS PARA PAUSAR/REANUDAR CON TIMER =====
function pauseTaskWithTimer( dateStr, taskId ) {
  stopTaskTimer( taskId );
  pauseTask( dateStr, taskId );
}

function resumeTaskWithTimer( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( task?.duration ) {
    startTaskTimer( taskId, dateStr, task.duration );
  }
  resumeTask( dateStr, taskId );
}

// Cambio de estado con tracking de retraso
function changeTaskStateWithLateTracking( dateStr, taskId, newState ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) return;

  const oldState = task.state || "pending";
  if ( oldState === newState ) return;

  const isPastDate = isDatePast( dateStr );
  const isLate = checkIfTaskIsLate( dateStr, task.time );

  // Confirmación para tareas retrasadas
  if ( isPastDate && newState === 'completed' && oldState !== 'completed' ) {
    const confirmMsg = "⚠️ Esta tarea está retrasada.\n\n¿Marcar como completada con retraso?\n(Se registrará en el historial)";
    if ( !confirm( confirmMsg ) ) {
      const dropdown = document.querySelector( `select[onchange*="${taskId}"]` );
      if ( dropdown ) dropdown.value = oldState;
      return;
    }

    task.completedLate = true;
    task.completedAt = new Date().toISOString();
  }

  // Confirmación para reversar completadas
  if ( oldState === "completed" && newState !== "completed" ) {
    if ( !confirm( "¿Estás seguro de que quieres cambiar una tarea completada?" ) ) {
      const dropdown = document.querySelector( `select[onchange*="${taskId}"]` );
      if ( dropdown ) dropdown.value = oldState;
      return;
    }

    delete task.completedLate;
    delete task.completedAt;
  }

  // ✅ CRÍTICO: Actualizar con timestamp
  task.state = newState;
  task.completed = ( task.state === "completed" );
  task.lastModified = Date.now(); // ✅ Para sincronización

  // Registrar cambio
  let actionType = "stateChanged";
  let logMessage = task.title;

  if ( task.completedLate && newState === 'completed' ) {
    logMessage = `⚠️ COMPLETADA CON RETRASO - ${task.title}`;
  } else if ( isLate && newState !== "pending" && oldState === "pending" ) {
    logMessage = `⚠️ RETRASADA - ${task.title}`;
  }

  if ( oldState === "inProgress" && newState === "paused" ) {
    actionType = "paused";
  } else if ( oldState === "paused" && newState === "inProgress" ) {
    actionType = "resumed";
  }

  addToChangeLog( actionType, logMessage, dateStr, oldState, newState, taskId );

  // Limpiar notificaciones si se completa
  if ( task.state === "completed" ) {
    clearTaskNotifications( taskId );
  }

  saveTasks();
  renderCalendar();
  updateProgress();

  // ✅ CRÍTICO: Sync inmediato
  enqueueSync( "upsert", dateStr, task );
  setTimeout( () => {
    if ( syncQueue.size > 0 ) {
      processSyncQueue();
    }
  }, 100 );

  // Actualizar panel
  if ( selectedDateForPanel === dateStr ) {
    const day = new Date( dateStr + "T12:00:00" ).getDate();
    showDailyTaskPanel( dateStr, day );
  }

  const stateInfo = TASK_STATES[ task.state ];
  const notifType = task.completedLate ? "warning" : "success";
  showNotification(
    task.completedLate ? `⚠️ Completada con retraso - ${stateInfo.label}` : `Tarea: ${stateInfo.label}`,
    notifType
  );
}

// FUNCIONES PARA PAUSAR Y REANUDAR
function pauseTask( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task || task.state !== "inProgress" ) {
    showNotification( "Solo se pueden pausar tareas en proceso", "error" );
    return;
  }

  const oldState = task.state;
  accumulateElapsed( task ); // congela el tiempo consumido al pausar
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
  markRunning( task ); // reanuda el conteo desde lo acumulado
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
                    <button onclick="closeAllModals()" class="bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition">
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

  if ( !confirm( `¿Eliminar todas las ${dayTasks.length} tareas del ${formattedDate}?` ) ) {
    return;
  }

  console.log( `🗑️ Limpiando día ${dateStr} con ${dayTasks.length} tareas` );

  // CRÍTICO: Encolar TODAS las eliminaciones para Firebase PRIMERO
  if ( currentUser && isOnline ) {
    dayTasks.forEach( ( task ) => {
      // Registrar eliminación
      registerDeletedTask( dateStr, task );

      // Encolar para Firebase
      enqueueSync( "delete", dateStr, { id: task.id } );

      console.log( `📤 Eliminación encolada: ${task.title}` );
    } );

    // Procesar cola inmediatamente
    setTimeout( () => {
      if ( syncQueue.size > 0 ) {
        console.log( '⚡ Procesando eliminaciones inmediatamente' );
        processSyncQueue();
      }
    }, 100 );
  }

  // Eliminar localmente
  delete tasks[ dateStr ];
  delete dailyTaskLogs[ dateStr ];

  saveTasks();
  renderCalendar();
  updateProgress();

  // Actualizar panel
  if ( selectedDateForPanel === dateStr ) {
    updatePanelDateHeader( dateStr, date.getDate(), [] );
    updatePanelProgress( [] );

    const taskList = document.getElementById( "panelTaskList" );
    if ( taskList ) {
      taskList.innerHTML = `
        <div class="text-center py-8 text-gray-500">
          <i class="fas fa-calendar-check text-4xl mb-3 opacity-50"></i>
          <p>No hay tareas para este día</p>
          <p class="text-sm mt-2 text-green-600">✅ Día limpiado correctamente</p>
        </div>
      `;
    }
  }

  showNotification(
    `✅ ${dayTasks.length} tareas eliminadas del ${formattedDate}`,
    "success"
  );
}

function createTaskElement( task, dateStr, fullName = false ) {
  const priority = PRIORITY_LEVELS[ task.priority ] || PRIORITY_LEVELS[ 3 ];
  const state = TASK_STATES[ task.state ] || TASK_STATES.pending;
  const overdue = isTaskOverdue( dateStr, task );

  // En la casilla solo la cantidad de tiempo programada (sin inicio/fin)
  const minutes = task.endTime
    ? computeMinutesFromRange( task.time, task.endTime )
    : ( task.duration || null );

  let amountBadge = '';
  if ( minutes ) {
    amountBadge = `<span class="text-xs ml-1 bg-gray-300 text-gray-700 px-1 rounded">⏱️${formatMinutes( minutes )}</span>`;
  } else if ( task.time ) {
    amountBadge = `<span class="text-xs opacity-75 ml-1">${task.time}</span>`;
  }

  const pillClass = overdue ? 'bg-red-500 text-white' : state.class;
  const overdueLabel = overdue ? ' · atrasada' : '';
  const timeRange = task.endTime ? `${task.time || ''}–${task.endTime}` : ( task.time || '' );

  return `
    <div class="task-item-wrapper relative group/task">
      <div class="text-xs p-1 rounded ${pillClass} task-item cursor-move border-l-4 ${fullName ? "break-words whitespace-normal" : "truncate"}"
           data-task-id="${task.id}"
           data-date="${dateStr}"
           draggable="true"
           style="border-left-color: ${priority.color}"
           title="${task.title}${timeRange ? " - " + timeRange : ""} | ${state.label}${overdueLabel} | ${priority.label}${minutes ? ' | Duración: ' + formatMinutes( minutes ) : ''}">
        <i class="fas ${overdue ? 'fa-exclamation-triangle' : state.icon} mr-1 opacity-75"></i>
        ${task.title}${overdue ? `<span class="font-bold"> · atrasada</span>` : ""}
        ${amountBadge}
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

// Generar fingerprint de tareas locales
function generateTaskFingerprint( tasks ) {
  try {
    // Crear un string único que represente el estado actual
    const taskIds = [];

    Object.keys( tasks ).sort().forEach( dateStr => {
      const dayTasks = tasks[ dateStr ] || [];
      dayTasks.forEach( task => {
        taskIds.push( `${dateStr}:${task.id}` );
      } );
    } );

    return taskIds.join( '|' );
  } catch ( error ) {
    console.error( 'Error generando fingerprint:', error );
    return '';
  }
}

// Resetear el listener cuando se hace login
function resetListenerState() {
  window.initialSnapshotProcessed = false;
  console.log( '🔄 Estado del listener reseteado' );
}

//Sincronización bidireccional mejorada
async function syncFromFirebaseBidirectional() {
  if ( !currentUser || !isOnline || syncInProgress ) {
    console.log( '⚠️ Sync bidireccional cancelado' );
    return;
  }

  if ( window.syncBidirectionalInProgress ) {
    console.log( '⏳ Sync bidireccional ya en progreso' );
    return;
  }

  window.syncBidirectionalInProgress = true;
  syncInProgress = true;
  updateSyncIndicator( "syncing" );

  try {
    console.log( '🔄 Iniciando sync bidireccional ANTI-DUPLICADOS v2...' );

    const userTasksRef = db
      .collection( "users" )
      .doc( currentUser.uid )
      .collection( "tasks" );

    const snapshot = await userTasksRef.get();

    const remoteTasks = {};
    const remoteTaskMap = new Map(); // ID -> task
    const remoteTaskKeys = new Set(); // date:title:time

    if ( !snapshot.empty ) {
      snapshot.forEach( ( doc ) => {
        const task = doc.data();
        const dateStr = task.date;
        const uniqueKey = `${dateStr}:${task.title}:${task.time}`;

        if ( !remoteTasks[ dateStr ] ) {
          remoteTasks[ dateStr ] = [];
        }

        const taskData = {
          id: task.id,
          title: task.title,
          description: task.description || "",
          time: task.time || "",
          completed: task.completed || false,
          state: task.state || ( task.completed ? "completed" : "pending" ),
          priority: task.priority || 3,
          lastModified: task.lastModified?.toMillis() || Date.now()
        };

        remoteTasks[ dateStr ].push( taskData );
        remoteTaskMap.set( task.id, taskData );
        remoteTaskKeys.add( uniqueKey );
      } );
    }

    let tasksAdded = 0;
    let tasksUpdated = 0;
    let tasksDeleted = 0;

    // PASO 1: Subir tareas locales que NO están en remoto
    const uploadBatch = db.batch();
    let uploadCount = 0;

    for ( const [ dateStr, dayTasks ] of Object.entries( tasks ) ) {
      for ( const task of dayTasks ) {
        const uniqueKey = `${dateStr}:${task.title}:${task.time}`;

        // Solo subir si NO existe en remoto (por contenido)
        if ( !remoteTaskKeys.has( uniqueKey ) ) {
          const taskDocId = `${dateStr}_${task.id}`;
          const taskRef = userTasksRef.doc( taskDocId );

          uploadBatch.set( taskRef, {
            ...task,
            date: dateStr,
            lastModified: new Date(),
            syncVersion: Date.now()
          }, { merge: false } );

          uploadCount++;
          console.log( `📤 Subiendo: ${task.title}` );
        }
      }
    }

    if ( uploadCount > 0 ) {
      await uploadBatch.commit();
      tasksAdded = uploadCount;
      console.log( `✅ ${uploadCount} tareas subidas` );
    }

    // PASO 2: Descargar tareas remotas que NO están localmente
    Object.keys( remoteTasks ).forEach( ( dateStr ) => {
      if ( !tasks[ dateStr ] ) {
        tasks[ dateStr ] = [];
      }

      remoteTasks[ dateStr ].forEach( ( remoteTask ) => {
        // VERIFICACIÓN CUÁDRUPLE ANTI-DUPLICADOS

        // 1. Verificar si fue eliminada previamente
        if ( wasTaskDeleted( dateStr, remoteTask ) ) {
          console.log( `🚫 Tarea eliminada previamente: ${remoteTask.title}` );
          return;
        }

        // 2. Verificar por ID exacto
        const existsById = tasks[ dateStr ].some( t => t.id === remoteTask.id );

        // 3. Verificar por contenido (título + hora)
        const existsByContent = tasks[ dateStr ].some( t =>
          t.title === remoteTask.title && t.time === remoteTask.time
        );

        // 4. Verificar por similitud temporal (mismo título y hora cercana - 5 segundos)
        const existsBySimilarity = tasks[ dateStr ].some( t => {
          if ( t.title !== remoteTask.title ) return false;

          const localTimestamp = parseInt( t.id.split( '-' ).pop() ) || 0;
          const remoteTimestamp = parseInt( remoteTask.id.split( '-' ).pop() ) || 0;

          return Math.abs( localTimestamp - remoteTimestamp ) < 5000;
        } );

        if ( !existsById && !existsByContent && !existsBySimilarity ) {
          tasks[ dateStr ].push( remoteTask );
          tasksUpdated++;
          console.log( `📥 Nueva tarea descargada: ${remoteTask.title}` );
        } else {
          console.log( `⏭️ Tarea duplicada ignorada: ${remoteTask.title}` );
        }
      } );
    } );

    // PASO 3: Eliminar tareas locales que NO existen en remoto
    Object.keys( tasks ).forEach( ( dateStr ) => {
      if ( !tasks[ dateStr ] ) return;

      const initialLength = tasks[ dateStr ].length;
      const tasksToRemove = [];

      tasks[ dateStr ].forEach( ( task, index ) => {
        const uniqueKey = `${dateStr}:${task.title}:${task.time}`;
        const existsInRemote = remoteTaskKeys.has( uniqueKey ) || remoteTaskMap.has( task.id );

        if ( !existsInRemote && !wasTaskDeleted( dateStr, task ) ) {
          console.log( `🔍 Eliminación detectada: ${task.title}` );
          tasksToRemove.push( index );

          registerDeletedTask( dateStr, task );
          clearTaskNotifications( task.id );
          addToChangeLog( "deleted", task.title, dateStr, null, null, task.id );
        }
      } );

      // Eliminar en orden inverso
      if ( tasksToRemove.length > 0 ) {
        tasksToRemove.reverse().forEach( index => {
          const removedTask = tasks[ dateStr ][ index ];
          console.log( `🗑️ Eliminando: ${removedTask.title}` );
          tasks[ dateStr ].splice( index, 1 );
          tasksDeleted++;
        } );

        if ( tasks[ dateStr ].length === 0 ) {
          delete tasks[ dateStr ];
        }
      }
    } );

    // PASO 4: Guardar y actualizar UI
    if ( tasksAdded > 0 || tasksUpdated > 0 || tasksDeleted > 0 ) {
      saveTasks();
      renderCalendar();
      updateProgress();

      if ( selectedDateForPanel && tasksDeleted > 0 ) {
        const panelDate = new Date( selectedDateForPanel + 'T12:00:00' );
        showDailyTaskPanel( selectedDateForPanel, panelDate.getDate() );
      }

      const message = [];
      if ( tasksAdded > 0 ) message.push( `${tasksAdded} subidas` );
      if ( tasksUpdated > 0 ) message.push( `${tasksUpdated} descargadas` );
      if ( tasksDeleted > 0 ) message.push( `${tasksDeleted} eliminadas` );

      showNotification( `Sincronización: ${message.join( ', ' )}`, "success" );
    } else {
      console.log( '✅ Todo sincronizado - sin cambios' );
    }

    lastFullSyncTime = Date.now();
    updateSyncIndicator( "success" );

  } catch ( error ) {
    console.error( "❌ Error en sync bidireccional:", error );
    updateSyncIndicator( "error" );
    showNotification( "Error al sincronizar: " + error.message, "error" );
  } finally {
    syncInProgress = false;
    window.syncBidirectionalInProgress = false;
  }
}

// Verificar si una tarea fue eliminada recientemente
function checkIfRecentlyDeleted( dateStr, taskId ) {
  try {
    // Verificar en el log de cambios si fue eliminada en los últimos 5 minutos
    const dayLogs = dailyTaskLogs[ dateStr ] || [];
    const fiveMinutesAgo = Date.now() - ( 5 * 60 * 1000 );

    return dayLogs.some( log =>
      log.taskId === taskId &&
      log.action === 'deleted' &&
      new Date( log.timestamp ).getTime() > fiveMinutesAgo
    );
  } catch ( error ) {
    return false;
  }
}

//deleteTaskFromPanel con sync automático
function deleteTaskFromPanel( dateStr, taskId ) {
  deleteTaskWithOptions( dateStr, taskId );
}

function deleteTaskWithOptions( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) {
    showNotification( "Tarea no encontrada", "error" );
    return;
  }

  // Buscar tareas similares (repetidas)
  const similarTasks = findSimilarTasksForDelete( task.title, task.time );

  if ( similarTasks.count > 1 ) {
    // Es tarea repetida → Mostrar opciones
    showBulkDeleteModal( dateStr, taskId, task, similarTasks );
  } else {
    // Tarea única → Confirmación simple
    confirmSingleDelete( dateStr, taskId, task );
  }
}

/* Buscar tareas idénticas para eliminación*/
function findSimilarTasksForDelete( title, time ) {
  let matchCount = 0;
  const dates = [];

  Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
    dayTasks.forEach( task => {
      if ( task.title === title && task.time === time ) {
        matchCount++;
        dates.push( date );
      }
    } );
  } );

  return { count: matchCount, dates };
}

/*Confirmación de eliminación simple*/
function confirmSingleDelete( dateStr, taskId, task ) {
  if ( confirm( `¿Eliminar la tarea "${task.title}"?\n\nEsta acción no se puede deshacer.` ) ) {
    executeSingleDelete( dateStr, taskId, task );
  }
}

/*Ejecutar eliminación de una sola tarea*/
function executeSingleDelete( dateStr, taskId, task ) {
  console.log( `🗑️ Eliminando tarea: ${task.title}` );

  // 1. PRIMERO: Registrar eliminación (para evitar re-sync)
  registerDeletedTask( dateStr, task );

  // 2. Encolar para Firebase ANTES de eliminar localmente
  if ( currentUser && isOnline ) {
    enqueueSync( "delete", dateStr, { id: taskId } );
  }

  // 3. Registrar en log
  addToChangeLog( "deleted", task.title, dateStr, null, null, taskId );

  // 4. Eliminar localmente
  tasks[ dateStr ] = tasks[ dateStr ].filter( t => t.id !== taskId );
  if ( tasks[ dateStr ].length === 0 ) {
    delete tasks[ dateStr ];
  }

  // 5. Guardar y actualizar UI
  saveTasks();
  renderCalendar();
  updateProgress();

  // 6. Actualizar panel
  if ( selectedDateForPanel === dateStr ) {
    const day = new Date( dateStr + "T12:00:00" ).getDate();
    showDailyTaskPanel( dateStr, day );
  }

  showNotification( "Tarea eliminada exitosamente", "success" );

  // 7. CRÍTICO: Procesar cola inmediatamente
  if ( currentUser && isOnline ) {
    setTimeout( () => {
      processSyncQueue();
    }, 100 );
  }
}

// MODAL DE ELIMINACIÓN MASIVA
function showBulkDeleteModal( dateStr, taskId, task, similarTasks ) {
  closeAllModals();

  const modal = document.createElement( "div" );
  modal.id = "bulkDeleteModal";
  modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold text-gray-800">
          <i class="fas fa-trash-alt text-red-500 mr-2"></i>Eliminar Tarea Recurrente
        </h3>
        <button onclick="closeAllModals()" class="text-gray-500 hover:text-gray-700 transition">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Información de la tarea -->
      <div class="bg-red-50 border-l-4 border-red-400 p-4 rounded-lg mb-4">
        <div class="flex items-start">
          <i class="fas fa-exclamation-triangle text-red-600 mt-1 mr-3 flex-shrink-0"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-red-800">
              <strong>Tarea:</strong> ${task.title}
            </p>
            ${task.time ? `<p class="text-xs text-red-600 mt-1">Hora: ${task.time}</p>` : ''}
            <p class="text-xs text-red-600 mt-2">
              Esta tarea se repite en <strong>${similarTasks.count} días</strong>.
              Selecciona cómo deseas eliminarla:
            </p>
          </div>
        </div>
      </div>

      <!-- Opciones de eliminación -->
      <div class="space-y-3 mb-6">
        <!-- Opción 1: Solo esta tarea -->
        <button onclick="deleteSingleTaskFromBulk('${dateStr}', '${taskId}')"
                class="w-full bg-blue-100 hover:bg-blue-200 text-blue-800 p-4 rounded-lg transition text-left group">
          <div class="flex items-center">
            <div class="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center mr-3 flex-shrink-0 group-hover:scale-110 transition-transform">
              <i class="fas fa-calendar-day text-lg"></i>
            </div>
            <div class="flex-1">
              <div class="font-semibold">Eliminar solo esta tarea</div>
              <div class="text-xs opacity-75 mt-1">
                Solo en ${new Date( dateStr + 'T12:00:00' ).toLocaleDateString( 'es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  } )}
              </div>
            </div>
            <i class="fas fa-chevron-right text-blue-400 ml-2"></i>
          </div>
        </button>

        <!-- Opción 2: Todas las ocurrencias -->
        <button onclick="showBulkDeleteConfirmation('${dateStr}', '${taskId}', 'all')"
                class="w-full bg-red-100 hover:bg-red-200 text-red-800 p-4 rounded-lg transition text-left group">
          <div class="flex items-center">
            <div class="w-10 h-10 bg-red-500 text-white rounded-full flex items-center justify-center mr-3 flex-shrink-0 group-hover:scale-110 transition-transform">
              <i class="fas fa-calendar-alt text-lg"></i>
            </div>
            <div class="flex-1">
              <div class="font-semibold">Eliminar en todos los días</div>
              <div class="text-xs opacity-75 mt-1">
                Buscar y eliminar todas las ${similarTasks.count} ocurrencias
              </div>
            </div>
            <i class="fas fa-chevron-right text-red-400 ml-2"></i>
          </div>
        </button>

        <!-- Opción 3: Días personalizados -->
        <button onclick="showCustomDatesDeleteSelector('${dateStr}', '${taskId}')"
                class="w-full bg-orange-100 hover:bg-orange-200 text-orange-800 p-4 rounded-lg transition text-left group">
          <div class="flex items-center">
            <div class="w-10 h-10 bg-orange-500 text-white rounded-full flex items-center justify-center mr-3 flex-shrink-0 group-hover:scale-110 transition-transform">
              <i class="fas fa-calendar-check text-lg"></i>
            </div>
            <div class="flex-1">
              <div class="font-semibold">Eliminar en días personalizados</div>
              <div class="text-xs opacity-75 mt-1">
                Selecciona fechas específicas para eliminar
              </div>
            </div>
            <i class="fas fa-chevron-right text-orange-400 ml-2"></i>
          </div>
        </button>
      </div>

      <!-- Botón cancelar -->
      <button onclick="closeAllModals()"
              class="w-full bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 py-3 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition font-medium">
        <i class="fas fa-times mr-2"></i>Cancelar
      </button>
    </div>
  `;

  document.body.appendChild( modal );
}

// OPCIÓN 1: ELIMINAR SOLO UNA TAREA
function deleteSingleTaskFromBulk( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) return;

  closeAllModals();

  if ( confirm( `¿Confirmas eliminar esta tarea solo del día seleccionado?\n\n"${task.title}"\n\nEsta acción no se puede deshacer.` ) ) {
    executeSingleDelete( dateStr, taskId, task );
  }
}

// OPCIÓN 2: ELIMINAR TODAS LAS OCURRENCIAS
function showBulkDeleteConfirmation( dateStr, taskId, mode ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) return;

  closeAllModals();

  // Buscar todas las fechas con esta tarea
  const similarTasks = findSimilarTasksForDelete( task.title, task.time );

  const modal = document.createElement( "div" );
  modal.id = "bulkDeleteConfirmModal";
  modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
      <div class="text-center mb-6">
        <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-exclamation-triangle text-red-600 text-3xl"></i>
        </div>
        <h3 class="text-xl font-bold text-gray-800 mb-2">
          Confirmar Eliminación Masiva
        </h3>
        <p class="text-gray-600 text-sm">
          Estás a punto de eliminar <strong>${similarTasks.count} tareas</strong> en ${similarTasks.count} días diferentes.
        </p>
      </div>

      <div class="bg-gray-50 rounded-lg p-4 mb-6">
        <div class="text-sm text-gray-700">
          <p class="font-semibold mb-2">Tarea a eliminar:</p>
          <p class="text-gray-800 font-medium">"${task.title}"</p>
          ${task.time ? `<p class="text-gray-600 text-xs mt-1">Hora: ${task.time}</p>` : ''}
        </div>

        <div class="mt-4 text-xs text-gray-500">
          <p class="font-semibold mb-1">Primeras fechas afectadas:</p>
          <ul class="list-disc list-inside space-y-1">
            ${similarTasks.dates.slice( 0, 5 ).map( date => {
    const dateObj = new Date( date + 'T12:00:00' );
    return `<li>${dateObj.toLocaleDateString( 'es-ES', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    } )}</li>`;
  } ).join( '' )}
            ${similarTasks.count > 5 ? `<li class="font-semibold">... y ${similarTasks.count - 5} más</li>` : ''}
          </ul>
        </div>
      </div>

      <div class="bg-red-50 border-l-4 border-red-400 p-3 mb-6 text-sm text-red-700">
        <i class="fas fa-exclamation-circle mr-2"></i>
        <strong>Esta acción no se puede deshacer.</strong> Todas las tareas idénticas serán eliminadas permanentemente.
      </div>

      <div class="flex space-x-3">
        <button onclick="executeBulkDelete('${dateStr}', '${taskId}', 'all')"
                class="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 transition font-medium">
          <i class="fas fa-trash-alt mr-2"></i>Sí, Eliminar Todo
        </button>
        <button onclick="closeAllModals()"
                class="flex-1 bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 py-3 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition font-medium">
          Cancelar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild( modal );
}

// OPCIÓN 3: SELECTOR DE DÍAS PERSONALIZADOS
function showCustomDatesDeleteSelector( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) return;

  closeAllModals();

  // Encontrar todas las fechas con esta tarea
  const matchingDates = [];
  Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
    if ( dayTasks.some( t => t.title === task.title && t.time === task.time ) ) {
      matchingDates.push( date );
    }
  } );

  const modal = document.createElement( "div" );
  modal.id = "customDatesDeleteModal";
  modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold text-gray-800">
          <i class="fas fa-calendar-check text-orange-500 mr-2"></i>Seleccionar Fechas para Eliminar
        </h3>
        <button onclick="closeAllModals()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="bg-orange-50 border-l-4 border-orange-400 p-3 mb-4 text-sm text-orange-800">
        <p class="font-medium">Tarea: <strong>"${task.title}"</strong></p>
        <p class="text-xs mt-1">Selecciona los días donde deseas eliminar esta tarea</p>
      </div>

      <div class="mb-4">
        <label class="flex items-center space-x-2 bg-blue-50 p-3 rounded cursor-pointer hover:bg-blue-100 transition">
          <input type="checkbox" id="selectAllDeleteDates" onchange="toggleAllDeleteDates(this)" class="rounded">
          <span class="text-sm font-medium">
            <i class="fas fa-check-double mr-2 text-blue-600"></i>
            Seleccionar todas (${matchingDates.length} fechas)
          </span>
        </label>
      </div>

      <div id="deleteDatesGrid" class="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-80 overflow-y-auto mb-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
        ${matchingDates.map( date => {
    const dateObj = new Date( date + 'T12:00:00' );
    const formattedDate = dateObj.toLocaleDateString( 'es-ES', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    } );
    const isToday = date === getTodayString();
    return `
            <label class="flex items-center space-x-2 bg-white p-3 rounded-lg hover:bg-gray-100 cursor-pointer border border-gray-200 transition ${isToday ? 'ring-2 ring-blue-400' : ''}">
              <input type="checkbox" value="${date}" class="custom-delete-date-checkbox rounded" checked>
              <span class="text-sm flex-1">
                ${formattedDate}
                ${isToday ? '<span class="text-xs text-blue-600 font-semibold ml-1">(Hoy)</span>' : ''}
              </span>
            </label>
          `;
  } ).join( '' )}
      </div>

      <div class="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4 text-sm text-yellow-800">
        <i class="fas fa-info-circle mr-2"></i>
        <span id="selectedDeleteCount">${matchingDates.length} fechas seleccionadas</span>
      </div>

      <div class="flex space-x-3">
        <button onclick="proceedWithCustomDelete('${dateStr}', '${taskId}')"
                class="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 transition font-medium">
          <i class="fas fa-trash-alt mr-2"></i>Eliminar Seleccionadas
        </button>
        <button onclick="closeAllModals()"
                class="flex-1 bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 py-3 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition font-medium">
          Cancelar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild( modal );

  // Event listener para actualizar contador
  document.querySelectorAll( '.custom-delete-date-checkbox' ).forEach( checkbox => {
    checkbox.addEventListener( 'change', updateDeleteCounter );
  } );
}

function toggleAllDeleteDates( checkbox ) {
  const checkboxes = document.querySelectorAll( '.custom-delete-date-checkbox' );
  checkboxes.forEach( cb => cb.checked = checkbox.checked );
  updateDeleteCounter();
}

function updateDeleteCounter() {
  const selected = document.querySelectorAll( '.custom-delete-date-checkbox:checked' ).length;
  const counter = document.getElementById( 'selectedDeleteCount' );
  if ( counter ) {
    counter.textContent = `${selected} fecha${selected !== 1 ? 's' : ''} seleccionada${selected !== 1 ? 's' : ''}`;
  }
}

function proceedWithCustomDelete( dateStr, taskId ) {
  const selectedDates = Array.from( document.querySelectorAll( '.custom-delete-date-checkbox:checked' ) )
    .map( cb => cb.value );

  if ( selectedDates.length === 0 ) {
    showNotification( "Selecciona al menos una fecha", "error" );
    return;
  }

  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) return;

  closeAllModals();

  // Confirmación final
  const confirmMsg = `¿Eliminar "${task.title}" en ${selectedDates.length} día${selectedDates.length > 1 ? 's' : ''}?\n\nEsta acción no se puede deshacer.`;
  if ( !confirm( confirmMsg ) ) {
    return;
  }

  // Guardar fechas seleccionadas y ejecutar
  window.selectedCustomDeleteDates = selectedDates;
  executeBulkDelete( dateStr, taskId, 'custom' );
}

// EJECUCIÓN DE ELIMINACIÓN MASIVA
function executeBulkDelete( dateStr, taskId, mode ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) {
    showNotification( "Tarea no encontrada", "error" );
    return;
  }

  let targetDates = [];
  const originalTitle = task.title;
  const originalTime = task.time;

  // Determinar fechas según modo
  if ( mode === 'custom' && window.selectedCustomDeleteDates ) {
    targetDates = window.selectedCustomDeleteDates;
  } else {
    // Modo 'all': buscar todas las fechas con tareas idénticas
    Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
      if ( dayTasks.some( t => t.title === originalTitle && t.time === originalTime ) ) {
        targetDates.push( date );
      }
    } );
  }

  if ( targetDates.length === 0 ) {
    showNotification( "No se encontraron tareas para eliminar", "error" );
    return;
  }

  let deletedCount = 0;

  // Eliminar tareas en las fechas seleccionadas
  targetDates.forEach( date => {
    if ( !tasks[ date ] ) return;

    const tasksToDelete = [];

    tasks[ date ].forEach( ( t, index ) => {
      if ( t.title === originalTitle && t.time === originalTime ) {
        tasksToDelete.push( { task: t, index } );
      }
    } );

    // Eliminar en orden inverso para no afectar índices
    tasksToDelete.reverse().forEach( ( { task: t, index } ) => {
      // Sync con Firebase
      if ( currentUser && isOnline ) {
        enqueueSync( "delete", date, { id: t.id } );
      }

      // Registrar eliminación
      addToChangeLog( "deleted", t.title, date, null, null, t.id );

      // Limpiar notificaciones
      clearTaskNotifications( t.id );

      // Eliminar localmente
      tasks[ date ].splice( index, 1 );
      deletedCount++;
    } );

    // Limpiar día si quedó vacío
    if ( tasks[ date ].length === 0 ) {
      delete tasks[ date ];
    }
  } );

  // Limpiar fechas personalizadas guardadas
  delete window.selectedCustomDeleteDates;

  // Procesar sync
  if ( currentUser && isOnline ) {
    setTimeout( () => {
      if ( syncQueue.size > 0 ) {
        processSyncQueue();
      }
    }, 100 );
  }

  saveTasks();
  renderCalendar();
  updateProgress();

  closeAllModals();
  showNotification(
    ` ${deletedCount} tarea${deletedCount > 1 ? 's' : ''} eliminada${deletedCount > 1 ? 's' : ''} en ${targetDates.length} día${targetDates.length > 1 ? 's' : ''}`,
    "success"
  );

  // Actualizar panel si está abierto
  if ( selectedDateForPanel && targetDates.includes( selectedDateForPanel ) ) {
    const day = new Date( selectedDateForPanel + "T12:00:00" ).getDate();
    showDailyTaskPanel( selectedDateForPanel, day );
  }
}

// Edicion avanzada de tareas
function showAdvancedEditModal( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( ( t ) => t.id === taskId );
  if ( !task ) {
    showNotification( "Tarea no encontrada", "error" );
    return;
  }

  // Cerrar cualquier modal existente
  closeAllModals();

  //  NUEVO: Buscar si hay tareas repetidas (mismo título y hora)
  const similarTasks = findSimilarTasks( task.title, task.time );
  const hasRecurring = similarTasks.count > 1;

  const modal = document.createElement( "div" );
  modal.id = "advancedEditModal";
  modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

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

      <!--  NUEVO: Botón de edición masiva (solo si hay tareas recurrentes) -->
      ${hasRecurring ? `
        <div class="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
          <div class="flex items-center text-sm text-purple-700 mb-2">
            <i class="fas fa-info-circle mr-2"></i>
            <span>Esta tarea se repite en <strong>${similarTasks.count} días</strong></span>
          </div>
          <button onclick="showBulkEditModal('${dateStr}', '${taskId}')"
                  class="w-full bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 transition duration-200 flex items-center justify-center">
            <i class="fas fa-layer-group mr-2"></i>
            Editar en Múltiples Días
          </button>
        </div>
      ` : ''}

      <!-- Formulario de edición individual -->
      <form id="advancedEditTaskForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Título <span class="text-red-500">*</span>
          </label>
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
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Hora de inicio <span class="text-red-500">*</span>
            </label>
            <input type="time" id="advancedEditTaskTime" value="${task.time || ""}" required
                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Hora de fin <span class="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input type="time" id="advancedEditTaskEndTime" value="${task.endTime || ""}"
                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Prioridad <span class="text-red-500">*</span>
          </label>
          <select id="advancedEditTaskPriority" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <option value="" disabled>Selecciona una prioridad</option>
            <option value="1" ${task.priority === 1 ? "selected" : ""}>🔴 Muy Importante</option>
            <option value="2" ${task.priority === 2 ? "selected" : ""}>🟠 Importante</option>
            <option value="3" ${task.priority === 3 ? "selected" : ""}>🔵 Moderado</option>
            <option value="4" ${task.priority === 4 ? "selected" : ""}>⚫ No Prioritario</option>
          </select>
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
            <i class="fas fa-save mr-2"></i>Guardar Solo Esta Tarea
          </button>
          <button type="button" onclick="closeAllModals()"
                  class="flex-1 bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 py-2 px-4 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild( modal );

  // La hora de fin solo admite valores posteriores a la de inicio
  wireTimeRangeValidation( "advancedEditTaskTime", "advancedEditTaskEndTime" );
  wireStartTimeValidation( { fixedDate: dateStr, startId: "advancedEditTaskTime", endId: "advancedEditTaskEndTime" } );

  // Event listener para el formulario
  document.getElementById( "advancedEditTaskForm" ).addEventListener( "submit", ( e ) => {
    e.preventDefault();
    updateAdvancedTaskFromPanelImproved( dateStr, taskId );
  } );
}

function canMoveTask( task ) {
  return task.priority > 2;
}

// FUNCIÓN AUXILIAR: Verificar si una tarea está retrasada
function checkIfTaskIsLate( dateStr, taskTime ) {
  if ( !taskTime ) return false;

  const now = new Date();
  const todayStr = getTodayString();

  // Si es día pasado, está retrasada
  if ( isDatePast( dateStr ) ) return true;

  // Si es hoy, verificar hora
  if ( dateStr === todayStr ) {
    const [ taskHours, taskMinutes ] = taskTime.split( ':' ).map( Number );
    const taskTimeInMinutes = taskHours * 60 + taskMinutes;
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();

    return currentTimeInMinutes > taskTimeInMinutes;
  }

  return false;
}

// ¿Tarea NO iniciada (pendiente) y fuera de hora? Incluye días pasados y hoy tardío.
function isTaskOverdue( dateStr, task ) {
  if ( !task || !task.time || task.state !== 'pending' ) return false;

  if ( isDatePast( dateStr ) ) return true;

  if ( dateStr === getTodayString() ) {
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const [ h, m ] = task.time.split( ':' ).map( Number );
    return current > ( h * 60 + m );
  }

  return false;
}

// Minutos → "45m" / "1h 30m" (la duración usa minutos en este proyecto)
function formatMinutes( minutes ) {
  if ( !minutes || minutes <= 0 ) return '';
  const h = Math.floor( minutes / 60 );
  const m = Math.round( minutes % 60 );
  if ( h === 0 ) return `${m}m`;
  if ( m === 0 ) return `${h}h`;
  return `${h}h ${m}m`;
}

// Al ingresar a la plataforma: avisa UNA vez por sesión si hay atrasadas hoy.
let entryOverdueNotified = false;
function notifyOverdueOnEntry() {
  if ( entryOverdueNotified ) return;
  entryOverdueNotified = true;

  const today = getTodayString();
  const overdue = ( tasks[ today ] || [] ).filter( ( t ) => isTaskOverdue( today, t ) );
  if ( overdue.length === 0 ) return;

  const msg = overdue.length === 1
    ? `Tarea atrasada: "${overdue[ 0 ].title}"`
    : `Tienes ${overdue.length} tareas atrasadas sin iniciar`;

  showInAppNotification( '⚠️ Tareas atrasadas', msg, 'warning' );
  alertTask( 'task-late' );

  if ( notificationsEnabled && 'Notification' in window && Notification.permission === 'granted' ) {
    showDesktopNotificationPWA( '⚠️ Tareas atrasadas', msg, `overdue-entry-${today}`, false, 'task-late' );
  }
}

// FUNCIÓN para actualizar tareas desde el panel
function updateAdvancedTaskFromPanelImproved( dateStr, taskId ) {
  const title = document.getElementById( "advancedEditTaskTitle" ).value.trim();
  const description = document
    .getElementById( "advancedEditTaskDescription" )
    .value.trim();
  const time = document.getElementById( "advancedEditTaskTime" ).value;
  const endTime = document.getElementById( "advancedEditTaskEndTime" ).value || null;
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

  if ( endTime && endTime <= time ) {
    showNotification( "La hora de fin debe ser posterior a la de inicio", "error" );
    return;
  }

  if ( dateStr === getTodayString() && time < nowHM() ) {
    showNotification( "La hora de inicio no puede ser anterior a la hora actual", "error" );
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
    endTime: endTime,
    duration: computeMinutesFromRange( time, endTime ),
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
                    <label class="block text-sm font-medium text-gray-700 mb-2">Hora de inicio <span class="text-red-500">*</span></label>
                    <input type="time" id="quickEditTime" value="${task.time || ""}" required
                           class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Hora de fin <span class="text-gray-400 font-normal">(opcional)</span></label>
                    <input type="time" id="quickEditEndTime" value="${task.endTime || ""}"
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
                            class="flex-1 bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 py-2 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition">
                        Cancelar
                    </button>
                </div>
            </form>
        </div>
    `;

  document.body.appendChild( modal );

  // La hora de fin solo admite valores posteriores a la de inicio
  wireTimeRangeValidation( "quickEditTime", "quickEditEndTime" );
  wireStartTimeValidation( { fixedDate: dateStr, startId: "quickEditTime", endId: "quickEditEndTime" } );

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
  const newEndTime = document.getElementById( "quickEditEndTime" ).value || null;
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

  if ( dateStr === getTodayString() && newTime < nowHM() ) {
    showNotification( "La hora de inicio no puede ser anterior a la hora actual", "error" );
    return;
  }

  if ( newEndTime && newEndTime <= newTime ) {
    showNotification( "La hora de fin debe ser posterior a la de inicio", "error" );
    return;
  }

  // Actualizar la tarea
  task.title = newTitle;
  task.description = newDescription;
  task.time = newTime;
  task.endTime = newEndTime;
  task.duration = computeMinutesFromRange( newTime, newEndTime );
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

// ===== FORMULARIO LATERAL COLAPSABLE + FAB + MODAL DE DÍA =====
let isFormSidebarOpen = true;

function toggleTaskForm( forceOpen ) {
  const wantOpen = typeof forceOpen === 'boolean' ? forceOpen : !isFormSidebarOpen;
  const formColumn = document.getElementById( 'formColumn' );
  const calendarColumn = document.getElementById( 'calendarColumn' );
  const toggleIcon = document.getElementById( 'formToggleIcon' );
  const toggleBtn = document.getElementById( 'formToggleBtn' );
  const showFormBtn = document.getElementById( 'showFormBtn' );
  const fab = document.getElementById( 'fabAddTask' );

  isFormSidebarOpen = wantOpen;

  if ( wantOpen ) {
    formColumn?.classList.remove( 'hidden' );
    calendarColumn?.classList.remove( 'lg:col-span-3' );
    calendarColumn?.classList.add( 'lg:col-span-2' );
    if ( toggleIcon ) toggleIcon.className = 'fas fa-chevron-up text-sm';
    toggleBtn?.setAttribute( 'title', 'Ocultar formulario' );
    showFormBtn?.classList.add( 'hidden' );
    if ( fab ) { fab.classList.add( 'hidden' ); fab.classList.remove( 'flex' ); }
    renderCalendar();
  } else {
    formColumn?.classList.add( 'hidden' );
    calendarColumn?.classList.remove( 'lg:col-span-2' );
    calendarColumn?.classList.add( 'lg:col-span-3' );
    if ( toggleIcon ) toggleIcon.className = 'fas fa-chevron-down text-sm';
    toggleBtn?.setAttribute( 'title', 'Crear tarea' );
    showFormBtn?.classList.remove( 'hidden' );
    if ( fab ) { fab.classList.remove( 'hidden' ); fab.classList.add( 'flex' ); }
    renderCalendar();
  }
}

// Abre el modal de creación (usado por el FAB en todos los dispositivos)
function openCreateTaskModal() {
  const base = selectedDateForPanel || getTodayString();
  showQuickAddTask( isDatePast( base ) ? getTodayString() : base );
}

// Modal centrado con todas las tareas del día. Al pulsar una tarea,
// cierra el modal y lleva con scroll suave hasta ella en el panel inferior.
function showDayTasksModal( dateStr ) {
  closeAllModals();

  const dayTasks = sortTasksByPriority( [ ...( tasks[ dateStr ] || [] ) ] );
  const date = new Date( dateStr + 'T12:00:00' );
  const label = date.toLocaleDateString( 'es-ES', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  } );

  const modal = document.createElement( 'div' );
  modal.id = 'dayTasksModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[85vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold text-gray-800">
          <i class="fas fa-calendar-day text-teal-600 mr-2"></i>${label}
        </h3>
        <button data-action="close-modals" class="text-gray-500 hover:text-gray-700 transition">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="space-y-2">
        ${dayTasks.length === 0 ? `
          <div class="text-center py-6 text-gray-500">
            <i class="fas fa-calendar-plus text-3xl mb-2 opacity-50"></i>
            <p>No hay tareas para este día</p>
          </div>` : dayTasks.map( ( task ) => {
            const priority = PRIORITY_LEVELS[ task.priority ] || PRIORITY_LEVELS[ 3 ];
            const state = TASK_STATES[ task.state ] || TASK_STATES.pending;
            const range = task.endTime ? `${task.time || ''} – ${task.endTime}` : ( task.time || 'Sin hora' );
            return `
              <div class="w-full bg-gray-50 hover:bg-blue-50 rounded-lg p-2 border-l-4 transition flex items-center gap-1"
                   style="border-left-color: ${priority.color}">
                <button data-action="goto-task" data-date="${dateStr}" data-id="${task.id}"
                        class="flex-1 min-w-0 text-left flex items-center gap-3 p-1"
                        title="Ver en el panel inferior">
                  <i class="fas ${state.icon} text-gray-500 flex-shrink-0"></i>
                  <span class="flex-1 min-w-0">
                    <span class="block font-medium text-sm text-gray-800 break-words">${task.title}</span>
                    <span class="block text-xs text-gray-500">${range} · ${state.label}</span>
                  </span>
                  <i class="fas fa-chevron-down text-gray-400 flex-shrink-0"></i>
                </button>
                <button data-action="edit-task" data-date="${dateStr}" data-id="${task.id}"
                        class="text-blue-500 hover:text-blue-700 p-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition flex-shrink-0"
                        title="Editar tarea">
                  <i class="fas fa-edit text-sm"></i>
                </button>
                <button data-action="delete-task" data-date="${dateStr}" data-id="${task.id}"
                        class="text-red-500 hover:text-red-700 p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900 transition flex-shrink-0"
                        title="Eliminar tarea">
                  <i class="fas fa-trash text-sm"></i>
                </button>
              </div>`;
          } ).join( '' )}
      </div>
      <button data-action="quick-add" data-date="${dateStr}"
              class="mt-4 w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition">
        <i class="fas fa-plus mr-2"></i>Agregar tarea este día
      </button>
    </div>
  `;

  modal.addEventListener( 'click', ( e ) => {
    if ( e.target === modal ) closeAllModals();
  } );

  document.body.appendChild( modal );
}

// ===== MODAL TRIPLE DE LIMPIEZA (semana / mes / días específicos) =====
function showClearOptionsModal() {
  closeAllModals();

  const modal = document.createElement( 'div' );
  modal.id = 'clearOptionsModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold text-gray-800">
          <i class="fas fa-trash-alt text-orange-500 mr-2"></i>Limpiar tareas
        </h3>
        <button data-action="close-modals" class="text-gray-500 hover:text-gray-700 transition">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="space-y-2">
        <button data-action="clear-week"
                class="w-full bg-orange-500 text-white py-2.5 px-4 rounded-lg hover:bg-orange-600 transition text-sm font-medium">
          <i class="fas fa-calendar-week mr-2"></i>Limpiar toda la semana
        </button>
        <button data-action="clear-month"
                class="w-full bg-red-500 text-white py-2.5 px-4 rounded-lg hover:bg-red-600 transition text-sm font-medium">
          <i class="fas fa-calendar-alt mr-2"></i>Limpiar todo el mes
        </button>
        <button data-action="clear-specific"
                class="w-full bg-purple-500 text-white py-2.5 px-4 rounded-lg hover:bg-purple-600 transition text-sm font-medium">
          <i class="fas fa-calendar-check mr-2"></i>Limpiar días específicos…
        </button>
      </div>
    </div>
  `;

  modal.addEventListener( 'click', ( e ) => {
    if ( e.target === modal ) closeAllModals();
  } );

  document.body.appendChild( modal );
}

function showClearSpecificDaysModal() {
  closeAllModals();

  const dates = Object.keys( tasks )
    .filter( ( d ) => tasks[ d ] && tasks[ d ].length > 0 )
    .sort();

  const modal = document.createElement( 'div' );
  modal.id = 'clearSpecificDaysModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[85vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold text-gray-800">
          <i class="fas fa-calendar-check text-purple-500 mr-2"></i>Días específicos
        </h3>
        <button data-action="close-modals" class="text-gray-500 hover:text-gray-700 transition">
          <i class="fas fa-times"></i>
        </button>
      </div>
      ${dates.length === 0 ? `
        <p class="text-center text-gray-500 py-6">No hay días con tareas para limpiar.</p>
      ` : `
        <div class="space-y-2 mb-4">
          ${dates.map( ( d ) => `
            <label class="flex items-center gap-3 bg-gray-50 p-2.5 rounded-lg border cursor-pointer hover:bg-gray-100 transition">
              <input type="checkbox" value="${d}" class="clear-day-checkbox rounded text-purple-600 w-4 h-4">
              <span class="flex-1 text-sm text-gray-800">${new Date( d + 'T12:00:00' ).toLocaleDateString( 'es-ES', { weekday: 'short', day: 'numeric', month: 'short' } )}</span>
              <span class="text-xs text-gray-500">${tasks[ d ].length} tarea(s)</span>
            </label>` ).join( '' )}
        </div>
        <button data-action="confirm-clear-specific"
                class="w-full bg-red-500 text-white py-2.5 px-4 rounded-lg hover:bg-red-600 transition text-sm font-medium">
          <i class="fas fa-trash-alt mr-2"></i>Eliminar días seleccionados
        </button>
      `}
    </div>
  `;

  modal.addEventListener( 'click', ( e ) => {
    if ( e.target === modal ) closeAllModals();
  } );

  document.body.appendChild( modal );
}

function confirmClearSpecificDays() {
  const selected = Array.from( document.querySelectorAll( '.clear-day-checkbox:checked' ) )
    .map( ( cb ) => cb.value );

  if ( selected.length === 0 ) {
    showNotification( 'Selecciona al menos un día', 'info' );
    return;
  }

  closeAllModals();
  clearSpecificDates( selected );
}

function clearSpecificDates( dateList ) {
  const deletedTasks = [];

  dateList.forEach( ( dateStr ) => {
    if ( !tasks[ dateStr ] ) return;
    tasks[ dateStr ].forEach( ( task ) => {
      deletedTasks.push( { dateStr, taskId: task.id } );
      clearTaskNotifications( task.id );
    } );
    delete tasks[ dateStr ];
  } );

  deletedTasks.forEach( ( { dateStr, taskId } ) => {
    enqueueSync( 'delete', dateStr, { id: taskId } );
  } );

  saveTasks();
  renderCalendar();
  updateProgress();
  showNotification( `${dateList.length} día(s) limpiados`, 'success' );

  if ( selectedDateForPanel && dateList.includes( selectedDateForPanel ) ) {
    updatePanelProgress( [] );
    closeDailyTaskPanel();
  }
}

// ===== SELECTOR RÁPIDO DE MES / AÑO =====
let pickerYear = null;
const PICKER_MONTHS = [ 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre' ];

function showMonthYearPicker() {
  closeAllModals();
  pickerYear = currentDate.getFullYear();

  const modal = document.createElement( 'div' );
  modal.id = 'monthYearPickerModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-xs w-full p-5">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-semibold text-gray-800">
          <i class="fas fa-calendar-alt text-teal-600 mr-2"></i>Ir a…
        </h3>
        <button data-action="close-modals" class="text-gray-500 hover:text-gray-700 transition">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="flex items-center justify-between mb-3">
        <button data-action="picker-year-prev" class="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 transition flex items-center justify-center" title="Año anterior">
          <i class="fas fa-chevron-left text-sm"></i>
        </button>
        <span id="pickerYear" class="text-xl font-bold text-gray-800"></span>
        <button data-action="picker-year-next" class="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 transition flex items-center justify-center" title="Año siguiente">
          <i class="fas fa-chevron-right text-sm"></i>
        </button>
      </div>
      <div id="pickerMonthGrid" class="grid grid-cols-3 gap-2 mb-4"></div>
      <button data-action="picker-today" class="w-full bg-teal-500 text-white py-2 px-4 rounded-lg hover:bg-teal-600 transition text-sm font-medium">
        <i class="fas fa-calendar-day mr-2"></i>Volver a hoy
      </button>
    </div>
  `;

  modal.addEventListener( 'click', ( e ) => {
    if ( e.target === modal ) closeAllModals();
  } );

  document.body.appendChild( modal );
  renderPickerMonths();
}

function renderPickerMonths() {
  const grid = document.getElementById( 'pickerMonthGrid' );
  const yearEl = document.getElementById( 'pickerYear' );
  if ( !grid || !yearEl || pickerYear === null ) return;

  yearEl.textContent = pickerYear;
  const isCurrentYear = pickerYear === currentDate.getFullYear();

  grid.innerHTML = PICKER_MONTHS.map( ( name, i ) => {
    const active = isCurrentYear && i === currentDate.getMonth();
    return `
      <button data-action="pick-month" data-month="${i}"
              class="py-2 px-1 rounded-lg text-sm font-medium transition ${active
                ? 'bg-blue-600 text-white shadow'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-100 dark:hover:bg-gray-600'}">
        ${name.slice( 0, 3 )}
      </button>`;
  } ).join( '' );
}

function shiftPickerYear( delta ) {
  if ( pickerYear === null ) return;
  pickerYear += delta;
  renderPickerMonths();
}

function pickMonthYear( month ) {
  // Fijar día 1 antes de cambiar mes/año para evitar desbordes (ej. 31 → feb).
  currentDate.setDate( 1 );
  currentDate.setFullYear( pickerYear );
  currentDate.setMonth( month );
  closeAllModals();
  renderCalendar();
  updateProgress();
}

function pickerGoToday() {
  const today = new Date();
  currentDate.setDate( 1 );
  currentDate.setFullYear( today.getFullYear() );
  currentDate.setMonth( today.getMonth() );
  closeAllModals();
  renderCalendar();
  updateProgress();
  const todayStr = getTodayString();
  showDailyTaskPanel( todayStr, today.getDate() );
}

function quickDeleteTask( dateStr, taskId ) {
  deleteTaskWithOptions( dateStr, taskId );
}

function setupRealtimeSync() {
  if ( !auth.currentUser || firestoreListener ) return;

  const userId = auth.currentUser.uid;
  const userTasksRef = db.collection( 'users' ).doc( userId ).collection( 'tasks' );

  console.log( '🔄 Iniciando sincronización en tiempo real (completa)...' );

  firestoreListener = userTasksRef.onSnapshot(
    ( snapshot ) => {
      console.log( '📡 Cambios detectados en Firestore' );

      snapshot.docChanges().forEach( ( change ) => {
        const taskData = change.doc.data();
        const docId = change.doc.id;
        const [ dateStr, taskId ] = docId.split( '_' );

        if ( change.type === 'added' || change.type === 'modified' ) {
          // Actualizar tarea local
          if ( !tasks[ dateStr ] ) {
            tasks[ dateStr ] = [];
          }

          const existingIndex = tasks[ dateStr ].findIndex( t => t.id === taskId );

          if ( existingIndex !== -1 ) {
            // Actualizar tarea existente
            const oldTask = tasks[ dateStr ][ existingIndex ];

            tasks[ dateStr ][ existingIndex ] = {
              ...taskData,
              date: dateStr,
              lastModified: taskData.lastModified?.toMillis() || Date.now()
            };

            // Registrar cambio si el estado cambió
            if ( oldTask.state !== taskData.state ) {
              console.log( `🔄 Estado actualizado en tiempo real: ${taskData.title} (${oldTask.state} → ${taskData.state})` );
            }
          } else {
            // Agregar nueva tarea
            tasks[ dateStr ].push( {
              ...taskData,
              date: dateStr,
              lastModified: taskData.lastModified?.toMillis() || Date.now()
            } );
            console.log( `➕ Nueva tarea detectada: ${taskData.title}` );
          }
        }

        if ( change.type === 'removed' ) {
          console.log( `🗑️ Eliminación detectada: ${dateStr}` );

          if ( tasks[ dateStr ] ) {
            tasks[ dateStr ] = tasks[ dateStr ].filter( t => t.id !== taskId );

            if ( tasks[ dateStr ].length === 0 ) {
              delete tasks[ dateStr ];
            }
          }
        }
      } );

      // Guardar y actualizar UI
      saveTasks();
      renderCalendar();
      updateProgress();

      // Actualizar panel si está visible
      if ( selectedDateForPanel && tasks[ selectedDateForPanel ] ) {
        const day = new Date( selectedDateForPanel + 'T12:00:00' ).getDate();
        showDailyTaskPanel( selectedDateForPanel, day );
      }
    },
    ( error ) => {
      console.error( '❌ Error en sincronización en tiempo real:', error );
    }
  );

  // También escuchar cambios en logs
  const userLogsRef = db.collection( 'users' ).doc( userId ).collection( 'taskLogs' );

  userLogsRef.onSnapshot( ( snapshot ) => {
    snapshot.docChanges().forEach( ( change ) => {
      if ( change.type === 'added' || change.type === 'modified' ) {
        const data = change.doc.data();
        const dateStr = data.date;
        const remoteLogs = data.logs || [];

        if ( remoteLogs.length > 0 ) {
          const localLogs = dailyTaskLogs[ dateStr ] || [];
          const localTimestamps = new Set( localLogs.map( l => l.timestamp ) );

          const newLogs = remoteLogs.filter( log => !localTimestamps.has( log.timestamp ) );

          if ( newLogs.length > 0 ) {
            dailyTaskLogs[ dateStr ] = [ ...localLogs, ...newLogs ]
              .sort( ( a, b ) => new Date( b.timestamp ) - new Date( a.timestamp ) )
              .slice( 0, 50 );

            saveTaskLogs();
            console.log( `📥 Logs actualizados en tiempo real para ${dateStr}` );
          }
        }
      }
    } );
  } );
}

// Animación de tarea añadida
function animateTaskAddition( dateStr, taskId, taskTitle ) {
  showInAppNotification(
    'Nueva tarea',
    `"${taskTitle}" añadida en otro dispositivo`,
    'success'
  );

  setTimeout( () => {
    const dayElement = document.querySelector( `[data-date="${dateStr}"]` );
    if ( dayElement ) {
      dayElement.classList.add( 'animate-pulse', 'bg-green-50' );
      setTimeout( () => {
        dayElement.classList.remove( 'animate-pulse', 'bg-green-50' );
      }, 2000 );
    }
  }, 100 );
}

// Animación visual de eliminación en tiempo real
function animateTaskDeletion( dateStr, taskId, taskTitle ) {
  // Buscar el elemento en el calendario
  const calendarTaskElement = document.querySelector(
    `.task-item[data-task-id="${taskId}"][data-date="${dateStr}"]`
  );

  if ( calendarTaskElement ) {
    // Animación de desaparición
    calendarTaskElement.style.transition = 'all 0.5s ease-out';
    calendarTaskElement.style.opacity = '0';
    calendarTaskElement.style.transform = 'scale(0.8) translateX(-20px)';
    calendarTaskElement.style.backgroundColor = '#fee';

    setTimeout( () => {
      calendarTaskElement.remove();
    }, 500 );
  }

  // Buscar el elemento en el panel (si está abierto)
  if ( selectedDateForPanel === dateStr ) {
    const panelTaskElement = document.querySelector(
      `.panel-task-item[data-task-id="${taskId}"]`
    );

    if ( panelTaskElement ) {
      // Efecto visual antes de eliminar
      panelTaskElement.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
      panelTaskElement.style.opacity = '0';
      panelTaskElement.style.transform = 'translateX(-100%)';
      panelTaskElement.style.backgroundColor = '#fee2e2';
      panelTaskElement.style.borderLeftColor = '#ef4444';

      // Agregar efecto de "flash" rojo
      panelTaskElement.classList.add( 'animate-pulse' );

      setTimeout( () => {
        panelTaskElement.remove();

        // Actualizar contador de progreso después de eliminar
        const remainingTasks = tasks[ dateStr ] || [];
        updatePanelProgress( remainingTasks );

        // Si no quedan tareas, mostrar mensaje vacío
        if ( remainingTasks.length === 0 ) {
          const taskList = document.getElementById( 'panelTaskList' );
          if ( taskList ) {
            taskList.innerHTML = `
              <div class="text-center py-8 text-gray-500 animate-fade-in">
                <i class="fas fa-calendar-check text-4xl mb-3 opacity-50"></i>
                <p>No quedan tareas para este día</p>
                <p class="text-sm mt-2 text-gray-400">
                  <i class="fas fa-sync-alt mr-1"></i>
                  Sincronizado en tiempo real
                </p>
              </div>
            `;
          }
        }
      }, 600 );
    }
  }

  console.log( `🎬 Animación de eliminación ejecutada: ${taskTitle}` );
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
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Fecha <span class="text-red-500">*</span></label>
                    <input type="date" id="quickAddTaskDate" value="${dateStr}" required
                           class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Hora de inicio <span class="text-red-500">*</span></label>
                        <input type="time" id="quickAddTaskTime" required
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Hora de fin <span class="text-gray-400 font-normal">(opcional)</span></label>
                        <input type="time" id="quickAddTaskEndTime"
                               class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    </div>
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
                <div class="flex space-x-3 pt-4 border-t">
                    <button type="submit" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition">
                        <i class="fas fa-save mr-2"></i>Agregar Tarea
                    </button>
                    <button type="button" onclick="closeAllModals()"
                            class="flex-1 bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 py-2 px-4 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition">
                        Cancelar
                    </button>
                </div>
            </form>
        </div>
    `;

  document.body.appendChild( modal );

  // Establecer hora actual por defecto
  const now = new Date();
  document.getElementById( "quickAddTaskTime" ).value = now
    .toTimeString()
    .slice( 0, 5 );

  // La hora de fin solo admite valores posteriores a la de inicio
  wireTimeRangeValidation( "quickAddTaskTime", "quickAddTaskEndTime" );
  // La hora de inicio no admite valores anteriores a ahora si es hoy
  wireStartTimeValidation( { dateId: "quickAddTaskDate", startId: "quickAddTaskTime", endId: "quickAddTaskEndTime" } );

  // Event listener para el formulario
  // Dentro de showQuickAddTask(), modificar el event listener:

  document.getElementById( "quickAddTaskForm" ).addEventListener( "submit", ( e ) => {
    e.preventDefault();
    const title = document.getElementById( "quickAddTaskTitle" ).value.trim();
    const description = document.getElementById( "quickAddTaskDescription" ).value.trim();
    const targetDate = document.getElementById( "quickAddTaskDate" ).value || dateStr;
    const time = document.getElementById( "quickAddTaskTime" ).value;
    const endTime = document.getElementById( "quickAddTaskEndTime" ).value || null;
    const priority = parseInt( document.getElementById( "quickAddTaskPriority" ).value );

    if ( !title || !targetDate || !time || !priority ) {
      showNotification( "Por favor completa todos los campos obligatorios", "error" );
      return;
    }

    if ( isDatePast( targetDate ) ) {
      showNotification( "No puedes agregar tareas a fechas anteriores", "error" );
      return;
    }

    if ( targetDate === getTodayString() && time < nowHM() ) {
      showNotification( "La hora de inicio no puede ser anterior a la hora actual", "error" );
      return;
    }

    if ( endTime && endTime <= time ) {
      showNotification( "La hora de fin debe ser posterior a la de inicio", "error" );
      return;
    }

    const task = {
      id: `${targetDate}-${Date.now()}`,
      title,
      description,
      time,
      endTime,
      duration: computeMinutesFromRange( time, endTime ),
      priority,
      state: "pending",
      completed: false,
    };

    addTaskToDate( targetDate, task );
    saveTasks();
    updateProgress();

    // Sync solo si hay conexión
    if ( currentUser && isOnline ) {
      enqueueSync( "upsert", targetDate, task );
    }

    closeAllModals();
    showNotification( "Tarea agregada exitosamente", "success" );

    // Llevar el calendario al mes de la tarea y abrir su panel para
    // verla de inmediato (sin recargar ni buscar el mes a mano).
    const target = new Date( targetDate + "T12:00:00" );
    currentDate.setDate( 1 );
    currentDate.setFullYear( target.getFullYear() );
    currentDate.setMonth( target.getMonth() );
    renderCalendar();
    showDailyTaskPanel( targetDate, target.getDate() );
  } );
}

// FUNCIÓN para cerrar todos los modales
function closeAllModals() {
  const modals = [
    "advancedEditModal",
    "quickEditModal",
    "quickAddTaskModal",
    "editTaskModal",
    "taskModal",
    "dayTasksModal",
    "clearOptionsModal",
    "clearSpecificDaysModal",
    "monthYearPickerModal",
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
        ${task.time || task.endTime ? `<div class="text-blue-300"><i class="far fa-clock mr-1"></i>${task.time || '—'}${task.endTime ? ` – ${task.endTime}` : ''}</div>` : ""}
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

    //RESTRICCIÓN: Verificar si la tarea puede moverse
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

// función handleDragStart para mostrar indicador visual de restricción
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

//sync automático
function deleteTaskWithUndoImproved( dateStr, taskId ) {
  const dayTasks = tasks[ dateStr ];
  const taskIndex = dayTasks?.findIndex( ( t ) => t.id === taskId );

  if ( taskIndex !== -1 ) {
    const task = dayTasks[ taskIndex ];
    lastDeletedTask = { ...task };
    lastDeletedDate = dateStr;

    // CRÍTICO: Sync ANTES de eliminar localmente (sin cambios)
    if ( currentUser && isOnline ) {
      enqueueSync( "delete", dateStr, { id: taskId } );

      // Procesar inmediatamente (sin cambios)
      setTimeout( () => {
        if ( syncQueue.size > 0 ) {
          processSyncQueue();
        }
      }, 100 );
    }

    // Registrar eliminación con ID (sin cambios)
    addToChangeLog( "deleted", task.title, dateStr, null, null, taskId );

    // NUEVO: Limpiar notificaciones pendientes para esta tarea específica
    clearTaskNotifications( taskId );

    // Eliminar localmente (sin cambios)
    tasks[ dateStr ] = tasks[ dateStr ].filter( ( t ) => t.id !== taskId );
    if ( tasks[ dateStr ].length === 0 ) {
      delete tasks[ dateStr ];
    }

    saveTasks();
    saveTaskLogs(); // Guardar logs actualizados
    renderCalendar();
    updateProgress();
    showUndoNotification();
  }
}

function saveTaskLogs() {
  try {
    // Solo guardar en localStorage, NO sincronizar logs con Firebase
    localStorage.setItem( "dailyTaskLogs", JSON.stringify( dailyTaskLogs ) );
    console.log( '📝 Logs guardados localmente (NO sincronizados)' );
  } catch ( error ) {
    console.error( "Error saving task logs:", error );
  }
}

// Sincronizar logs de cambios
async function syncTaskLogs() {
  if ( !currentUser || !db || !isOnline ) {
    console.log( '⚠️ No se puede sincronizar logs' );
    return;
  }

  try {
    const userLogsRef = db
      .collection( "users" )
      .doc( currentUser.uid )
      .collection( "taskLogs" );

    // 1. SUBIR logs locales que no están en remoto
    const localLogPromises = [];

    Object.entries( dailyTaskLogs ).forEach( ( [ dateStr, logs ] ) => {
      if ( logs && logs.length > 0 ) {
        // Usar el dateStr como ID del documento
        localLogPromises.push(
          userLogsRef.doc( dateStr ).set( {
            date: dateStr,
            logs: logs,
            lastUpdated: new Date()
          }, { merge: true } )
        );
      }
    } );

    if ( localLogPromises.length > 0 ) {
      await Promise.all( localLogPromises );
      console.log( `📤 ${localLogPromises.length} días de logs subidos` );
    }

    // 2. DESCARGAR logs remotos
    const logsSnapshot = await userLogsRef.get();
    let logsDownloaded = 0;

    if ( !logsSnapshot.empty ) {
      logsSnapshot.forEach( ( doc ) => {
        const data = doc.data();
        const dateStr = data.date;
        const remoteLogs = data.logs || [];

        if ( remoteLogs.length > 0 ) {
          // Mergear logs (evitar duplicados por timestamp)
          const localLogs = dailyTaskLogs[ dateStr ] || [];
          const localTimestamps = new Set( localLogs.map( l => l.timestamp ) );

          const newLogs = remoteLogs.filter( log => !localTimestamps.has( log.timestamp ) );

          if ( newLogs.length > 0 ) {
            dailyTaskLogs[ dateStr ] = [ ...localLogs, ...newLogs ]
              .sort( ( a, b ) => new Date( b.timestamp ) - new Date( a.timestamp ) )
              .slice( 0, 50 ); // Mantener solo los últimos 50

            logsDownloaded += newLogs.length;
          }
        }
      } );

      if ( logsDownloaded > 0 ) {
        saveTaskLogs();
        console.log( `📥 ${logsDownloaded} logs descargados` );
      }
    }

  } catch ( error ) {
    console.error( '❌ Error sincronizando logs:', error );
  }
}

function loadTaskLogs() {
  try {
    const storedLogs = localStorage.getItem( "dailyTaskLogs" );
    dailyTaskLogs = storedLogs ? JSON.parse( storedLogs ) : {};
  } catch ( error ) {
    dailyTaskLogs = {};
    console.warn( "Error loading task logs from localStorage:", error );
  }
}

function showUndoNotification() {
  const notification = document.createElement( "div" );
  notification.className =
    "fixed bottom-4 left-4 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg z-[100] flex items-center space-x-3";
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
function clearWeek( skipConfirm = false ) {
  if (
    !skipConfirm &&
    !confirm(
      "¿Estás seguro de que quieres limpiar todas las tareas de esta semana?"
    )
  )
    return;

  const today = new Date();
  const startOfWeek = new Date( today );
  startOfWeek.setDate( today.getDate() - today.getDay() );
  const endOfWeek = new Date( startOfWeek );
  endOfWeek.setDate( startOfWeek.getDate() + 6 );

  const deletedTasks = []; // NUEVO: Para recopilar taskIds y limpiar notificaciones

  for ( let i = 0; i < 7; i++ ) {
    const date = new Date( startOfWeek );
    date.setDate( startOfWeek.getDate() + i );
    const dateStr = date.toISOString().split( "T" )[ 0 ];

    if ( tasks[ dateStr ] ) {
      // Guardar tareas para sync y notificaciones
      tasks[ dateStr ].forEach( ( task ) => {
        deletedTasks.push( { dateStr, taskId: task.id } );
        clearTaskNotifications( task.id ); // Limpiar notificaciones pendientes para esta tarea
      } );
      delete tasks[ dateStr ];
    }
  }

  // Auto-sync batch delete (sin cambios)
  deletedTasks.forEach( ( { dateStr, taskId } ) => {
    enqueueSync( "delete", dateStr, { id: taskId } );
  } );

  saveTasks();
  renderCalendar();
  updateProgress();
  showNotification( "Semana limpiada exitosamente" );

  // NUEVO: Verificar si el panel está abierto y afectado, actualizar y cerrar
  if ( selectedDateForPanel ) {
    const panelDate = new Date( selectedDateForPanel + "T00:00:00" );
    if ( panelDate >= startOfWeek && panelDate <= endOfWeek ) {
      // Actualizar panel a vacío (opcional, pero para consistencia)
      const taskList = document.getElementById( "panelTaskList" );
      if ( taskList ) {
        taskList.innerHTML = `
          <div class="text-center py-8 text-gray-500">
            <i class="fas fa-calendar-plus text-4xl mb-3 opacity-50"></i>
            <p>No hay tareas para este día</p>
            <p class="text-sm mt-2">¡Todas las tareas de la semana fueron eliminadas!</p>
          </div>
        `;
      }
      updatePanelProgress( [] );
      closeDailyTaskPanel(); // Cerrar panel
    }
  }
}

//clearMonth con sync automático optimizado
function clearMonth( skipConfirm = false ) {
  if (
    !skipConfirm &&
    !confirm(
      "¿Estás seguro de que quieres limpiar todas las tareas de este mes?"
    )
  )
    return;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const deletedTasks = []; // NUEVO: Para recopilar taskIds y limpiar notificaciones

  Object.keys( tasks ).forEach( ( dateStr ) => {
    const date = new Date( dateStr + "T12:00:00" );
    if ( date.getFullYear() === year && date.getMonth() === month ) {
      // Guardar tareas para sync y notificaciones
      tasks[ dateStr ].forEach( ( task ) => {
        deletedTasks.push( { dateStr, taskId: task.id } );
        clearTaskNotifications( task.id ); // NUEVO: Limpiar notificaciones pendientes para esta tarea
      } );
      delete tasks[ dateStr ];
    }
  } );

  // Auto-sync batch delete (sin cambios)
  deletedTasks.forEach( ( { dateStr, taskId } ) => {
    enqueueSync( "delete", dateStr, { id: taskId } );
  } );

  saveTasks();
  renderCalendar();
  updateProgress();
  showNotification( "Mes limpiado exitosamente" );

  // NUEVO: Verificar si el panel está abierto y afectado (mismo mes/año), actualizar y cerrar
  if ( selectedDateForPanel ) {
    const panelDate = new Date( selectedDateForPanel + "T12:00:00" );
    if ( panelDate.getFullYear() === year && panelDate.getMonth() === month ) {
      // Actualizar panel a vacío (opcional)
      const taskList = document.getElementById( "panelTaskList" );
      if ( taskList ) {
        taskList.innerHTML = `
          <div class="text-center py-8 text-gray-500">
            <i class="fas fa-calendar-plus text-4xl mb-3 opacity-50"></i>
            <p>No hay tareas para este día</p>
            <p class="text-sm mt-2">¡Todas las tareas del mes fueron eliminadas!</p>
          </div>
        `;
      }
      updatePanelProgress( [] );
      closeDailyTaskPanel(); // Cerrar panel
    }
  }
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

  // Verificar si hay tareas en el calendario
  const hasTasks = Object.keys( tasks ).some( date => tasks[ date ] && tasks[ date ].length > 0 );

  if ( !hasTasks ) {
    showNotification( "No hay tareas para exportar", "info" );
    return;
  }

  const wb = XLSX.utils.book_new();
  const data = [ [ "Fecha", "Título", "Descripción", "Hora de inicio", "Hora de fin", "Estado", "Prioridad" ] ];

  Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
    dayTasks.forEach( task => {
      const priority = PRIORITY_LEVELS[ task.priority ] || PRIORITY_LEVELS[ 3 ];
      const state = TASK_STATES[ task.state ] || TASK_STATES.pending;
      data.push( [
        date,
        task.title,
        task.description || "",
        task.time || "",
        task.endTime || "",
        state.label,
        priority.label
      ] );
    } );
  } );

  const ws = XLSX.utils.aoa_to_sheet( data );
  XLSX.utils.book_append_sheet( wb, ws, "Tareas" );
  XLSX.writeFile( wb, `tareas_${getTodayString()}.xlsx` );

  showNotification( "Excel exportado exitosamente", "success" );
}

function toggleNotifications() {
  if ( !( 'Notification' in window ) ) {
    showNotification( "Este navegador no soporta notificaciones", "error" );
    return;
  }

  if ( Notification.permission === "granted" ) {
    notificationsEnabled = !notificationsEnabled;

    // CRÍTICO: Guardar preferencia inmediatamente
    savePermissions();

    updateNotificationButton();

    if ( notificationsEnabled ) {
      if ( 'vibrate' in navigator ) {
        navigator.vibrate( getVibrationPattern( 'success' ) );
      }
      showNotification( "Notificaciones activadas", "success" );
    } else {
      showNotification( "Notificaciones desactivadas", "info" );
    }
  } else if ( Notification.permission === "default" ) {
    requestNotificationPermissionWithVibration();
  } else {
    showNotification(
      "Los permisos fueron denegados. Actívalos en configuración del navegador.",
      "error"
    );
  }
}

function requestNotificationPermissionWithVibration() {
  if ( !( 'Notification' in window ) ) {
    showNotification( "Este navegador no soporta notificaciones", "error" );
    return Promise.resolve( "denied" );
  }

  if ( 'vibrate' in navigator ) {
    navigator.vibrate( [ 100, 50, 100 ] );
  }

  return Notification.requestPermission().then( permission => {
    notificationsEnabled = ( permission === "granted" );

    // CRÍTICO: Guardar inmediatamente después de obtener permisos
    savePermissions();

    updateNotificationButton();

    if ( permission === "granted" ) {

      if ( 'vibrate' in navigator ) {
        navigator.vibrate( getVibrationPattern( 'success' ) );
      }

      showNotification( "Notificaciones activadas correctamente", "success" );

      setTimeout( () => {
        showDesktopNotificationPWA(
          "¡Notificaciones activadas!",
          "Recibirás recordatorios de tus tareas",
          "welcome",
          false,
          'success'
        );
      }, 1000 );
    } else {
      showNotification( "Permisos de notificación denegados", "error" );
    }

    return permission;
  } );
}

// Función para revisar notificaciones cuando la PWA vuelve del background
function onPageVisibilityChange() {
  if ( !document.hidden && notificationsEnabled && Notification.permission === "granted" ) {
    console.log( "📱 PWA volvió del background - revisando notificaciones" );
  }
}

// Escuchar cuando la PWA vuelve del background
document.addEventListener( "visibilitychange", onPageVisibilityChange );

function updateNotificationButton() {
  const btn = document.getElementById( "notificationsBtn" );
  if ( !btn ) return;

  const hasPermission = Notification.permission === "granted";
  const baseClasses =
    "text-white px-3 py-2 rounded-lg transition duration-300 text-xs md:text-sm font-normal md:font-bold";

  if ( notificationsEnabled && hasPermission ) {
    btn.className = `bg-green-500 hover:bg-green-600 ${baseClasses}`;
    btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Notificaciones ON';
    btn.title = "Notificaciones activadas - Click para desactivar";
  } else if ( hasPermission ) {
    btn.className = `bg-gray-500 hover:bg-gray-600 ${baseClasses}`;
    btn.innerHTML = '<i class="fas fa-bell-slash mr-2"></i>Notificaciones OFF';
    btn.title = "Notificaciones desactivadas - Click para activar";
  } else {
    btn.className = `bg-yellow-500 hover:bg-yellow-600 ${baseClasses}`;
    btn.innerHTML = '<i class="fas fa-bell mr-2"></i>Permitir Notificaciones';
    btn.title = "Click para solicitar permisos de notificación";
  }
}

// función para limpiar notificaciones cuando se completa una tarea
function clearTaskNotifications( taskId ) {
  const keysToRemove = [
    `${taskId}-5min`,
    `${taskId}-15min`,
    `${taskId}-start`,
    `${taskId}-late`
  ];

  keysToRemove.forEach( key => {
    notificationStatus.taskReminders.delete( key );
    sentNotifications.delete( key );
  } );
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

  notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-[100] transition-all duration-300 transform translate-x-full ${className}`;
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

// FUNCIÓN: Modal de edición masiva
function showBulkEditModal( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) {
    showNotification( "Tarea no encontrada", "error" );
    return;
  }

  closeAllModals();

  const modal = document.createElement( "div" );
  modal.id = "bulkEditModal";
  modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold text-gray-800">
          <i class="fas fa-layer-group text-blue-500 mr-2"></i>Editar Tarea Recurrente
        </h3>
        <button onclick="closeAllModals()" class="text-gray-500 hover:text-gray-700 transition">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Información de la tarea -->
      <div class="bg-blue-50 p-3 rounded-lg mb-4">
        <p class="text-sm text-blue-800">
          <i class="fas fa-info-circle mr-1"></i>
          <strong>Tarea:</strong> ${task.title}
        </p>
        <p class="text-xs text-blue-600 mt-1">
          Esta tarea se repite en múltiples días. Selecciona cómo deseas editarla:
        </p>
      </div>

      <!-- Opciones de edición -->
      <div class="space-y-3 mb-6">
        <button onclick="editSingleTask('${dateStr}', '${taskId}')"
                class="w-full bg-blue-100 hover:bg-blue-200 text-blue-800 p-4 rounded-lg transition text-left">
          <div class="flex items-center">
            <i class="fas fa-calendar-day text-2xl mr-3"></i>
            <div>
              <div class="font-semibold">Editar solo esta tarea</div>
              <div class="text-xs opacity-75">Cambios solo en ${new Date( dateStr + 'T12:00:00' ).toLocaleDateString( 'es-ES' )}</div>
            </div>
          </div>
        </button>

        <button onclick="showBulkEditForm('${dateStr}', '${taskId}', 'all')"
                class="w-full bg-green-100 hover:bg-green-200 text-green-800 p-4 rounded-lg transition text-left">
          <div class="flex items-center">
            <i class="fas fa-calendar-alt text-2xl mr-3"></i>
            <div>
              <div class="font-semibold">Editar en todos los días</div>
              <div class="text-xs opacity-75">Buscar y actualizar todas las ocurrencias</div>
            </div>
          </div>
        </button>

        <button onclick="showCustomDatesSelector('${dateStr}', '${taskId}')"
                class="w-full bg-purple-100 hover:bg-purple-200 text-purple-800 p-4 rounded-lg transition text-left">
          <div class="flex items-center">
            <i class="fas fa-calendar-check text-2xl mr-3"></i>
            <div>
              <div class="font-semibold">Editar en días personalizados</div>
              <div class="text-xs opacity-75">Selecciona fechas específicas</div>
            </div>
          </div>
        </button>
      </div>

      <button onclick="closeAllModals()"
              class="w-full bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 py-2 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition">
        Cancelar
      </button>
    </div>
  `;

  document.body.appendChild( modal );
}

// FUNCIÓN: Editar solo una tarea
function editSingleTask( dateStr, taskId ) {
  closeAllModals();
  showAdvancedEditModal( dateStr, taskId );
}

// FUNCIÓN: Formulario de edición masiva
function showBulkEditForm( dateStr, taskId, mode = 'all' ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) return;

  closeAllModals();

  const modal = document.createElement( "div" );
  modal.id = "bulkEditFormModal";
  modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold text-gray-800">
          <i class="fas fa-edit text-green-500 mr-2"></i>Edición Masiva
        </h3>
        <button onclick="closeAllModals()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4">
        <p class="text-sm text-yellow-800">
          <i class="fas fa-exclamation-triangle mr-1"></i>
          Los cambios se aplicarán a <strong>todas las ocurrencias</strong> de esta tarea
        </p>
      </div>

      <form id="bulkEditForm" class="space-y-4">
        <input type="hidden" id="bulkMode" value="${mode}">
        <input type="hidden" id="originalTitle" value="${task.title}">
        <input type="hidden" id="originalTime" value="${task.time || ''}">

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Nuevo Título <span class="text-red-500">*</span>
          </label>
          <input type="text" id="bulkEditTitle" value="${task.title}" required
                 class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500">
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Nueva Descripción
          </label>
          <textarea id="bulkEditDescription" rows="3"
                    class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500">${task.description || ''}</textarea>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Nueva Hora <span class="text-red-500">*</span>
            </label>
            <input type="time" id="bulkEditTime" value="${task.time || ''}" required
                   class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Nueva Prioridad <span class="text-red-500">*</span>
            </label>
            <select id="bulkEditPriority" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500">
              <option value="1" ${task.priority === 1 ? "selected" : ""}>🔴 Muy Importante</option>
              <option value="2" ${task.priority === 2 ? "selected" : ""}>🟠 Importante</option>
              <option value="3" ${task.priority === 3 ? "selected" : ""}>🔵 Moderado</option>
              <option value="4" ${task.priority === 4 ? "selected" : ""}>⚫ No Prioritario</option>
            </select>
          </div>
        </div>

        <div id="bulkEditPreview" class="bg-gray-50 p-3 rounded text-sm text-gray-700">
          <i class="fas fa-search mr-1"></i>
          Buscando tareas similares...
        </div>

        <div class="flex space-x-3 pt-4 border-t">
          <button type="submit" class="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700">
            <i class="fas fa-save mr-2"></i>Aplicar Cambios
          </button>
          <button type="button" onclick="closeAllModals()"
                  class="flex-1 bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 py-2 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild( modal );

  // Buscar tareas similares
  setTimeout( () => findSimilarTasks( task.title, task.time ), 100 );

  // Event listener
  document.getElementById( "bulkEditForm" ).addEventListener( "submit", ( e ) => {
    e.preventDefault();
    applyBulkEdit( dateStr, taskId );
  } );
}

// FUNCIÓN: Buscar tareas similares
function findSimilarTasks( title, time ) {
  let matchCount = 0;
  const dates = [];

  Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
    dayTasks.forEach( task => {
      if ( task.title === title && task.time === time ) {
        matchCount++;
        dates.push( date );
      }
    } );
  } );

  const preview = document.getElementById( "bulkEditPreview" );
  if ( preview ) {
    if ( matchCount > 1 ) {
      preview.innerHTML = `
        <i class="fas fa-check-circle text-green-600 mr-1"></i>
        Se encontraron <strong>${matchCount} tareas idénticas</strong> en el calendario
        <div class="text-xs mt-2 text-gray-500">
          Fechas: ${dates.slice( 0, 5 ).map( d => new Date( d + 'T12:00:00' ).toLocaleDateString( 'es-ES', { day: 'numeric', month: 'short' } ) ).join( ', ' )}
          ${matchCount > 5 ? ` y ${matchCount - 5} más` : ''}
        </div>
      `;
    } else {
      preview.innerHTML = `
        <i class="fas fa-info-circle text-blue-600 mr-1"></i>
        Solo se encontró esta tarea (no hay repeticiones)
      `;
    }
  }

  return { count: matchCount, dates };
}

// FUNCIÓN: Aplicar edición masiva
function applyBulkEdit( dateStr, taskId ) {
  const originalTitle = document.getElementById( "originalTitle" ).value;
  const originalTime = document.getElementById( "originalTime" ).value;
  const newTitle = document.getElementById( "bulkEditTitle" ).value.trim();
  const newDescription = document.getElementById( "bulkEditDescription" ).value.trim();
  const newTime = document.getElementById( "bulkEditTime" ).value;
  const newPriority = parseInt( document.getElementById( "bulkEditPriority" ).value );
  const mode = document.getElementById( "bulkMode" ).value;

  if ( !newTitle || !newTime ) {
    showNotification( "Completa todos los campos obligatorios", "error" );
    return;
  }

  let updatedCount = 0;
  let targetDates = [];

  // Determinar qué fechas actualizar según el modo
  if ( mode === 'custom' && window.selectedCustomDates ) {
    targetDates = window.selectedCustomDates;
  } else {
    // Modo 'all': buscar todas las fechas con tareas idénticas
    Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
      if ( dayTasks.some( t => t.title === originalTitle && t.time === originalTime ) ) {
        targetDates.push( date );
      }
    } );
  }

  if ( targetDates.length === 0 ) {
    showNotification( "No se encontraron tareas para actualizar", "error" );
    return;
  }

  // Confirmar antes de aplicar cambios masivos
  const confirmMsg = `¿Actualizar ${targetDates.length} tarea${targetDates.length > 1 ? 's' : ''} en ${targetDates.length} día${targetDates.length > 1 ? 's' : ''}?`;
  if ( !confirm( confirmMsg ) ) {
    return;
  }

  // Actualizar tareas en las fechas seleccionadas
  targetDates.forEach( ( date ) => {
    if ( !tasks[ date ] ) return;

    tasks[ date ].forEach( ( task, index ) => {
      if ( task.title === originalTitle && task.time === originalTime ) {
        // Actualizar tarea manteniendo su estado
        tasks[ date ][ index ] = {
          ...task,
          title: newTitle,
          description: newDescription,
          time: newTime,
          priority: newPriority
        };

        // Sync individual
        enqueueSync( "upsert", date, tasks[ date ][ index ] );
        updatedCount++;

        // Registrar cambio
        addToChangeLog( "edited", newTitle, date, null, null, task.id );
      }
    } );
  } );

  // Limpiar fechas personalizadas guardadas
  delete window.selectedCustomDates;

  saveTasks();
  renderCalendar();
  updateProgress();

  closeAllModals();
  showNotification(
    ` ${updatedCount} tarea${updatedCount > 1 ? 's' : ''} actualizada${updatedCount > 1 ? 's' : ''} en ${targetDates.length} día${targetDates.length > 1 ? 's' : ''}`,
    "success"
  );

  // Actualizar panel si está abierto
  if ( selectedDateForPanel ) {
    const day = new Date( selectedDateForPanel + "T12:00:00" ).getDate();
    showDailyTaskPanel( selectedDateForPanel, day );
  }
}

// FUNCIÓN: Selector de fechas personalizadas
function showCustomDatesSelector( dateStr, taskId ) {
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  if ( !task ) return;

  closeAllModals();

  // Encontrar todas las fechas con esta tarea
  const matchingDates = [];
  Object.entries( tasks ).forEach( ( [ date, dayTasks ] ) => {
    if ( dayTasks.some( t => t.title === task.title && t.time === task.time ) ) {
      matchingDates.push( date );
    }
  } );

  const modal = document.createElement( "div" );
  modal.id = "customDatesModal";
  modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4";

  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold text-gray-800">
          <i class="fas fa-calendar-check text-purple-500 mr-2"></i>Seleccionar Fechas
        </h3>
        <button onclick="closeAllModals()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <p class="text-sm text-gray-600 mb-4">
        Selecciona las fechas donde deseas aplicar los cambios:
      </p>

      <div class="mb-4">
        <label class="flex items-center space-x-2 bg-blue-50 p-2 rounded cursor-pointer">
          <input type="checkbox" id="selectAllDates" onchange="toggleAllDates(this)" class="rounded">
          <span class="text-sm font-medium">Seleccionar todas (${matchingDates.length} fechas)</span>
        </label>
      </div>

      <div id="datesGrid" class="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto mb-4">
        ${matchingDates.map( date => {
    const dateObj = new Date( date + 'T12:00:00' );
    const formattedDate = dateObj.toLocaleDateString( 'es-ES', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    } );
    return `
            <label class="flex items-center space-x-2 bg-gray-50 p-2 rounded hover:bg-gray-100 cursor-pointer">
              <input type="checkbox" value="${date}" class="custom-date-checkbox rounded" checked>
              <span class="text-sm">${formattedDate}</span>
            </label>
          `;
  } ).join( '' )}
      </div>

      <div class="flex space-x-3">
        <button onclick="proceedWithCustomDates('${dateStr}', '${taskId}')"
                class="flex-1 bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700">
          <i class="fas fa-arrow-right mr-2"></i>Continuar con Selección
        </button>
        <button onclick="closeAllModals()"
                class="flex-1 bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 py-2 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600">
          Cancelar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild( modal );
}

function toggleAllDates( checkbox ) {
  const checkboxes = document.querySelectorAll( '.custom-date-checkbox' );
  checkboxes.forEach( cb => cb.checked = checkbox.checked );
}

function proceedWithCustomDates( dateStr, taskId ) {
  const selectedDates = Array.from( document.querySelectorAll( '.custom-date-checkbox:checked' ) )
    .map( cb => cb.value );

  if ( selectedDates.length === 0 ) {
    showNotification( "Selecciona al menos una fecha", "error" );
    return;
  }

  // Guardar fechas seleccionadas y mostrar formulario
  window.selectedCustomDates = selectedDates;
  showBulkEditForm( dateStr, taskId, 'custom' );
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

  const deletedTasks = []; //  Para recopilar taskIds y limpiar notificaciones

  // Recopilar todas las tareas para sync y notificaciones
  Object.entries( tasks ).forEach( ( [ dateStr, dayTasks ] ) => {
    dayTasks.forEach( ( task ) => {
      deletedTasks.push( { dateStr, taskId: task.id } );
      clearTaskNotifications( task.id ); //  Limpiar notificaciones para cada tarea
    } );
  } );

  tasks = {};
  saveTasks();
  renderCalendar();
  updateProgress();
  closeDailyTaskPanel();

  // NUEVO: Limpiar todos los estados de notificaciones globales
  notificationStatus.taskReminders.clear();
  notificationStatus.morning = false;
  notificationStatus.midday = false;
  notificationStatus.evening = false;
  sentNotifications.clear();

  // Auto-sync batch delete (sin cambios)
  deletedTasks.forEach( ( { dateStr, taskId } ) => {
    enqueueSync( "delete", dateStr, { id: taskId } );
  } );

  showNotification( `${totalTasks} tareas eliminadas del calendario`, "success" );
}

// Actualizar duraciones cada 30 segundos para tareas en proceso
setInterval( () => {
  const today = getTodayString();
  const todayTasks = tasks[ today ] || [];

  const inProgressTasks = todayTasks.filter(
    t => t.state === 'inProgress' && t.duration
  );

  if ( inProgressTasks.length > 0 && selectedDateForPanel === today ) {
    // Actualizar panel sin hacer scroll
    const currentScrollPosition = document.getElementById( 'panelTaskList' )?.scrollTop || 0;

    const day = new Date( today + 'T12:00:00' ).getDate();
    showDailyTaskPanel( today, day );

    // Restaurar scroll
    setTimeout( () => {
      const taskList = document.getElementById( 'panelTaskList' );
      if ( taskList ) {
        taskList.scrollTop = currentScrollPosition;
      }
    }, 100 );
  }
}, 30000 ); // Cada 30 segundos

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

function updateUI() {
  const loginBtn = document.getElementById( "loginBtn" );
  const userInfo = document.getElementById( "userInfo" );
  const syncBtn = document.getElementById( "syncBtn" );
  const statusEl = document.getElementById( "firebaseStatus" );

  console.log( '🎨 Actualizando UI - Usuario:', currentUser ? `logged in (${currentUser.email})` : 'not logged' );

  // ✅ CRÍTICO: SIEMPRE mantener elementos core visibles
  const coreElements = {
    calendar: document.getElementById( "calendar" ),
    dailyTaskPanel: document.getElementById( "dailyTaskPanel" ),
    taskForm: document.getElementById( "taskForm" ),
    progressBar: document.getElementById( "progressBar" ),
    progressText: document.getElementById( "progressText" ),
    currentMonth: document.getElementById( "currentMonth" ),
    panelTaskList: document.getElementById( "panelTaskList" )
  };

  // Asegurar visibilidad de elementos core
  Object.values( coreElements ).forEach( el => {
    if ( el ) {
      el.style.display = ''; // Reset display
      el.style.visibility = 'visible'; // ✅ NUEVO
      el.classList.remove( 'hidden', 'force-hidden', 'opacity-0' );
    }
  } );

  if ( currentUser && !currentUser.isOffline ) {
    // ✅ Usuario logueado correctamente
    if ( loginBtn ) loginBtn.classList.add( "hidden" );

    if ( userInfo ) {
      userInfo.classList.remove( "hidden" );

      const userName = document.getElementById( "userName" );
      const userEmail = document.getElementById( "userEmail" );
      const userPhoto = document.getElementById( "userPhoto" );

      if ( userName ) userName.textContent = currentUser.displayName || "Usuario";
      if ( userEmail ) userEmail.textContent = currentUser.email || "";
      if ( userPhoto ) {
        userPhoto.src = currentUser.photoURL || "https://via.placeholder.com/32";
        userPhoto.onerror = () => userPhoto.src = "https://via.placeholder.com/32";
      }
    }

    if ( syncBtn ) {
      syncBtn.classList.remove( "hidden" );
      syncBtn.disabled = false;
    }

    if ( statusEl ) statusEl.classList.remove( "force-hidden" );

    console.log( '✅ UI actualizada: Usuario logueado' );

  } else {
    // ✅ Usuario no logueado - Mostrar solo login
    if ( loginBtn ) loginBtn.classList.remove( "hidden" );
    if ( userInfo ) userInfo.classList.add( "hidden" );
    if ( syncBtn ) syncBtn.classList.add( "hidden" );
    if ( statusEl ) statusEl.classList.add( "force-hidden" );

    console.log( '✅ UI actualizada: Modo local' );
  }

  // ✅ Botón de instalación
  const installBtn = document.getElementById( "install-button" );
  if ( installBtn ) {
    if ( isPWAInstalled() ) {
      installBtn.style.display = 'none';
      installBtn.classList.add( 'hidden' );
    } else if ( deferredPrompt && !installButtonShown ) {
      installBtn.style.display = 'block';
      installBtn.classList.remove( 'hidden' );
    }
  }
}

// Manejar cambios de visibilidad de página
document.addEventListener( 'visibilitychange', () => {
  if ( !document.hidden ) {
    console.log( '📱 App volvió del background' );

    // Verificar si el usuario sigue logueado
    if ( auth && auth.currentUser ) {
      console.log( ' Usuario todavía logueado:', auth.currentUser.email );

      // Re-sincronizar
      if ( isOnline && !isSyncing ) {
        setTimeout( () => {
          syncFromFirebase();

        }, 1000 );
      }
    } else {
      console.warn( '⚠️ Usuario no detectado, verificando...' );

      // Verificar flag de sesión
      const hadSession = localStorage.getItem( 'firebase_auth_active' ) === 'true';
      if ( hadSession ) {
        console.log( '🔄 Sesión previa detectada, esperando restauración...' );
        // Firebase debería restaurar automáticamente
        setTimeout( () => {
          if ( !auth.currentUser ) {
            console.error( '❌ No se pudo restaurar la sesión' );
            localStorage.removeItem( 'firebase_auth_active' );
          }
        }, 3000 );
      }
    }
  }
} );

// Enviar tareas al SW cada vez que se actualiza la lista
function saveTasks() {
  try {
    localStorage.setItem( "tasks", JSON.stringify( tasks ) );
    localStorage.setItem( "dailyTaskLogs", JSON.stringify( dailyTaskLogs ) );

    // ✅ CRÍTICO: Siempre enviar tareas actualizadas al Service Worker
    if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
      navigator.serviceWorker.controller.postMessage( {
        type: 'UPDATE_TASKS',
        data: { tasks, timestamp: Date.now() }
      } );
      console.log( '📤 Tareas actualizadas en Service Worker' );
    }
  } catch ( error ) {
    console.error( "❌ Error saving tasks:", error );
    showNotification( "Error al guardar tareas", "error" );
  }
}

// NUEVA FUNCIÓN: Limpieza de duplicados
async function cleanupDuplicates() {
  console.log( '🧹 Limpiando duplicados...' );

  let cleaned = 0;

  Object.keys( tasks ).forEach( dateStr => {
    if ( !tasks[ dateStr ] ) return;

    const seen = new Map();
    const uniqueTasks = [];

    tasks[ dateStr ].forEach( task => {
      const key = `${task.title}:${task.time}`;

      if ( !seen.has( key ) ) {
        seen.set( key, task );
        uniqueTasks.push( task );
      } else {
        console.log( `🗑️ Duplicado eliminado: ${task.title}` );
        cleaned++;
      }
    } );

    tasks[ dateStr ] = uniqueTasks;

    if ( tasks[ dateStr ].length === 0 ) {
      delete tasks[ dateStr ];
    }
  } );

  if ( cleaned > 0 ) {
    saveTasks();
    renderCalendar();
    console.log( `✅ ${cleaned} duplicados eliminados` );
  }

  return cleaned;
}

// INICIALIZACIÓN PRINCIPAL
document.addEventListener( "DOMContentLoaded", async function () {
  console.log( '🚀 Inicializando aplicación...' );

  isOnline = navigator.onLine;
  setupNetworkListeners();

  loadTasks();
  loadPermissions();

  renderCalendar();
  updateProgress();
  setupEventListeners();
  setupDragAndDrop();
  setupTaskTooltips();
  setupDateInput();

  initNotifications();

  // Inicializar tema
  initThemeToggle();

  // ✅ Mostrar panel hoy después de 500ms
  setTimeout( () => {
    console.log( '📅 Ejecutando initializeTodayPanel...' );
    initializeTodayPanel();
  }, 500 );

  // ✅ Firebase solo si HAY conexión
  if ( navigator.onLine ) {
    console.log( '🔥 Inicializando Firebase...' );
    await initFirebase();
  } else {
    console.log( '📴 Sin conexión inicial - modo offline' );
    initOfflineMode();
  }

  setTimeout( () => {
    handleServiceWorkerMessages();

    const isDesktop = window.innerWidth >= 768;
    const isPWA = isPWAInstalled();

    if ( isDesktop && !isPWA ) {
      initializeTodayPanel();
    }

    if ( isPWA ) {
      console.log( '🚀 PWA detectada - configurando características' );
      configurePWAFeatures();

      const installButton = document.getElementById( 'install-button' );
      if ( installButton ) {
        installButton.style.display = 'none';
        installButton.classList.add( 'hidden' );
      }
    }
  }, 500 );

  // ✅ Auth listeners solo si Firebase está listo
  if ( firebaseInitialized ) {
    setupAuthListeners();
  }

  // Limpieza preventiva
  await cleanupDuplicates();

  // Restaurar temporizadores: congelar el reloj (NO reanudar solo).
  // El estado se conserva tal cual; el tiempo sigue solo al iniciar/reanudar.
  let timersNeedSave = false;
  Object.entries( tasks ).forEach( ( [ dateStr, dayTasks ] ) => {
    dayTasks.forEach( task => {
      if ( task.state === 'inProgress' && task.runSince ) {
        task.runSince = null;
        timersNeedSave = true;
      }
    } );
  } );
  if ( timersNeedSave ) saveTasks();

  console.log( '✅ Sistema de temporizadores y tema inicializado' );

  console.log( '✅ Aplicación inicializada completamente' );
} );

//Configurar listeners después de DOMContentLoaded
function setupAuthListeners() {
  console.log( '🔐 Configurando listeners de autenticación...' );

  if ( !auth ) {
    console.warn( '⚠️ Auth no disponible aún, reintentando...' );
    setTimeout( setupAuthListeners, 500 );
    return;
  }

  // ✅ LISTENER ÚNICO Y MEJORADO
  auth.onAuthStateChanged( async ( user ) => {
    console.log( '🔄 onAuthStateChanged:', user ? user.email : 'no user' );

    if ( user ) {
      // Usuario logueado
      if ( !currentUser || currentUser.uid !== user.uid ) {
        console.log( '✅ Nueva sesión detectada:', user.email );
        currentUser = user;

        // ✅ CRÍTICO: Notificar al Service Worker
        if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
          navigator.serviceWorker.controller.postMessage( {
            type: 'SET_USER_ID',
            data: {
              userId: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL
            }
          } );
          console.log( '📤 Sesión actualizada en Service Worker' );
        }

        // ✅ Enviar tareas actuales al SW
        if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
          navigator.serviceWorker.controller.postMessage( {
            type: 'UPDATE_TASKS',
            data: { tasks, timestamp: Date.now() }
          } );
        }

        // Limpiar listener anterior
        if ( firestoreListener ) {
          firestoreListener();
          firestoreListener = null;
        }

        localStorage.setItem( 'firebase_auth_active', 'true' );
        localStorage.setItem( 'firebase_user_email', user.email );
        localStorage.setItem( 'firebase_user_uid', user.uid );
        localStorage.setItem( 'firebase_session_timestamp', Date.now().toString() );

        updateUI();
        closeLoginModal();

        // Configurar listener en tiempo real
        setupRealtimeSync();

        // Sync bidireccional después de 3 segundos
        if ( isOnline && !isSyncing ) {
          setTimeout( () => {
            console.log( '🔄 Sync inicial después de login' );
            syncFromFirebaseBidirectional();
          }, 3000 );
        }

        // Configurar FCM si está disponible
        if ( messaging && Notification.permission === 'granted' ) {
          setTimeout( async () => {
            try {
              const token = await requestFCMToken();
              if ( token ) {
                // Actualizar token en SW
                if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
                  navigator.serviceWorker.controller.postMessage( {
                    type: 'FCM_TOKEN',
                    data: { token }
                  } );
                }
              }
            } catch ( error ) {
              console.warn( '⚠️ Error configurando FCM:', error );
            }
          }, 2000 );
        }
      }
    } else {
      // Usuario deslogueado
      if ( currentUser && !currentUser.isOffline ) {
        console.log( '👋 Sesión cerrada' );

        // Limpiar listener
        if ( firestoreListener ) {
          firestoreListener();
          firestoreListener = null;
        }

        // ✅ CRÍTICO: Notificar logout al Service Worker
        if ( 'serviceWorker' in navigator && navigator.serviceWorker.controller ) {
          navigator.serviceWorker.controller.postMessage( {
            type: 'LOGOUT'
          } );
          console.log( '📤 Logout notificado al Service Worker' );
        }

        currentUser = null;
        localStorage.removeItem( 'firebase_auth_active' );
        localStorage.removeItem( 'firebase_user_email' );
        localStorage.removeItem( 'firebase_user_uid' );
        localStorage.removeItem( 'firebase_session_timestamp' );
        updateUI();
      }
    }
  } );

  console.log( '✅ Listeners de autenticación configurados' );
}

// Limpiar duplicados al volver de background
document.addEventListener( 'visibilitychange', async () => {
  if ( !document.hidden && currentUser && !currentUser.isOffline ) {
    console.log( '👀 Pestaña activa - verificando duplicados' );

    // Esperar 1 segundo y limpiar duplicados
    setTimeout( async () => {
      const cleaned = await cleanupDuplicates();
      if ( cleaned > 0 ) {
        console.log( `🧹 ${cleaned} duplicados eliminados al activar pestaña` );
      }
    }, 1000 );
  }
} );

function checkSessionHealth() {
  if ( !currentUser || currentUser.isOffline ) return;

  const sessionTimestamp = localStorage.getItem( 'firebase_session_timestamp' );
  if ( !sessionTimestamp ) {
    console.warn( '⚠️ No hay timestamp de sesión' );
    return;
  }

  const sessionAge = Date.now() - parseInt( sessionTimestamp );
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 días

  if ( sessionAge > maxAge ) {
    console.warn( '⚠️ Sesión muy antigua, requiere reautenticación' );
    signOut();
  }
}

// ===== SISTEMA DE TEMA OSCURO/CLARO =====
function initThemeToggle() {
  const themeToggle = document.getElementById( 'themeToggle' );
  const html = document.documentElement;

  // Cargar tema guardado
  const savedTheme = localStorage.getItem( 'theme' ) || 'light';
  if ( savedTheme === 'dark' ) {
    html.classList.add( 'dark' );
  }

  // Event listener para cambio de tema
  themeToggle?.addEventListener( 'click', () => {
    html.classList.toggle( 'dark' );
    const newTheme = html.classList.contains( 'dark' ) ? 'dark' : 'light';
    localStorage.setItem( 'theme', newTheme );

    // Animación de cambio
    themeToggle.classList.add( 'rotate-180' );
    setTimeout( () => themeToggle.classList.remove( 'rotate-180' ), 300 );

    showNotification(
      `Modo ${newTheme === 'dark' ? 'oscuro' : 'claro'} activado`,
      'success'
    );
  } );
}

window.addEventListener( 'beforeunload', () => {
  taskTimers.forEach( ( timer, taskId ) => {
    clearInterval( timer.interval );
  } );
} );

// ===== TIEMPO ACUMULADO POR TAREA (minutos, persistido) =====
// task.elapsedMin: minutos consumidos acumulados (se congela al pausar).
// task.runSince: timestamp ms desde cuando corre (solo en inProgress).
// Al recargar NO se reanuda solo: se congela en lo acumulado hasta que
// el usuario la inicie/reanude de nuevo.
function currentElapsedMin( task ) {
  if ( !task ) return 0;
  const base = task.elapsedMin || 0;
  if ( task.state === 'inProgress' && task.runSince ) {
    return base + Math.max( 0, ( Date.now() - task.runSince ) / 60000 );
  }
  return base;
}

function accumulateElapsed( task ) {
  if ( !task ) return;
  if ( task.state === 'inProgress' && task.runSince ) {
    task.elapsedMin = ( task.elapsedMin || 0 ) + Math.max( 0, ( Date.now() - task.runSince ) / 60000 );
  }
  task.runSince = null;
}

function markRunning( task ) {
  if ( !task ) return;
  if ( typeof task.elapsedMin !== 'number' ) task.elapsedMin = 0;
  task.runSince = Date.now();
}

// ===== SISTEMA DE TEMPORIZADOR PARA TAREAS =====
function startTaskTimer( taskId, dateStr, durationMinutes ) {
  // Si ya existe un timer, limpiarlo
  if ( taskTimers.has( taskId ) ) {
    clearInterval( taskTimers.get( taskId ).interval );
  }

  // Descontar lo ya consumido (pausas) del total programado
  const task = tasks[ dateStr ]?.find( t => t.id === taskId );
  const remainingMin = durationMinutes - currentElapsedMin( task || {} );

  if ( remainingMin <= 0 ) {
    const timerElement = document.getElementById( `timer-${taskId}` );
    if ( timerElement ) {
      timerElement.textContent = '⏰ ¡Tiempo agotado!';
      timerElement.className = 'timer-display timer-critical text-sm font-bold';
    }
    return;
  }

  const startTime = Date.now();
  const endTime = startTime + ( remainingMin * 60 * 1000 );

  const interval = setInterval( () => {
    updateTimerDisplay( taskId, endTime );
  }, 1000 );

  taskTimers.set( taskId, {
    interval,
    startTime,
    endTime,
    dateStr
  } );

  console.log( `⏱️ Timer iniciado para tarea ${taskId}` );
}

function stopTaskTimer( taskId ) {
  const timer = taskTimers.get( taskId );
  if ( timer ) {
    clearInterval( timer.interval );
    taskTimers.delete( taskId );
    console.log( `⏹️ Timer detenido para tarea ${taskId}` );
  }
}

function updateTimerDisplay( taskId, endTime ) {
  const timerElement = document.getElementById( `timer-${taskId}` );
  if ( !timerElement ) {
    stopTaskTimer( taskId );
    return;
  }

  const now = Date.now();
  const remaining = endTime - now;

  if ( remaining <= 0 ) {
    // Tiempo agotado
    timerElement.textContent = '⏰ ¡Tiempo agotado!';
    timerElement.className = 'timer-display timer-critical text-sm font-bold';
    stopTaskTimer( taskId );

    // Notificación
    if ( notificationsEnabled ) {
      showDesktopNotificationPWA(
        '⏰ Tiempo agotado',
        `La tarea ha excedido su tiempo programado`,
        `${taskId}-timeout`,
        true,
        'task-late'
      );
    }
    return;
  }

  // Calcular tiempo restante
  const hours = Math.floor( remaining / ( 1000 * 60 * 60 ) );
  const minutes = Math.floor( ( remaining % ( 1000 * 60 * 60 ) ) / ( 1000 * 60 ) );
  const seconds = Math.floor( ( remaining % ( 1000 * 60 ) ) / 1000 );

  const display = `${String( hours ).padStart( 2, '0' )}:${String( minutes ).padStart( 2, '0' )}:${String( seconds ).padStart( 2, '0' )}`;
  timerElement.textContent = `⏱️ ${display}`;

  // Cambiar color según tiempo restante
  const totalMinutes = Math.floor( remaining / ( 1000 * 60 ) );
  if ( totalMinutes <= 5 ) {
    timerElement.className = 'timer-display timer-critical text-sm font-bold animate-pulse';
  } else if ( totalMinutes <= 15 ) {
    timerElement.className = 'timer-display timer-warning text-sm font-bold';
  } else {
    timerElement.className = 'timer-display timer-active text-sm font-bold text-blue-600';
  }
}

// Duración en minutos calculada desde hora inicio/fin (HH:MM).
// Sin hora de fin no hay duración y el temporizador no aplica.
function computeMinutesFromRange( start, end ) {
  if ( !start || !end ) return null;
  const [ sh, sm ] = start.split( ':' ).map( Number );
  const [ eh, em ] = end.split( ':' ).map( Number );
  const diff = ( eh * 60 + em ) - ( sh * 60 + sm );
  return diff > 0 ? diff : null;
}


// Verificar salud de sesión cada hora
setInterval( checkSessionHealth, 60 * 60 * 1000 );

console.log( 'Sistema de autenticación configurado' );
