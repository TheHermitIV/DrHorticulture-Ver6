// Store already-compressed JPEG and PNG files in a standard ZIP archive.
const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let i = 0; i < 8; i++) byte = byte & 1 ? (byte >>> 1) ^ 0xedb88320 : byte >>> 1;
  return byte >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size, values) {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  for (const [offset, width, value] of values) {
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  }
  return data;
}
export async function makeZip(files) {
  if (files.length > 65535) throw new Error('Too many files for one ZIP.');
  const parts = [],
    directory = [];
  let offset = 0,
    directorySize = 0;
  for (const [path, blob] of files) {
    const name = encoder.encode(path);
    const data = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(data);
    parts.push(
      header(30, [
        [0, 4, 0x04034b50],
        [4, 2, 20],
        [6, 2, 2048],
        [12, 2, 33],
        [14, 4, crc],
        [18, 4, data.length],
        [22, 4, data.length],
        [26, 2, name.length],
      ]),
      name,
      data,
    );
    directory.push(
      header(46, [
        [0, 4, 0x02014b50],
        [4, 2, 20],
        [6, 2, 20],
        [8, 2, 2048],
        [14, 2, 33],
        [16, 4, crc],
        [20, 4, data.length],
        [24, 4, data.length],
        [28, 2, name.length],
        [42, 4, offset],
      ]),
      name,
    );
    offset += 30 + name.length + data.length;
    directorySize += 46 + name.length;
    if (offset + directorySize > 0xffffffff) throw new Error('Export fewer photos at a time.');
  }
  const end = header(22, [
    [0, 4, 0x06054b50],
    [8, 2, files.length],
    [10, 2, files.length],
    [12, 4, directorySize],
    [16, 4, offset],
  ]);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
