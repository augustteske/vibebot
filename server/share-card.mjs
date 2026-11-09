/**
 * Карточка «Пульс команды» для Telegram: PNG без внешних зависимостей.
 *
 * Сервер собирает картинку 1200×630 из трёх чисел периода тем же способом,
 * что и веб-версия: жёлтый фон, тёмные карточки метрик, шрифт Inter.
 * Текст на картинке фиксированный (заголовок и подписи метрик), название
 * команды и период идут в подписи к фото в Telegram — их форматирует бот.
 */
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { formatSharePercent } from '../src/features/insights/shareCard.ts'
import { drawText, loadFontFile, measureText } from './truetype.mjs'

export const SHARE_CARD_WIDTH = 1200
export const SHARE_CARD_HEIGHT = 630

const INK = [23, 23, 25]
const YELLOW = [255, 214, 56]
const LABEL = [190, 190, 186]
const BACKGROUND_STOPS = [
  { at: 0, color: [255, 230, 128] },
  { at: 0.55, color: [255, 214, 56] },
  { at: 1, color: [255, 196, 0] },
]
const METRICS = [
  { key: 'outsideHoursPercent', label: 'ВНЕ РАБОТЫ' },
  { key: 'participationEvenness', label: 'УЧАСТИЕ' },
  { key: 'recognitionPercent', label: 'ПРИЗНАНИЕ' },
]
const CARD_WIDTH = 340
const CARD_HEIGHT = 250
const CARD_TOP = 240
const CARD_GAP = 26
const CARD_LEFT = 64

function loadFont(file) {
  return loadFontFile(fileURLToPath(new URL(file, import.meta.url)))
}

// Inter из дизайна: 600 — подписи, 800 — крупные надписи и числа.
const FONT_LABEL = loadFont('./fonts/inter-semibold.ttf')
const FONT_DISPLAY = loadFont('./fonts/inter-extrabold.ttf')

function createImage(width, height) {
  const pixels = Buffer.alloc(width * height * 4)
  const set = (x, y, color, alpha = 1) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const offset = (y * width + x) * 4
    if (alpha >= 1) {
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
    } else {
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(color[channel] * alpha + pixels[offset + channel] * (1 - alpha))
      }
    }
  }
  return { width, height, pixels, set, blend: (x, y, alpha, color) => set(x, y, color, alpha) }
}

function lerpColor(from, to, t) {
  return from.map((value, index) => Math.round(value + (to[index] - value) * t))
}

function backgroundAt(t) {
  for (let index = 1; index < BACKGROUND_STOPS.length; index++) {
    const next = BACKGROUND_STOPS[index]
    if (t <= next.at) {
      const previous = BACKGROUND_STOPS[index - 1]
      return lerpColor(previous.color, next.color, (t - previous.at) / (next.at - previous.at))
    }
  }
  return BACKGROUND_STOPS[BACKGROUND_STOPS.length - 1].color
}

function paintBackground(image) {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const t = Math.min(1, Math.max(0, (x / image.width) * 0.45 + (y / image.height) * 0.55))
      const color = backgroundAt(t)
      const offset = (y * image.width + x) * 4
      image.pixels[offset] = color[0]
      image.pixels[offset + 1] = color[1]
      image.pixels[offset + 2] = color[2]
      image.pixels[offset + 3] = 255
    }
  }
  paintGlow(image, 930, 260, 420, 0.5)
}

function paintGlow(image, centerX, centerY, radius, strength) {
  for (let y = Math.max(0, centerY - radius); y < Math.min(image.height, centerY + radius); y++) {
    for (let x = Math.max(0, centerX - radius); x < Math.min(image.width, centerX + radius); x++) {
      const distance = Math.hypot(x - centerX, y - centerY) / radius
      if (distance >= 1) continue
      image.set(x, y, [255, 255, 255], strength * (1 - distance) ** 2)
    }
  }
}

