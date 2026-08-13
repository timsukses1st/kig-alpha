/**
 * Penulis file .xlsx tanpa pustaka luar.
 *
 * Kenapa ditulis sendiri, bukan pakai SheetJS/ExcelJS:
 *  - Repo ini punya package-lock.json, sedangkan file diedit lewat GitHub web.
 *    Menambah dependensi berarti lockfile tidak sinkron, dan build Vercel bisa
 *    gagal dengan "npm ci ... not in sync" yang hanya bisa dibetulkan dengan
 *    menjalankan npm install di komputer.
 *  - Kebutuhan kita cuma MENULIS tabel sederhana. Pustaka besar itu 90% fitur
 *    baca-tulis rumus, chart, dan parsing — tidak dipakai sama sekali.
 *
 * Sebuah .xlsx adalah arsip ZIP berisi beberapa berkas XML. Modul ini membuat
 * ZIP-nya sendiri (dengan CRC32 + DEFLATE lewat CompressionStream bawaan
 * browser) lalu menyusun XML minimal yang dibutuhkan Excel & Google Sheets.
 */

export interface XlsxColumn {
  /** Judul kolom di baris pertama. */
  header: string;
  /** Nama field di objek baris. */
  key: string;
  /** Lebar kolom dalam satuan karakter. Default 18. */
  width?: number;
}

export interface XlsxSheet {
  /** Nama tab. Karakter terlarang Excel dibersihkan otomatis. */
  name: string;
  columns: XlsxColumn[];
  rows: Record<string, unknown>[];
}

// ---------------------------------------------------------------- XML helpers

/** Excel menolak karakter kontrol; ini juga mencegah XML rusak karena & atau <. */
function esc(v: string): string {
  return v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A, B, ... Z, AA, AB, ... — penomoran kolom ala Excel. */
function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Nama tab tidak boleh mengandung : \ / ? * [ ] dan maksimal 31 karakter.
 * Kalau dilanggar, Excel menolak membuka filenya tanpa penjelasan yang jelas.
 */
function safeSheetName(name: string, index: number): string {
  const cleaned = (name || '').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

function cellXml(ref: string, value: unknown, styleIdx: number): string {
  const s = styleIdx ? ` s="${styleIdx}"` : '';

  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}"${s}/>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  // Sisanya ditulis sebagai teks inline. Sengaja tidak memakai sharedStrings:
  // lebih sederhana, dan selisih ukurannya tidak berarti untuk ekspor sebesar ini.
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"/>`)
    .join('');

  const header = sheet.columns
    .map((c, i) => cellXml(`${colName(i)}1`, c.header, 1))
    .join('');

  const body = sheet.rows
    .map((row, r) => {
      const cells = sheet.columns
        .map((c, i) => cellXml(`${colName(i)}${r + 2}`, row[c.key], 0))
        .join('');
      return `<row r="${r + 2}">${cells}</row>`;
    })
    .join('');

  const lastCol = colName(Math.max(sheet.columns.length - 1, 0));
  const lastRow = sheet.rows.length + 1;

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    // Baris judul dibekukan supaya tetap terlihat saat digulir.
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${lastRow}"/>` +
    '</worksheet>'
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1F6FEB"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '</cellXfs>' +
  '</styleSheet>';

// ---------------------------------------------------------------------- ZIP

const enc = new TextEncoder();

/** Tabel CRC32 dibuat sekali lalu dipakai ulang. */
let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Kompresi DEFLATE mentah memakai CompressionStream bawaan browser.
 * Kalau browsernya terlalu tua, file tetap dibuat — hanya tanpa kompresi
 * (metode "stored"), yang tetap sah menurut spesifikasi ZIP.
 */
async function deflateRaw(data: Uint8Array): Promise<{ body: Uint8Array; method: number }> {
  const CS = (globalThis as unknown as { CompressionStream?: unknown }).CompressionStream;
  if (typeof CS !== 'function' || data.length === 0) {
    return { body: data, method: 0 };
  }
  try {
    const stream = new (CS as new (f: string) => TransformStream)('deflate-raw');
    const writer = stream.writable.getWriter();
    void writer.write(data);
    void writer.close();
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value as Uint8Array);
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return { body: out, method: 8 };
  } catch {
    return { body: data, method: 0 };
  }
}

interface ZipEntry { name: string; data: Uint8Array }

async function makeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const { body, method } = await deflateRaw(e.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);        // versi minimum
    lv.setUint16(6, 0, true);         // flag
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);        // waktu — sengaja 0 supaya hasilnya konsisten
    lv.setUint16(12, 0x21, true);     // tanggal — 1 Januari 1996, penanda netral
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  let centralSize = 0;
  for (const c of centrals) centralSize += c.length;

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  let total = 0;
  for (const p of locals) total += p.length;
  total += centralSize + end.length;

  const out = new Uint8Array(total);
  let off = 0;
  for (const p of locals) { out.set(p, off); off += p.length; }
  for (const c of centrals) { out.set(c, off); off += c.length; }
  out.set(end, off);
  return out;
}

// ------------------------------------------------------------------ publik

/** Membuat isi file .xlsx sebagai byte. Dipisah supaya bisa diuji tanpa browser. */
export async function buildXlsx(sheets: XlsxSheet[]): Promise<Uint8Array> {
  const list = sheets.length ? sheets : [{ name: 'Kosong', columns: [], rows: [] }];
  const names = list.map((s, i) => safeSheetName(s.name, i));

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    list
      .map((_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('') +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    list
      .map((_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('') +
    `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRels) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) },
    ...list.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: enc.encode(sheetXml(s)),
    })),
  ];

  return makeZip(entries);
}

/** Membuat file lalu langsung memicu unduhan di browser. */
export async function downloadXlsx(fileName: string, sheets: XlsxSheet[]): Promise<void> {
  const bytes = await buildXlsx(sheets);
  // Cast diperlukan: TypeScript versi baru menandai Uint8Array<ArrayBufferLike>
  // tidak cocok dengan BlobPart. Secara runtime keduanya sama.
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Ditunda sebentar — kalau langsung dicabut, sebagian browser membatalkan unduhan.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
