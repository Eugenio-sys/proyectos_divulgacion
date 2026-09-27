/** Spreadsheet input and original certificate filename/preview conventions.
 * JSZip is bundled locally and exposed as window.JSZip by the page.
 */
const REQUIRED_HEADERS = ['id', 'name', 'tallerpuno', 'tallerpdos'];
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ROWS = 10000;
const INVALID_ID = /[\\/:*?"<>|\u0000-\u001f\u007f]/u;

function inputError(message) {
  return new Error(message);
}

function children(element, name) {
  return [...element.children].filter((node) => node.localName === name);
}

function descendants(element, name) {
  return [...element.getElementsByTagName('*')].filter((node) => node.localName === name);
}

function firstChild(element, name) {
  return children(element, name)[0];
}

function parseXML(text, label) {
  // XLSX parts do not require DTDs or externally resolved entities.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw inputError(`El archivo contiene declaraciones XML no admitidas (${label}).`);
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.documentElement.localName === 'parsererror' || descendants(doc, 'parsererror').length) {
    throw inputError(`No se pudo leer el XML de ${label}. El archivo XLSX parece estar dañado.`);
  }
  return doc;
}

/** Check advertised uncompressed sizes before JSZip expands any ZIP member. */
function inspectArchive(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength > MAX_TOTAL_BYTES) {
    throw inputError('El archivo excede el límite de 100 MB. Utiliza un libro más pequeño.');
  }
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw inputError('El archivo está cifrado o utiliza el formato antiguo XLS. Ábrelo en Excel y guarda una copia XLSX sin contraseña.');
  }
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw inputError('El archivo no es un libro XLSX válido. Guarda el libro como .xlsx; cambiar su extensión no convierte el formato.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos -= 1) {
    if (view.getUint32(pos, true) === 0x06054b50 && pos + 22 + view.getUint16(pos + 20, true) === bytes.length) {
      end = pos;
      break;
    }
  }
  if (end < 0) throw inputError('El archivo XLSX está incompleto o dañado.');
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 ||
      view.getUint16(end + 8, true) !== count || count === 0xffff || offset === 0xffffffff || size === 0xffffffff) {
    throw inputError('El libro utiliza un archivo ZIP dividido o ZIP64 no admitido. Guarda una copia XLSX estándar.');
  }
  const centralEnd = offset + size;
  if (centralEnd > end) throw inputError('El directorio del archivo XLSX está dañado.');
  let total = 0;
  const paths = new Set();
  const decoder = new TextDecoder('utf-8');
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== 0x02014b50) {
      throw inputError('El directorio del archivo XLSX está dañado.');
    }
    const flags = view.getUint16(offset + 8, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > centralEnd) throw inputError('El archivo XLSX contiene una entrada dañada.');
    if (flags & 1) throw inputError('El libro está cifrado. Guarda una copia XLSX sin contraseña.');
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw inputError('Una parte del libro supera 50 MB al descomprimirse. Utiliza un libro más pequeño.');
    }
    total += uncompressedSize;
    if (total > MAX_TOTAL_BYTES) throw inputError('El libro supera 100 MB al descomprimirse. Utiliza un libro más pequeño.');
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (path.includes('\\') || path.startsWith('/') || path.split('/').includes('..') || paths.has(path)) {
      throw inputError('El archivo XLSX contiene rutas internas inválidas o repetidas. Guarda una nueva copia desde Excel.');
    }
    paths.add(path);
    offset = next;
  }
  if (offset !== centralEnd) throw inputError('El archivo XLSX contiene un directorio no válido.');
}

function resolvePart(basePart, target) {
  if (!target || /[?#\\]/.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    throw inputError('El libro contiene una referencia de hoja no válida.');
  }
  const path = target.startsWith('/') ? [] : basePart.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!path.length) throw inputError('El libro contiene una referencia fuera de sus archivos internos.');
      path.pop();
    } else {
      path.push(segment);
    }
  }
  return path.join('/');
}

