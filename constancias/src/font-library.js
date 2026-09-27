/* Optional font catalog for a static site: local manifest + public GitHub Pages discovery.
   Files are always loaded from this app's font/ or fonts/ directory, never API URLs. */
const MAX_FONT_BYTES = 10 * 1024 * 1024;
const MAX_FONTS = 200;
const MAX_DEPTH = 2;
const CACHE_MS = 30 * 60 * 1000;
const MAX_API_REQUESTS = 32;
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function appBase(value) {
  const url = new URL(value || '../', value ? globalThis.location?.href || import.meta.url : import.meta.url);
  url.search = ''; url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname = /\.html?$/i.test(url.pathname)
    ? url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) : `${url.pathname}/`;
  return url;
}

function safeFile(value) {
  if (typeof value !== 'string' || value.length > 1024) return null;
  // Manifest paths are literal file names, not URLs or percent-encoded paths.
  const parts = value.split('/');
  if (!['font', 'fonts'].includes(parts[0]) || parts.length < 2 || parts.length > MAX_DEPTH + 2) return null;
  if (parts.some(p => !p || p === '.' || p === '..' || /[\\\u0000-\u001f\u007f]/u.test(p))) return null;
  if (!/\.(ttf|otf)$/i.test(parts.at(-1))) return null;
  return parts.join('/');
}

function fontId(file) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(file)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return `library-${hash.toString(16).padStart(16, '0')}`;
}

function fontRecord(entry, base) {
  const file = safeFile(entry?.file);
  if (!file || (Number.isFinite(entry.size) && (entry.size <= 0 || entry.size > MAX_FONT_BYTES))) return null;
  const fileName = file.split('/').at(-1);
  const label = typeof entry.label === 'string' && entry.label.trim()
    ? entry.label.trim().slice(0, 180)
    : fileName.replace(/\.(ttf|otf)$/i, '').replace(/[_-]+/g, ' ');
  return { id: fontId(file), label, url: new URL(file.split('/').map(encodeURIComponent).join('/'), base).href, fileName };
}

async function getJson(url, { missingOK = false, api = false, force = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: force ? 'no-store' : 'default',
      ...(api ? { headers: { Accept: 'application/vnd.github+json' } } : {}),
    });
    if (missingOK && response.status === 404) return null;
    if (!response.ok) throw new Error(api && [403, 429].includes(response.status)
      ? 'GitHub limitó temporalmente la consulta de fuentes.' : `No se pudo leer el catálogo de fuentes (HTTP ${response.status}).`);
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('El catálogo de fuentes es demasiado grande.');
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

function githubCandidates(base) {
  const match = base.hostname.match(/^([a-z\d](?:[a-z\d-]*[a-z\d])?)\.github\.io$/i);
  if (!match) return [];
  let parts;
  try { parts = base.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return []; }
  if (parts.some(p => /[/\\\u0000-\u001f]/u.test(p) || p === '.' || p === '..')) return [];
  const owner = match[1];
  const candidates = [];
  if (parts.length && /^[a-z\d_.-]+$/i.test(parts[0])) candidates.push({ owner, repo: parts[0], appPath: parts.slice(1) });
  candidates.push({ owner, repo: `${owner}.github.io`, appPath: parts });
  return candidates;
}

