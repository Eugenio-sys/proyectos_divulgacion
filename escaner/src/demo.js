// Datos ficticios, aislados de Google. Solo se utilizan en modo ?demo=1.
const STORAGE = 'registro-qr-demo-v1';
const error = (code, message) => Object.assign(new Error(message), {code});
const firstNames = ['Ana María', 'Luis', 'Carmen', 'Diego', 'Isabel', 'Manuel', 'Lucía', 'Rafael'];
const surnames = ['Pérez', 'Santiago', 'Rivera', 'Torres', 'Morales', 'Vega', 'Soto', 'Cruz'];
const roles = ['Just attending', 'Presenting a poster', 'Contributed talk', 'Local organizer'];
const defaults = () => ({
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/DEMO_ONLY_DATABASE_2026/edit',
  eventName: 'Encuentro de ejemplo',
  sheets: {pre: 'Hoja 2', onsite: 'Hoja 0', attendance: 'Hoja 1'},
  version: 'demo-initial',
});
const makePerson = (n, onsite = false) => ({
  id: `SIDIM_2026_${String(n).padStart(3, '0')}`,
  name: `${firstNames[n % firstNames.length]} ${surnames[Math.floor(n / firstNames.length) % surnames.length]}`,
  institution: `Institución de ejemplo ${n % 3 + 1}`,
  email: `persona${n}@example.invalid`,
  attend: roles[n % roles.length],
  participate: n % 2 ? 'Viernes y sábado' : 'Viernes',
  role: ['ATTENDING', 'POSTER', 'SPEAKER', 'LOCAL ORGANIZER'][n % 4],
  source: onsite ? 'onsite' : 'pre', sourceLabel: onsite ? 'In situ' : 'Pre-registrado',
});
const pre = Array.from({length: 64}, (_, i) => makePerson(i + 1));
const onsite = Array.from({length: 12}, (_, i) => makePerson(901 + i, true));
const norm = text => String(text || '').trim().replace(/-/g, '_');
function baseId(value) {
  const text = String(value || '').trim();
  const match = text.match(/^[A-Za-z][A-Za-z0-9]*_[0-9]{4}[-_][0-9]+/);
  return match ? match[0] : text.split('_').length >= 3 ? text.split('_').slice(0, 3).join('_') : text;
}
function timestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Puerto_Rico', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).formatToParts(new Date());
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}
let fallback;
function read() {
  try {const parsed = JSON.parse(localStorage.getItem(STORAGE));if (parsed?.config?.version && parsed.databases) return parsed;} catch {}
  if (!fallback) {
    const config = defaults();
    fallback = {config, databases: {[config.spreadsheetUrl]: [
      {...pre[3], timestamp:'2026-09-27 08:30:00'},
      {...pre[7], timestamp:'2026-09-27 08:32:00'},
    ]}};
  }
  return structuredClone(fallback);
}
function write(data) {fallback = structuredClone(data);try {localStorage.setItem(STORAGE, JSON.stringify(data));} catch {}}
function attendance(data) {return data.databases[data.config.spreadsheetUrl] || [];}
function counts(data) {return {pre:pre.length, onsite:onsite.length, attendance:attendance(data).length};}
function resolved(qr, data) {
  const id = baseId(qr), person = [...pre, ...onsite].find(p => norm(p.id) === norm(id));
  if (!person) return {found:false, baseId:id, person:null, configVersion:data.config.version};
  const row = attendance(data).find(p => norm(p.id) === norm(person.id));
  return {found:true, baseId:id, person:{...person, alreadyRegistered:Boolean(row), registeredAt:row?.timestamp || ''}, configVersion:data.config.version};
}
function configPayload(payload) {
  let url;
  try {
    url = new URL(String(payload.spreadsheetUrl || '').trim());
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !/^\/spreadsheets\/d\/[A-Za-z0-9_-]+/.test(url.pathname)) throw new Error();
  } catch {throw error('INVALID_REQUEST', 'Pega un enlace válido de Google Sheets.');}
  const sheets = Object.fromEntries(['pre','onsite','attendance'].map(key => [key, String(payload.sheets?.[key] || '').trim()]));
  if (Object.values(sheets).some(v => !v) || new Set(Object.values(sheets)).size !== 3) throw error('INVALID_REQUEST', 'Indica tres pestañas distintas.');
  return {spreadsheetUrl:`https://docs.google.com/spreadsheets/d/${url.pathname.split('/')[3]}/edit`, eventName:String(payload.eventName || 'Registro de asistencia').trim(), sheets};
}
export function createDemoClient() {
  let closed = false;
  return {
    demo:true,
    async connect() {},
    destroy() {closed = true;},
    async request(action, payload = {}, token = '') {
      if (closed) throw error('CLOSED', 'La demostración se cerró.');
      await new Promise(resolve => setTimeout(resolve, 80));
      const data = read();
      if (action === 'login' || action === 'adminLogin') {
        if (payload.code !== 'demo') throw error('AUTH_FAILED', 'En la demostración, el código es demo.');
        const role = action === 'adminLogin' ? 'admin' : 'operator';
        return {token:`demo-${role}-${Date.now()}`, expiresAt:new Date(Date.now()+6*3600000).toISOString(), eventName:data.config.eventName, role};
      }
      if (!/^demo-(admin|operator)-\d+$/.test(token)) throw error('UNAUTHORIZED', 'Accede a la demostración con el código demo.');
      const admin = token.startsWith('demo-admin-');
      if (['getConfig','validateConfig','saveConfig'].includes(action) && !admin) throw error('FORBIDDEN', 'Accede como administrador para cambiar la base.');
      if (action === 'logout') return {loggedOut:true};
      if (action === 'getConfig') {
        const {spreadsheetUrl,eventName,sheets,version} = data.config;
        return structuredClone({spreadsheetUrl,eventName,sheets,version});
      }
      if (action === 'validateConfig') {
        configPayload(payload);
        return {valid:true, counts:counts(data), spreadsheetTitle:'Base ficticia de demostración', warnings:['Demostración: no se ha consultado ningún archivo de Google Sheets.']};
      }
      if (action === 'saveConfig') {
        data.config = {...configPayload(payload), version:`demo-${crypto.randomUUID()}`};
        data.databases[data.config.spreadsheetUrl] ||= [];
        write(data);
        return {saved:true, ...data.config, counts:counts(data), spreadsheetTitle:'Base ficticia de demostración', warnings:[], configVersion:data.config.version};
      }
      if (action === 'bootstrap') return {eventName:data.config.eventName, counts:counts(data), updatedAt:timestamp(), warnings:[], spreadsheetTitle:'Base ficticia de demostración', configVersion:data.config.version};
      if (action === 'lookup') return resolved(payload.qr, data);
      if (action === 'register') {
        if (payload.configVersion !== data.config.version) throw error('CONFIG_CHANGED', 'La base cambió. Vuelve a consultar el QR antes de registrar.');
        const found = resolved(payload.qr, data);
        if (!found.found) throw error('NOT_FOUND', 'No hay ninguna persona con ese ID.');
        if (found.person.alreadyRegistered) return {status:'already', person:found.person, registeredAt:found.person.registeredAt, message:'Este ID ya tiene asistencia registrada.', configVersion:data.config.version};
        const now = timestamp();
        data.databases[data.config.spreadsheetUrl] = [...attendance(data), {...found.person, timestamp:now}];write(data);
        return {status:'registered', person:{...found.person, alreadyRegistered:true, registeredAt:now}, registeredAt:now, message:'Asistencia registrada en la demostración.', configVersion:data.config.version};
      }
      if (action === 'list') {
        const dataset = payload.dataset;
        if (!['pre','onsite','attendance'].includes(dataset)) throw error('INVALID_REQUEST', 'Lista no válida.');
        const fields = dataset === 'attendance' ? ['timestamp','id','name','institution','email','role','attend','participate'] : ['id','name','institution','email','attend','participate'];
        const labels = {timestamp:'Fecha y hora',id:'ID',name:'Nombre',institution:'Institución',email:'Correo',role:'Rol',attend:'Tipo de asistencia',participate:'Participación'};
        const columns = fields.map((key,i) => ({key:`c${i}`,label:labels[key]}));
        const people = dataset === 'pre' ? pre : dataset === 'onsite' ? onsite : attendance(data);
        const raw = people.map(p => ({__id:p.id, ...Object.fromEntries(fields.map((key,i) => [`c${i}`,p[key] || '']))}));
        const q = String(payload.query || '').toLocaleLowerCase();
        const rows = raw.filter(row => (!q || Object.values(row).some(v => v.toLocaleLowerCase().includes(q))) && Object.entries(payload.filters || {}).every(([key,v]) => !v || String(row[key] || '').toLocaleLowerCase().includes(String(v).toLocaleLowerCase())));
        const key = payload.sort?.key;
        if (key && columns.some(c => c.key === key)) rows.sort((a,b) => a[key].localeCompare(b[key],'es',{numeric:true})*(payload.sort.direction === 'desc' ? -1 : 1));
        const size = Math.min(100,Math.max(1,Number(payload.pageSize) || 25)), pages = Math.max(1,Math.ceil(rows.length/size));
        const page = Math.min(pages,Math.max(1,Number(payload.page) || 1));
        return {columns,rows:rows.slice((page-1)*size,page*size),total:raw.length,filtered:rows.length,page,pageSize:size,pages,configVersion:data.config.version};
      }
      throw error('INVALID_REQUEST', 'Operación no reconocida.');
    },
  };
}
