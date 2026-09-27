/**
 * Local PDF renderer. Coordinates are PDF points measured from bottom-left;
 * x/y identify the centre of a block. Fontkit supplies one shared glyph layout:
 * canvas is used only for the live preview; exports contain embedded-font text
 * and vector mathematical paths. The template remains vector PDF.
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

/** Resolve MathJax's rare SVG text fallback into the selected font's outlines.
 * Both preview and PDF then use exactly the same geometry, without a browser
 * serif fallback or an image in the exported document. */
function outlineMathText(svg, style) {
  const NS = 'http://www.w3.org/2000/svg';
  for (const node of svg.querySelectorAll('text')) {
    const text = node.textContent || '';
    if (node.children.length) throw new Error('La fórmula contiene un texto SVG compuesto no admitido. Escribe ese texto fuera de los delimitadores matemáticos.');
    const source = style.source;
    const size = parseFloat(node.style.fontSize || node.getAttribute('font-size') || '1000');
    if (!Number.isFinite(size) || size <= 0) throw new Error('El texto de la fórmula tiene un tamaño no válido.');
    const unit = value => {
      const n = parseFloat(value || '0');
      return /em$/.test(value || '') ? n * size : /ex$/.test(value || '') ? n * size / 2 : n;
    };
    for (const char of text) {
      if (!/\s/u.test(char) && !source.font.hasGlyphForCodePoint(char.codePointAt(0))) {
        throw new Error(`La fuente no contiene el carácter matemático «${char}». Carga una fuente que lo incluya o escribe ese texto fuera de la fórmula.`);
      }
    }
    const run = source.font.layout(text), scale = size / source.font.unitsPerEm;
    const width = run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale;
    const anchor = node.style.getPropertyValue('text-anchor') || node.getAttribute('text-anchor');
    let x = unit(node.getAttribute('x')) + unit(node.getAttribute('dx')) - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
    let y = unit(node.getAttribute('y')) + unit(node.getAttribute('dy'));
    const group = document.createElementNS(NS, 'g');
    for (const attr of node.attributes) {
      if (!['x', 'y', 'dx', 'dy', 'text-anchor'].includes(attr.name)) group.setAttribute(attr.name, attr.value);
    }
    run.glyphs.forEach((glyph, index) => {
      const position = run.positions[index];
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', glyph.path.toSVG());
      path.setAttribute('transform', `matrix(${scale},0,0,${-scale},${x + position.xOffset * scale},${y - position.yOffset * scale})`);
      group.appendChild(path);
      x += position.xAdvance * scale; y -= position.yAdvance * scale;
    });
    node.replaceWith(group);
  }
}

/** Give only the preview image enough room for ink outside TeX's advance
 * box (for example \mathclap). The original SVG and logical advance remain
 * unchanged for PDF placement and mathematical spacing. */
