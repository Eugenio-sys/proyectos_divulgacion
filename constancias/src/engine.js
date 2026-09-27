/**
 * Local PDF renderer. Coordinates are PDF points measured from bottom-left;
 * x/y identify the centre of a block. The same 288-dpi transparent PNG is used
 * for its live preview and its PDF overlay. The template remains vector PDF.
 */
import { filenameFor } from './data.js';

const RESOLUTION = 4;
const MAX_CANVAS_EDGE = 16384;
const MAX_CANVAS_PIXELS = 28_000_000;
const CACHE_LIMIT = 96;
const defer = () => new Promise(resolve => setTimeout(resolve, 0));

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Generación cancelada.', 'AbortError');
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeXML(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function colorValue(value) {
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value || '')) return value;
  return '#222222';
}

function zipBytesCancelable(zip, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const stream = zip.generateInternalStream({ type: 'uint8array', compression: 'STORE', mimeType: 'application/zip' });
    let chunks = [], length = 0, settled = false;
    const cleanup = () => signal?.removeEventListener('abort', aborted);
    const fail = error => {
      if (settled) return;
      settled = true; stream.pause(); chunks = []; cleanup(); reject(error);
    };
    const aborted = () => fail(new DOMException('Generación cancelada.', 'AbortError'));
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    stream.on('data', (chunk, metadata) => {
      if (settled) return;
      try {
        checkAbort(signal);
        chunks.push(chunk); length += chunk.length;
        onProgress?.(metadata.percent);
      } catch (error) { fail(error); }
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (settled) return;
      try {
        checkAbort(signal);
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        settled = true; chunks = []; cleanup(); resolve(bytes);
      } catch (error) { fail(error); }
    });
    stream.resume();
  });
}

/** Split math without interpreting HTML or arbitrary LaTeX text commands. */
export function parseMathSegments(value) {
  const text = String(value ?? '');
  const parts = [];
  let buffer = '', i = 0;
  const flush = () => { if (buffer) parts.push({ type: 'text', text: buffer }); buffer = ''; };
  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] === '$') { buffer += '$'; i += 2; continue; }
    let open = '', close = '', display = false;
    if (text.startsWith('$$', i)) { open = close = '$$'; display = true; }
    else if (text[i] === '$') { open = close = '$'; }
    else if (text.startsWith('\\(', i)) { open = '\\('; close = '\\)'; }
    else if (text.startsWith('\\[', i)) { open = '\\['; close = '\\]'; display = true; }
    if (!open) { buffer += text[i++]; continue; }
    let end = i + open.length;
    while (end < text.length) {
      if (text.startsWith(close, end)) {
        let preceding = 0;
        for (let k = end - 1; k >= 0 && text[k] === '\\'; k--) preceding++;
        if (preceding % 2 === 0) break;
      }
      end++;
    }
    if (end >= text.length) { buffer += open; i += open.length; continue; }
    flush();
    parts.push({ type: 'math', text: text.slice(i + open.length, end), display });
    i = end + close.length;
  }
  flush();
  return parts;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo representar una fórmula matemática.'));
    image.src = dataUrl;
  });
}

function svgUnit(value, size, fallback) {
  const parsed = /^([\d.e+-]+)(ex|em|px|pt)?$/i.exec(String(value || ''));
  if (!parsed) return fallback;
  const n = Number(parsed[1]);
  return n * (parsed[2] === 'ex' ? size / 2 : parsed[2] === 'em' ? size : 1);
}

const mathCache = new Map();
let mathQueue = Promise.resolve();

