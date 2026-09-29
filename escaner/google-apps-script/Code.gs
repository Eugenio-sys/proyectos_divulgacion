/**
 * Registro QR — backend de Google Apps Script (motor V8).
 * Configuración y secretos: Propiedades de la secuencia de comandos.
 * Nunca crea pestañas, elimina filas ni modifica datos durante una validación.
 * api(request) es el punto de entrada de datos; los helpers terminan en «_».
 */
var QR_NAMESPACE_ = 'registro-qr-v1';
var QR_TIMEZONE_ = 'America/Puerto_Rico';
var QR_SESSION_SECONDS_ = 6 * 60 * 60;
var QR_ALIASES_ = {
  id: ['id', 'id_asignado', 'codigo_qr_asignado', 'id_3_last_digits', 'id (3 last digits)'],
  name: ['nombre', 'name', 'full_name'],
  institution: ['institucion', 'institución', 'institution', 'affiliation', 'org'],
  attend: ['attend', 'asiste', 'attendance', 'tipo_asistencia'],
  participate: ['participate', 'participacion', 'participación', 'modalidad', 'actividad', 'activities', 'activity'],
  email: ['email', 'e-mail', 'correo', 'correo electrónico', 'correo electronico', 'dirección de correo electrónico', 'direccion de correo electronico', 'dirección de correo electronico', 'direccion de correo electrónico'],
  role: ['rol', 'role'],
  timestamp: ['timestamp', 'fecha_hora', 'datetime', 'fecha', 'hora', 'marca temporal'],
  source: ['source', 'fuente', 'via', 'canal']
};

/** Único punto de entrada RPC. Nunca devuelve excepciones o secretos en bruto. */
function api(request) {
  try {
    if (!isRecord_(request) || typeof request.action !== 'string') {
      fail_('INVALID_REQUEST', 'La solicitud no es válida.');
    }
    var payload = request.payload == null ? {} : request.payload;
    if (!isRecord_(payload)) fail_('INVALID_REQUEST', 'Los datos de la solicitud no son válidos.');
    var properties = PropertiesService.getScriptProperties().getProperties();
    var action = request.action;
    if (action === 'login' || action === 'adminLogin') {
      return { ok: true, data: login_(payload, action === 'adminLogin' ? 'admin' : 'operator', properties) };
    }
    var session = requireSession_(request.token, properties);
    if (action === 'logout') return { ok: true, data: { loggedOut: true } };
    if (action === 'getConfig' || action === 'validateConfig' || action === 'saveConfig') {
      if (session.role !== 'admin') fail_('FORBIDDEN', 'Se requiere acceso de administración.');
      if (action === 'getConfig') return { ok: true, data: publicConfig_(readConfig_(properties, false)) };
      if (action === 'validateConfig') {
        var candidate = candidateConfig_(payload);
        var candidateData = readAll_(candidate);
        return { ok: true, data: validationResult_(candidate, candidateData) };
      }
      return { ok: true, data: saveConfig_(payload, request.token) };
    }
    if (['bootstrap', 'lookup', 'register', 'list'].indexOf(action) < 0) {
      fail_('INVALID_REQUEST', 'La acción solicitada no existe.');
    }
    if (action === 'register') return { ok: true, data: register_(payload, request.token) };
    var config = readConfig_(properties, true);
    var data;
    if (action === 'bootstrap') {
      var all = readAll_(config);
      data = {
        eventName: config.eventName,
        baseSpreadsheetTitle: all.title,
        spreadsheetTitle: all.title,
        counts: counts_(config, all),
        updatedAt: nowPr_(),
        warnings: warnings_(config, all)
      };
    } else if (action === 'lookup') {
      var baseId = baseId_(requireQr_(payload.qr));
      data = lookup_(readAll_(config), baseId);
    } else {
      data = list_(config, payload);
    }
    data.configVersion = config.version;
    return { ok: true, data: data };
  } catch (error) {
    return publicError_(error);
  }
}