function mathPreviewViewport(svg, width, height) {
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some(n => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    throw new Error('La fórmula no tiene dimensiones vectoriales válidas.');
  }
  let sx = width / vb[2], sy = height / vb[3], padX = 0, padY = 0;
  const aspect = svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet';
  if (aspect !== 'none') {
    const scale = /slice/.test(aspect) ? Math.max(sx, sy) : Math.min(sx, sy);
    const freeX = width - vb[2] * scale, freeY = height - vb[3] * scale;
    padX = /xMin/.test(aspect) ? 0 : /xMax/.test(aspect) ? freeX : freeX / 2;
    padY = /YMin/.test(aspect) ? 0 : /YMax/.test(aspect) ? freeY : freeY / 2;
    sx = sy = scale;
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
  const probe = svg.cloneNode(true);
  host.appendChild(probe); document.body.appendChild(host);
  let box;
  try { box = probe.getBBox({ fill: true, stroke: true, markers: true }); }
  finally { host.remove(); }
  const margin = .5;
  const left = Math.min(0, padX + (box.x - vb[0]) * sx) - margin;
  const top = Math.min(0, padY + (box.y - vb[1]) * sy) - margin;
  const right = Math.max(width, padX + (box.x + box.width - vb[0]) * sx) + margin;
  const bottom = Math.max(height, padY + (box.y + box.height - vb[1]) * sy) + margin;
  const preview = svg.cloneNode(true);
  preview.setAttribute('viewBox', [vb[0] + (left - padX) / sx, vb[1] + (top - padY) / sy, (right - left) / sx, (bottom - top) / sy].join(' '));
  preview.setAttribute('preserveAspectRatio', 'none');
  preview.setAttribute('width', String((right - left) * RESOLUTION));
  preview.setAttribute('height', String((bottom - top) * RESOLUTION));
  return { preview, previewX: left, previewY: top, previewWidth: right - left, previewHeight: bottom - top,
    leftOverhang: -left, rightOverhang: right - width, topOverhang: -top, bottomOverhang: bottom - height };
}

const mathCache = new Map();
let mathQueue = Promise.resolve();

async function mathToken(part, style) {
  const key = JSON.stringify([part.text, part.display, style.size, style.color, style.source.id]);
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
    const svgs = node.querySelectorAll('svg');
    if (svgs.length > 1) throw new Error('El motor matemático dividió la fórmula en varias imágenes SVG. No se exportó para evitar truncarla; recarga la página y revisa la configuración matemática.');
    const svg = svgs[0];
    const error = node.querySelector('[data-mml-node="merror"], merror, mjx-merror');
    if (!svg || error) {
      const detail = error?.getAttribute('data-mjx-error') || error?.textContent || 'notación no admitida';
      throw new Error(`No se pudo interpretar la fórmula «${part.text.slice(0, 100)}»: ${detail}.`);
    }
    outlineMathText(svg, style);
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
    const viewport = mathPreviewViewport(svg, width, height);
    const source = new XMLSerializer().serializeToString(viewport.preview).replace(/currentColor/g, escapeXML(style.color));
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
    const image = await loadImage(dataUrl);
    const { preview, ...previewMetrics } = viewport;
    return { type: 'math', image, svgRoot: svg.cloneNode(true), width, ascent: Math.max(0, height - descent), descent, display: part.display, ...previewMetrics };
  });
  mathQueue = promise.catch(() => {});
  mathCache.set(key, promise);
  if (mathCache.size > 160) mathCache.delete(mathCache.keys().next().value);
  promise.catch(() => mathCache.delete(key));
  return promise;
}

const fontSources = new WeakMap();
let fontSourceSerial = 0;

function fontSource(block) {
  const bytes = block.fontBytes;
  if (!bytes || !(bytes instanceof Uint8Array || bytes instanceof ArrayBuffer)) {
    throw new Error('No están disponibles los datos de la fuente. Vuelve a cargarla antes de exportar.');
  }
  let source = fontSources.get(bytes);
  if (source) return source;
  if (!window.fontkit?.create) throw new Error('No se cargó el motor de fuentes. Recarga la página.');
  try {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const font = window.fontkit.create(data);
    if (!font.layout || !font.unitsPerEm) throw new Error('El archivo no contiene una fuente TTF/OTF individual.');
    source = { id: ++fontSourceSerial, bytes: data, font };
    fontSources.set(bytes, source);
    fontSources.set(data, source);
    return source;
  } catch (error) {
    throw new Error(`No se pudo interpretar la fuente «${block.fontFamily || block.fontId || ''}»: ${error.message}`);
  }
}

function normalizeStyle(block, pageWidth) {
  const source = fontSource(block);
  return {
    size: Math.max(1, finite(block.size, 24)),
    width: Math.max(1, finite(block.width, pageWidth * 0.9)),
    lineHeight: Math.max(0.8, finite(block.lineHeight, 1.25)),
    source,
    color: colorValue(block.color),
    align: ['left', 'center', 'right'].includes(block.align) ? block.align : 'center',
    wrap: block.wrap !== false,
    math: block.math ?? block.key !== 'name',
  };
}

