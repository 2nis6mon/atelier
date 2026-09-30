// Apple Pages documents. Two local paths, both read-only:
//  1. Older .pages packages embed QuickLook/Preview.pdf → its text layer is
//     extracted like any PDF (reliable).
//  2. Current .pages files store text in IWA archives (Snappy-compressed
//     protobuf). Atelier reads text storages from Index/Document.iwa. This
//     reader follows the publicly documented structure but has only been
//     validated on synthetic files, so its output is marked as experimental
//     and must be reviewed; the in-app instructions to export to DOCX from
//     Pages are always shown alongside.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { unzipSync } from 'fflate';

export interface PagesExtraction {
  text: string;
  method: 'pages:preview-pdf' | 'pages:iwa-experimental' | 'pages:none';
  previewPdf: Uint8Array | null;
  warnings: string[];
}

/** Raw Snappy block decoder (no framing, no CRC — as used inside IWA chunks). */
export function snappyDecompress(input: Uint8Array): Uint8Array {
  let pos = 0;
  let length = 0;
  let shift = 0;
  for (;;) {
    if (pos >= input.length) throw new Error('snappy: truncated length');
    const b = input[pos++];
    length |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) throw new Error('snappy: length too large');
  }
  if (length > 64 * 1024 * 1024) throw new Error('snappy: output too large');
  const out = new Uint8Array(length);
  let op = 0;
  while (pos < input.length) {
    const tag = input[pos++];
    const type = tag & 3;
    if (type === 0) {
      let len = tag >> 2;
      if (len >= 60) {
        const extra = len - 59;
        len = 0;
        for (let i = 0; i < extra; i++) len |= input[pos++] << (8 * i);
      }
      len += 1;
      if (pos + len > input.length || op + len > out.length) throw new Error('snappy: literal overflow');
      out.set(input.subarray(pos, pos + len), op);
      pos += len;
      op += len;
      continue;
    }
    let len: number;
    let offset: number;
    if (type === 1) {
      len = ((tag >> 2) & 7) + 4;
      offset = ((tag >> 5) << 8) | input[pos++];
    } else if (type === 2) {
      len = (tag >> 2) + 1;
      offset = input[pos] | (input[pos + 1] << 8);
      pos += 2;
    } else {
      len = (tag >> 2) + 1;
      offset = (input[pos] | (input[pos + 1] << 8) | (input[pos + 2] << 16) | (input[pos + 3] << 24)) >>> 0;
      pos += 4;
    }
    if (offset === 0 || offset > op || op + len > out.length) throw new Error('snappy: bad copy');
    for (let i = 0; i < len; i++, op++) out[op] = out[op - offset];
  }
  if (op !== length) throw new Error('snappy: length mismatch');
  return out;
}

/** Decodes an IWA file: 4-byte headers (0x00 + 24-bit length) followed by Snappy blocks. */
export function decodeIwa(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let pos = 0;
  while (pos + 4 <= data.length) {
    if (data[pos] !== 0) throw new Error('iwa: unexpected chunk header');
    const len = data[pos + 1] | (data[pos + 2] << 8) | (data[pos + 3] << 16);
    pos += 4;
    if (pos + len > data.length) throw new Error('iwa: truncated chunk');
    parts.push(snappyDecompress(data.subarray(pos, pos + len)));
    pos += len;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

interface Field {
  num: number;
  wire: number;
  value: number | Uint8Array;
}

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let mul = 1;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new Error('protobuf: truncated varint');
    const b = buf[pos++];
    result += (b & 0x7f) * mul;
    if ((b & 0x80) === 0) return [result, pos];
    mul *= 128;
  }
  throw new Error('protobuf: varint too long');
}

export function parseProtobuf(buf: Uint8Array): Field[] {
  const fields: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos);
    pos = p1;
    const num = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      const [v, p2] = readVarint(buf, pos);
      fields.push({ num, wire, value: v });
      pos = p2;
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      if (p2 + len > buf.length) throw new Error('protobuf: truncated bytes');
      fields.push({ num, wire, value: buf.subarray(p2, p2 + len) });
      pos = p2 + len;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new Error(`protobuf: unsupported wire type ${wire}`);
    }
  }
  return fields;
}

