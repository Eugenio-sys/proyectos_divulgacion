import {createDemoClient} from './demo.js';

const NS = 'registro-qr-v1';
const rpcError = (code, message) => Object.assign(new Error(message), {code});
const randomId = () => [...crypto.getRandomValues(new Uint8Array(24))].map(v => v.toString(16).padStart(2, '0')).join('');

function googleOrigin(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.port && (
      u.hostname === 'script.google.com' ||
      u.hostname === 'script.googleusercontent.com' ||
      u.hostname.endsWith('.script.googleusercontent.com') ||
      u.hostname.endsWith('-script.googleusercontent.com')
    );
  } catch {return false;}
}

/** Hidden HtmlService bridge: the Google sandbox may add a nested iframe. */
export function createClient(config = {}) {
  if (new URLSearchParams(location.search).get('demo') === '1') return createDemoClient();
  let frame, peer, peerOrigin, nonce, connecting, connectTimer, resolveConnect, rejectConnect;
  let destroyed = false, counter = 0;
  const pending = new Map();
  function receive(event) {
    const data = event.data;
    if (!data || data.namespace !== NS || data.nonce !== nonce || destroyed) return;
    if (data.kind === 'ready') {
      if (!connecting || peer || !googleOrigin(event.origin) || !event.source || event.source === window) return;
      // Bind to the actual inner HtmlService window, not the outer iframe proxy.
      peer = event.source; peerOrigin = event.origin;
      clearTimeout(connectTimer);
      resolveConnect();
      return;
    }
    if (!peer || event.source !== peer || event.origin !== peerOrigin || data.kind !== 'response') return;
    const item = pending.get(data.id);
    if (!item) return;
    clearTimeout(item.timer);pending.delete(data.id);
    const result = data.result;
    if (result?.ok === true) item.resolve(result.data);
    else item.reject(rpcError(result?.error?.code || 'SERVER_ERROR', result?.error?.message || 'No se pudo completar la operación.'));
  }
  window.addEventListener('message', receive);
  function connect() {
    if (destroyed) return Promise.reject(rpcError('CLOSED', 'La conexión está cerrada. Recarga la página.'));
    if (peer) return Promise.resolve();
    if (connecting) return connecting;
    let endpoint;
    try {
      endpoint = new URL(String(config.endpoint || '').trim());
      if (endpoint.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(endpoint.pathname)) throw new Error();
    } catch {return Promise.reject(rpcError('SETUP_REQUIRED', 'Falta configurar la URL /exec de Google Apps Script en config.js. Puedes explorar la demostración.'));}
    if (window.top !== window) return Promise.reject(rpcError('EMBEDDED_PAGE', 'Abre esta aplicación en una pestaña propia para conectar con Google Sheets.'));
    nonce = randomId();
    endpoint.search = '';endpoint.hash = '';
    endpoint.searchParams.set('nonce', nonce);
    endpoint.searchParams.set('clientOrigin', location.origin);
    connecting = new Promise((resolve, reject) => {
      resolveConnect = resolve;rejectConnect = reject;
      connectTimer = setTimeout(() => {
        frame?.remove();frame = null;connecting = null;
        reject(rpcError('CONNECTION_TIMEOUT', 'No se pudo conectar con Google. Revisa que el despliegue permita «Cualquier persona», el origen autorizado y la URL /exec. Si el navegador bloquea la conexión, prueba abrir la app en otra pestaña o navegador.'));
      }, 30000);
      frame = document.createElement('iframe');
      frame.title = 'Conexión con Google Sheets';
      frame.hidden = true;
      frame.referrerPolicy = 'strict-origin';
      frame.src = endpoint.href;
      document.body.append(frame);
    });
    return connecting;
  }
  async function request(action, payload = {}, token = '') {
    await connect();
    if (pending.size >= 4) throw rpcError('BUSY', 'Espera a que termine la operación anterior.');
    const id = `${++counter}-${randomId().slice(0, 12)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(rpcError('REQUEST_TIMEOUT', action === 'register'
          ? 'No llegó la confirmación de Google. Comprueba la asistencia o vuelve a consultar el mismo QR; no se mostrará como registrado hasta confirmarlo.'
          : 'Google tardó demasiado en responder. Intenta de nuevo.'));
      }, 65000);
      pending.set(id, {resolve, reject, timer});
      try {peer.postMessage({namespace: NS, nonce, kind: 'request', id, request: {action, payload, token}}, peerOrigin);}
      catch {clearTimeout(timer);pending.delete(id);reject(rpcError('CONNECTION_ERROR', 'Se perdió la conexión con Google. Recarga la página.'));}
    });
  }
  function destroy() {
    destroyed = true;clearTimeout(connectTimer);frame?.remove();
    window.removeEventListener('message', receive);
    rejectConnect?.(rpcError('CLOSED', 'La conexión se cerró.'));
    for (const item of pending.values()) {clearTimeout(item.timer);item.reject(rpcError('CLOSED', 'La conexión se cerró.'));}
    pending.clear();peer = null;
  }
  return {connect, request, destroy, demo: false};
}