/** Puente HTML; el origen solicitado debe coincidir exactamente con la lista. */
function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var nonce = typeof params.nonce === 'string' ? params.nonce : '';
    var origin = typeof params.clientOrigin === 'string' ? params.clientOrigin : '';
    var props = PropertiesService.getScriptProperties().getProperties();
    var origins = allowedOrigins_(props.ALLOWED_ORIGINS);
    if (!/^[a-fA-F0-9]{32,128}$/.test(nonce) || origins.indexOf(origin) < 0) throw new Error('Invalid bridge');
    var template = HtmlService.createTemplateFromFile('Bridge');
    template.bridgeConfigJson = JSON.stringify({ nonce: nonce, parentOrigin: origin, namespace: QR_NAMESPACE_ })
      .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return template.evaluate().setTitle('Registro QR').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (_) {
    return HtmlService.createHtmlOutput('<!doctype html><html lang="es"><meta charset="utf-8"><title>Registro QR</title><p>No se pudo abrir la conexión. Revisa la configuración de la aplicación.</p></html>');
  }
}

function login_(payload, role, properties) {
  var secret = authSecret_(role, properties);
  var supplied = typeof payload.code === 'string' && payload.code.length <= 1024 ? payload.code : '';
  if (!constantTimeEqual_(signature_(supplied, secret), signature_(secret, secret))) {
    fail_('AUTH_FAILED', 'Código de acceso incorrecto.');
  }
  var now = Math.floor(Date.now() / 1000);
  var claims = { v: 1, role: role, iat: now, exp: now + QR_SESSION_SECONDS_, nonce: Utilities.getUuid().replace(/-/g, '') };
  var encoded = base64Url_(JSON.stringify(claims));
  return {
    token: encoded + '.' + signature_(encoded, secret),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    eventName: text_(properties.EVENT_NAME).trim() || 'Registro con QR',
    role: role
  };
}

function authSecret_(role, properties) {
  var key = role === 'admin' ? 'ADMIN_CODE' : 'ACCESS_CODE';
  var secret = text_(properties[key]);
  if (secret.length < 16 || secret.length > 1024) {
    fail_('CONFIG_ERROR', 'El acceso no está configurado. Revisa las propiedades del servidor.');
  }
  if (properties.ADMIN_CODE && properties.ACCESS_CODE && properties.ADMIN_CODE === properties.ACCESS_CODE) {
    fail_('CONFIG_ERROR', 'Administración y operación requieren códigos de acceso diferentes.');
  }
  return secret;
}

function requireSession_(token, properties) {
  try {
    if (typeof token !== 'string' || token.length > 2048) throw new Error('Invalid token');
    var parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw new Error('Invalid token');
    var claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
    if (!isRecord_(claims) || claims.v !== 1 || ['admin', 'operator'].indexOf(claims.role) < 0) throw new Error('Invalid claims');
    var expected = signature_(parts[0], authSecret_(claims.role, properties));
    if (!constantTimeEqual_(parts[1], expected)) throw new Error('Invalid signature');
    var now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= now || claims.iat > now + 30 || claims.exp - claims.iat !== QR_SESSION_SECONDS_ || !/^[a-fA-F0-9]{32}$/.test(claims.nonce)) throw new Error('Expired token');
    return claims;
  } catch (_) {
    fail_('UNAUTHORIZED', 'La sesión terminó o no es válida. Vuelve a iniciar sesión.');
  }
}

function signature_(value, secret) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value, secret, Utilities.Charset.UTF_8)).replace(/=+$/, '');
}

function base64Url_(value) {
  return Utilities.base64EncodeWebSafe(value, Utilities.Charset.UTF_8).replace(/=+$/, '');
}