function paintRing(image, centerX, centerY, radiusX, radiusY, thickness, color, alpha) {
  for (let y = Math.max(0, centerY - radiusY - thickness); y < Math.min(image.height, centerY + radiusY + thickness); y++) {
    for (let x = Math.max(0, centerX - radiusX - thickness); x < Math.min(image.width, centerX + radiusX + thickness); x++) {
      const distance = Math.hypot((x - centerX) / radiusX, (y - centerY) / radiusY)
      if (Math.abs(distance - 1) <= thickness / Math.min(radiusX, radiusY)) image.set(x, y, color, alpha)
    }
  }
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const nearLeft = x < left + radius
  const nearRight = x >= left + width - radius
  const nearTop = y < top + radius
  const nearBottom = y >= top + height - radius
  if (!(nearLeft || nearRight) || !(nearTop || nearBottom)) return true
  const cornerX = nearLeft ? left + radius : left + width - radius
  const cornerY = nearTop ? top + radius : top + height - radius
  return (x - cornerX) ** 2 + (y - cornerY) ** 2 <= radius ** 2
}

function paintRoundedRect(image, left, top, width, height, radius, color, alpha = 1) {
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      if (insideRoundedRect(x, y, left, top, width, height, radius)) image.set(x, y, color, alpha)
    }
  }
}

function paintDisc(image, centerX, centerY, radius, color, alpha = 1) {
  for (let y = centerY - radius; y <= centerY + radius; y++) {
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) image.set(x, y, color, alpha)
    }
  }
}

function capSize(font, capHeight) {
  return (capHeight * font.unitsPerEm) / font.capHeight
}

function textWidth(font, text, capHeight) {
  return measureText(font, text, capSize(font, capHeight))
}

function paintText(image, font, text, left, capTop, capHeight, color) {
  drawText(image, font, text, { x: left, baseline: capTop + capHeight, size: capSize(font, capHeight), color })
}

function percentText(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '?'
  return formatSharePercent(Math.min(100, Math.max(0, number)))
}

function paintBrand(image) {
  paintRoundedRect(image, 64, 52, 52, 52, 16, INK)
  const mark = 'V'
  const markWidth = textWidth(FONT_DISPLAY, mark, 21)
  paintText(image, FONT_DISPLAY, mark, Math.round(64 + (52 - markWidth) / 2), 68, 21, YELLOW)
  paintText(image, FONT_DISPLAY, 'VIBEE', 140, 60, 35, INK)
  paintText(image, FONT_DISPLAY, 'ПУЛЬС КОМАНДЫ', 64, 170, 21, INK)
}

function paintDemoBadge(image) {
  const label = 'ДЕМО'
  const capHeight = 14
  const width = Math.round(textWidth(FONT_LABEL, label, capHeight)) + 40
  const left = image.width - 64 - width
  paintRoundedRect(image, left, 56, width, 40, 20, INK)
  paintText(image, FONT_LABEL, label, left + 20, 69, capHeight, YELLOW)
}

function paintMetrics(image, metrics) {
  METRICS.forEach((metric, index) => {
    const left = CARD_LEFT + index * (CARD_WIDTH + CARD_GAP)
    paintRoundedRect(image, left, CARD_TOP, CARD_WIDTH, CARD_HEIGHT, 28, INK)
    paintText(image, FONT_LABEL, metric.label, left + 28, CARD_TOP + 34, 14, LABEL)
    paintText(image, FONT_DISPLAY, percentText(metrics?.[metric.key]), left + 28, CARD_TOP + 150, 63, YELLOW)
  })
}

function paintDecoration(image) {
  paintRing(image, 950, 300, 250, 200, 2, INK, 0.12)
  for (let index = 0; index < 6; index++) {
    paintDisc(image, 71 + index * 28, 566, 5, INK, 0.18)
  }
}

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index++) {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  CRC_TABLE[index] = value >>> 0
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, checksum])
}

function encodePng(image) {
  const stride = image.width * 4
  const raw = Buffer.alloc((stride + 1) * image.height)
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0
    image.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Рисует карточку «Пульс команды» и возвращает PNG-байты.
 * Неизвестные значения метрик заменяются на «?», а не ломают картинку.
 */
export function renderShareCardPng({ metrics, demo = false } = {}) {
  const image = createImage(SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT)
  paintBackground(image)
  paintDecoration(image)
  paintBrand(image)
  if (demo) paintDemoBadge(image)
  paintMetrics(image, metrics)
  return encodePng(image)
}