async function mathToken(part, style) {
  const key = JSON.stringify([part.text, part.display, style.size, style.color]);
  if (mathCache.has(key)) return mathCache.get(key);
  const promise = mathQueue.then(async () => {
    const mathjax = window.MathJax;
    await mathjax?.startup?.promise;
    if (!mathjax?.tex2svgPromise) throw new Error('No se cargó el motor matemático. Recarga la página y vuelve a intentarlo.');
    // Disable network-capable or interactive TeX extensions in imported cells.
    if (/\\(?:require|href|url|htmlClass|htmlId|htmlStyle|class|cssId|style)\b/.test(part.text)) {
      throw new Error('La fórmula utiliza un comando de enlace, estilo o extensión no admitido. Usa únicamente notación matemática.');
    }
    const node = await mathjax.tex2svgPromise(part.text, { display: part.display, em: style.size, ex: style.size / 2, containerWidth: 10000 });
    const svg = node.querySelector('svg');
    const error = node.querySelector('[data-mml-node="merror"], merror, mjx-merror');
    if (!svg || error) {
      const detail = error?.getAttribute('data-mjx-error') || error?.textContent || 'notación no admitida';
      throw new Error(`No se pudo interpretar la fórmula «${part.text.slice(0, 100)}»: ${detail}.`);
    }
    const width = svgUnit(svg.getAttribute('width'), style.size, style.size);
    const height = svgUnit(svg.getAttribute('height'), style.size, style.size);
    const vertical = /vertical-align\s*:\s*([^;]+)/.exec(svg.getAttribute('style') || '')?.[1];
    const descent = Math.max(0, -svgUnit(vertical, style.size, 0));
    // Use the XMLNS namespace; an ordinary xmlns attribute can be duplicated
    // by XMLSerializer and make the SVG invalid when decoded as an image.
    svg.removeAttribute('xmlns');
    svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(Math.max(1, width * RESOLUTION)));
    svg.setAttribute('height', String(Math.max(1, height * RESOLUTION)));
    svg.setAttribute('color', style.color);
    svg.style.color = style.color;
    // MathJax with fontCache:none embeds all paths; currentColor is made explicit
    // because inherited CSS is unavailable when an SVG is loaded as an image.
    const source = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, escapeXML(style.color));
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
    const image = await loadImage(dataUrl);
    return { type: 'math', image, width, ascent: Math.max(0, height - descent), descent, display: part.display };
  });
  mathQueue = promise.catch(() => {});
  mathCache.set(key, promise);
  if (mathCache.size > 160) mathCache.delete(mathCache.keys().next().value);
  promise.catch(() => mathCache.delete(key));
  return promise;
}

