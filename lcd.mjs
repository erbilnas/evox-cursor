import { deflateSync } from 'node:zlib';

export const LCD_SIZE = 112;

const BG = [22, 22, 24];
const INK = [242, 238, 230];
const WAIT = [232, 176, 74];

const GLYPHS = {
  ' ': '00000000000000000000000000000000000',
  '-': '00000000000000011111000000000000000',
  '.': '00000000000000000000000000000000100',
  '%': '10001000100010001110000100001000101',
  '?': '01110100010001000100000000010000100',
  '0': '01110100011001110101110011000101110',
  '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100111111',
  '3': '11110000010000101110000010000111110',
  '4': '00010001100101010010111110001000010',
  '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110',
  '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010001001100',
  A: '01110100011000111111100011000110001',
  B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110',
  E: '11111100001000011100100001000011111',
  F: '11111100001000011100100001000010000',
  G: '01110100011000010111100011000101111',
  H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110',
  J: '00111000010000100001000011000101110',
  K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111',
  M: '10001110111010110001100011000110001',
  N: '10001110011010110011100011000110001',
  O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101',
  R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110',
  T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110',
  V: '10001100011000110001010100100001000',
  W: '10001100011000110001101011010101010',
  X: '10001010100010000100001000101010001',
  Y: '10001010100010000100001000010000100',
  Z: '11111000010001000100010000100011111',
};

export function lcdLabel(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 %?.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8);
}

export function keyView(action, title) {
  if (action === 'chat') return { kind: 'chat', label: 'NEW' };
  if (action === 'project') return { kind: 'project', label: lcdLabel(title) || 'PROJECT' };
  if (action === 'model') return { kind: 'model', label: lcdLabel(title) || 'MODEL' };
  if (action === 'file') return { kind: 'file', label: lcdLabel(title) || 'FILE' };
  if (action === 'profiles') return { kind: 'profile', label: lcdLabel(title) || 'PROFILE' };
  if (action === 'approve') {
    const verb = lcdLabel(title);
    if (verb === 'RUN' || verb === 'APPROVE' || verb === 'ALLOW') return { kind: 'allow', label: verb };
    return { kind: 'allow', label: 'ALLOW' };
  }
  if (action === 'deny') return { kind: 'deny', label: 'DENY' };
  if (action === 'stop') return { kind: 'stop', label: 'STOP' };
  if (action === 'profile') return { kind: 'profile', label: lcdLabel(title) || 'PROFILE' };
  if (action === 'usage') {
    if (title === 'Sign in') return { kind: 'signin', label: 'SIGN IN' };
    return { kind: 'usage', label: lcdLabel(title) || 'USAGE' };
  }
  if (title === 'Idle') return { kind: 'idle', label: 'IDLE' };
  if (title === 'Thinking') return { kind: 'thinking', label: 'THINKING' };
  if (title === 'Reading') return { kind: 'reading', label: 'READING' };
  if (title === 'Editing') return { kind: 'editing', label: 'EDITING' };
  if (title === 'Running') return { kind: 'running', label: 'RUNNING' };
  if (title === 'Answer') return { kind: 'answer', label: 'ANSWER?' };
  if (title === 'Working') return { kind: 'working', label: 'WORKING' };
  if (title === 'Needs you') return { kind: 'needs', label: 'WAIT' };
  return { kind: 'needs', label: lcdLabel(title) || 'WAIT' };
}

export function renderLcd({ kind, label }) {
  const size = LCD_SIZE;
  const rgb = Buffer.alloc(size * size * 3, BG[0]);
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = BG[0];
    rgb[i + 1] = BG[1];
    rgb[i + 2] = BG[2];
  }
  drawIcon(rgb, size, kind, kind === 'needs' || kind === 'signin' || kind === 'answer' ? WAIT : INK, label);
  const usage = kind === 'usage';
  drawCentered(rgb, size, label, usage ? 70 : 78, INK, usage ? 3 : 2);
  return encodePng(size, rgb);
}

export function rasterImage(view) {
  const png = renderLcd(view);
  return {
    kind: 'raster',
    mimeType: 'image/png',
    dataBase64: png.toString('base64'),
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, crc]);
}

function encodePng(size, rgb) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    rgb.copy(raw, row + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function putPixel(rgb, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 3;
  rgb[offset] = color[0];
  rgb[offset + 1] = color[1];
  rgb[offset + 2] = color[2];
}

function fillRect(rgb, size, x, y, width, height, color) {
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) putPixel(rgb, size, x + col, y + row, color);
  }
}

function fillCircle(rgb, size, cx, cy, radius, color) {
  const limit = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= limit) putPixel(rgb, size, x, y, color);
    }
  }
}