async function githubFiles(base, force, warnings) {
  const candidates = githubCandidates(base);
  if (!candidates.length) return null;
  const cacheKey = `constancias-fonts-v1:${base.href}`;
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.time >= 0 && Date.now() - cached.time < CACHE_MS && Array.isArray(cached.files)) return cached.files;
    } catch { /* Storage may be disabled; discovery still works. */ }
  }
  let requests = 0;
  const files = [];
  let foundDirectory = false;
  let limited = false;
  let skipped = 0;
  let discoveryFailed = false;
  const readDirectory = async (candidate, relativePath) => {
    if (discoveryFailed) return null;
    if (++requests > MAX_API_REQUESTS) { limited = true; return null; }
    const path = [...candidate.appPath, ...relativePath.split('/')].map(encodeURIComponent).join('/');
    // Omitting ref asks GitHub for the repository's default branch; no main/master guess.
    const url = `https://api.github.com/repos/${encodeURIComponent(candidate.owner)}/${encodeURIComponent(candidate.repo)}/contents/${path}`;
    try {
      const listing = await getJson(url, { missingOK: true, api: true, force });
      return Array.isArray(listing) ? listing : null;
    } catch (error) {
      discoveryFailed = true;
      warnings.push(`${error.name === 'AbortError' ? 'La consulta de fuentes de GitHub tardó demasiado.' : error.message} Puedes seleccionar la carpeta de fuentes o actualizar fonts/manifest.json.`);
      return null;
    }
  };
  try {
    for (const candidate of candidates) {
      const roots = [];
      for (const root of ['fonts', 'font']) {
        const listing = await readDirectory(candidate, root);
        if (listing) roots.push({ relative: root, depth: 0, listing });
      }
      if (!roots.length) continue;
      foundDirectory = true;
      // Breadth-first traversal gives both root directories a fair share of the limit.
      const queue = roots;
      while (queue.length && files.length < MAX_FONTS) {
        const current = queue.shift();
        const listing = current.listing || await readDirectory(candidate, current.relative);
        if (!listing) continue;
        for (const entry of [...listing].sort((a, b) => collator.compare(String(a?.name), String(b?.name)))) {
          const name = entry?.name;
          if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\u0000-\u001f\u007f]/u.test(name)) continue;
          const relative = `${current.relative}/${name}`;
          if (entry.type === 'dir' && current.depth < MAX_DEPTH && queue.length < MAX_API_REQUESTS) queue.push({ relative, depth: current.depth + 1 });
          if (entry.type !== 'file' || !safeFile(relative)) continue;
          if (!Number.isFinite(entry.size) || entry.size <= 0 || entry.size > MAX_FONT_BYTES) { skipped++; continue; }
          files.push({ file: relative, size: entry.size });
          if (files.length >= MAX_FONTS) { limited = true; break; }
        }
      }
      break;
    }
  } catch (error) {
    warnings.push(`${error.name === 'AbortError' ? 'La consulta de fuentes de GitHub tardó demasiado.' : error.message} Puedes seleccionar la carpeta de fuentes o actualizar fonts/manifest.json.`);
    return files;
  }
  if (limited) warnings.push('La búsqueda automática tiene un límite de 200 fuentes y 32 carpetas. Usa el catálogo o selecciona una carpeta para añadir más.');
  if (skipped) warnings.push(`Se omitieron ${skipped} fuentes vacías o mayores de 10 MB.`);
  if (!foundDirectory && !discoveryFailed) warnings.push('No se encontró la carpeta de fuentes en la rama predeterminada del repositorio. Usa fonts/manifest.json o selecciona la carpeta.');
  // A partial failure is not cached, so the next attempt can recover immediately.
  if (foundDirectory && !limited && !discoveryFailed) {
    try { localStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), files })); } catch { /* Optional cache. */ }
  }
  return files;
}

/** Discover hosted TTF/OTF files without loading their bytes or installing fonts.
 * @param {{baseUrl?: string|URL, force?: boolean}} options
 * @returns {Promise<{fonts: Array<{id:string,label:string,url:string,fileName:string}>, warnings:string[]}>}
 */
export async function discoverFonts({ baseUrl, force = false } = {}) {
  const base = appBase(baseUrl);
  const warnings = [];
  const byUrl = new Map();
  let hasManifest = false;
  let invalid = 0;
  let clipped = false;
  const add = entry => {
    const record = fontRecord(entry, base);
    if (!record) { invalid++; return; }
    if (!byUrl.has(record.url)) {
      if (byUrl.size < MAX_FONTS) byUrl.set(record.url, record);
      else clipped = true;
    }
  };
  try {
    const manifest = await getJson(new URL('fonts/manifest.json', base), { missingOK: true, force });
    if (manifest !== null) {
      if (manifest.version !== 1 || !Array.isArray(manifest.fonts)) throw new Error('El archivo fonts/manifest.json debe tener version: 1 y una lista fonts.');
      hasManifest = true;
      manifest.fonts.slice(0, MAX_FONTS).forEach(add);
      if (manifest.fonts.length > MAX_FONTS) warnings.push('El catálogo muestra las primeras 200 fuentes.');
    }
  } catch (error) {
    warnings.push(error.name === 'AbortError' ? 'El catálogo de fuentes tardó demasiado en responder.' : `No se pudo leer fonts/manifest.json: ${error.message}`);
  }
  // Merge with GitHub even when the manifest exists: newly copied files then appear automatically.
  const hosted = await githubFiles(base, force, warnings);
  hosted?.forEach(add);
  if (clipped) warnings.push('El catálogo combinado muestra las primeras 200 fuentes. Puedes seleccionar una carpeta para añadir otras.');
  if (invalid) warnings.push(`Se omitieron ${invalid} entradas de fuentes no válidas.`);
  if (hosted === null && !hasManifest) warnings.push('Para detectar archivos copiados a font/ o fonts/, ejecuta actualizar_fuentes.py o selecciona la carpeta de fuentes desde la app.');
  return { fonts: [...byUrl.values()].sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.url, b.url)), warnings: [...new Set(warnings)] };
}