function normalizeStyle(block, pageWidth) {
  const fontFamily = String(block.fontFamily || block.fontId || 'Georgia');
  const familyCSS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(fontFamily)
    ? fontFamily : '"' + fontFamily.replace(/["\\]/g, '') + '"';
  const size = Math.max(1, finite(block.size, 24));
  return {
    size,
    width: Math.max(1, finite(block.width, pageWidth * 0.9)),
    lineHeight: Math.max(0.8, finite(block.lineHeight, 1.25)),
    fontFamily,
    font: `${block.italic ? 'italic' : 'normal'} ${block.bold ? '700' : '400'} ${size}px ${familyCSS}`,
    color: colorValue(block.color),
    align: ['left', 'center', 'right'].includes(block.align) ? block.align : 'center',
    wrap: block.wrap !== false,
    math: block.math ?? block.key !== 'name',
    fontVersion: block.fontVersion || '',
  };
}

function textToken(text, context, metrics) {
  const measured = context.measureText(text);
  return {
    type: 'text', text, width: measured.width,
    ascent: measured.actualBoundingBoxAscent || metrics.ascent,
    descent: measured.actualBoundingBoxDescent || metrics.descent,
    whitespace: /^\s+$/.test(text),
    leftOverhang: Math.max(0, measured.actualBoundingBoxLeft || 0),
    rightOverhang: Math.max(0, (measured.actualBoundingBoxRight || 0) - measured.width),
  };
}

async function rasterBlock(text, style) {
  const measureCanvas = document.createElement('canvas');
  const context = measureCanvas.getContext('2d');
  context.font = style.font;
  const sample = context.measureText('Ájg');
  const metrics = { ascent: sample.actualBoundingBoxAscent || style.size * .85, descent: sample.actualBoundingBoxDescent || style.size * .25 };
  const segments = style.math ? parseMathSegments(text) : [{ type: 'text', text }];
  const tokens = [];
  for (const part of segments) {
    if (part.type === 'math') { tokens.push(await mathToken(part, style)); continue; }
    for (const chunk of part.text.replace(/\r\n?/g, '\n').split(/(\n|[^\S\n]+)/u)) {
      if (!chunk) continue;
      tokens.push(chunk === '\n' ? { type: 'break' } : textToken(chunk, context, metrics));
    }
  }
  const lines = [];
  let line = [];
  let width = 0;
  const flush = (force = false) => {
    while (line.at(-1)?.whitespace) { width -= line.pop().width; }
    if (line.length || force) lines.push({ tokens: line, width: Math.max(0, width) });
    line = []; width = 0;
  };
  const add = token => {
    if (token.whitespace && !line.length) return;
    if (style.wrap && line.length && width + token.width > style.width) flush();
    if (token.whitespace && !line.length) return;
    line.push(token); width += token.width;
  };
  for (const token of tokens) {
    if (token.type === 'break') { flush(true); continue; }
    if (token.type === 'math' && token.display) { flush(); add(token); flush(); continue; }
    if (style.wrap && token.type === 'text' && !token.whitespace && token.width > style.width) {
      // Split a single exceptionally long word; keep size unchanged.
      const chars = typeof Intl.Segmenter === 'function'
        ? [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(token.text)].map(x => x.segment)
        : Array.from(token.text);
      let chunk = '';
      for (const char of chars) {
        if (chunk && context.measureText(chunk + char).width > style.width) { add(textToken(chunk, context, metrics)); flush(); chunk = ''; }
        chunk += char;
      }
      if (chunk) add(textToken(chunk, context, metrics));
    } else add(token);
  }
  flush();
  if (!lines.length) lines.push({ tokens: [], width: 0 });
  const warnings = [];
  const contentWidth = Math.max(style.width, ...lines.map(x => x.width));
  if (contentWidth > style.width + 0.5) warnings.push('Hay una fórmula o un texto sin división que supera el ancho del bloque. Aumenta el ancho o reduce el tamaño.');
  let contentHeight = 0;
  for (const row of lines) {
    row.ascent = Math.max(metrics.ascent, ...row.tokens.map(x => x.ascent));
    row.descent = Math.max(metrics.descent, ...row.tokens.map(x => x.descent));
    row.height = Math.max(style.size * style.lineHeight, row.ascent + row.descent);
    row.baseline = contentHeight + (row.height - row.ascent - row.descent) / 2 + row.ascent;
    contentHeight += row.height;
  }
  const overhang = Math.max(0, ...tokens.map(t => Math.max(t.leftOverhang || 0, t.rightOverhang || 0)));
  const padding = Math.max(2, overhang + 1);
  const logicalWidth = contentWidth + 2 * padding;
  const logicalHeight = contentHeight + 2 * padding;
  const pixelWidth = Math.ceil(logicalWidth * RESOLUTION);
  const pixelHeight = Math.ceil(logicalHeight * RESOLUTION);
  if (pixelWidth > MAX_CANVAS_EDGE || pixelHeight > MAX_CANVAS_EDGE || pixelWidth * pixelHeight > MAX_CANVAS_PIXELS) {
    throw new Error('El bloque es demasiado grande para representarlo. Reduce el texto, el ancho o el tamaño de fuente. No se ha reducido automáticamente.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth; canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d');
  ctx.scale(RESOLUTION, RESOLUTION);
  ctx.font = style.font;
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'alphabetic';
  for (const row of lines) {
    let x = padding + (style.align === 'center' ? (contentWidth - row.width) / 2 : style.align === 'right' ? contentWidth - row.width : 0);
    const baseline = padding + row.baseline;
    for (const token of row.tokens) {
      if (token.type === 'math') ctx.drawImage(token.image, x, baseline - token.ascent, token.width, token.ascent + token.descent);
      else ctx.fillText(token.text, x, baseline);
      x += token.width;
    }
  }
  const dataUrl = canvas.toDataURL('image/png');
  // Release a potentially large temporary canvas immediately.
  canvas.width = 1; canvas.height = 1;
  return { dataUrl, width: pixelWidth / RESOLUTION, height: pixelHeight / RESOLUTION, contentWidth, contentHeight, warnings, empty: !text.trim(), lines: lines.length, resolution: RESOLUTION };
}

/**
 * Normalize the first displayed page to rotation=0, retaining vector content.
 * CropBox intersection, page rotation and /UserUnit follow PDF.js conventions.
 */
async function normalizeTemplate(templateBytes, dimensions) {
  const { PDFDocument, PDFName, degrees } = window.PDFLib;
  if (!templateBytes) {
    const document = await PDFDocument.create();
    const width = finite(dimensions.width, 792), height = finite(dimensions.height, 612);
    document.addPage([width, height]);
    return { document, width, height, warnings: [], sourcePages: 0 };
  }
  let source;
  try { source = await PDFDocument.load(templateBytes); }
  catch (error) { throw new Error(`No se pudo abrir la plantilla PDF. Comprueba que sea válida y que no esté protegida con contraseña. ${error.message}`); }
  if (!source.getPageCount()) throw new Error('La plantilla no contiene ninguna página.');
  const page = source.getPage(0);
  const media = page.getMediaBox(), crop = page.getCropBox();
  const left = Math.max(media.x, crop.x), bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  const box = right > left && top > bottom ? { left, bottom, right, top }
    : { left: media.x, bottom: media.y, right: media.x + media.width, top: media.y + media.height };
  const rawUnit = page.node.get(PDFName.of('UserUnit'));
  const unit = Math.max(.01, finite(rawUnit?.asNumber?.(), 1));
  const w = (box.right - box.left) * unit, h = (box.top - box.bottom) * unit;
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('La plantilla tiene una rotación de página no válida.');
  const width = rotation % 180 ? h : w, height = rotation % 180 ? w : h;
  const document = await PDFDocument.create();
  const output = document.addPage([width, height]);
  const embedded = await document.embedPage(page, box);
  const placement = rotation === 90 ? { x: 0, y: w, rotate: degrees(270) }
    : rotation === 180 ? { x: w, y: h, rotate: degrees(180) }
      : rotation === 270 ? { x: h, y: 0, rotate: degrees(90) }
        : { x: 0, y: 0, rotate: degrees(0) };
  output.drawPage(embedded, { width: w, height: h, ...placement });
  const warnings = [];
  if (source.getPageCount() > 1) warnings.push('La plantilla tiene varias páginas: se utiliza únicamente la primera.');
  if ((page.node.Annots()?.size() || 0) > 0) warnings.push('La plantilla contiene anotaciones o campos de formulario. Conviene aplanarlos en el PDF antes de cargarlo para conservarlos.');
  return { document, width, height, warnings, sourcePages: source.getPageCount() };
}

/** Main API. All returned PDF and ZIP files are Uint8Array values. */
export async function createEngine(templateBytes, options = {}) {
  if (!window.PDFLib?.PDFDocument) throw new Error('No se cargó el motor PDF. Recarga la página.');
  const normalized = await normalizeTemplate(templateBytes, options);
  const { document: template, width, height } = normalized;
  const cache = new Map();
  let destroyed = false;

  async function renderBlock(value, block, renderOptions = {}) {
    if (destroyed) throw new Error('Esta plantilla ya está cerrada.');
    checkAbort(renderOptions.signal);
    const text = String(value ?? '');
    const style = normalizeStyle(block, width);
    const key = JSON.stringify([text, style]);
    let pending = cache.get(key);
    if (pending) { cache.delete(key); cache.set(key, pending); }
    else {
      pending = rasterBlock(text, style);
      cache.set(key, pending);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      pending.catch(() => cache.delete(key));
    }
    const rendered = await pending;
    checkAbort(renderOptions.signal);
    const x = finite(block.x, width / 2) - rendered.width / 2;
    const y = finite(block.y, height / 2) - rendered.height / 2;
    const warnings = [...rendered.warnings];
    if (!rendered.empty && (x < -0.5 || y < -0.5 || x + rendered.width > width + .5 || y + rendered.height > height + .5)) {
      warnings.push('Parte del bloque queda fuera de la página. Mueve el bloque, ajusta su ancho o reduce su tamaño.');
    }
    return { ...rendered, x, y, warnings };
  }

  async function generatePdf(row, blocks, generationOptions = {}) {
    checkAbort(generationOptions.signal);
    const output = await window.PDFLib.PDFDocument.create();
    const [page] = await output.copyPages(template, [0]);
    output.addPage(page);
    output.setTitle(`Constancia — ${String(row.name ?? '')}`);
    output.setCreator('Estudio de constancias');
    const blockList = Array.isArray(blocks) ? blocks : Object.entries(blocks).map(([key, block]) => ({ key, ...block }));
    for (const block of blockList) {
      checkAbort(generationOptions.signal);
      if (block.visible === false || block.enabled === false) continue;
      const text = String(row[block.key] ?? '');
      if (!text.trim()) continue;
      const rendered = await renderBlock(text, block, generationOptions);
      const image = await output.embedPng(rendered.dataUrl);
      page.drawImage(image, { x: rendered.x, y: rendered.y, width: rendered.width, height: rendered.height });
      generationOptions.onWarning?.(rendered.warnings, { row, block });
    }
    checkAbort(generationOptions.signal);
    const bytes = await output.save({ useObjectStreams: true });
    checkAbort(generationOptions.signal);
    return bytes;
  }

  async function generateZip(rows, blocks, generationOptions = {}) {
    if (!window.JSZip) throw new Error('No se cargó el motor ZIP. Recarga la página.');
    if (!rows.length) throw new Error('No hay personas para generar constancias.');
    checkAbort(generationOptions.signal);
    const zip = new window.JSZip();
    const usedNames = new Set();
    for (let i = 0; i < rows.length; i++) {
      checkAbort(generationOptions.signal);
      let filename = filenameFor(rows[i]);
      const base = filename.replace(/\.pdf$/i, '');
      let suffix = 2;
      while (usedNames.has(filename.toLocaleLowerCase('es'))) filename = `${base}_${suffix++}.pdf`;
      usedNames.add(filename.toLocaleLowerCase('es'));
      const pdf = await generatePdf(rows[i], blocks, generationOptions);
      zip.file(filename, pdf);
      generationOptions.onProgress?.({ done: i + 1, total: rows.length, percent: (i + 1) / rows.length * 95, id: rows[i].id, phase: 'pdf' });
      // Return control so progress, pointer events and cancellation can run.
      await defer();
    }
    checkAbort(generationOptions.signal);
    generationOptions.onProgress?.({ done: rows.length, total: rows.length, percent: 95, phase: 'zip' });
    const result = await zipBytesCancelable(zip, generationOptions.signal, percent => {
      generationOptions.onProgress?.({ done: rows.length, total: rows.length, percent: 95 + percent * .05, phase: 'zip' });
    });
    checkAbort(generationOptions.signal);
    generationOptions.onProgress?.({ done: rows.length, total: rows.length, percent: 100, phase: 'done' });
    return result;
  }

  return {
    width, height, warnings: normalized.warnings, sourcePages: normalized.sourcePages,
    renderBlock, generatePdf, generateZip,
    async templatePdf() { return template.save({ useObjectStreams: true }); },
    clearCache() { cache.clear(); },
    destroy() { destroyed = true; cache.clear(); },
  };
}
