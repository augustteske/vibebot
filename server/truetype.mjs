/**
 * Крошечный TrueType: чтение таблиц шрифта и растрирование текста.
 *
 * Карточка «Пульс команды» собирается без сторонних библиотек, поэтому контуры
 * глифов разбираются здесь вручную (обычные и составные глифы), а заливка идёт
 * по площади со сглаживанием. Шрифт — Inter, тот же, что в интерфейсе.
 */
import { readFileSync } from 'node:fs'

const SUB_SCANLINES = 10
const FLATTEN_TOLERANCE = 0.2
const MAX_SEGMENTS = 24

const COMPOSITE_ARG_WORDS = 0x0001
const COMPOSITE_ARGS_ARE_XY = 0x0002
const COMPOSITE_HAVE_SCALE = 0x0008
const COMPOSITE_MORE = 0x0020
const COMPOSITE_HAVE_XY_SCALE = 0x0040
const COMPOSITE_HAVE_TWO_BY_TWO = 0x0080

/** Читает шрифт из файла. */
export function loadFontFile(path) {
  return parseFont(readFileSync(path))
}

/** Разбирает буфер TrueType и возвращает шрифт для рисования текста. */
export function parseFont(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const tables = readTables(view)
  const randomAccess = (tag) => {
    const table = tables.get(tag)
    if (!table) throw new Error(`В шрифте нет таблицы ${tag}`)
    return table
  }

  const head = randomAccess('head')
  const maxp = randomAccess('maxp')
  const hhea = randomAccess('hhea')
  const hmtx = randomAccess('hmtx')
  const loca = randomAccess('loca')
  const glyf = randomAccess('glyf')
  const unitsPerEm = view.getUint16(head.offset + 18)
  const longLoca = view.getInt16(head.offset + 50) === 1
  const glyphCount = view.getUint16(maxp.offset + 4)
  const metricCount = view.getUint16(hhea.offset + 34)

  const glyphOffsets = (glyph) => {
    const read = (index) => longLoca
      ? view.getUint32(loca.offset + index * 4)
      : view.getUint16(loca.offset + index * 2) * 2
    return [read(glyph), read(glyph + 1)]
  }

  const advanceOf = (glyph) => {
    const index = Math.min(glyph, metricCount - 1)
    return view.getUint16(hmtx.offset + index * 4)
  }

  const cmap = readCmap(view, randomAccess('cmap'))

  const outlines = new Map()

  const outlineOf = (glyph, depth = 0) => {
    if (outlines.has(glyph)) return outlines.get(glyph)
    const [start, end] = glyphOffsets(glyph)
    if (glyph >= glyphCount || start >= end) {
      outlines.set(glyph, [])
      return []
    }
    const contours = parseGlyphContours(view, glyf.offset + start, depth, outlineOf)
    outlines.set(glyph, contours)
    return contours
  }

  const font = {
    unitsPerEm,
    capHeight: readCapHeight(view, tables, cmap, outlineOf, unitsPerEm),
    glyphFor: (codePoint) => cmap.get(codePoint) ?? 0,
    advanceOf: (codePoint) => advanceOf(font.glyphFor(codePoint)),
    outlineOf: (codePoint) => outlineOf(font.glyphFor(codePoint)),
  }
  return font
}

/** Ширина строки в пикселях при заданном размере шрифта. */
export function measureText(font, text, size) {
  const scale = size / font.unitsPerEm
  let width = 0
  for (const character of text) width += font.advanceOf(character.codePointAt(0)) * scale
  return width
}

/**
 * Рисует строку поверх изображения с базовой линией в `baseline`.
 * `image.blend(x, y, alpha, color)` получает готовую долю покрытия пикселя.
 */
export function drawText(image, font, text, { x, baseline, size, color, alpha = 1 }) {
  const mask = rasterizeText(font, text, size)
  if (!mask) return
  for (let row = 0; row < mask.height; row++) {
    for (let column = 0; column < mask.width; column++) {
      const coverage = mask.coverage[row * mask.width + column]
      if (coverage <= 0.002) continue
      image.blend(x + mask.left + column, baseline + mask.top + row, coverage * alpha, color)
    }
  }
}