function ring(rgb, size, cx, cy, radius, thickness, color) {
  const outer = radius * radius;
  const inner = Math.max(0, radius - thickness);
  const hole = inner * inner;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distance = dx * dx + dy * dy;
      if (distance <= outer && distance >= hole) putPixel(rgb, size, x, y, color);
    }
  }
}

function stroke(rgb, size, x0, y0, x1, y1, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    fillRect(
      rgb,
      size,
      Math.round(x0 + (x1 - x0) * t) - 1,
      Math.round(y0 + (y1 - y0) * t) - 1,
      4,
      4,
      color,
    );
  }
}

function drawIcon(rgb, size, kind, color, label) {
  const cx = size / 2;
  const cy = 38;
  if (kind === 'usage') {
    drawMeter(rgb, size, label, color);
    return;
  }
  if (kind === 'idle' || kind === 'signin') {
    ring(rgb, size, cx, cy, 16, 4, color);
    return;
  }
  if (kind === 'working' || kind === 'running') {
    fillCircle(rgb, size, cx, cy, 16, color);
    return;
  }
  if (kind === 'thinking') {
    fillCircle(rgb, size, cx - 16, cy, 5, color);
    fillCircle(rgb, size, cx, cy, 5, color);
    fillCircle(rgb, size, cx + 16, cy, 5, color);
    return;
  }
  if (kind === 'needs') {
    fillRect(rgb, size, cx - 3, cy - 16, 6, 20, color);
    fillRect(rgb, size, cx - 3, cy + 10, 6, 6, color);
    return;
  }
  if (kind === 'allow') {
    stroke(rgb, size, cx - 14, cy, cx - 4, cy + 12, color);
    stroke(rgb, size, cx - 4, cy + 12, cx + 16, cy - 12, color);
    return;
  }
  if (kind === 'deny') {
    stroke(rgb, size, cx - 12, cy - 12, cx + 12, cy + 12, color);
    stroke(rgb, size, cx + 12, cy - 12, cx - 12, cy + 12, color);
    return;
  }
  if (kind === 'profile' || kind === 'project') {
    fillRect(rgb, size, cx - 16, cy - 6, 32, 22, color);
    fillRect(rgb, size, cx - 16, cy - 12, 14, 8, color);
    if (kind === 'project') fillRect(rgb, size, cx - 8, cy - 2, 16, 12, BG);
    return;
  }
  if (kind === 'model') {
    ring(rgb, size, cx, cy, 16, 4, color);
    fillCircle(rgb, size, cx, cy, 5, color);
    return;
  }
  if (kind === 'reading' || kind === 'editing' || kind === 'file') {
    fillRect(rgb, size, cx - 12, cy - 16, 24, 32, color);
    fillRect(rgb, size, cx - 6, cy - 8, 12, 3, BG);
    fillRect(rgb, size, cx - 6, cy - 1, 12, 3, BG);
    if (kind === 'editing') fillRect(rgb, size, cx + 6, cy + 8, 10, 4, color);
    return;
  }
  if (kind === 'answer' || kind === 'chat') {
    fillRect(rgb, size, cx - 16, cy - 12, 32, 20, color);
    fillRect(rgb, size, cx - 8, cy + 8, 8, 8, color);
    return;
  }
  fillRect(rgb, size, cx - 12, cy - 12, 24, 24, color);
}

function percentOf(label) {
  const match = String(label || '').match(/(\d+)\s*%/);
  if (!match) return null;
  return Number(match[1]);
}

function drawMeter(rgb, size, label, color) {
  const track = [72, 68, 62];
  const x = 16;
  const y = 26;
  const width = 72;
  const height = 18;
  fillRect(rgb, size, x, y, width, height, track);
  fillRect(rgb, size, x + width, y + 4, 6, 10, track);
  const used = percentOf(label);
  if (used == null || used <= 0) return;
  const fill = Math.max(2, Math.round((width * Math.min(used, 100)) / 100));
  fillRect(rgb, size, x, y, fill, height, color);
}

function textWidth(text, scale) {
  return text.length * (5 * scale + scale) - scale;
}

function drawText(rgb, size, text, scale, x, y, color) {
  let cursor = x;
  for (const character of text) {
    const bits = GLYPHS[character] || GLYPHS[' '];
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (bits[row * 5 + col] !== '1') continue;
        fillRect(rgb, size, cursor + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += 5 * scale + scale;
  }
}

function drawCentered(rgb, size, text, y, color, scale = 2) {
  const label = lcdLabel(text);
  if (!label) return;
  const fitted = textWidth(label, scale) <= size - 8 ? scale : 2;
  const width = textWidth(label, fitted);
  drawText(rgb, size, label, fitted, Math.max(4, Math.round((size - width) / 2)), y, color);
}