function constantTimeEqual_(a, b) {
  var diff = a.length ^ b.length;
  var length = Math.max(a.length, b.length);
  for (var i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function allowedOrigins_(raw) {
  var values = text_(raw).split(',').map(function (s) { return s.trim(); });
  if (!values.length || values.some(function (s) { return !/^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?$/.test(s); })) {
    fail_('CONFIG_ERROR', 'Configura uno o varios orígenes HTTPS exactos en ALLOWED_ORIGINS.');
  }
  return values;
}

function readConfig_(properties, required) {
  var config = {
    spreadsheetId: text_(properties.SPREADSHEET_ID).trim(),
    eventName: text_(properties.EVENT_NAME).trim() || 'Registro con QR',
    sheets: {
      pre: text_(properties.SHEET_PRE).trim() || 'Hoja 2',
      onsite: text_(properties.SHEET_ONSITE).trim() || 'Hoja 0',
      attendance: text_(properties.SHEET_ATTENDANCE).trim() || 'Hoja 1'
    }
  };
  if (required && !config.spreadsheetId) fail_('CONFIG_REQUIRED', 'Un administrador debe configurar la base de este evento.');
  if (config.spreadsheetId && !/^[A-Za-z0-9_-]{20,200}$/.test(config.spreadsheetId)) {
    fail_('CONFIG_ERROR', 'El identificador de la base no es válido. Revisa la configuración.');
  }
  validateSheetNames_(config.sheets);
  config.version = version_(config, text_(properties.CONFIG_VERSION));
  return config;
}

function candidateConfig_(payload) {
  if (typeof payload.spreadsheetUrl !== 'string' || payload.spreadsheetUrl.length > 2048) {
    fail_('INVALID_REQUEST', 'Pega el enlace de un archivo de Google Sheets.');
  }
  var url = payload.spreadsheetUrl.trim();
  var match = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})(?:[/?#]|$)/.exec(url);
  if (!match) fail_('INVALID_REQUEST', 'Usa un enlace https://docs.google.com/spreadsheets/d/… de Google Sheets.');
  if (typeof payload.eventName !== 'string' || payload.eventName.trim().length > 200) fail_('INVALID_REQUEST', 'El nombre del evento debe tener como máximo 200 caracteres.');
  if (!isRecord_(payload.sheets)) fail_('INVALID_REQUEST', 'Indica las tres pestañas de la base.');
  var sheets = {};
  ['pre', 'onsite', 'attendance'].forEach(function (key) {
    if (typeof payload.sheets[key] !== 'string') fail_('INVALID_REQUEST', 'Indica las tres pestañas de la base.');
    sheets[key] = payload.sheets[key].trim();
  });
  validateSheetNames_(sheets);
  return { spreadsheetId: match[1], eventName: payload.eventName.trim() || 'Registro con QR', sheets: sheets };
}

function validateSheetNames_(sheets) {
  var names = [sheets.pre, sheets.onsite, sheets.attendance];
  if (names.some(function (s) { return !s || s.length > 100; })) fail_('INVALID_REQUEST', 'Cada pestaña debe tener un nombre de entre 1 y 100 caracteres.');
  if (new Set(names).size !== 3) fail_('INVALID_REQUEST', 'Pre-registro, in situ y asistencia deben usar pestañas diferentes.');
}

function version_(config, revision) {
  var canonical = JSON.stringify([config.spreadsheetId, config.eventName, config.sheets.pre, config.sheets.onsite, config.sheets.attendance, revision]);
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8)).replace(/=+$/, '');
}

function publicConfig_(config) {
  return {
    spreadsheetUrl: config.spreadsheetId ? 'https://docs.google.com/spreadsheets/d/' + config.spreadsheetId + '/edit' : '',
    eventName: config.eventName,
    sheets: { pre: config.sheets.pre, onsite: config.sheets.onsite, attendance: config.sheets.attendance },
    version: config.version
  };
}