function textToken(text, style, metrics) {
  // Reading a composite glyph outline can cache its unencoded components in
  // fontkit. Restore Unicode on those cached base glyphs before shaping so the
  // PDF ToUnicode map never loses letters such as A after previewing Á.
  for (const char of text) {
    const glyph = style.source.font.glyphForCodePoint(char.codePointAt(0));
    if (!glyph.codePoints?.length) glyph.codePoints = [char.codePointAt(0)];
  }
  const run = style.source.font.layout(text);
  const scale = style.size / style.source.font.unitsPerEm;
  let penX = 0, penY = 0, left = 0, right = 0, top = 0, bottom = 0;
  const glyphs = run.glyphs.map((glyph, index) => {
    if (glyph.id === 0 && !/^\s*$/u.test(text)) {
      throw new Error(`La fuente seleccionada no contiene todos los caracteres de «${text.slice(0, 80)}». Selecciona o carga otra fuente.`);
    }
    const position = run.positions[index];
    const x = penX + position.xOffset * scale;
    const y = penY + position.yOffset * scale;
    const box = glyph.bbox;
    if (box && Number.isFinite(box.minX)) {
      left = Math.min(left, x + box.minX * scale);
      right = Math.max(right, x + box.maxX * scale);
      top = Math.max(top, y + box.maxY * scale);
      bottom = Math.min(bottom, y + box.minY * scale);
    }
    penX += position.xAdvance * scale;
    penY += position.yAdvance * scale;
    return { glyph, x, y };
  });
  return {
    type: 'text', text, glyphs, scale, width: penX,
    ascent: Math.max(0, top) || metrics?.ascent || style.size * .8,
    descent: Math.max(0, -bottom) || metrics?.descent || 0,
    whitespace: /^\s+$/u.test(text),
    leftOverhang: Math.max(0, -left),
    rightOverhang: Math.max(0, right - penX),
  };
}

async function layoutBlock(text, style) {
  const sample = textToken('Ájg', style);
  const metrics = { ascent: sample.ascent, descent: sample.descent };
  const segments = style.math ? parseMathSegments(text) : [{ type: 'text', text }];
  const tokens = [];
  for (const part of segments) {
    if (part.type === 'math') { tokens.push(await mathToken(part, style)); continue; }
    for (const chunk of part.text.replace(/\r\n?/g, '\n').split(/(\n|[^\S\n]+)/u)) {
      if (!chunk) continue;
      tokens.push(chunk === '\n' ? { type: 'break' } : textToken(chunk, style, metrics));
    }
  }
  const rows = [];
  let line = [], width = 0;
  const flush = (force = false) => {
    while (line.at(-1)?.whitespace) { width -= line.pop().width; }
    if (line.length || force) rows.push({ tokens: line, width: Math.max(0, width) });
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
      const chars = typeof Intl.Segmenter === 'function'
        ? [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(token.text)].map(x => x.segment)
        : Array.from(token.text);
      let chunk = '';
      for (const char of chars) {
        if (chunk && textToken(chunk + char, style, metrics).width > style.width) {
          add(textToken(chunk, style, metrics)); flush(); chunk = '';
        }
        chunk += char;
      }
      if (chunk) add(textToken(chunk, style, metrics));
    } else add(token);
  }
  flush();
  if (!rows.length) rows.push({ tokens: [], width: 0 });
  const warnings = [];
  const contentWidth = Math.max(style.width, ...rows.map(x => x.width));
  if (contentWidth > style.width + 0.5) warnings.push('Hay una fórmula o un texto sin división que supera el ancho del bloque. Aumenta el ancho o reduce el tamaño.');
  let contentHeight = 0;
  for (const row of rows) {
    row.ascent = Math.max(metrics.ascent, ...row.tokens.map(x => x.ascent));
    row.descent = Math.max(metrics.descent, ...row.tokens.map(x => x.descent));
    row.height = Math.max(style.size * style.lineHeight, row.ascent + row.descent);
    row.baseline = contentHeight + (row.height - row.ascent - row.descent) / 2 + row.ascent;
    row.x = style.align === 'center' ? (contentWidth - row.width) / 2 : style.align === 'right' ? contentWidth - row.width : 0;
    contentHeight += row.height;
  }
  const overhang = Math.max(0, ...tokens.map(t => Math.max(t.leftOverhang || 0, t.rightOverhang || 0, t.topOverhang || 0, t.bottomOverhang || 0)));
  const padding = Math.max(2, overhang + 1);
  const pixelWidth = Math.ceil((contentWidth + 2 * padding) * RESOLUTION);
  const pixelHeight = Math.ceil((contentHeight + 2 * padding) * RESOLUTION);
  if (pixelWidth > MAX_CANVAS_EDGE || pixelHeight > MAX_CANVAS_EDGE || pixelWidth * pixelHeight > MAX_CANVAS_PIXELS) {
    throw new Error('El bloque es demasiado grande para representarlo. Reduce el texto, el ancho o el tamaño de fuente. No se ha reducido automáticamente.');
  }
  return { width: pixelWidth / RESOLUTION, height: pixelHeight / RESOLUTION, contentWidth, contentHeight, warnings,
    empty: !text.trim(), lines: rows.length, resolution: RESOLUTION, rows, padding, style };
}