/** TSWP.StorageArchive message types that carry document text. */
const TEXT_STORAGE_TYPES = new Set([2001, 2005]);

/** Extracts text storages from a decoded IWA stream. */
export function iwaTextStorages(stream: Uint8Array): string[] {
  const texts: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let pos = 0;
  while (pos < stream.length) {
    const [infoLen, p1] = readVarint(stream, pos);
    const info = parseProtobuf(stream.subarray(p1, p1 + infoLen));
    pos = p1 + infoLen;
    for (const mi of info.filter((f) => f.num === 2 && f.wire === 2)) {
      const m = parseProtobuf(mi.value as Uint8Array);
      const type = Number(m.find((f) => f.num === 1)?.value ?? 0);
      const length = Number(m.find((f) => f.num === 3)?.value ?? 0);
      const payload = stream.subarray(pos, pos + length);
      pos += length;
      if (!TEXT_STORAGE_TYPES.has(type)) continue;
      try {
        for (const f of parseProtobuf(payload)) {
          if (f.num === 3 && f.wire === 2) texts.push(decoder.decode(f.value as Uint8Array));
        }
      } catch {
        // skip unreadable message
      }
    }
  }
  return texts;
}

function cleanPagesText(t: string): string {
  return t
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n')
    .replace(/[\ufffc\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readPackage(path: string): Record<string, Uint8Array> {
  if (statSync(path).isDirectory()) {
    const entries: Record<string, Uint8Array> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/Preview\.pdf$|Document\.iwa$/.test(name)) entries[relative(path, p).split('\\').join('/')] = new Uint8Array(readFileSync(p));
      }
    };
    walk(path);
    return entries;
  }
  return unzipSync(new Uint8Array(readFileSync(path)), {
    filter: (f) => /(^|\/)(QuickLook\/Preview\.pdf|Index\/Document\.iwa|Index\.zip)$/.test(f.name) && f.originalSize < 64 * 1024 * 1024,
  });
}

/** Reads a .pages file or package directory. Never modifies it. */
export function readPages(path: string): PagesExtraction {
  if (!existsSync(path)) throw new Error('File not found');
  let entries: Record<string, Uint8Array>;
  try {
    entries = readPackage(path);
  } catch {
    return { text: '', method: 'pages:none', previewPdf: null, warnings: ['This Pages file could not be opened.'] };
  }
  const previewKey = Object.keys(entries).find((k) => k.endsWith('QuickLook/Preview.pdf'));
  if (previewKey) return { text: '', method: 'pages:preview-pdf', previewPdf: entries[previewKey], warnings: [] };

  // Some packages keep the IWA files inside Index.zip
  let iwa = entries['Index/Document.iwa'];
  if (!iwa && entries['Index.zip']) {
    try {
      iwa = unzipSync(entries['Index.zip'], { filter: (f) => f.name.endsWith('Document.iwa') })['Index/Document.iwa'];
    } catch {
      iwa = undefined as unknown as Uint8Array;
    }
  }
  if (iwa) {
    try {
      const texts = iwaTextStorages(decodeIwa(iwa)).map(cleanPagesText).filter((t) => t.length > 0);
      texts.sort((a, b) => b.length - a.length);
      const body = texts[0] ?? '';
      if (body.length >= 40) {
        return {
          text: body,
          method: 'pages:iwa-experimental',
          previewPdf: null,
          warnings: ['Text read directly from the Pages file (experimental reader). Compare with your document; export to Word from Pages if something is missing.'],
        };
      }
    } catch {
      // fall through to conversion instructions
    }
  }
  return {
    text: '',
    method: 'pages:none',
    previewPdf: null,
    warnings: ['Atelier could not read text from this Pages file. Export it to Word (.docx) from Pages, then import the .docx.'],
  };
}