function saveConfig_(payload, token) {
  var candidate = candidateConfig_(payload);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) fail_('BUSY', 'Hay otra operación en curso. Espera unos segundos y vuelve a intentarlo.');
  try {
    var propertiesService = PropertiesService.getScriptProperties();
    var properties = propertiesService.getProperties();
    if (requireSession_(token, properties).role !== 'admin') fail_('FORBIDDEN', 'Se requiere acceso de administración.');
    var all = readAll_(candidate); // Validación completa antes de cualquier escritura.
    var update = {
      SPREADSHEET_ID: candidate.spreadsheetId,
      EVENT_NAME: candidate.eventName,
      SHEET_PRE: candidate.sheets.pre,
      SHEET_ONSITE: candidate.sheets.onsite,
      SHEET_ATTENDANCE: candidate.sheets.attendance,
      CONFIG_VERSION: Utilities.getUuid()
    };
    try {
      propertiesService.setProperties(update, false);
    } catch (_) {
      fail_('WRITE_ERROR', 'No se pudo guardar la configuración. Vuelve a consultar la configuración antes de reintentar.');
    }
    candidate.version = version_(candidate, update.CONFIG_VERSION);
    var result = publicConfig_(candidate);
    result.saved = true;
    result.configVersion = candidate.version;
    result.spreadsheetTitle = all.title;
    result.counts = counts_(candidate, all);
    result.warnings = warnings_(candidate, all);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function openSpreadsheet_(config) {
  try {
    return SpreadsheetApp.openById(config.spreadsheetId);
  } catch (_) {
    fail_('DATA_ERROR', 'No se pudo abrir la base. Comprueba el enlace y que la cuenta que despliega Apps Script tenga acceso al archivo.');
  }
}

function readAll_(config) {
  var spreadsheet = openSpreadsheet_(config);
  var title;
  try { title = spreadsheet.getName(); } catch (_) { fail_('DATA_ERROR', 'No se pudo leer la base. Vuelve a intentarlo.'); }
  return {
    title: title,
    pre: readSheet_(spreadsheet, config.sheets.pre, 'pre'),
    onsite: readSheet_(spreadsheet, config.sheets.onsite, 'onsite'),
    attendance: readSheet_(spreadsheet, config.sheets.attendance, 'attendance')
  };
}

function readSheet_(spreadsheet, name, dataset) {
  var sheet;
  var values;
  try {
    sheet = spreadsheet.getSheetByName(name);
    if (!sheet) fail_('DATA_ERROR', 'No existe la pestaña «' + name + '». Revisa su nombre exacto.');
    values = sheet.getDataRange().getDisplayValues();
  } catch (error) {
    if (error && error.qrCode) throw error;
    fail_('DATA_ERROR', 'No se pudo leer la pestaña «' + name + '». Revisa los permisos y vuelve a intentarlo.');
  }
  var headers = values.length ? values[0].map(text_) : [];
  var normalized = headers.map(function (s) { return s.trim().toLowerCase(); });
  var idAliases = dataset === 'attendance' ? ['id'] : QR_ALIASES_.id;
  if (!normalized.some(function (h) { return idAliases.indexOf(h) >= 0; })) {
    fail_('DATA_ERROR', 'La pestaña «' + name + '» necesita una columna ' + (dataset === 'attendance' ? '«id»' : '«id» o un alias reconocido') + ' en la primera fila.');
  }
  if (dataset === 'attendance') {
    if (normalized.filter(function (h) { return h === 'id'; }).length !== 1) fail_('DATA_ERROR', 'La pestaña de asistencia debe contener una sola columna «id».');
    if (!normalized.some(function (h) { return QR_ALIASES_.timestamp.indexOf(h) >= 0; })) {
      fail_('DATA_ERROR', 'La pestaña «' + name + '» necesita una columna de fecha: timestamp, fecha_hora, datetime, fecha, hora o marca temporal.');
    }
  }
  return { sheet: sheet, headers: headers, normalized: normalized, rows: values.slice(1).map(function (row) { return row.map(text_); }) };
}

function visibleRows_(table) {
  return table.rows.filter(function (row) { return row.some(function (cell) { return cell !== ''; }); });
}

function counts_(config, all) {
  return {
    pre: visibleRows_(all.pre).length,
    onsite: visibleRows_(all.onsite).length,
    attendance: visibleRows_(all.attendance).length
  };
}

function warnings_(config, all) {
  var warnings = [];
  ['pre', 'onsite'].forEach(function (dataset) {
    if (!all[dataset].rows.some(function (row) { return coalesce_(all[dataset], row, QR_ALIASES_.id) !== ''; })) {
      warnings.push('La pestaña «' + config.sheets[dataset] + '» no contiene identificadores de referencia.');
    }
  });
  return warnings;
}

function validationResult_(config, all) {
  return { valid: true, counts: counts_(config, all), warnings: warnings_(config, all), spreadsheetTitle: all.title };
}

/** La expresión y el fallback conservan la semántica de get_base_id de app.R. */
function baseId_(qr) {
  var match = /^[A-Za-z][A-Za-z0-9]*_[0-9]{4}[-_][0-9]{1,}/.exec(qr);
  if (match) return match[0];
  var parts = qr.split('_');
  return parts.length >= 3 ? parts.slice(0, 3).join('_') : qr;
}

function normalizedId_(id) {
  return text_(id).replace(/-/g, '_'); // Distingue mayúsculas y minúsculas.
}

function requireQr_(qr) {
  if (typeof qr !== 'string' || !qr.length || qr.length > 4096 || !qr.trim()) fail_('INVALID_REQUEST', 'Escanea o escribe un QR válido.');
  return qr; // No recorta ni cambia el ID original.
}

/** Coalesce por fila: admite columnas de ambas fuentes y celdas vacías. */
function coalesce_(table, row, aliases) {
  for (var a = 0; a < aliases.length; a++) {
    for (var i = 0; i < table.normalized.length; i++) {
      if (table.normalized[i] === aliases[a] && row[i] != null && String(row[i]).trim() !== '') return String(row[i]);
    }
  }
  return '';
}

function role_(attend, participate) {
  var value = (attend.trim() ? attend : participate).toLowerCase();
  if (value.indexOf('local organizer') >= 0 || value.indexOf('local organiser') >= 0) return 'LOCAL ORGANIZER';
  if (['plenary', 'minisymposium', 'mini-symposium', 'mini_symposium', 'contributed'].some(function (word) { return value.indexOf(word) >= 0; })) return 'SPEAKER';
  if (value.indexOf('poster') >= 0) return 'POSTER';
  return 'ATTENDING';
}

function attendanceHit_(table, id) {
  var idIndex = table.normalized.indexOf('id');
  var normalized = normalizedId_(id);
  for (var i = 0; i < table.rows.length; i++) {
    if (normalizedId_(table.rows[i][idIndex]) === normalized) {
      return { registeredAt: coalesce_(table, table.rows[i], QR_ALIASES_.timestamp) };
    }
  }
  return null;
}

function lookup_(all, baseId) {
  var normalized = normalizedId_(baseId);
  var sources = ['pre', 'onsite']; // Hoja 2 siempre tiene prioridad.
  for (var s = 0; s < sources.length; s++) {
    var source = sources[s];
    var table = all[source];
    for (var r = 0; r < table.rows.length; r++) {
      var row = table.rows[r];
      var id = coalesce_(table, row, QR_ALIASES_.id);
      if (!id || normalizedId_(id) !== normalized) continue;
      var attend = coalesce_(table, row, QR_ALIASES_.attend);
      var participate = coalesce_(table, row, QR_ALIASES_.participate);
      var existing = attendanceHit_(all.attendance, id);
      return { found: true, baseId: baseId, person: {
        id: id,
        name: coalesce_(table, row, QR_ALIASES_.name),
        institution: coalesce_(table, row, QR_ALIASES_.institution),
        email: coalesce_(table, row, QR_ALIASES_.email),
        role: role_(attend, participate),
        attend: attend,
        participate: participate,
        source: source,
        sourceLabel: source === 'pre' ? 'Pre-registrado' : 'In situ',
        alreadyRegistered: !!existing,
        registeredAt: existing ? existing.registeredAt : ''
      } };
    }
  }
  return { found: false, baseId: baseId, person: null };
}

function register_(payload, token) {
  var qr = requireQr_(payload.qr);
  if (typeof payload.configVersion !== 'string' || !payload.configVersion) {
    fail_('CONFIG_CHANGED', 'Actualiza la base y vuelve a buscar el QR antes de registrar.');
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) fail_('BUSY', 'Hay otro registro o cambio de base en curso. Espera unos segundos y vuelve a intentarlo.');
  try {
    var properties = PropertiesService.getScriptProperties().getProperties();
    requireSession_(token, properties);
    var config = readConfig_(properties, true);
    if (payload.configVersion !== config.version) fail_('CONFIG_CHANGED', 'La base del evento cambió. Actualiza la base y vuelve a buscar el QR.');
    var all = readAll_(config); // Relee referencias y asistencia dentro del mismo lock.
    var match = lookup_(all, baseId_(qr));
    if (!match.found) fail_('NOT_FOUND', 'El ID no aparece en las referencias. No se registró.');
    var person = match.person;
    if (person.alreadyRegistered) {
      return { status: 'already', person: person, registeredAt: person.registeredAt, message: 'Este ID ya aparece en Asistencia. Se omitió el duplicado.', configVersion: config.version };
    }
    var timestamp = nowPr_();
    var fields = {
      id: person.id, name: person.name, institution: person.institution, email: person.email,
      role: person.role, attend: person.attend, participate: person.participate,
      timestamp: timestamp, source: 'github-pages-qr'
    };
    var newRow = all.attendance.normalized.map(function (header) {
      var keys = Object.keys(fields);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var aliases = key === 'id' ? ['id'] : QR_ALIASES_[key];
        if (aliases.indexOf(header) >= 0) return safeCell_(fields[key]);
      }
      return '';
    });
    try {
      all.attendance.sheet.appendRow(newRow);
      SpreadsheetApp.flush();
    } catch (_) {
      fail_('WRITE_ERROR', 'No se pudo confirmar el registro. Vuelve a buscar este QR antes de reintentar; si la fila se guardó, se detectará como asistencia existente.');
    }
    person.alreadyRegistered = true;
    person.registeredAt = timestamp;
    return { status: 'registered', person: person, registeredAt: timestamp, message: 'Registro agregado correctamente en Asistencia.', configVersion: config.version };
  } finally {
    lock.releaseLock();
  }
}