/** Собирает маску строки: покрытие пикселей относительно начала строки и базовой линии. */
export function rasterizeText(font, text, size) {
  const scale = size / font.unitsPerEm
  const polygons = []
  let penX = 0
  for (const character of text) {
    const outlines = font.outlineOf(character.codePointAt(0))
    for (const contour of outlines) polygons.push(scaleContour(contour, scale, penX))
    penX += font.advanceOf(character.codePointAt(0)) * scale
  }
  const edges = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index++) {
      const from = polygon[index]
      const to = polygon[(index + 1) % polygon.length]
      if (from.x < minX) minX = from.x
      if (from.x > maxX) maxX = from.x
      if (from.y < minY) minY = from.y
      if (from.y > maxY) maxY = from.y
      if (from.y === to.y) continue
      edges.push({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, winding: to.y < from.y ? 1 : -1 })
    }
  }
  if (!edges.length) return null
  const left = Math.floor(minX)
  const top = Math.floor(minY)
  const width = Math.ceil(maxX) - left + 1
  const height = Math.ceil(maxY) - top + 1
  const coverage = fillPolygons(edges, left, top, width, height)
  return { left, top, width, height, coverage }
}

function readTables(view) {
  const count = view.getUint16(4)
  const tables = new Map()
  for (let index = 0; index < count; index++) {
    const record = 12 + index * 16
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    )
    tables.set(tag, { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) })
  }
  return tables
}

function readCmap(view, table) {
  const count = view.getUint16(table.offset + 2)
  let best = null
  for (let index = 0; index < count; index++) {
    const record = table.offset + 4 + index * 8
    const platform = view.getUint16(record)
    const encoding = view.getUint16(record + 2)
    const offset = table.offset + view.getUint32(record + 4)
    const format = view.getUint16(offset)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!unicode) continue
    if (format === 12) best = { offset, format }
    else if (format === 4 && best?.format !== 12) best = { offset, format }
  }
  if (!best) throw new Error('В шрифте нет подходящей таблицы cmap')
  if (best.format === 12) return readCmapFormat12(view, best.offset)
  return readCmapFormat4(view, best.offset)
}

function readCmapFormat4(view, offset) {
  const map = new Map()
  const segments = view.getUint16(offset + 6) / 2
  const endCodes = offset + 14
  const startCodes = endCodes + segments * 2 + 2
  const deltas = startCodes + segments * 2
  const rangeOffsets = deltas + segments * 2
  for (let index = 0; index < segments; index++) {
    const end = view.getUint16(endCodes + index * 2)
    const start = view.getUint16(startCodes + index * 2)
    const delta = view.getInt16(deltas + index * 2)
    const rangeOffset = view.getUint16(rangeOffsets + index * 2)
    for (let code = start; code <= end && code !== 0xffff; code++) {
      let glyph
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff
      else {
        const address = rangeOffsets + index * 2 + rangeOffset + (code - start) * 2
        glyph = view.getUint16(address)
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff
      }
      if (glyph !== 0) map.set(code, glyph)
    }
  }
  return map
}

function readCmapFormat12(view, offset) {
  const map = new Map()
  const groups = view.getUint32(offset + 12)
  for (let index = 0; index < groups; index++) {
    const record = offset + 16 + index * 12
    const start = view.getUint32(record)
    const end = view.getUint32(record + 4)
    const glyph = view.getUint32(record + 8)
    for (let code = start; code <= end; code++) map.set(code, glyph + (code - start))
  }
  return map
}

function readCapHeight(view, tables, cmap, outlineOf, unitsPerEm) {
  const os2 = tables.get('OS/2')
  if (os2 && os2.length >= 90) {
    const version = view.getUint16(os2.offset)
    if (version >= 2) {
      const capHeight = view.getInt16(os2.offset + 88)
      if (capHeight > 0) return capHeight
    }
  }
  const glyph = cmap.get('H'.codePointAt(0))
  const contours = glyph === undefined ? [] : outlineOf(glyph)
  let top = 0
  for (const contour of contours) for (const point of contour) top = Math.max(top, point.y)
  return top || Math.round(unitsPerEm * 0.7)
}