function relationshipPath(part) {
  const split = part.lastIndexOf('/');
  return `${split < 0 ? '' : part.slice(0, split + 1)}_rels/${part.slice(split + 1)}.rels`;
}

function richString(container) {
  if (!container) return '';
  return [...container.children].map((node) => {
    if (node.localName === 't') return node.textContent || '';
    if (node.localName === 'r') return children(node, 't').map((text) => text.textContent || '').join('');
    return '';
  }).join('');
}

function columnIndex(reference) {
  const match = /^([A-Z]{1,3})[1-9][0-9]*$/i.exec(reference);
  if (!match) throw inputError(`El libro contiene una referencia de celda no válida: ${reference}.`);
  let result = 0;
  for (const letter of match[1].toUpperCase()) result = result * 26 + letter.charCodeAt(0) - 64;
  if (result > 16384) throw inputError('El libro contiene una columna fuera del rango de Excel.');
  return result - 1;
}

function cellValue(cell, sharedStrings, rowNumber, onFormula) {
  const value = firstChild(cell, 'v');
  const formula = firstChild(cell, 'f');
  const kind = cell.getAttribute('t') || 'n';
  if (formula) {
    if (!value) {
      throw inputError(`La fila ${rowNumber} contiene una fórmula sin resultado guardado. Abre el libro en Excel, recalcula y guarda, o pega los valores.`);
    }
    onFormula();
  }
  if (kind === 'inlineStr') return richString(firstChild(cell, 'is'));
  if (!value) return '';
  const text = value.textContent || '';
  if (kind === 's') {
    const index = Number(text);
    if (!/^\d+$/.test(text) || !Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
      throw inputError(`La fila ${rowNumber} contiene una referencia de texto dañada.`);
    }
    return sharedStrings[index];
  }
  if (kind === 'e') throw inputError(`La fila ${rowNumber} contiene un error de Excel (${text}). Corrígelo antes de importar.`);
  if (kind === 'b') return text === '1' ? 'TRUE' : 'FALSE';
  if (kind === 'n' && text !== '') {
    const number = Number(text);
    if (!Number.isFinite(number)) throw inputError(`La fila ${rowNumber} contiene un número no válido.`);
    return String(number);
  }
  return text;
}

/** Equivalent to the original Latin-ASCII + filename cleanup. */
function sanitizedName(value) {
  const latin = String(value ?? '').replace(/[ÆæŒœØøŁłĐđÐðÞþßẞı]/gu, (letter) => ({
    Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', Ø: 'O', ø: 'o', Ł: 'L', ł: 'l', Đ: 'D', đ: 'd',
    Ð: 'D', ð: 'd', Þ: 'TH', þ: 'th', ß: 'ss', ẞ: 'SS', ı: 'i',
  })[letter]).normalize('NFKD').replace(/\p{M}/gu, '');
  return latin.replace(/[^A-Za-z0-9 _.-]/g, '').replace(/\s+/g, '_')
    .replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '') || 'archivo';
}

/** Filename convention is intentionally compatible with the Shiny application. */
export function filenameFor(row) {
  const id = String(row.id ?? '');
  if (INVALID_ID.test(id)) {
    throw inputError(`El id de la fila ${row.rowNumber ?? '?'} contiene caracteres no válidos para un archivo: \\ / : * ? " < > | o caracteres de control. Corrígelo en el Excel.`);
  }
  const base = `${id ? `${id}_` : ''}${sanitizedName(row.name)}`;
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base)) {
    throw inputError(`La fila ${row.rowNumber ?? '?'} produce un nombre reservado de Windows (${base}.pdf). Añade un id diferente.`);
  }
  if (new TextEncoder().encode(`${base}.pdf`).length > 240) {
    throw inputError(`El nombre del PDF de la fila ${row.rowNumber ?? '?'} es demasiado largo. Acorta el nombre o el id (máximo 240 bytes para el archivo).`);
  }
  return `${base}.pdf`;
}

