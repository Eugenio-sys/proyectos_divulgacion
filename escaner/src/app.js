import { createClient } from './client.js';
import { QRScanner } from './scanner.js';
import { config } from '../config.js';

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).get('demo') === '1';
const endpoint = String(config.endpoint || '').trim();
const sessionKey = 'registroQR.session.v1';
const tableNames = { attendance: 'Asistentes', pre: 'Pre-registrados', onsite: 'In situ' };
const tableDescriptions = {
  attendance: 'Personas que han confirmado su asistencia.',
  pre: 'Busca por nombre o correo y pulsa Consultar para revisar la ficha.',
  onsite: 'Inscritos en el evento. Busca a la persona y pulsa Consultar para revisar la ficha.',
};
const state = {
  token: '', role: '', expiresAt: '', eventName: '', tab: 'scanner', connected: false,
  connecting: false, authenticating: false, lookupBusy: false, registerBusy: false,
  cameraBusy: false, refreshBusy: false, configBusy: false, configLoaded: false,
  configRequired: false, qr: '', match: null, configVersion: null,
  configFormVersion: null, authSeq: 0, lookupSeq: 0, tableSeq: 0, metaSeq: 0,
  operation: 'idle', lookupSource: 'manual', online: navigator.onLine !== false,
  lastConnectionCheck: null, connectionUnconfirmed: false,
  configSeq: 0, expiryTimer: null,
  camera: { running: false, cameras: [], selectedCameraId: '', torchSupported: false, torchOn: false },
  table: { query: '', filters: {}, sort: { key: '', direction: 'asc' }, page: 1, pages: 0,
    pageSize: 25, columns: [], rows: [], total: 0, filtered: 0, loading: false },
};
let client = null;
let tableSearchTimer = null;

function status(id, message = '', kind = '') {
  const box = $(id);
  box.textContent = message;
  box.className = `status${kind ? ` status-${kind}` : ''}${kind === 'loading' ? ' is-loading' : ''}`;
  box.hidden = !message;
}

function text(id, value, fallback = '—') {
  $(id).textContent = value === null || value === undefined || value === '' ? fallback : String(value);
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('es', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function numberLabel(value) {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('es').format(value) : '—';
}

function setOperation(kind = 'idle', detail = '') {
  const labels = {
    pending: ['Por confirmar', '○'], registered: ['Registrado', '✓'],
    already: ['Ya registrado', '!'], 'not-found': ['No encontrado', '?'],
    unconfirmed: ['Sin confirmar', '!'], searching: ['Consultando…', '…'],
    checking: ['Confirmando…', '…'],
  };
  state.operation = kind;
  const panel = $('operation-state');
  panel.hidden = kind === 'idle';
  panel.dataset.state = kind;
  text('operation-title', labels[kind]?.[0] || '', '');
  text('operation-icon', labels[kind]?.[1] || '', '');
  text('operation-detail', detail, '');
  $('next-person').hidden = !['registered', 'already', 'not-found'].includes(kind);
  $('person-registration').classList.toggle('is-already', kind === 'already');
  $('person-registration').textContent = kind === 'already' ? 'Ya registrado' : 'Asistencia registrada';
}

function showResultOnMobile() {
  if (state.tab !== 'scanner' || !window.matchMedia('(max-width: 700px)').matches) return;
  requestAnimationFrame(() => {
    if (state.tab !== 'scanner') return;
    const result = $('operation-state');
    if (result.hidden) return;
    const bounds = result.getBoundingClientRect();
    const personBounds = !$('person-card').hidden ? $('person-card').querySelector('.person-heading').getBoundingClientRect() : null;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    if (bounds.top < 12 || bounds.bottom > viewportHeight - 12 || (personBounds && personBounds.bottom > viewportHeight - 12)) {
      $('result-card').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });
}

function renderConnection() {
  const indicator = $('connection-indicator');
  const checked = state.online && Boolean(state.lastConnectionCheck) && !state.connectionUnconfirmed;
  indicator.classList.toggle('is-checked', checked);
  indicator.classList.toggle('is-offline', !state.online);
  indicator.classList.toggle('is-unconfirmed', state.online && state.connectionUnconfirmed);
  text('connection-icon', !state.online || state.connectionUnconfirmed ? '!' : checked ? '✓' : '○');
  let label = 'Red disponible · pendiente de comprobar';
  if (!state.online) label = 'Sin conexión';
  else if (state.connectionUnconfirmed) label = 'Conexión sin confirmar';
  else if (checked) {
    const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(state.lastConnectionCheck);
    label = demo ? 'Demostración local · datos ficticios' : `Conexión comprobada · ${time}`;
  }
  text('connection-label', label);
  $('connection-detail').hidden = state.online && !state.connectionUnconfirmed;
  text('connection-detail', !state.online
    ? 'Las consultas y los registros están pausados. Recupera la conexión para continuar; no se guardan operaciones pendientes.'
    : 'No hemos recibido una respuesta del servicio. Comprueba la conexión y vuelve a consultar los datos.');
}

function markConnectionChecked() {
  state.lastConnectionCheck = new Date();
  state.connectionUnconfirmed = false;
  renderConnection();
}

function isNetworkError(error) {
  return ['OFFLINE', 'REQUEST_TIMEOUT', 'CONNECTION_TIMEOUT', 'CONNECTION_ERROR', 'CLOSED'].includes(error.code);
}

function expiryTime(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  return Date.parse(value);
}

function persistSession() {
  try {
    sessionStorage.setItem(sessionKey, JSON.stringify({ token: state.token, role: state.role,
      expiresAt: state.expiresAt, eventName: state.eventName, endpoint: demo ? 'demo' : endpoint }));
  } catch { /* The current session still works when browser storage is disabled. */ }
}

function removeSession() {
  try { sessionStorage.removeItem(sessionKey); } catch { /* Storage may be unavailable. */ }
}

function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
    if (saved && saved.endpoint === (demo ? 'demo' : endpoint) && typeof saved.token === 'string' && saved.token &&
      ['operator', 'admin'].includes(saved.role) && expiryTime(saved.expiresAt) > Date.now()) return saved;
  } catch { /* Ignore an incomplete or expired session. */ }
  removeSession();
  return null;
}

const scanner = new QRScanner({
  video: $('camera-video'), overlay: $('camera-overlay'),
  onDecode: (qr) => {
    if (state.token && state.tab === 'scanner' && !state.registerBusy && !state.lookupBusy && !state.configBusy) {
      $('manual-id').value = qr;
      void lookup(qr, { source: 'camera' });
    }
  },
  onState: (camera) => {
    state.camera = camera;
    $('camera-placeholder').hidden = camera.running;
    $('video-shell').classList.toggle('is-running', camera.running);
    $('camera-badge').textContent = camera.running ? 'Cámara activa' : 'Cámara apagada';
    $('camera-badge').classList.toggle('is-active', camera.running);
    const existing = [...$('camera-select').options].map((option) => [option.value, option.textContent]);
    const next = camera.cameras?.length ? camera.cameras.map((item) => [item.id, item.label]) : [['', 'Cámara predeterminada']];
    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      $('camera-select').replaceChildren(...next.map(([id, label]) => {
        const option = document.createElement('option');
        option.value = id; option.textContent = label; return option;
      }));
    }
    $('camera-select').value = camera.selectedCameraId || '';
    $('camera-torch').setAttribute('aria-pressed', String(Boolean(camera.torchOn)));
    $('camera-torch').setAttribute('aria-label', camera.torchOn ? 'Apagar flash' : 'Encender flash');
    $('camera-torch').title = camera.torchSupported ? (camera.torchOn ? 'Apagar flash' : 'Encender flash') : 'El flash no está disponible en esta cámara';
    syncControls();
  },
  onError: (error) => {
    if (state.token) status('scan-status', error.message || 'No se pudo abrir la cámara. Puedes buscar el identificador manualmente.', 'error');
  },
});