function parseGlyphContours(view, offset, depth, outlineOf) {
  const contourCount = view.getInt16(offset)
  if (contourCount >= 0) return parseSimpleGlyph(view, offset + 10, contourCount)
  return parseCompositeGlyph(view, offset + 10, depth, outlineOf)
}

function parseSimpleGlyph(view, offset, contourCount) {
  const endPoints = []
  let cursor = offset
  for (let index = 0; index < contourCount; index++) {
    endPoints.push(view.getUint16(cursor))
    cursor += 2
  }
  const pointCount = contourCount ? endPoints[endPoints.length - 1] + 1 : 0
  cursor += 2 + view.getUint16(cursor) // инструкции пропускаем
  const flags = []
  while (flags.length < pointCount) {
    const flag = view.getUint8(cursor++)
    flags.push(flag)
    if (flag & 0x08) {
      const repeat = view.getUint8(cursor++)
      for (let index = 0; index < repeat; index++) flags.push(flag)
    }
  }
  const xs = readCoordinates(view, cursor, flags, 0x02, 0x10, pointCount)
  cursor = xs.cursor
  const ys = readCoordinates(view, cursor, flags, 0x04, 0x20, pointCount)
  const points = []
  for (let index = 0; index < pointCount; index++) {
    points.push({ x: xs.values[index], y: ys.values[index], onCurve: (flags[index] & 0x01) !== 0 })
  }
  const contours = []
  let start = 0
  for (const end of endPoints) {
    contours.push(points.slice(start, end + 1))
    start = end + 1
  }
  return contours
}

function readCoordinates(view, offset, flags, shortBit, sameBit, count) {
  const values = []
  let cursor = offset
  let value = 0
  for (let index = 0; index < count; index++) {
    const flag = flags[index]
    if (flag & shortBit) {
      const delta = view.getUint8(cursor++)
      value += flag & sameBit ? delta : -delta
    } else if (!(flag & sameBit)) {
      value += view.getInt16(cursor)
      cursor += 2
    }
    values.push(value)
  }
  return { values, cursor }
}

function parseCompositeGlyph(view, offset, depth, outlineOf) {
  if (depth > 4) return []
  const contours = []
  let cursor = offset
  let flags = COMPOSITE_MORE
  while (flags & COMPOSITE_MORE) {
    flags = view.getUint16(cursor)
    const glyph = view.getUint16(cursor + 2)
    cursor += 4
    let arg1
    let arg2
    if (flags & COMPOSITE_ARG_WORDS) {
      arg1 = view.getInt16(cursor)
      arg2 = view.getInt16(cursor + 2)
      cursor += 4
    } else {
      arg1 = view.getInt8(cursor)
      arg2 = view.getInt8(cursor + 1)
      cursor += 2
    }
    let a = 1
    let b = 0
    let c = 0
    let d = 1
    if (flags & COMPOSITE_HAVE_SCALE) {
      a = d = view.getInt16(cursor) / 16384
      cursor += 2
    } else if (flags & COMPOSITE_HAVE_XY_SCALE) {
      a = view.getInt16(cursor) / 16384
      d = view.getInt16(cursor + 2) / 16384
      cursor += 4
    } else if (flags & COMPOSITE_HAVE_TWO_BY_TWO) {
      a = view.getInt16(cursor) / 16384
      b = view.getInt16(cursor + 2) / 16384
      c = view.getInt16(cursor + 4) / 16384
      d = view.getInt16(cursor + 6) / 16384
      cursor += 8
    }
    const shiftX = flags & COMPOSITE_ARGS_ARE_XY ? arg1 : 0
    const shiftY = flags & COMPOSITE_ARGS_ARE_XY ? arg2 : 0
    for (const contour of outlineOf(glyph, depth + 1)) {
      contours.push(contour.map((point) => ({
        x: a * point.x + c * point.y + shiftX,
        y: b * point.x + d * point.y + shiftY,
        onCurve: point.onCurve,
      })))
    }
  }
  return contours
}