/** Each field is selected independently, by Unicode character count, like nchar. */
export function longestPreview(rows) {
  const result = {};
  for (const field of ['name', 'tallerpuno', 'tallerpdos']) {
    let longest = '';
    let length = 0;
    for (const row of rows) {
      const text = String(row[field] ?? '');
      const current = Array.from(text).length;
      if (current > length) {
        longest = text;
        length = current;
      }
    }
    result[field] = longest ? `${longest} Áj` : '';
  }
  return result;
}

/** Read and validate the first worksheet, using workbook relationship targets. */
export async function readWorkbook(arrayBuffer) {
  inspectArchive(arrayBuffer);
  const JSZip = globalThis.JSZip || globalThis.window?.JSZip;
  if (!JSZip) throw inputError('No se pudo cargar el lector de Excel. Recarga la página e inténtalo otra vez.');
  let archive;
  try {
    archive = await JSZip.loadAsync(arrayBuffer);
  } catch {
    throw inputError('No se pudo abrir el XLSX. Comprueba que no esté dañado ni protegido con contraseña.');
  }
  async function xmlPart(path, optional = false) {
    const entry = archive.file(path);
    if (!entry) {
      if (optional) return null;
      throw inputError(`Al libro le falta un archivo interno (${path}). Guarda una nueva copia XLSX.`);
    }
    // JSZip independently parses the central directory; check its size too.
    if (entry._data?.uncompressedSize > MAX_ENTRY_BYTES) throw inputError('Una parte del libro supera el límite de 50 MB.');
    let bytes;
    try {
      bytes = await entry.async('uint8array');
    } catch {
      throw inputError(`No se pudo descomprimir ${path}. El XLSX parece estar dañado.`);
    }
    if (bytes.byteLength > MAX_ENTRY_BYTES) throw inputError('Una parte del libro supera el límite de 50 MB.');
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' :
      bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    return parseXML(new TextDecoder(encoding).decode(bytes), path);
  }
  const packageRelationships = await xmlPart('_rels/.rels');
  const officeRelationship = descendants(packageRelationships, 'Relationship')
    .find((node) => (node.getAttribute('Type') || '').endsWith('/officeDocument'));
  if (!officeRelationship || officeRelationship.getAttribute('TargetMode') === 'External') {
    throw inputError('El archivo no contiene un libro de Excel válido.');
  }
  const workbookPath = resolvePart('', officeRelationship.getAttribute('Target'));
  const workbook = await xmlPart(workbookPath);
  if (workbook.documentElement.localName !== 'workbook') throw inputError('El archivo no contiene un libro XLSX válido.');
  const relationships = await xmlPart(relationshipPath(workbookPath));
  const relationshipNodes = descendants(relationships, 'Relationship');
  const sheets = descendants(workbook, 'sheet');
  let selectedSheet;
  let sheetRelationship;
  for (const sheet of sheets) {
    const relationshipId = [...sheet.attributes].find((attribute) => attribute.localName === 'id')?.value;
    const relationship = relationshipNodes.find((node) => node.getAttribute('Id') === relationshipId);
    if (relationship && (relationship.getAttribute('Type') || '').endsWith('/worksheet')) {
      selectedSheet = sheet;
      sheetRelationship = relationship;
      break;
    }
  }
  if (!selectedSheet || sheetRelationship.getAttribute('TargetMode') === 'External') {
    throw inputError('El libro no contiene una primera hoja de datos válida.');
  }
  const sheetName = selectedSheet.getAttribute('name') || 'Hoja 1';
  const stringsRelationship = relationshipNodes.find((node) => (node.getAttribute('Type') || '').endsWith('/sharedStrings'));
  let sharedStrings = [];
  if (stringsRelationship) {
    if (stringsRelationship.getAttribute('TargetMode') === 'External') throw inputError('El libro contiene una referencia externa de textos no admitida.');
    const strings = await xmlPart(resolvePart(workbookPath, stringsRelationship.getAttribute('Target')));
    sharedStrings = children(strings.documentElement, 'si').map(richString);
  }
  const worksheet = await xmlPart(resolvePart(workbookPath, sheetRelationship.getAttribute('Target')));
  const sheetData = firstChild(worksheet.documentElement, 'sheetData');
  if (!sheetData) throw inputError(`La hoja «${sheetName}» está vacía.`);
  const physicalRows = children(sheetData, 'row');
  const rows = [];
  const warnings = [];
  let headers;
  let previousRow = 0;
  let formulaUsed = false;
  let blankIds = 0;
  const filenames = new Map();
  const seenRows = new Set();
  for (const xmlRow of physicalRows) {
    const rowNumber = xmlRow.hasAttribute('r') ? Number(xmlRow.getAttribute('r')) : previousRow + 1;
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 1048576 || seenRows.has(rowNumber)) {
      throw inputError('El libro contiene un número de fila inválido o repetido.');
    }
    seenRows.add(rowNumber);
    previousRow = rowNumber;
    const cells = new Map();
    let previousColumn = -1;
    for (const cell of children(xmlRow, 'c')) {
      const reference = cell.getAttribute('r');
      const column = reference ? columnIndex(reference) : previousColumn + 1;
      previousColumn = column;
      if (cells.has(column)) throw inputError(`La fila ${rowNumber} contiene celdas repetidas.`);
      // Unused columns do not prevent certificate generation, even with formulas/errors.
      if (headers && !headers.includes(column)) continue;
      cells.set(column, cellValue(cell, sharedStrings, rowNumber, () => { formulaUsed = true; }));
    }
    if (rowNumber === 1) {
      headers = REQUIRED_HEADERS.map((header) => {
        const matches = [...cells].filter(([, text]) => text === header).map(([column]) => column);
        if (matches.length > 1) throw inputError(`El encabezado «${header}» está repetido en la primera fila.`);
        return matches[0];
      });
      const missing = REQUIRED_HEADERS.filter((_, index) => headers[index] === undefined);
      if (missing.length) {
        throw inputError(`Faltan estos encabezados exactos en la primera fila: ${missing.join(', ')}. El XLSX debe incluir id, name, tallerpuno y tallerpdos (en minúsculas y sin espacios).`);
      }
      continue;
    }
    if (!headers) throw inputError('La primera fila debe contener los encabezados id, name, tallerpuno y tallerpdos.');
    const row = Object.fromEntries(REQUIRED_HEADERS.map((header, index) => [header, cells.get(headers[index]) ?? '']));
    row.rowNumber = rowNumber;
    if (REQUIRED_HEADERS.every((header) => row[header].trim() === '')) continue;
    if (!row.name.trim()) throw inputError(`Falta el nombre (name) en la fila ${rowNumber}. Completa el nombre o elimina esa fila.`);
    const filename = filenameFor(row);
    const key = filename.normalize('NFC').toLocaleLowerCase('en-US');
    if (filenames.has(key)) {
      throw inputError(`Las filas ${filenames.get(key)} y ${rowNumber} producirían el mismo PDF (${filename}). Asigna identificadores distintos para evitar que una constancia reemplace a otra.`);
    }
    filenames.set(key, rowNumber);
    if (!row.id) blankIds += 1;
    rows.push(row);
    if (rows.length > MAX_ROWS) throw inputError(`El libro contiene más de ${MAX_ROWS.toLocaleString('es')} registros. Divídelo en archivos más pequeños.`);
  }
  if (!headers) throw inputError('La primera fila debe contener los encabezados id, name, tallerpuno y tallerpdos.');
  if (!rows.length) throw inputError(`La hoja «${sheetName}» no contiene personas debajo de los encabezados.`);
  if (blankIds) warnings.push(`${blankIds} ${blankIds === 1 ? 'fila no tiene id: su PDF usará' : 'filas no tienen id: sus PDF usarán'} solo el nombre de la persona.`);
  if (formulaUsed) warnings.push('Se utilizaron los resultados guardados de las fórmulas. Si cambiaste el Excel, recalcúlalo y guárdalo antes de importarlo.');
  return { rows, warnings, sheetName };
}