function syncControls() {
  const locked = state.registerBusy || state.configBusy;
  const scanLocked = locked || state.lookupBusy || state.cameraBusy || !state.token || state.configRequired || !state.online;
  $('camera-start').disabled = scanLocked || state.camera.running;
  $('camera-stop').disabled = locked || (!state.camera.running && !state.cameraBusy);
  $('camera-select').disabled = scanLocked || !state.camera.running || state.camera.cameras.length < 2;
  $('camera-torch').disabled = scanLocked || !state.camera.running || !state.camera.torchSupported;
  $('manual-id').disabled = locked || !state.token || state.configRequired;
  $('lookup-button').disabled = scanLocked;
  $('lookup-button').textContent = state.lookupBusy ? 'Buscando…' : 'Buscar';
  $('clear-selection').disabled = locked || (!state.qr && !state.match && !state.lookupBusy && !$('manual-id').value);
  $('register-button').disabled = locked || state.lookupBusy || !state.match?.found ||
    !state.match?.person || Boolean(state.match.person.alreadyRegistered) || state.configRequired || !state.online;
  $('register-button').textContent = state.registerBusy ? 'Guardando asistencia…' : state.match?.person?.alreadyRegistered ? 'Asistencia registrada' : 'Registrar asistencia  ✓';
  $('next-person').disabled = locked || state.lookupBusy;
  $('refresh').disabled = locked || state.refreshBusy || state.lookupBusy || !state.online;
  $('refresh').setAttribute('aria-busy', String(state.refreshBusy));
  document.querySelectorAll('[data-tab]').forEach((button) => { button.disabled = locked; });
  $('table-search').disabled = locked || state.configRequired || !state.online;
  $('clear-filters').disabled = locked || state.configRequired || !state.online;
  $('previous-page').disabled = locked || state.table.loading || state.table.page <= 1 || !state.online;
  $('next-page').disabled = locked || state.table.loading || state.table.page >= state.table.pages || !state.online;
  document.querySelectorAll('#records-head input, #records-head button, [data-consult-id]').forEach((element) => {
    element.disabled = locked || !state.online || (element.hasAttribute('data-consult-id') && state.lookupBusy);
  });
  $('login-button').disabled = state.connecting || state.authenticating || !state.connected || !state.online;
  $('login-button').textContent = state.connecting ? 'Conectando…' : state.authenticating ? 'Comprobando…' : 'Entrar  →';
  $('access-code').disabled = state.authenticating;
  $('login-role').disabled = state.authenticating;
  document.querySelectorAll('#config-form input, #config-form button').forEach((element) => { element.disabled = state.configBusy; });
  $('validate-config').disabled = state.configBusy || !state.online;
  $('save-config').disabled = state.configBusy || !state.online;
  $('validate-config').textContent = state.configBusy ? 'Espera…' : 'Comprobar conexión';
  $('save-config').textContent = state.configBusy ? 'Espera…' : 'Guardar configuración';
}

