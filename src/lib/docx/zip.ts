// Minimal ZIP reader/writer for DOCX on Cloudflare Workers: no Node built-ins, no dependency.
// Compression uses the platform CompressionStream/DecompressionStream with 'deflate-raw'.

export type ZipEntry = { name: string; data: Uint8Array };
export type ZipLimits = { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number };
export const ZIP_LIMITS: ZipLimits = { maxEntries: 200, maxEntryBytes: 8_000_000, maxTotalBytes: 16_000_000 };

export class ZipError extends Error {}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD_SIZE = 22;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function through(bytes: Uint8Array, transform: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

export const deflateRaw = (bytes: Uint8Array) => through(bytes, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
export const inflateRaw = (bytes: Uint8Array) => through(bytes, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);

// The declared size is attacker-controlled, so inflation stops the moment the output passes it.
async function inflateBounded(bytes: Uint8Array, limit: number, name: string): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel().catch(() => undefined); throw new ZipError(`ZIP entry ${name} is larger than it declares.`); }
    chunks.push(value);
  }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

// Reads the central directory rather than scanning local headers, so a truncated or lying entry is caught by bounds checks.
export async function unzip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): Promise<Map<string, Uint8Array>> {
  if (bytes.length < EOCD_SIZE) throw new ZipError('Not a ZIP archive.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = bytes.length - EOCD_SIZE; index >= 0 && index >= bytes.length - EOCD_SIZE - 0xffff; index--) {
    if (view.getUint32(index, true) === EOCD_SIG) { eocd = index; break; }
  }
  if (eocd < 0) throw new ZipError('ZIP end-of-central-directory record not found.');

  const total = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (total > limits.maxEntries) throw new ZipError(`ZIP has too many entries (${total}).`);
  if (directoryOffset + directorySize > bytes.length) throw new ZipError('ZIP central directory is out of bounds.');

  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  let cursor = directoryOffset;
  let written = 0;

  for (let index = 0; index < total; index++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_SIG) throw new ZipError('ZIP central directory entry is malformed.');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    if (uncompressedSize > limits.maxEntryBytes) throw new ZipError(`ZIP entry ${name} is too large.`);
    written += uncompressedSize;
    if (written > limits.maxTotalBytes) throw new ZipError('ZIP contents exceed the allowed total size.');
    if (name.endsWith('/')) continue;

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIG) throw new ZipError(`ZIP entry ${name} has no local header.`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > bytes.length) throw new ZipError(`ZIP entry ${name} is truncated.`);
    const raw = bytes.subarray(start, end);

    if (method === 0) { if (raw.length > uncompressedSize) throw new ZipError(`ZIP entry ${name} is larger than it declares.`); files.set(name, raw); }
    else if (method === 8) files.set(name, await inflateBounded(raw, uncompressedSize, name));
    else throw new ZipError(`ZIP entry ${name} uses unsupported compression method ${method}.`);
  }
  return files;
}

type Prepared = { name: Uint8Array; data: Uint8Array; stored: Uint8Array; method: number; crc: number };

// DOS timestamp; DOCX readers ignore it, so a fixed value keeps exports byte-stable.
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01

export async function zip(entries: ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const prepared: Prepared[] = [];
  for (const entry of entries) {
    const data = entry.data;
    // Deflate only pays off past a few hundred bytes; STORE keeps the tiny OOXML parts simple and is equally valid.
    const compressed = data.length > 256 ? await deflateRaw(data) : null;
    const useDeflate = compressed !== null && compressed.length < data.length;
    prepared.push({ name: encoder.encode(entry.name), data, stored: useDeflate ? compressed : data, method: useDeflate ? 8 : 0, crc: crc32(data) });
  }

  const localSize = prepared.reduce((sum, item) => sum + 30 + item.name.length + item.stored.length, 0);
  const centralSize = prepared.reduce((sum, item) => sum + 46 + item.name.length, 0);
  const output = new Uint8Array(localSize + centralSize + EOCD_SIZE);
  const view = new DataView(output.buffer);
  const offsets: number[] = [];
  let cursor = 0;

  for (const item of prepared) {
    offsets.push(cursor);
    view.setUint32(cursor, LOCAL_SIG, true);
    view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 0, true);
    view.setUint16(cursor + 8, item.method, true);
    view.setUint16(cursor + 10, DOS_TIME, true);
    view.setUint16(cursor + 12, DOS_DATE, true);
    view.setUint32(cursor + 14, item.crc, true);
    view.setUint32(cursor + 18, item.stored.length, true);
    view.setUint32(cursor + 22, item.data.length, true);
    view.setUint16(cursor + 26, item.name.length, true);
    view.setUint16(cursor + 28, 0, true);
    output.set(item.name, cursor + 30);
    output.set(item.stored, cursor + 30 + item.name.length);
    cursor += 30 + item.name.length + item.stored.length;
  }

  const directoryOffset = cursor;
  prepared.forEach((item, index) => {
    view.setUint32(cursor, CENTRAL_SIG, true);
    view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 20, true);
    view.setUint16(cursor + 8, 0, true);
    view.setUint16(cursor + 10, item.method, true);
    view.setUint16(cursor + 12, DOS_TIME, true);
    view.setUint16(cursor + 14, DOS_DATE, true);
    view.setUint32(cursor + 16, item.crc, true);
    view.setUint32(cursor + 20, item.stored.length, true);
    view.setUint32(cursor + 24, item.data.length, true);
    view.setUint16(cursor + 28, item.name.length, true);
    view.setUint16(cursor + 30, 0, true);
    view.setUint16(cursor + 32, 0, true);
    view.setUint16(cursor + 34, 0, true);
    view.setUint16(cursor + 36, 0, true);
    view.setUint32(cursor + 38, 0, true);
    view.setUint32(cursor + 42, offsets[index]!, true);
    output.set(item.name, cursor + 46);
    cursor += 46 + item.name.length;
  });

  view.setUint32(cursor, EOCD_SIG, true);
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, prepared.length, true);
  view.setUint16(cursor + 10, prepared.length, true);
  view.setUint32(cursor + 12, centralSize, true);
  view.setUint32(cursor + 16, directoryOffset, true);
  view.setUint16(cursor + 20, 0, true);
  return output;
}