function previewBlock(layout) {
  if (layout.dataUrl) return layout.dataUrl;
  const { style, padding } = layout;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.width * RESOLUTION);
  canvas.height = Math.round(layout.height * RESOLUTION);
  const ctx = canvas.getContext('2d');
  ctx.scale(RESOLUTION, RESOLUTION);
  ctx.fillStyle = style.color;
  for (const row of layout.rows) {
    let x = padding + row.x;
    const baseline = padding + row.baseline;
    for (const token of row.tokens) {
      if (token.type === 'math') ctx.drawImage(token.image, x + token.previewX, baseline - token.ascent + token.previewY, token.previewWidth, token.previewHeight);
      else for (const positioned of token.glyphs) {
        ctx.save();
        ctx.translate(x + positioned.x, baseline - positioned.y);
        ctx.scale(token.scale, -token.scale);
        ctx.fill(new Path2D(positioned.glyph.path.toSVG()));
        ctx.restore();
      }
      x += token.width;
    }
  }
  layout.dataUrl = canvas.toDataURL('image/png');
  canvas.width = 1; canvas.height = 1;
  return layout.dataUrl;
}

function drawTextToken(page, token, x, baseline, style, font, fontKey) {
  const lib = window.PDFLib;
  const hex = font.encodeText(token.text).asString();
  if (hex.length !== token.glyphs.length * 4) throw new Error('La fuente produjo una codificación de glifos incompatible con la exportación PDF.');
  const color = style.color.slice(1, 7);
  const operators = [lib.pushGraphicsState(), lib.setFillingRgbColor(
    parseInt(color.slice(0, 2), 16) / 255, parseInt(color.slice(2, 4), 16) / 255, parseInt(color.slice(4, 6), 16) / 255),
    lib.beginText(), lib.setFontAndSize(fontKey, style.size)];
  for (let i = 0; i < token.glyphs.length; i++) {
    const glyph = token.glyphs[i];
    operators.push(lib.setTextMatrix(1, 0, 0, 1, x + glyph.x, baseline + glyph.y), lib.showText(lib.PDFHexString.of(hex.slice(i * 4, i * 4 + 4))));
  }
  operators.push(lib.endText(), lib.popGraphicsState());
  page.pushOperators(...operators);
}