function showScreen(screen) {
  ['setup', 'login', 'app'].forEach((name) => { $(`${name}-screen`).hidden = name !== screen; });
  $('session-tools').hidden = screen !== 'app';
}

function clearMatch({ clearInput = true, clearStatus = true } = {}) {
  state.lookupSeq += 1;
  state.lookupBusy = false;
  state.qr = '';
  state.match = null;
  state.lookupSource = 'manual';
  setOperation('idle');
  if (clearInput) $('manual-id').value = '';
  $('person-card').hidden = true;
  $('match-empty').hidden = false;
  $('match-empty').querySelector('h3').textContent = 'Esperando un código';
  $('match-empty').querySelector('p').textContent = 'Escanea un QR o busca un identificador para ver la ficha del asistente.';
  $('qr-details').hidden = true;
  $('qr-details').open = false;
  $('qr-content').textContent = '';
  ['person-name', 'person-initials', 'person-source', 'person-role', 'person-id', 'person-institution',
    'person-email', 'person-attend', 'person-participate', 'person-registered-at'].forEach((id) => { $(id).textContent = ''; });
  if (clearStatus) status('scan-status');
  syncControls();
}

function resetTable() {
  clearTimeout(tableSearchTimer);
  state.tableSeq += 1;
  state.table = { query: '', filters: {}, sort: { key: '', direction: 'asc' }, page: 1,
    pages: 0, pageSize: 25, columns: [], rows: [], total: 0, filtered: 0, loading: false };
  $('table-search').value = '';
  $('records-head').replaceChildren();
  $('records-body').replaceChildren();
  $('table-empty').hidden = true;
  $('table-count').textContent = '—';
  $('page-label').textContent = 'Página 1';
  status('table-status');
}

function logout(message = '') {
  state.authSeq += 1;
  state.metaSeq += 1;
  state.configSeq += 1;
  clearTimeout(state.expiryTimer);
  scanner.stop();
  state.token = ''; state.role = ''; state.expiresAt = ''; state.eventName = '';
  state.registerBusy = false; state.configBusy = false; state.lookupBusy = false;
  state.refreshBusy = false; state.configRequired = false; state.configLoaded = false;
  state.configVersion = null; state.configFormVersion = null;
  state.lastConnectionCheck = null; state.connectionUnconfirmed = false;
  removeSession();
  clearMatch(); resetTable();
  $('config-form').reset();
  ['global-status', 'data-warnings', 'config-status'].forEach((id) => status(id));
  ['pre', 'onsite', 'attendance'].forEach((key) => text(`count-${key}`, '—'));
  text('last-updated', 'Pendiente de actualización');
  text('event-name', config.title || 'Control de asistencia');
  document.title = 'Registro QR · Control de asistencia';
  $('access-code').value = demo ? 'demo' : '';
  showScreen('login');
  status('login-status', message, message ? 'warning' : '');
  renderConnection();
  syncControls();
  $('access-code').focus();
}

function armSessionExpiry() {
  clearTimeout(state.expiryTimer);
  const remaining = expiryTime(state.expiresAt) - Date.now();
  if (Number.isFinite(remaining) && remaining > 0) {
    state.expiryTimer = setTimeout(() => logout('Tu sesión ha caducado. Vuelve a introducir el código de acceso.'), Math.min(remaining, 2147483647));
  }
}

async function connect() {
  if (state.connecting) return false;
  state.connecting = true; state.connected = false;
  status('login-status', 'Conectando con el registro…', 'loading');
  syncControls();
  try {
    client?.destroy();
    client = createClient(config);
    await client.connect();
    state.connected = true;
    status('login-status');
    return true;
  } catch (error) {
    status('login-status', error.message || 'No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.', 'error');
    const retry = document.createElement('button');
    retry.type = 'button'; retry.id = 'retry-connection'; retry.className = 'button button-secondary full-width';
    retry.textContent = 'Reintentar conexión';
    retry.addEventListener('click', () => { void connect(); });
    $('login-status').append(retry);
    return false;
  } finally {
    state.connecting = false;
    syncControls();
  }
}

async function api(action, payload = {}) {
  if (!state.online) throw Object.assign(new Error('Sin conexión. Conéctate a internet y vuelve a consultar el identificador.'), { code: 'OFFLINE' });
  const authSeq = state.authSeq;
  try {
    const result = await client.request(action, payload, state.token);
    if (authSeq === state.authSeq && state.token) markConnectionChecked();
    return result;
  } catch (error) {
    if (authSeq === state.authSeq && state.token && isNetworkError(error)) {
      state.connectionUnconfirmed = true;
      renderConnection();
    }
    throw error;
  }
}

function configuredHint() {
  const message = state.role === 'admin'
    ? 'Configura la base de Google Sheets en la pestaña Configuración para empezar a registrar.'
    : 'La organización todavía no ha configurado la base del evento. Un administrador debe entrar y elegir el archivo de Google Sheets.';
  status('global-status', message, 'warning');
}