function scaleContour(contour, scale, penX) {
  const points = contour.map((point) => ({
    x: penX + point.x * scale,
    y: -point.y * scale,
    onCurve: point.onCurve,
  }))
  return contourToPolygon(points)
}

function contourToPolygon(points) {
  const count = points.length
  if (!count) return []
  const polygon = []
  let startIndex = points.findIndex((point) => point.onCurve)
  let startPoint
  if (startIndex < 0) {
    startPoint = midpoint(points[count - 1], points[0])
    startIndex = 0
  } else {
    startPoint = points[startIndex]
  }
  polygon.push(startPoint)
  let cursor = startIndex + 1
  let control = null
  for (let step = 0; step < count; step++) {
    const point = points[(cursor + step) % count]
    if (point.onCurve) {
      if (control) appendQuad(polygon, control, point)
      else polygon.push(point)
      control = null
    } else if (control) {
      appendQuad(polygon, control, midpoint(control, point))
      control = point
    } else {
      control = point
    }
  }
  if (control) appendQuad(polygon, control, startPoint)
  return polygon
}

function midpoint(from, to) {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, onCurve: true }
}

function appendQuad(polygon, control, end) {
  const start = polygon[polygon.length - 1]
  const bend = Math.hypot(start.x - 2 * control.x + end.x, start.y - 2 * control.y + end.y) / 4
  const steps = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(Math.sqrt(bend / FLATTEN_TOLERANCE))))
  for (let step = 1; step <= steps; step++) {
    const t = step / steps
    const rest = 1 - t
    polygon.push({
      x: rest * rest * start.x + 2 * rest * t * control.x + t * t * end.x,
      y: rest * rest * start.y + 2 * rest * t * control.y + t * t * end.y,
      onCurve: true,
    })
  }
}

function fillPolygons(edges, left, top, width, height) {
  const coverage = new Float32Array(width * height)
  const rows = height * SUB_SCANLINES
  const crossings = []
  for (let row = 0; row < rows; row++) {
    const y = top + (row + 0.5) / SUB_SCANLINES
    crossings.length = 0
    for (const edge of edges) {
      const minY = Math.min(edge.fromY, edge.toY)
      const maxY = Math.max(edge.fromY, edge.toY)
      if (y < minY || y >= maxY) continue
      crossings.push({
        x: edge.fromX + ((y - edge.fromY) * (edge.toX - edge.fromX)) / (edge.toY - edge.fromY),
        winding: edge.winding,
      })
    }
    if (crossings.length < 2) continue
    crossings.sort((first, second) => first.x - second.x)
    const rowOffset = Math.floor(row / SUB_SCANLINES) * width
    let winding = 0
    let spanStart = 0
    for (const crossing of crossings) {
      const previous = winding
      winding += crossing.winding
      if (previous === 0 && winding !== 0) spanStart = crossing.x
      else if (previous !== 0 && winding === 0) {
        paintSpan(coverage, rowOffset, left, width, spanStart, crossing.x)
      }
    }
  }
  for (let index = 0; index < coverage.length; index++) {
    if (coverage[index] > 1) coverage[index] = 1
  }
  return coverage
}

function paintSpan(coverage, rowOffset, left, width, from, to) {
  const start = Math.max(from, left)
  const end = Math.min(to, left + width)
  if (end <= start) return
  const first = Math.max(0, Math.floor(start - left))
  const last = Math.min(width - 1, Math.floor(end - left))
  for (let pixel = first; pixel <= last; pixel++) {
    const overlap = Math.min(end, left + pixel + 1) - Math.max(start, left + pixel)
    if (overlap > 0) coverage[rowOffset + pixel] += overlap / SUB_SCANLINES
  }
}
