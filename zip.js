/* Small dependency-free ZIP32 codec. Writes standard uncompressed ZIP files.
   Reads this app's STORE archives, checking bounds, size and CRC before restore. */
'use strict';
(() => {
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
  const table = Array.from({length: 256}, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  const LIMIT = 512 * 1024 * 1024;
  async function create(entries) {
    if (entries.length > 65535) throw Error('Too many files for a ZIP backup.');
    const parts = [], central = [];
    let offset = 0, centralSize = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : new Uint8Array(await entry.data.arrayBuffer());
      if (offset + data.length > LIMIT) throw Error('This trip exceeds the 512 MB export limit. Export smaller trips to keep phone memory use safe.');
      const crc = crc32(data), local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
      lv.setUint16(12, 33, true); // 1980-01-01; observation timestamps are in JSON.
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true); local.set(name, 30);
      const directory = new Uint8Array(46 + name.length), dv = new DataView(directory.buffer);
      dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x800, true);
      dv.setUint16(14, 33, true); dv.setUint32(16, crc, true); dv.setUint32(20, data.length, true); dv.setUint32(24, data.length, true);
      dv.setUint16(28, name.length, true); dv.setUint32(42, offset, true); directory.set(name, 46);
      parts.push(local, data); central.push(directory); offset += local.length + data.length; centralSize += directory.length;
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], {type: 'application/zip'});
  }
  async function read(blob) {
    if (blob.size > LIMIT) throw Error('Backup exceeds the 512 MB import limit.');
    const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
    const check = (start, size) => { if (start < 0 || size < 0 || start + size > bytes.length) throw Error('Truncated ZIP backup.'); };
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
      if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) {end = p; break;}
    }
    if (end < 0) throw Error('Not a valid ZIP backup.');
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error('Multipart ZIP is not supported.');
    const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true);
    let p = view.getUint32(end + 16, true);
    const directoryEnd = p + directorySize;
    if (directoryEnd !== end || count !== view.getUint16(end + 8, true)) throw Error('Invalid ZIP directory.');
    const files = new Map();
    let total = 0;
    for (let i = 0; i < count; i++) {
      check(p, 46);
      if (view.getUint32(p, true) !== 0x02014b50) throw Error('Invalid ZIP entry.');
      const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true), size = view.getUint32(p + 20, true), rawSize = view.getUint32(p + 24, true);
      const length = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true);
      check(p + 46, length + extra + comment);
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + length));
      if (flags & 1 || method !== 0 || size !== rawSize) throw Error('Import the original ZIP exported by this app (uncompressed, unencrypted).');
      if (name.startsWith('/') || name.includes('..') || name.includes('\\') || files.has(name)) throw Error('Unsafe or duplicate ZIP filename.');
      const local = view.getUint32(p + 42, true); check(local, 30);
      if (view.getUint32(local, true) !== 0x04034b50) throw Error('Invalid ZIP file header.');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      check(start, size);
      if (start + size > view.getUint32(end + 16, true)) throw Error('Invalid ZIP data bounds.');
      total += size; if (total > LIMIT) throw Error('Backup is too large.');
      const data = bytes.subarray(start, start + size);
      if (crc32(data) !== crc) throw Error('ZIP checksum failed: backup is damaged.');
      files.set(name, new Blob([data])); p += 46 + length + extra + comment;
    }
    if (p !== directoryEnd) throw Error('Invalid ZIP directory length.');
    return files;
  }
  globalThis.FieldZip = {create, read, crc32};
})();