function handleError(error, target = 'global-status') {
  if (['UNAUTHORIZED', 'SESSION_EXPIRED', 'AUTH_EXPIRED'].includes(error.code)) {
    logout('Tu sesión ha caducado o ya no es válida. Vuelve a entrar.');
    return;
  }
  if (error.code === 'CONFIG_REQUIRED') {
    state.configRequired = true;
    scanner.stop(); clearMatch({ clearStatus: false }); resetTable();
    configuredHint();
    if (target !== 'global-status') status(target, 'Falta configurar la base del evento.', 'warning');
    syncControls();
    return;
  }
  if (error.code === 'CONFIG_CHANGED') {
    scanner.stop(); clearMatch({ clearStatus: false }); resetTable();
    status('global-status', 'La base del evento ha cambiado. Actualizamos los datos; vuelve a buscar el QR antes de registrar.', 'warning');
    status(target, 'La configuración cambió. Vuelve a consultar el QR para registrar en la base actual.', 'warning');
    void refreshMetadata();
    return;
  }
  status(target, error.message || 'No se pudo completar la operación. Inténtalo de nuevo.', 'error');
}

function acceptVersion(version) {
  if (version === undefined || version === null) return;
  if (state.configVersion !== null && String(version) !== String(state.configVersion)) {
    scanner.stop(); clearMatch({ clearStatus: false });
    state.configLoaded = false;
    status('global-status', 'La base del evento se ha actualizado. Comprueba los datos y vuelve a buscar el QR antes de registrar.', 'warning');
  }
  state.configVersion = version;
}

function setCounts(counts = {}) {
  ['pre', 'onsite', 'attendance'].forEach((key) => text(`count-${key}`, numberLabel(counts[key])));
}

async function refreshMetadata() {
  const seq = ++state.metaSeq;
  const authSeq = state.authSeq;
  try {
    const result = await api('bootstrap');
    if (seq !== state.metaSeq || authSeq !== state.authSeq || !state.token) return false;
    acceptVersion(result.configVersion);
    state.configRequired = false;
    state.eventName = result.eventName || config.title || 'Control de asistencia';
    text('event-name', state.eventName);
    document.title = `${state.eventName} · Registro QR`;
    setCounts(result.counts);
    text('last-updated', `Actualizado: ${dateLabel(result.updatedAt || new Date().toISOString())}`);
    status('data-warnings', (result.warnings || []).join(' '), 'warning');
    persistSession();
    syncControls();
    return true;
  } catch (error) {
    if (seq === state.metaSeq && authSeq === state.authSeq && state.token) handleError(error);
    return false;
  }
}

async function enterSession(session) {
  state.authSeq += 1;
  state.token = session.token;
  state.role = session.role || 'operator';
  state.expiresAt = session.expiresAt;
  state.eventName = session.eventName || config.title || 'Control de asistencia';
  persistSession(); armSessionExpiry();
  text('event-name', state.eventName);
  text('session-role', state.role === 'admin' ? 'Administración' : 'Organización');
  $('tab-config').hidden = state.role !== 'admin';
  $('access-code').value = '';
  showScreen('app');
  selectTab('scanner', { load: false });
  status('global-status', 'Cargando la base del evento…', 'loading');
  const ok = await refreshMetadata();
  if (!state.token) return;
  if (ok) status('global-status');
  if (state.configRequired && state.role === 'admin') selectTab('config');
  syncControls();
}

async function login(event) {
  event.preventDefault();
  if (state.authenticating || !state.connected || !state.online) return;
  const code = $('access-code').value.trim();
  if (!code) { status('login-status', 'Introduce el código de acceso.', 'warning'); return; }
  state.authenticating = true;
  status('login-status', 'Comprobando el acceso…', 'loading'); syncControls();
  try {
    const result = await client.request($('login-role').value === 'admin' ? 'adminLogin' : 'login', { code });
    if (!result.token) throw new Error('No se recibió una sesión válida. Inténtalo de nuevo.');
    markConnectionChecked();
    status('login-status');
    await enterSession(result);
  } catch (error) {
    status('login-status', error.message || 'No se pudo iniciar sesión. Revisa el código de acceso.', 'error');
  } finally {
    state.authenticating = false;
    syncControls();
  }
}

