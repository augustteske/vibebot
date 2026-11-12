/**
 * «Общая температура команды» — одно число 0–100 для команды бота.
 *
 * Складывает три показателя опубликованного периода: долю работы вне
 * рабочих часов (её берём наоборот — чем меньше, тем теплее), ровность
 * участия и долю благодарностей. Среднее округляется до целого.
 */

/** Процент из метрики: число 0–100 или null, если данные неполные. */
const percent = value => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
)

/**
 * Температура команды 0–100: среднее из «100 − вне работы», участия
 * и благодарностей. `null` — метрики неполные или вне диапазона.
 */
export const teamTemperature = metrics => {
  if (!metrics || typeof metrics !== 'object') return null
  const outsideHours = percent(metrics.outsideHoursPercent)
  const participation = percent(metrics.participationEvenness)
  const recognition = percent(metrics.recognitionPercent)
  if (outsideHours === null || participation === null || recognition === null) return null
  return Math.round((100 - outsideHours + participation + recognition) / 3)
}