function safeCell_(value) {
  var cell = text_(value);
  return /^\s*[=+\-@]/.test(cell) ? "'" + cell : cell;
}

function list_(config, payload) {
  var dataset = payload.dataset;
  if (['pre', 'onsite', 'attendance'].indexOf(dataset) < 0) fail_('INVALID_REQUEST', 'La tabla solicitada no existe.');
  var table = readSheet_(openSpreadsheet_(config), config.sheets[dataset], dataset);
  var columns = table.headers.map(function (label, index) { return { key: 'c' + index, label: label }; });
  var query = optionalSearch_(payload.query);
  var filters = payload.filters == null ? {} : payload.filters;
  if (!isRecord_(filters)) fail_('INVALID_REQUEST', 'Los filtros no son válidos.');
  var filterKeys = Object.keys(filters);
  var validKeys = columns.map(function (column) { return column.key; });
  if (filterKeys.some(function (key) { return validKeys.indexOf(key) < 0; })) fail_('INVALID_REQUEST', 'Una columna de filtro no existe.');
  var prepared = filterKeys.map(function (key) { return { index: Number(key.slice(1)), value: optionalSearch_(filters[key]) }; });
  var rows = visibleRows_(table);
  var total = rows.length;
  rows = rows.filter(function (row) {
    if (query && !row.some(function (cell) { return cell.toLocaleLowerCase().indexOf(query) >= 0; })) return false;
    return prepared.every(function (filter) { return text_(row[filter.index]).toLocaleLowerCase().indexOf(filter.value) >= 0; });
  });
  if (payload.sort != null) {
    if (!isRecord_(payload.sort) || validKeys.indexOf(payload.sort.key) < 0 || ['asc', 'desc'].indexOf(payload.sort.direction) < 0) fail_('INVALID_REQUEST', 'El orden solicitado no es válido.');
    var sortIndex = Number(payload.sort.key.slice(1));
    var sign = payload.sort.direction === 'desc' ? -1 : 1;
    rows = rows.map(function (row, index) { return { row: row, index: index }; }).sort(function (a, b) {
      var compared = text_(a.row[sortIndex]).localeCompare(text_(b.row[sortIndex]), 'es', { numeric: true, sensitivity: 'base' });
      return compared ? compared * sign : a.index - b.index;
    }).map(function (entry) { return entry.row; });
  }
  var requestedPage = payload.page == null ? 1 : payload.page;
  if (!Number.isInteger(requestedPage) || requestedPage < 1) fail_('INVALID_REQUEST', 'La página debe ser un número entero positivo.');
  if (payload.pageSize != null && payload.pageSize !== 25) fail_('INVALID_REQUEST', 'El tamaño de página es 25 filas.');
  var pageSize = 25;
  var filtered = rows.length;
  var pages = Math.max(1, Math.ceil(filtered / pageSize));
  var page = Math.min(requestedPage, pages);
  var sliced = rows.slice((page - 1) * pageSize, page * pageSize).map(function (row) {
    var result = {};
    columns.forEach(function (column, index) { result[column.key] = text_(row[index]); });
    result.__id = coalesce_(table, row, dataset === 'attendance' ? ['id'] : QR_ALIASES_.id);
    return result;
  });
  return { columns: columns, rows: sliced, total: total, filtered: filtered, page: page, pageSize: pageSize, pages: pages };
}

