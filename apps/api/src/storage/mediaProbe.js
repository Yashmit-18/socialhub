/**
 * Reads what a stored file really is from its bytes: type (magic numbers), pixel size and,
 * for videos, duration. The client's declared type is never trusted.
 *
 * `read(start, length)` returns a Buffer (shorter at end of file); only small ranges are
 * requested, so this works on files of any size without downloading them.
 *
 * Returns `{ mimeType, width, height, durationSec }`, with null for anything that could not
 * be determined, or `{ mimeType: null }` when the file is none of the supported types.
 */

const HEAD_BYTES = 64 * 1024;
const MAX_MOOV_BYTES = 8 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 64;

const ascii = (buffer, start, end) => buffer.toString('latin1', start, end);

function probePng(head) {
  if (head.length < 24 || ascii(head, 12, 16) !== 'IHDR') return {};
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function probeGif(head) {
  if (head.length < 10) return {};
  return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
}

/** Walks JPEG segments to the start-of-frame marker, which holds the dimensions. */
async function probeJpeg(read, head) {
  let buffer = head;
  let base = 0;
  let offset = 2;
  for (let guard = 0; guard < 512; guard += 1) {
    if (offset + 9 > base + buffer.length) {
      buffer = await read(offset, HEAD_BYTES);
      base = offset;
      if (buffer.length < 9) return {};
    }
    const at = offset - base;
    if (buffer[at] !== 0xff) return {};
    const marker = buffer[at + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(at + 5), width: buffer.readUInt16BE(at + 7) };
    }
    if (marker === 0xd9 || marker === 0xda) return {};
    const standalone = marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
    offset += standalone ? 2 : 2 + buffer.readUInt16BE(at + 2);
  }
  return {};
}

function boxHeader(buffer, at) {
  if (at + 8 > buffer.length) return null;
  let size = buffer.readUInt32BE(at);
  const type = ascii(buffer, at + 4, at + 8);
  let header = 8;
  if (size === 1) {
    if (at + 16 > buffer.length) return null;
    size = Number(buffer.readBigUInt64BE(at + 8));
    header = 16;
  }
  return { size, type, header };
}

/** Child boxes of a container held fully in `buffer` between `start` and `end`. */
function* children(buffer, start, end) {
  let at = start;
  while (at + 8 <= end) {
    const box = boxHeader(buffer, at);
    if (!box || box.size < box.header) return;
    const boxEnd = box.size === 0 ? end : Math.min(end, at + box.size);
    yield { type: box.type, start: at + box.header, end: boxEnd };
    at = boxEnd;
  }
}

function parseMoov(moov) {
  let durationSec = null;
  let width = null;
  let height = null;
  for (const box of children(moov, 0, moov.length)) {
    if (box.type === 'mvhd') {
      const v1 = moov[box.start] === 1;
      const timescale = moov.readUInt32BE(box.start + (v1 ? 20 : 12));
      const duration = v1
        ? Number(moov.readBigUInt64BE(box.start + 24))
        : moov.readUInt32BE(box.start + 16);
      if (timescale > 0 && duration > 0) durationSec = duration / timescale;
    }
    if (box.type !== 'trak') continue;
    for (const inner of children(moov, box.start, box.end)) {
      if (inner.type !== 'tkhd') continue;
      // Width and height are the last two 16.16 fixed-point fields of the track header.
      const w = moov.readUInt32BE(inner.end - 8) / 65536;
      const h = moov.readUInt32BE(inner.end - 4) / 65536;
      // Audio tracks report 0×0; keep the largest picture track.
      if (w > 0 && h > 0 && w * h > (width ?? 0) * (height ?? 0)) {
        width = Math.round(w);
        height = Math.round(h);
      }
    }
  }
  return { width, height, durationSec };
}

/** Finds the `moov` box by hopping over top-level boxes (it may follow the media data). */
async function probeIsoMedia(read, head, sizeBytes) {
  let offset = 0;
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES && offset + 8 <= sizeBytes; i += 1) {
    const chunk = offset + 16 <= head.length ? head.subarray(offset) : await read(offset, 16);
    const box = boxHeader(chunk, 0);
    if (!box || (box.size !== 0 && box.size < box.header)) return {};
    const size = box.size === 0 ? sizeBytes - offset : box.size;
    if (box.type === 'moov') {
      const length = size - box.header;
      if (length <= 0 || length > MAX_MOOV_BYTES) return {};
      const moov = await read(offset + box.header, length);
      if (moov.length < length) return {};
      try {
        return parseMoov(moov);
      } catch {
        return {};
      }
    }
    offset += size;
  }
  return {};
}

const QUICKTIME_BRANDS = new Set(['qt  ']);

export async function probeMedia(read, sizeBytes) {
  const head = await read(0, Math.min(HEAD_BYTES, sizeBytes));
  const none = { mimeType: null, width: null, height: null, durationSec: null };
  if (head.length < 12) return none;

  let mimeType = null;
  let details = {};
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    mimeType = 'image/jpeg';
    details = await probeJpeg(read, head);
  } else if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mimeType = 'image/png';
    details = probePng(head);
  } else if (['GIF87a', 'GIF89a'].includes(ascii(head, 0, 6))) {
    mimeType = 'image/gif';
    details = probeGif(head);
  } else if (ascii(head, 4, 8) === 'ftyp') {
    mimeType = QUICKTIME_BRANDS.has(ascii(head, 8, 12)) ? 'video/quicktime' : 'video/mp4';
    details = await probeIsoMedia(read, head, sizeBytes);
  } else if (['moov', 'mdat', 'wide', 'free'].includes(ascii(head, 4, 8))) {
    // Classic QuickTime files may have no `ftyp` box.
    mimeType = 'video/quicktime';
    details = await probeIsoMedia(read, head, sizeBytes);
  }
  if (!mimeType) return none;

  const positive = (value) => (Number.isFinite(value) && value > 0 ? value : null);
  return {
    mimeType,
    width: positive(details.width),
    height: positive(details.height),
    durationSec: positive(details.durationSec),
  };
}
