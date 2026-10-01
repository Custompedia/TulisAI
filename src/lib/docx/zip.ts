// Minimal ZIP reader/writer for DOCX on Cloudflare Workers: no Node built-ins, no dependency.
// Compression uses the platform CompressionStream/DecompressionStream with 'deflate-raw'.
import { MAX_DOCX_ENTRIES, MAX_DOCX_PART_BYTES, MAX_DOCX_TOTAL_BYTES } from '../limits';

export type ZipEntry = { name: string; data: Uint8Array };
// maxEntryBytes bounds a part that is read whole; maxStreamBytes a part that is streamed (the document body, which a
// 2,000-page thesis can make larger than a Worker could hold as one string). Neither ever applies to images: the
// importer does not inflate them at all.
export type ZipLimits = { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number; maxStreamBytes?: number };
export const ZIP_LIMITS: ZipLimits = { maxEntries: MAX_DOCX_ENTRIES, maxEntryBytes: 24_000_000, maxTotalBytes: MAX_DOCX_TOTAL_BYTES, maxStreamBytes: MAX_DOCX_PART_BYTES };

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

// Incremental CRC-32: pass the previous value (already finalised) to continue over the next chunk.
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function through(bytes: Uint8Array, transform: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

export const deflateRaw = (bytes: Uint8Array) => through(bytes, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
export const inflateRaw = (bytes: Uint8Array) => through(bytes, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);

export type ZipDirectoryEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; start: number };

// Reads the central directory rather than scanning local headers, so a truncated or lying entry is caught by bounds
// checks. Nothing is inflated here.
export function zipDirectory(bytes: Uint8Array, maxEntries = ZIP_LIMITS.maxEntries): Map<string, ZipDirectoryEntry> {
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
  if (total > maxEntries) throw new ZipError(`ZIP has too many entries (${total}).`);
  if (directoryOffset + directorySize > bytes.length) throw new ZipError('ZIP central directory is out of bounds.');

  const decoder = new TextDecoder();
  const entries = new Map<string, ZipDirectoryEntry>();
  let cursor = directoryOffset;
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
    if (name.endsWith('/')) continue;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIG) throw new ZipError(`ZIP entry ${name} has no local header.`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (start + compressedSize > bytes.length) throw new ZipError(`ZIP entry ${name} is truncated.`);
    if (method !== 0 && method !== 8) throw new ZipError(`ZIP entry ${name} uses unsupported compression method ${method}.`);
    entries.set(name, { name, method, compressedSize, uncompressedSize, start });
  }
  return entries;
}

// The entry's bytes as a stream. The declared size is attacker-controlled, so inflation stops the moment the output
// passes it (or `limit`), with an error instead of the next chunk.
export function streamZipEntry(bytes: Uint8Array, entry: ZipDirectoryEntry, limit: number): ReadableStream<Uint8Array> {
  if (entry.uncompressedSize > limit) throw new ZipError(`ZIP entry ${entry.name} is too large.`);
  const raw = bytes.subarray(entry.start, entry.start + entry.compressedSize);
  if (entry.method === 0) {
    if (raw.length > entry.uncompressedSize) throw new ZipError(`ZIP entry ${entry.name} is larger than it declares.`);
    return new Blob([raw as BlobPart]).stream();
  }
  let size = 0;
  const bound = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.length;
      if (size > entry.uncompressedSize) throw new ZipError(`ZIP entry ${entry.name} is larger than it declares.`);
      controller.enqueue(chunk);
    },
  });
  return new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>).pipeThrough(bound);
}

// The entry's bytes in one buffer, for the small parts (styles, numbering, notes, headers).
export async function readZipEntry(bytes: Uint8Array, entry: ZipDirectoryEntry, limit: number): Promise<Uint8Array> {
  const reader = streamZipEntry(bytes, entry, limit).getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length; chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof ZipError ? error : new ZipError(`ZIP entry ${entry.name} could not be read.`);
  }
  if (chunks.length === 1) return chunks[0]!;
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

// Every entry, inflated: what tests and small tools want. The importer reads only the parts it maps.
export async function unzip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  let written = 0;
  for (const entry of zipDirectory(bytes, limits.maxEntries).values()) {
    if (entry.uncompressedSize > limits.maxEntryBytes) throw new ZipError(`ZIP entry ${entry.name} is too large.`);
    written += entry.uncompressedSize;
    if (written > limits.maxTotalBytes) throw new ZipError('ZIP contents exceed the allowed total size.');
    files.set(entry.name, await readZipEntry(bytes, entry, limits.maxEntryBytes));
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
