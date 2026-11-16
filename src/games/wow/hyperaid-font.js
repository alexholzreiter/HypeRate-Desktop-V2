const fs = require('node:fs');
const path = require('node:path');

const template = fs.readFileSync(path.join(__dirname, '../../../assets/hyperaid/placeholder.ttf'));
const tables = Array.from({ length: template.readUInt16BE(4) }, (_, i) => {
  const record = 12 + i * 16;
  const offset = template.readUInt32BE(record + 8);
  const length = template.readUInt32BE(record + 12);
  return [template.toString('ascii', record, record + 4), template.subarray(offset, offset + length)];
});

function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) sum = (sum + bytes.readUInt32BE(i)) >>> 0;
  return sum;
}

function fontNames(slot) {
  const family = `HypeRaid Live Pulse ${slot}`;
  const postscript = `HypeRaidLivePulse${slot}`;
  const names = [family, 'Regular', `${postscript}-1.0`, family, 'Version 1.0', postscript];
  const header = Buffer.alloc(6 + names.length * 12);
  header.writeUInt16BE(names.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  const strings = names.map((name, index) => {
    const data = Buffer.from(name, 'utf16le').swap16();
    [3, 1, 0x0409, index + 1, data.length, offset].forEach((value, field) => {
      header.writeUInt16BE(value, 6 + index * 12 + field * 2);
    });
    offset += data.length;
    return data;
  });
  return Buffer.concat([header, ...strings]);
}

// Keep the slot-specific font identity and the glyph widths used by HypeRaid's Lua reader.
function liveFontBytes(slot, bpm, timestamp) {
  const check = (3 * slot + 7 * bpm + 11 * timestamp) % 97;
  const digits = `${String(bpm).padStart(3, '0')}${String(timestamp).padStart(10, '0')}${String(check).padStart(2, '0')}`;
  const widths = [256, 256, 768, ...Array.from(digits, digit => 256 + Number(digit) * 64), 256];
  const hmtx = Buffer.alloc(widths.length * 4);
  widths.forEach((width, index) => hmtx.writeUInt16BE(width, index * 4));
  const hhea = Buffer.from(tables.find(([tag]) => tag === 'hhea')[1]);
  hhea.writeUInt16BE(Math.max(...widths), 10);
  hhea.writeInt16BE(Math.min(...widths) - 64, 14);
  const head = Buffer.from(tables.find(([tag]) => tag === 'head')[1]);
  head.writeUInt32BE(0, 8);
  const replacements = { head, hhea, hmtx, name: fontNames(slot) };

  const directory = Buffer.from(template.subarray(0, 12 + tables.length * 16));
  let offset = directory.length;
  let headOffset;
  const blocks = tables.map(([tag, original], index) => {
    const data = replacements[tag] || original;
    const block = Buffer.alloc((data.length + 3) & ~3);
    data.copy(block);
    const record = 12 + index * 16;
    directory.writeUInt32BE(checksum(block), record + 4);
    directory.writeUInt32BE(offset, record + 8);
    directory.writeUInt32BE(data.length, record + 12);
    if (tag === 'head') headOffset = offset;
    offset += block.length;
    return block;
  });
  const font = Buffer.concat([directory, ...blocks]);
  font.writeUInt32BE((0xB1B0AFBA - checksum(font)) >>> 0, headOffset + 8);
  return font;
}

module.exports = { liveFontBytes };