function renderPerson(person) {
  $('match-empty').hidden = true;
  $('person-card').hidden = false;
  text('person-name', person.name, 'Sin nombre');
  text('person-initials', String(person.name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase());
  text('person-source', person.sourceLabel || (person.source === 'onsite' ? 'In situ' : 'Pre-registrado'));
  text('person-role', person.role, 'ATTENDING');
  for (const key of ['id', 'institution', 'email', 'attend', 'participate']) text(`person-${key}`, person[key]);
  $('person-registration').hidden = !person.alreadyRegistered;
  $('registered-at-row').hidden = !person.registeredAt;
  text('person-registered-at', dateLabel(person.registeredAt));
  syncControls();
}

async function lookup(raw, { source = 'manual' } = {}) {
  const qr = String(raw || '').trim();
  if (!state.token || state.registerBusy || state.configBusy || state.lookupBusy) return;
  if (!state.online) { renderConnection(); syncControls(); return; }
  if (!qr) { status('scan-status', 'Introduce un identificador o escanea un código QR.', 'warning'); $('manual-id').focus(); return; }
  if (qr.length > 4096) { status('scan-status', 'El contenido del código es demasiado largo.', 'error'); return; }
  scanner.stop();
  clearMatch({ clearInput: false });
  const seq = ++state.lookupSeq;
  const authSeq = state.authSeq;
  state.lookupBusy = true; state.qr = qr;
  state.lookupSource = source;
  $('manual-id').value = qr;
  $('qr-details').hidden = false;
  $('qr-content').textContent = qr;
  status('scan-status', 'Buscando en la base del evento…', 'loading');
  setOperation('searching', 'Consulta en curso. La asistencia aún no se ha confirmado.');
  syncControls();
  try {
    const result = await api('lookup', { qr });
    if (seq !== state.lookupSeq || authSeq !== state.authSeq || !state.token) return;
    acceptVersion(result.configVersion);
    // acceptVersion may clear the previous selection when another device changed the base.
    // This response itself was read from the current base, so attach it to this exact QR.
    state.qr = qr; state.match = result;
    state.lookupSource = source;
    $('manual-id').value = qr;
    $('qr-details').hidden = false; $('qr-content').textContent = qr;
    if (result.found && result.person) {
      setOperation(result.person.alreadyRegistered ? 'already' : 'pending', result.person.alreadyRegistered
        ? (result.person.registeredAt ? `Asistencia registrada el ${dateLabel(result.person.registeredAt)}.` : 'Ya consta una asistencia registrada. No se añadirá otro registro.')
        : 'Verifica la identidad y pulsa Registrar asistencia para confirmar.');
      renderPerson(result.person);
      status('scan-status', result.person.alreadyRegistered
        ? 'Esta persona ya tiene la asistencia registrada.'
        : 'Persona encontrada. Comprueba sus datos y registra la asistencia.', result.person.alreadyRegistered ? 'warning' : '');
    } else {
      setOperation('not-found', 'Comprueba el código o busca por nombre y correo en Pre-registrados o In situ.');
      $('match-empty').hidden = false;
      $('match-empty').querySelector('h3').textContent = 'No se encontró una coincidencia';
      $('match-empty').querySelector('p').textContent = 'Si tampoco aparece en las listas, consulta con la organización antes de registrar.';
      status('scan-status', 'No hay una inscripción que coincida con este código.', 'warning');
    }
    showResultOnMobile();
  } catch (error) {
    if (seq === state.lookupSeq && authSeq === state.authSeq && state.token) {
      handleError(error, 'scan-status');
      if (state.token && !['CONFIG_CHANGED', 'CONFIG_REQUIRED'].includes(error.code)) {
        setOperation('unconfirmed', 'No se ha podido comprobar la inscripción. Revisa el mensaje y vuelve a buscar.');
        showResultOnMobile();
      }
    }
  } finally {
    if (authSeq === state.authSeq && seq === state.lookupSeq) {
      state.lookupBusy = false;
      syncControls();
    }
  }
}

async function register() {
  if (state.registerBusy || state.lookupBusy || !state.match?.found || !state.match.person || state.match.person.alreadyRegistered || !state.online) return;
  const qr = state.qr;
  const match = state.match;
  const authSeq = state.authSeq;
  const seq = state.lookupSeq;
  state.registerBusy = true;
  scanner.stop();
  status('scan-status', 'Guardando la asistencia. Espera la confirmación…', 'loading');
  setOperation('checking', 'Espera la respuesta del registro antes de continuar con la siguiente persona.');
  syncControls();
  try {
    const result = await api('register', { qr, configVersion: match.configVersion });
    if (authSeq !== state.authSeq || seq !== state.lookupSeq || qr !== state.qr || !state.token) return;
    if (!['registered', 'already'].includes(result.status)) throw new Error('No se recibió una confirmación de registro. Vuelve a consultar este QR antes de continuar.');
    state.match = { ...match, configVersion: result.configVersion ?? match.configVersion,
      person: { ...match.person, ...result.person, alreadyRegistered: true,
        registeredAt: result.registeredAt || result.person?.registeredAt || match.person.registeredAt } };
    setOperation(result.status === 'already' ? 'already' : 'registered', state.match.person.registeredAt
      ? `${result.status === 'already' ? 'Asistencia ya registrada' : 'Asistencia confirmada'} el ${dateLabel(state.match.person.registeredAt)}.`
      : result.status === 'already' ? 'La asistencia ya estaba registrada. No se ha duplicado.' : 'La asistencia se ha guardado correctamente.');
    renderPerson(state.match.person);
    status('scan-status', result.message || (result.status === 'already' ? 'Esta persona ya tenía la asistencia registrada.' : 'Asistencia registrada correctamente.'), result.status === 'already' ? 'warning' : 'success');
    showResultOnMobile();
    void refreshMetadata();
  } catch (error) {
    if (authSeq === state.authSeq && seq === state.lookupSeq && state.token) {
      handleError(error, 'scan-status');
      // Any unconfirmed write requires a fresh lookup before another attempt.
      if (state.token && !['CONFIG_CHANGED', 'CONFIG_REQUIRED'].includes(error.code)) {
        state.match = null;
        setOperation('unconfirmed', 'No hay confirmación del resultado. Vuelve a buscar este identificador antes de intentar registrarlo otra vez.');
        $('person-card').hidden = true;
        $('match-empty').hidden = false;
        $('match-empty').querySelector('h3').textContent = 'Comprueba el resultado';
        $('match-empty').querySelector('p').textContent = 'Vuelve a buscar este identificador para comprobar si la asistencia se ha guardado.';
        showResultOnMobile();
      }
    }
  } finally {
    if (authSeq === state.authSeq) { state.registerBusy = false; syncControls(); }
  }
}

function selectTab(tab, { load = true } = {}) {
  if (state.registerBusy || state.configBusy || !state.token || (tab === 'config' && state.role !== 'admin')) return;
  if (tab !== 'scanner') scanner.stop();
  const changed = state.tab !== tab;
  state.tab = tab;
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    if (selected) {
      const tabs = button.parentElement;
      const visible = tabs.getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      if (bounds.left < visible.left) tabs.scrollLeft -= visible.left - bounds.left;
      else if (bounds.right > visible.right) tabs.scrollLeft += bounds.right - visible.right;
    }
  });
  $('scanner-panel').hidden = tab !== 'scanner';
  $('table-panel').hidden = !(tab in tableNames);
  $('config-panel').hidden = tab !== 'config';
  if (tab in tableNames) {
    $('table-panel').setAttribute('aria-labelledby', `tab-${tab}`);
    text('table-title', tableNames[tab]); text('table-caption', `Listado de ${tableNames[tab].toLowerCase()}`);
    text('table-description', tableDescriptions[tab]);
    if (changed) resetTable();
    if (load) void loadTable();
  }
  if (tab === 'config' && load && !state.configLoaded) void loadConfig();
}