/** Render a MathJax SVG as PDF vector geometry, with no embedded image. */
async function drawMathSvg(page, token, x, baseline, context = {}) {
  const P = window.PDFLib;
  const svg = token.svgRoot;
  if (!svg) throw new Error('Falta el trazado vectorial de la fórmula.');
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some(n => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    throw new Error('La fórmula no tiene dimensiones vectoriales válidas.');
  }
  const num = (value, fallback = 0) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const props = ['color', 'fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset'];
  const colorCanvas = document.createElement('canvas').getContext('2d');
  function paint(value, currentColor) {
    if (value == null || value === 'none') return null;
    if (value === 'currentColor') value = currentColor;
    colorCanvas.fillStyle = '#000000';
    colorCanvas.fillStyle = value;
    const normalized = colorCanvas.fillStyle;
    let r, g, b, a = 1;
    const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(normalized);
    if (hex) {
      r = parseInt(hex[1].slice(0, 2), 16) / 255;
      g = parseInt(hex[1].slice(2, 4), 16) / 255;
      b = parseInt(hex[1].slice(4, 6), 16) / 255;
      if (hex[2]) a = parseInt(hex[2], 16) / 255;
    } else {
      const rgba = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(normalized);
      if (!rgba) throw new Error(`El color matemático «${value}» no está admitido.`);
      r = +rgba[1] / 255; g = +rgba[2] / 255; b = +rgba[3] / 255; a = rgba[4] == null ? 1 : +rgba[4];
    }
    return { color: P.rgb(r, g, b), alpha: a };
  }
  function transform(value) {
    if (!value) return;
    const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let part;
    while ((part = re.exec(value))) {
      const v = (part[2].match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || []).map(Number);
      let m;
      switch (part[1]) {
        case 'matrix': if (v.length !== 6) throw new Error('Transformación matemática no válida.'); m = v; break;
        case 'translate': m = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
        case 'scale': m = [v[0], 0, 0, v[1] ?? v[0], 0, 0]; break;
        case 'rotate': {
          const a = v[0] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = v[1] || 0, cy = v[2] || 0;
          m = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; break;
        }
        case 'skewX': m = [1, 0, Math.tan(v[0] * Math.PI / 180), 1, 0, 0]; break;
        case 'skewY': m = [1, Math.tan(v[0] * Math.PI / 180), 0, 1, 0, 0]; break;
        default: throw new Error(`Transformación matemática no admitida: ${part[1]}.`);
      }
      if (m.some(n => !Number.isFinite(n))) throw new Error('Transformación matemática no válida.');
      page.pushOperators(P.concatTransformationMatrix(...m));
    }
  }
  function paintOptions(style) {
    const fill = paint(style.fill, style.color);
    const border = paint(style.stroke, style.color);
    const opacity = Math.max(0, Math.min(1, style.opacity));
    const borderWidth = num(style['stroke-width'], 1);
    return {
      x: 0, y: 0,
      color: fill?.color,
      opacity: fill ? opacity * num(style['fill-opacity'], 1) * fill.alpha : 0,
      borderColor: border && borderWidth > 0 ? border.color : undefined,
      borderWidth: border && borderWidth > 0 ? borderWidth : 0,
      borderOpacity: border ? opacity * num(style['stroke-opacity'], 1) * border.alpha : 0,
      borderLineCap: ({ butt: 0, round: 1, square: 2 })[style['stroke-linecap']] ?? 0,
      borderDashArray: !style['stroke-dasharray'] || style['stroke-dasharray'] === 'none' ? undefined : style['stroke-dasharray'].split(/[\s,]+/).map(Number),
      borderDashPhase: num(style['stroke-dashoffset'], 0),
    };
  }
  function path(d, style) {
    if (!d) return;
    const opts = paintOptions(style);
    if (!opts.color && !opts.borderColor) return;
    page.pushOperators(P.pushGraphicsState());
    // drawSvgPath applies its own Y reflection. Cancel it: the outer viewBox
    // matrix already maps SVG's downward Y axis onto PDF's upward Y axis.
    page.pushOperators(P.concatTransformationMatrix(1, 0, 0, -1, 0, 0));
    if (P.setLineJoin) page.pushOperators(P.setLineJoin(({ miter: 0, round: 1, bevel: 2 })[style['stroke-linejoin']] ?? 0));
    page.drawSvgPath(d, opts);
    page.pushOperators(P.popGraphicsState());
  }
  async function fallbackText(node, style) {
    const text = node.textContent;
    if (!text.trim()) return;
    if (context.drawFallbackText) {
      await context.drawFallbackText(page, node, style);
      return;
    }
    const font = context.source?.font;
    if (!font) throw new Error('La fórmula incluye caracteres sin trazado matemático. Escribe ese texto fuera de los delimitadores matemáticos.');
    for (const char of text) {
      if (!/\s/.test(char) && font.hasGlyphForCodePoint && !font.hasGlyphForCodePoint(char.codePointAt(0))) {
        throw new Error(`La fuente no contiene el carácter matemático «${char}». Carga una fuente que lo incluya o escribe ese texto fuera de la fórmula.`);
      }
    }
    const size = num(node.style?.fontSize || node.getAttribute('font-size'), 1000);
    const unit = (value) => {
      const parsed = num(value);
      return /em$/.test(value || '') ? parsed * size : /ex$/.test(value || '') ? parsed * size / 2 : parsed;
    };
    const run = font.layout(text);
    const scale = size / font.unitsPerEm;
    const width = run.positions.reduce((total, pos) => total + pos.xAdvance, 0) * scale;
    const anchor = node.style?.getPropertyValue('text-anchor') || node.getAttribute('text-anchor') || 'start';
    let penX = unit(node.getAttribute('x')) + unit(node.getAttribute('dx')) - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
    let penY = unit(node.getAttribute('y')) + unit(node.getAttribute('dy'));
    for (let i = 0; i < run.glyphs.length; i++) {
      const glyph = run.glyphs[i], position = run.positions[i];
      page.pushOperators(P.pushGraphicsState(), P.concatTransformationMatrix(scale, 0, 0, -scale, penX + position.xOffset * scale, penY - position.yOffset * scale));
      try { path(glyph.path.toSVG(), style); }
      finally { page.pushOperators(P.popGraphicsState()); }
      penX += position.xAdvance * scale;
      penY -= position.yAdvance * scale;
    }
  }
  async function visit(node, inherited, references = new Set()) {
    const tag = node.localName?.toLowerCase();
    if (!tag || ['defs', 'title', 'desc', 'metadata', 'style'].includes(tag)) return;
    const style = { ...inherited };
    for (const prop of props) {
      const value = node.style?.getPropertyValue(prop) || node.getAttribute(prop);
      if (value && value !== 'inherit') style[prop] = value;
    }
    const ownOpacity = node.style?.getPropertyValue('opacity') || node.getAttribute('opacity');
    style.opacity = inherited.opacity * num(ownOpacity, 1);
    if (node.getAttribute('display') === 'none' || node.style?.display === 'none' || node.getAttribute('visibility') === 'hidden') return;
    page.pushOperators(P.pushGraphicsState());
    try {
      transform(node.getAttribute('transform'));
      if (tag === 'path') path(node.getAttribute('d'), style);
      else if (tag === 'rect') {
        const px = num(node.getAttribute('x')), py = num(node.getAttribute('y'));
        const w = num(node.getAttribute('width')), h = num(node.getAttribute('height'));
        let rx = Math.min(w / 2, Math.max(0, num(node.getAttribute('rx'), num(node.getAttribute('ry')))));
        let ry = Math.min(h / 2, Math.max(0, num(node.getAttribute('ry'), rx)));
        if (w > 0 && h > 0) path(rx && ry
          ? `M${px + rx},${py}H${px + w - rx}A${rx},${ry},0,0,1,${px + w},${py + ry}V${py + h - ry}A${rx},${ry},0,0,1,${px + w - rx},${py + h}H${px + rx}A${rx},${ry},0,0,1,${px},${py + h - ry}V${py + ry}A${rx},${ry},0,0,1,${px + rx},${py}Z`
          : `M${px},${py}h${w}v${h}h${-w}Z`, style);
      } else if (tag === 'line') {
        path(`M${num(node.getAttribute('x1'))},${num(node.getAttribute('y1'))}L${num(node.getAttribute('x2'))},${num(node.getAttribute('y2'))}`, { ...style, fill: 'none' });
      } else if (tag === 'polygon' || tag === 'polyline') {
        const points = node.getAttribute('points')?.trim();
        if (points) path(`M${points}${tag === 'polygon' ? 'Z' : ''}`, style);
      } else if (tag === 'circle' || tag === 'ellipse') {
        const cx = num(node.getAttribute('cx')), cy = num(node.getAttribute('cy'));
        const rx = num(node.getAttribute(tag === 'circle' ? 'r' : 'rx'));
        const ry = num(node.getAttribute(tag === 'circle' ? 'r' : 'ry'));
        if (rx > 0 && ry > 0) path(`M${cx - rx},${cy}a${rx},${ry},0,1,0,${2 * rx},0a${rx},${ry},0,1,0,${-2 * rx},0Z`, style);
      } else if (tag === 'use') {
        const href = node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (!href?.startsWith('#')) throw new Error('La fórmula contiene una referencia SVG externa no admitida.');
        const id = href.slice(1);
        if (references.has(id)) throw new Error('La fórmula contiene una referencia SVG circular.');
        const target = Array.from(svg.querySelectorAll('[id]')).find(el => el.id === id);
        if (!target) throw new Error('No se encontró un símbolo vectorial de la fórmula.');
        page.pushOperators(P.concatTransformationMatrix(1, 0, 0, 1, num(node.getAttribute('x')), num(node.getAttribute('y'))));
        await visit(target, style, new Set([...references, id]));
      } else if (tag === 'text') {
        await fallbackText(node, style);
      } else if (tag === 'g' || tag === 'svg' || tag === 'a') {
        for (const child of node.children) await visit(child, style, references);
      } else {
        throw new Error(`El elemento matemático SVG «${tag}» no está admitido.`);
      }
    } finally {
      page.pushOperators(P.popGraphicsState());
    }
  }
  let sx = token.width / vb[2], sy = (token.ascent + token.descent) / vb[3];
  let padX = 0, padY = 0;
  const aspect = svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet';
  if (aspect !== 'none') {
    const scale = /slice/.test(aspect) ? Math.max(sx, sy) : Math.min(sx, sy);
    const freeX = token.width - vb[2] * scale;
    const freeY = token.ascent + token.descent - vb[3] * scale;
    padX = /xMin/.test(aspect) ? 0 : /xMax/.test(aspect) ? freeX : freeX / 2;
    padY = /YMin/.test(aspect) ? 0 : /YMax/.test(aspect) ? freeY : freeY / 2;
    sx = sy = scale;
  }
  page.pushOperators(P.pushGraphicsState(), P.concatTransformationMatrix(sx, 0, 0, -sy, x + padX - vb[0] * sx, baseline + token.ascent - padY + vb[1] * sy));
  try {
    await visit(svg, { color: context.color || token.color || '#222222', fill: 'black', stroke: 'none', 'stroke-width': 1, opacity: 1 });
  } finally {
    page.pushOperators(P.popGraphicsState());
  }
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
  // A valid blank PDF page may omit /Contents entirely. Give it an empty
  // stream so pdf-lib can normalize it like any other template.
  if (!page.node.Contents()) page.pushOperators(window.PDFLib.pushGraphicsState(), window.PDFLib.popGraphicsState());
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

  async function getLayout(value, block, renderOptions = {}) {
    if (destroyed) throw new Error('Esta plantilla ya está cerrada.');
    checkAbort(renderOptions.signal);
    const text = String(value ?? '');
    const style = normalizeStyle(block, width);
    const key = JSON.stringify([text, { ...style, source: style.source.id }]);
    let pending = cache.get(key);
    if (pending) { cache.delete(key); cache.set(key, pending); }
    else {
      pending = layoutBlock(text, style);
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
    return { layout: rendered, x, y, warnings };
  }

  async function renderBlock(value, block, renderOptions = {}) {
    const placed = await getLayout(value, block, renderOptions);
    const { layout, x, y, warnings } = placed;
    return { dataUrl: previewBlock(layout), width: layout.width, height: layout.height,
      contentWidth: layout.contentWidth, contentHeight: layout.contentHeight,
      empty: layout.empty, lines: layout.lines, resolution: RESOLUTION, x, y, warnings };
  }

  async function generatePdf(row, blocks, generationOptions = {}) {
    checkAbort(generationOptions.signal);
    const blockList = Array.isArray(blocks) ? blocks : Object.entries(blocks).map(([key, block]) => ({ key, ...block }));
    const placedBlocks = [];
    for (const block of blockList) {
      checkAbort(generationOptions.signal);
      if (block.visible === false || block.enabled === false) continue;
      const text = String(row[block.key] ?? '');
      if (!text.trim()) continue;
      const placed = await getLayout(text, block, generationOptions);
      placedBlocks.push(placed);
      generationOptions.onWarning?.(placed.warnings, { row, block });
    }
    async function build(subset) {
      const lib = window.PDFLib;
      const output = await lib.PDFDocument.create();
      output.registerFontkit({ create: data => fontSources.get(data)?.font || window.fontkit.create(data) });
      const [page] = await output.copyPages(template, [0]);
      output.addPage(page);
      output.setTitle(`Constancia — ${String(row.name ?? '')}`);
      output.setCreator('Estudio de constancias');
      const embeddedFonts = new Map();
      for (const { layout, x, y } of placedBlocks) {
        checkAbort(generationOptions.signal);
        const { style, padding } = layout;
        let embedded = embeddedFonts.get(style.source.id);
        if (!embedded) {
          const hasCff = Boolean(style.source.font.directory?.tables?.['CFF ']);
          // CFF subsetting in this fontkit version can emit invalid fonts that
          // silently trigger viewer substitutions. Embed OTF/CFF in full.
          const font = await output.embedFont(style.source.bytes, { subset: subset && !hasCff });
          if (hasCff) {
            // Fontkit exposes the CFF table, while this pdf-lib build checks a
            // legacy .cff flag. Set the corresponding PDF font subtype too.
            font.embedder.isCFF = () => true;
            // pdf-lib labels every CFF stream as bare CIDFontType0C. A complete
            // OTF file includes an OpenType container and must say /OpenType.
            font.embedder.embedFontStream = async pdfContext => pdfContext.register(
              pdfContext.flateStream(style.source.bytes, { Subtype: 'OpenType' }));
          }
          embedded = { font, fontKey: page.node.newFontDictionary(font.name, font.ref) };
          embeddedFonts.set(style.source.id, embedded);
        }
        for (const textRow of layout.rows) {
          let penX = x + padding + textRow.x;
          const baseline = y + layout.height - padding - textRow.baseline;
          for (const token of textRow.tokens) {
            if (token.type === 'math') await drawMathSvg(page, token, penX, baseline, { source: style.source, color: style.color, size: style.size });
            else drawTextToken(page, token, penX, baseline, style, embedded.font, embedded.fontKey);
            penX += token.width;
          }
        }
      }
      checkAbort(generationOptions.signal);
      try {
        const bytes = await output.save({ useObjectStreams: true });
        checkAbort(generationOptions.signal);
        return bytes;
      } catch (error) {
        checkAbort(generationOptions.signal);
        if (!subset) throw error;
        // Some uncommon OTF fonts cannot be subsetted by fontkit. Retain native
        // text by embedding the complete font; never substitute a bitmap.
        generationOptions.onWarning?.(['Esta fuente requirió incrustarse completa; el PDF puede ocupar más espacio.'], { row });
        return build(false);
      }
    }
    return build(true);
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
