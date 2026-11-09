/**
 * Рендеринг шеринговой карточки «Пульс команды» на нативном Canvas.
 * Без внешних зависимостей: результат отдаётся как data:-URL (совместимо с CSP `img-src 'self' data:`)
 * или Blob для буфера обмена. Карточка содержит только опубликованные общие показатели.
 */

export interface ShareCardMetrics {
  outsideHoursPercent: number;
  participationEvenness: number;
  recognitionPercent: number;
}

export interface ShareCardData {
  periodLabel: string;
  metrics: ShareCardMetrics;
  teamName?: string;
  demo?: boolean;
}

export const SHARE_CARD_WIDTH = 1200
export const SHARE_CARD_HEIGHT = 630
export const SHARE_CARD_SLOGAN = 'Почувствовать команду. Сделать следующий шаг.'
export const SHARE_CARD_REFERRAL_URL = 'https://github.com/augustteske/vibebot'
export const SHARE_CARD_REFERRAL_TEXT = 'Попробуйте Vibee для своей команды: github.com/augustteske/vibebot'

const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
const INK = '#171719'
const YELLOW = '#FFD638'

export const SHARE_CARD_METRICS: { key: keyof ShareCardMetrics; label: string }[] = [
  { key: 'outsideHoursPercent', label: 'Вне рабочих часов' },
  { key: 'participationEvenness', label: 'Равномерность участия' },
  { key: 'recognitionPercent', label: 'Благодарности' },
]

const percentFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export function formatSharePercent(value: number) {
  return `${percentFormatter.format(value)}%`
}

/** Короткая подпись периода: «5–12 ноября», «28 октября – 3 ноября», «2 ноября». */
export function formatSharePeriod(start: string, end: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
  const parts = (date: string) => {
    const values = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).formatToParts(new Date(date))
    const get = (type: string) => values.find(part => part.type === type)?.value ?? ''
    return { day: get('day'), month: get('month'), year: get('year') }
  }
  const from = parts(start)
  const to = parts(end)
  if (from.year !== to.year) return `${from.day} ${from.month} ${from.year} – ${to.day} ${to.month} ${to.year}`
  if (from.month !== to.month) return `${from.day} ${from.month} – ${to.day} ${to.month}`
  if (from.day !== to.day) return `${from.day}–${to.day} ${to.month}`
  return `${to.day} ${to.month}`
}

/** Текстовая версия карточки — для копирования в чат ретроспективы. */
export function shareCardText(data: ShareCardData) {
  return [
    `🐝 Пульс команды${data.teamName ? ' «' + data.teamName + '»' : ''} · ${data.periodLabel}`,
    ...SHARE_CARD_METRICS.map(metric => `• ${metric.label}: ${formatSharePercent(data.metrics[metric.key])}`),
    ...(data.demo ? ['Демо: вымышленные данные.'] : []),
    `Vibee — ${SHARE_CARD_SLOGAN}`,
    `Попробуйте Vibee для своей команды: ${SHARE_CARD_REFERRAL_URL}`,
  ].join('\n')
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? line + ' ' + word : word
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number) {
  let current = size
  ctx.font = `${weight} ${current}px ${FONT}`
  while (current > 24 && ctx.measureText(text).width > maxWidth) {
    current -= 2
    ctx.font = `${weight} ${current}px ${FONT}`
  }
}