function queueTableSearch() {
  clearTimeout(tableSearchTimer);
  state.table.page = 1;
  // Ignore an old response as soon as the user changes a filter, before the debounce fires.
  state.tableSeq += 1;
  tableSearchTimer = setTimeout(() => { void loadTable(); }, 350);
}

function renderTableHead(columns) {
  const currentKeys = state.table.columns.map((column) => [column.key, column.label]);
  const nextKeys = columns.map((column) => [column.key, column.label]);
  if ($('records-head').childElementCount && JSON.stringify(currentKeys) === JSON.stringify(nextKeys)) {
    updateSortLabels(); return;
  }
  const row = document.createElement('tr');
  if (state.tab === 'pre' || state.tab === 'onsite') {
    const action = document.createElement('th');
    action.scope = 'col'; action.className = 'action-column action-column-header'; action.textContent = 'Ficha';
    row.append(action);
  }
  for (const column of columns) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.dataset.column = column.key;
    const sort = document.createElement('button'); sort.type = 'button'; sort.className = 'sort-button'; sort.dataset.sort = column.key;
    const label = document.createElement('span'); label.textContent = column.label;
    const arrow = document.createElement('span'); arrow.className = 'sort-arrow'; arrow.setAttribute('aria-hidden', 'true');
    sort.append(label, arrow);
    sort.addEventListener('click', () => {
      state.table.sort = { key: column.key, direction: state.table.sort.key === column.key && state.table.sort.direction === 'asc' ? 'desc' : 'asc' };
      state.table.page = 1; void loadTable();
    });
    const input = document.createElement('input'); input.type = 'search'; input.dataset.filter = column.key;
    input.setAttribute('aria-label', `Filtrar por ${column.label}`); input.placeholder = 'Filtrar…'; input.autocomplete = 'off';
    input.value = state.table.filters[column.key] || '';
    input.addEventListener('input', () => {
      if (input.value) state.table.filters[column.key] = input.value;
      else delete state.table.filters[column.key];
      queueTableSearch();
    });
    cell.append(sort, input); row.append(cell);
  }
  $('records-head').replaceChildren(row);
  updateSortLabels();
}