function optionalSearch_(value) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > 500) fail_('INVALID_REQUEST', 'Cada búsqueda debe tener como máximo 500 caracteres.');
  return value.toLocaleLowerCase();
}

function nowPr_() {
  return Utilities.formatDate(new Date(), QR_TIMEZONE_, 'yyyy-MM-dd HH:mm:ss');
}

function isRecord_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text_(value) {
  return value == null ? '' : String(value);
}

function fail_(code, message) {
  var error = new Error(message);
  error.qrCode = code;
  throw error;
}

function publicError_(error) {
  if (error && error.qrCode) return { ok: false, error: { code: error.qrCode, message: error.message } };
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo completar la operación. Vuelve a intentarlo; si persiste, avisa a administración.' } };
}

/** Ejecutar manualmente desde el editor. Solo lectura; no imprime datos personales. */
function verificarConfiguracion() {
  try {
    var properties = PropertiesService.getScriptProperties().getProperties();
    authSecret_('operator', properties);
    authSecret_('admin', properties);
    allowedOrigins_(properties.ALLOWED_ORIGINS);
    var config = readConfig_(properties, true);
    var all = readAll_(config);
    var summary = { ok: true, eventName: config.eventName, sheets: config.sheets, counts: counts_(config, all), warnings: warnings_(config, all), timeZone: QR_TIMEZONE_ };
    console.log(JSON.stringify(summary));
    return summary;
  } catch (error) {
    var result = publicError_(error);
    console.log(JSON.stringify(result));
    return result;
  }
}