export async function renderShareCard(data: ShareCardData, scale = 2): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_WIDTH * scale
  canvas.height = SHARE_CARD_HEIGHT * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas недоступен в этом браузере')
  await document.fonts?.ready
  const [logo, mascot] = await Promise.all([loadImage('/bee.svg'), loadImage('/bee-mascot.png')])
  ctx.scale(scale, scale)
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT

  // Фон: фирменный жёлтый градиент.
  const background = ctx.createLinearGradient(0, 0, W, H)
  background.addColorStop(0, '#FFE680')
  background.addColorStop(.55, YELLOW)
  background.addColorStop(1, '#FFC400')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, W, H)

  // Мягкое свечение и орбита за пчёлкой.
  const glow = ctx.createRadialGradient(950, 280, 30, 950, 280, 300)
  glow.addColorStop(0, 'rgba(255, 255, 255, .75)')
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(600, 0, 600, H)
  ctx.strokeStyle = 'rgba(23, 23, 25, .12)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(950, 290, 250, 200, -.25, 0, Math.PI * 2)
  ctx.stroke()

  if (mascot) {
    const size = 430
    const ratio = mascot.naturalWidth / mascot.naturalHeight || 1
    const width = ratio >= 1 ? size : size * ratio
    const height = ratio >= 1 ? size / ratio : size
    ctx.save()
    ctx.shadowColor = 'rgba(86, 57, 0, .28)'
    ctx.shadowBlur = 40
    ctx.shadowOffsetY = 24
    ctx.drawImage(mascot, 950 - width / 2, 300 - height / 2, width, height)
    ctx.restore()
  }

  // Логотип.
  if (logo) ctx.drawImage(logo, 64, 52, 48, 48)
  ctx.fillStyle = INK
  ctx.textBaseline = 'alphabetic'
  ctx.font = `850 36px ${FONT}`
  ctx.fillText('Vibee', logo ? 122 : 64, 89)

  if (data.demo) {
    ctx.font = `800 15px ${FONT}`
    const label = 'ДЕМО · ВЫМЫШЛЕННЫЕ ДАННЫЕ'
    const width = ctx.measureText(label).width + 32
    roundedRect(ctx, W - 64 - width, 56, width, 40, 20)
    ctx.fillStyle = INK
    ctx.fill()
    ctx.fillStyle = YELLOW
    ctx.fillText(label, W - 64 - width + 16, 81)
  }

  // Заголовок и период.
  ctx.fillStyle = 'rgba(23, 23, 25, .66)'
  ctx.font = `800 18px ${FONT}`
  ctx.fillText('ПУЛЬС КОМАНДЫ', 64, 172)
  ctx.fillStyle = INK
  fitText(ctx, data.periodLabel, 820, 68, 620)
  ctx.fillText(data.periodLabel, 64, 244)
  if (data.teamName) {
    ctx.fillStyle = 'rgba(23, 23, 25, .72)'
    fitText(ctx, data.teamName, 650, 24, 620)
    ctx.fillText(data.teamName, 64, 284)
  }

  // Три метрики — тёмные карточки с жёлтыми значениями.
  const cardWidth = 200
  const cardHeight = 172
  const top = 318
  SHARE_CARD_METRICS.forEach((metric, index) => {
    const x = 64 + index * (cardWidth + 20)
    ctx.save()
    ctx.shadowColor = 'rgba(57, 43, 0, .22)'
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 12
    roundedRect(ctx, x, top, cardWidth, cardHeight, 28)
    ctx.fillStyle = INK
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = 'rgba(255, 255, 255, .74)'
    ctx.font = `650 17px ${FONT}`
    wrapLines(ctx, metric.label, cardWidth - 44).slice(0, 2).forEach((line, lineIndex) => {
      ctx.fillText(line, x + 22, top + 38 + lineIndex * 22)
    })
    ctx.fillStyle = YELLOW
    fitText(ctx, formatSharePercent(data.metrics[metric.key]), 850, 56, cardWidth - 44)
    ctx.fillText(formatSharePercent(data.metrics[metric.key]), x + 22, top + 146)
  })

  // Слоган, подпись и реферальная плашка.
  ctx.fillStyle = INK
  ctx.font = `780 27px ${FONT}`
  ctx.fillText(SHARE_CARD_SLOGAN, 64, 546)
  ctx.fillStyle = 'rgba(23, 23, 25, .64)'
  ctx.font = `560 16px ${FONT}`
  ctx.fillText('Общие показатели команды · без слежки и персональных оценок', 64, 574)

  // Реферальная ссылка / бейдж
  const referralLabel = 'Попробуйте Vibee для своей команды → github.com/augustteske/vibebot'
  ctx.font = `700 14px ${FONT}`
  const refWidth = ctx.measureText(referralLabel).width + 28
  roundedRect(ctx, 64, 588, refWidth, 28, 14)
  ctx.fillStyle = 'rgba(23, 23, 25, .08)'
  ctx.fill()
  ctx.fillStyle = INK
  ctx.fillText(referralLabel, 78, 607)

  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось создать PNG')), 'image/png')
  })
}