function updateSortLabels() {
  document.querySelectorAll('#records-head th[data-column]').forEach((cell) => {
    const active = cell.dataset.column === state.table.sort.key;
    cell.setAttribute('aria-sort', active ? (state.table.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    cell.querySelector('.sort-arrow').textContent = active ? (state.table.sort.direction === 'asc' ? '↑' : '↓') : '↕';
    cell.querySelector('.sort-button').setAttribute('aria-label', `Ordenar por ${cell.querySelector('.sort-button span').textContent}, ${active && state.table.sort.direction === 'asc' ? 'descendente' : 'ascendente'}`);
  });
}

async function loadTable() {
  clearTimeout(tableSearchTimer);
  if (!(state.tab in tableNames) || !state.token || state.configRequired || !state.online) return false;
  const dataset = state.tab;
  const seq = ++state.tableSeq;
  const authSeq = state.authSeq;
  state.table.loading = true;
  $('records-table').setAttribute('aria-busy', 'true');
  status('table-status', 'Cargando registros…', 'loading');
  syncControls();
  try {
    const payload = { dataset, query: state.table.query, filters: { ...state.table.filters },
      page: state.table.page, pageSize: 25 };
    if (state.table.sort.key) payload.sort = { ...state.table.sort };
    const result = await api('list', payload);
    if (seq !== state.tableSeq || authSeq !== state.authSeq || dataset !== state.tab || !state.token) return false;
    acceptVersion(result.configVersion);
    const columns = Array.isArray(result.columns) ? result.columns : [];
    const rows = Array.isArray(result.rows) ? result.rows : [];
    renderTableHead(columns);
    state.table.columns = columns;
    state.table.rows = rows;
    state.table.page = result.page || 1;
    state.table.pages = result.pages || 0;
    state.table.total = result.total || 0;
    state.table.filtered = result.filtered || 0;
    const body = document.createDocumentFragment();
    for (const record of rows) {
      const row = document.createElement('tr');
      if (dataset === 'pre' || dataset === 'onsite') {
        const action = document.createElement('td'); action.className = 'action-column';
        if (record.__id !== undefined && record.__id !== null && String(record.__id).trim()) {
          const id = String(record.__id);
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'button button-secondary consult-button';
          button.dataset.consultId = id; button.textContent = 'Consultar';
          button.setAttribute('aria-label', `Consultar la ficha de ${id}`);
          button.addEventListener('click', () => {
            if (state.registerBusy || state.configBusy || state.lookupBusy || !state.online) return;
            selectTab('scanner');
            $('manual-id').value = id;
            void lookup(id, { source: 'directory' });
          });
          action.append(button);
        } else {
          action.textContent = 'Sin ID';
        }
        row.append(action);
      }
      for (const column of columns) {
        const cell = document.createElement('td');
        cell.textContent = record[column.key] === null || record[column.key] === undefined || record[column.key] === '' ? '—' : String(record[column.key]);
        row.append(cell);
      }
      body.append(row);
    }
    $('records-body').replaceChildren(body);
    $('table-empty').hidden = rows.length > 0;
    const first = rows.length ? (state.table.page - 1) * 25 + 1 : 0;
    const last = rows.length ? first + rows.length - 1 : 0;
    text('table-count', `${first}–${last} de ${numberLabel(state.table.filtered)}${state.table.filtered !== state.table.total ? ` (${numberLabel(state.table.total)} en total)` : ''}`);
    text('page-label', `Página ${state.table.page} de ${Math.max(1, state.table.pages)}`);
    status('table-status');
    return true;
  } catch (error) {
    if (seq === state.tableSeq && authSeq === state.authSeq && state.token) handleError(error, 'table-status');
    return false;
  } finally {
    if (seq === state.tableSeq && authSeq === state.authSeq) {
      state.table.loading = false;
      $('records-table').setAttribute('aria-busy', 'false');
      syncControls();
    }
  }
}

function populateConfig(result) {
  $('config-url').value = result.spreadsheetUrl || '';
  $('config-event').value = result.eventName || '';
  $('config-pre').value = result.sheets?.pre || 'Hoja 2';
  $('config-onsite').value = result.sheets?.onsite || 'Hoja 0';
  $('config-attendance').value = result.sheets?.attendance || 'Hoja 1';
  state.configFormVersion = result.version;
  state.configLoaded = true;
}

async function loadConfig() {
  if (state.role !== 'admin' || state.configBusy) return;
  const seq = ++state.configSeq;
  const authSeq = state.authSeq;
  state.configBusy = true;
  status('config-status', 'Cargando configuración…', 'loading'); syncControls();
  try {
    const result = await api('getConfig');
    if (seq !== state.configSeq || authSeq !== state.authSeq || !state.token) return;
    populateConfig(result);
    status('config-status');
  } catch (error) {
    if (seq === state.configSeq && authSeq === state.authSeq && state.token) handleError(error, 'config-status');
  } finally {
    if (seq === state.configSeq && authSeq === state.authSeq) { state.configBusy = false; syncControls(); }
  }
}

function configPayload() {
  return { spreadsheetUrl: $('config-url').value.trim(), eventName: $('config-event').value.trim(),
    sheets: { pre: $('config-pre').value.trim(), onsite: $('config-onsite').value.trim(), attendance: $('config-attendance').value.trim() },
    version: state.configFormVersion };
}

async function configure(save) {
  if (state.configBusy || state.role !== 'admin' || !state.online || !$('config-form').reportValidity()) return;
  const payload = configPayload();
  if (Object.values(payload.sheets).some((name) => !name) || !payload.eventName) {
    status('config-status', 'Completa el nombre del evento y los nombres de las tres pestañas.', 'warning'); return;
  }
  const seq = ++state.configSeq;
  const authSeq = state.authSeq;
  state.configBusy = true;
  scanner.stop();
  status('config-status', save ? 'Comprobando y guardando la configuración…' : 'Comprobando la conexión y las pestañas…', 'loading');
  syncControls();
  try {
    const result = await api(save ? 'saveConfig' : 'validateConfig', payload);
    if (seq !== state.configSeq || authSeq !== state.authSeq || !state.token) return;
    if (save) {
      clearMatch(); resetTable();
      state.metaSeq += 1;
      state.configVersion = result.version ?? null;
      state.configRequired = false;
      populateConfig({ ...payload, ...result });
      status('global-status');
      await refreshMetadata();
      if (authSeq !== state.authSeq || !state.token) return;
    }
    const counts = result.counts;
    const summary = counts ? ` ${numberLabel(counts.pre)} pre-registrados, ${numberLabel(counts.onsite)} inscritos in situ y ${numberLabel(counts.attendance)} asistentes.` : '';
    const warnings = (result.warnings || []).join(' ');
    const title = result.spreadsheetTitle ? ` Archivo: ${result.spreadsheetTitle}.` : '';
    status('config-status', `${save ? 'Configuración guardada para todos los dispositivos.' : 'Conexión comprobada correctamente. Aún no se han guardado los cambios.'}${title}${summary}${warnings ? ` ${warnings}` : ''}`, warnings ? 'warning' : 'success');
  } catch (error) {
    if (seq === state.configSeq && authSeq === state.authSeq && state.token) handleError(error, 'config-status');
  } finally {
    if (seq === state.configSeq && authSeq === state.authSeq) { state.configBusy = false; syncControls(); }
  }
}

async function refresh() {
  if (state.refreshBusy || state.registerBusy || state.lookupBusy || state.configBusy || !state.online) return;
  state.refreshBusy = true;
  const authSeq = state.authSeq;
  status('global-status', 'Actualizando datos…', 'loading'); syncControls();
  const ok = await refreshMetadata();
  if (authSeq !== state.authSeq || !state.token) return;
  let tableOk = true;
  if (ok && state.tab in tableNames) tableOk = await loadTable();
  if (authSeq !== state.authSeq || !state.token) return;
  if (ok && tableOk) status('global-status', 'Datos actualizados.', 'success');
  state.refreshBusy = false;
  syncControls();
}

async function startCamera() {
  if (state.cameraBusy || state.lookupBusy || state.registerBusy || state.configBusy || state.configRequired || !state.online) return;
  clearMatch();
  state.cameraBusy = true;
  status('scan-status', 'Abriendo la cámara…', 'loading'); syncControls();
  const authSeq = state.authSeq;
  try {
    const opened = await scanner.start($('camera-select').value || undefined);
    if (authSeq !== state.authSeq || !state.token || state.tab !== 'scanner') { scanner.stop(); return; }
    if (opened) status('scan-status', 'Cámara lista. Coloca el QR dentro del recuadro.');
  } catch (error) { if (authSeq === state.authSeq && state.token) handleError(error, 'scan-status'); }
  finally { state.cameraBusy = false; syncControls(); }
}

$('login-form').addEventListener('submit', login);
$('logout').addEventListener('click', () => logout());
$('lookup-form').addEventListener('submit', (event) => { event.preventDefault(); void lookup($('manual-id').value); });
$('manual-id').addEventListener('input', () => {
  if (state.qr && $('manual-id').value.trim() !== state.qr) {
    scanner.stop();
    clearMatch({ clearInput: false });
    status('scan-status', 'El identificador ha cambiado. Pulsa Buscar para consultar sus datos.');
  }
  syncControls();
});
$('register-button').addEventListener('click', () => { void register(); });
$('clear-selection').addEventListener('click', () => {
  if (state.registerBusy || state.configBusy) return;
  scanner.stop(); clearMatch();
  status('scan-status', 'Campos limpiados. Puedes buscar al siguiente asistente.');
  $('manual-id').focus();
});
$('next-person').addEventListener('click', () => {
  if (state.registerBusy || state.configBusy || state.lookupBusy) return;
  const useCamera = state.lookupSource === 'camera';
  scanner.stop(); clearMatch();
  if (useCamera && state.online) {
    void startCamera();
    $('video-shell').scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } else {
    status('scan-status', 'Listo para la siguiente persona. Introduce o escanea su identificador.');
    $('manual-id').focus();
  }
});
$('camera-start').addEventListener('click', () => { void startCamera(); });
$('camera-stop').addEventListener('click', () => {
  scanner.stop(); state.cameraBusy = false;
  status('scan-status', 'Cámara cerrada. Puedes seguir buscando por identificador.'); syncControls();
});
$('camera-select').addEventListener('change', async () => {
  if (state.registerBusy || state.lookupBusy || state.cameraBusy) return;
  state.cameraBusy = true; syncControls();
  try { await scanner.switchCamera($('camera-select').value); }
  catch (error) { handleError(error, 'scan-status'); }
  finally { state.cameraBusy = false; syncControls(); }
});
$('camera-torch').addEventListener('click', async () => {
  if (state.cameraBusy || state.registerBusy) return;
  state.cameraBusy = true; syncControls();
  try { await scanner.toggleTorch(); }
  catch (error) { handleError(error, 'scan-status'); }
  finally { state.cameraBusy = false; syncControls(); }
});
$('refresh').addEventListener('click', () => { void refresh(); });
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-tab]')].filter((tab) => !tab.hidden && !tab.disabled);
    const current = tabs.indexOf(button);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next]?.focus(); if (tabs[next]) selectTab(tabs[next].dataset.tab);
  });
});
$('table-search').addEventListener('input', () => { state.table.query = $('table-search').value; queueTableSearch(); });
$('clear-filters').addEventListener('click', () => { resetTable(); void loadTable(); });
$('previous-page').addEventListener('click', () => { if (state.table.page > 1) { state.table.page -= 1; void loadTable(); } });
$('next-page').addEventListener('click', () => { if (state.table.page < state.table.pages) { state.table.page += 1; void loadTable(); } });
$('config-form').addEventListener('submit', (event) => { event.preventDefault(); void configure(true); });
$('validate-config').addEventListener('click', () => { void configure(false); });
window.addEventListener('pagehide', () => { scanner.stop(); });
window.addEventListener('beforeunload', () => { scanner.destroy(); client?.destroy(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) scanner.stop(); });
window.addEventListener('offline', () => {
  state.online = false;
  scanner.stop();
  renderConnection(); syncControls();
});
window.addEventListener('online', () => {
  state.online = true;
  state.lastConnectionCheck = null;
  state.connectionUnconfirmed = false;
  renderConnection(); syncControls();
});

async function initialize() {
  renderConnection();
  $('demo-banner').hidden = !demo;
  $('demo-login-hint').hidden = !demo;
  if (demo) {
    $('demo-login-hint').textContent = 'Código de demostración: demo. Puedes probar ambos tipos de acceso.';
    $('access-code').value = 'demo';
  }
  if (!endpoint && !demo) { showScreen('setup'); return; }
  showScreen('login');
  const saved = readSession();
  if (await connect()) {
    if (saved) await enterSession(saved);
    else $('access-code').focus();
  }
}

void initialize();
