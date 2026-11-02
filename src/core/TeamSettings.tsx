import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from './client'
import './team-settings.css'

interface WorkInterval {
  day: number
  start: number
  end: number
}

interface WorkSchedule {
  version: number
  timeZone: string | null
  intervals: WorkInterval[]
}

const days = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 7, label: 'Вс' },
]

const timeZones = [
  'UTC',
  'Asia/Omsk',
  'Asia/Almaty',
  'Asia/Yekaterinburg',
  'Asia/Tokyo',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Moscow',
  'America/Los_Angeles',
  'America/New_York',
]

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export function TeamSettings() {
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null)
  const [timeZone, setTimeZone] = useState('Asia/Omsk')
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('19:00')
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    let active = true
    void api<WorkSchedule>('/telegram/profile').then(profile => {
      if (!active) return
      setSchedule(profile)
      setTimeZone(profile.timeZone ?? 'Asia/Omsk')
      if (profile.intervals.length) {
        setSelectedDays([...new Set(profile.intervals.map(interval => interval.day))])
        setStartTime(toTime(profile.intervals[0].start))
        setEndTime(toTime(profile.intervals[0].end))
      }
      setLoading(false)
    }).catch(failure => {
      if (!active) return
      setError(failure instanceof ApiError ? failure.message : 'Не удалось загрузить расписание.')
      setLoading(false)
    })
    return () => { active = false }
  }, [loadAttempt])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!schedule || saving) return
    if (!selectedDays.length) {
      setError('Выберите хотя бы один рабочий день.')
      setStatus('')
      return
    }

    const start = toMinutes(startTime)
    const end = toMinutes(endTime)
    if (start >= end) {
      setError('Время окончания должно быть позже времени начала.')
      setStatus('')
      return
    }

    setSaving(true)
    setError('')
    setStatus('')
    try {
      const updated = await api<WorkSchedule>('/telegram/profile', {
        requestId: crypto.randomUUID(),
        expectedVersion: schedule.version,
        timeZone,
        intervals: [...selectedDays].sort((a, b) => a - b).map(day => ({ day, start, end })),
      })
      setSchedule(updated)
      setStatus('Рабочее расписание сохранено.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить расписание.')
    } finally {
      setSaving(false)
    }
  }

  const usesDifferentIntervals = schedule?.intervals.some(interval =>
    interval.start !== schedule.intervals[0]?.start || interval.end !== schedule.intervals[0]?.end) ?? false

  return <section className="panel team-settings" aria-labelledby="team-settings-title">
    <h2 id="team-settings-title">Рабочее расписание</h2>
    <p className="muted">Расписание используется для расчёта сообщений вне рабочих часов. При изменении сервер пересчитает производные показатели.</p>
    {loading ? <p role="status">Загружаем расписание…</p> : error && !schedule
      ? <div className="error" role="alert">{error} <button type="button" onClick={() => { setError(''); setLoading(true); setLoadAttempt(attempt => attempt + 1) }}>Повторить загрузку</button></div>
      : schedule && <>
        {error && <p className="error" role="alert">{error}</p>}
        {status && <p className="team-settings__status" role="status">{status}</p>}
        {usesDifferentIntervals && <p className="team-settings__note">Сейчас заданы разные часы для отдельных дней. Сохранение заменит их единым интервалом для выбранных дней.</p>}
        <form onSubmit={event => void save(event)}>
          <label className="team-field">Часовой пояс
            <select value={timeZone} onChange={event => setTimeZone(event.target.value)} disabled={saving}>
              {!timeZones.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}
              {timeZones.map(zone => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          </label>
          <fieldset className="team-settings__days" disabled={saving}>
            <legend>Рабочие дни</legend>
            <div className="team-settings__day-list">
              {days.map(day => <label key={day.value}>
                <input
                  type="checkbox"
                  checked={selectedDays.includes(day.value)}
                  onChange={event => setSelectedDays(current => event.target.checked
                    ? [...current, day.value]
                    : current.filter(value => value !== day.value))}
                />
                {day.label}
              </label>)}
            </div>
          </fieldset>
          <div className="team-settings__hours">
            <label className="team-field">Начало рабочего дня<input type="time" value={startTime} onChange={event => setStartTime(event.target.value)} required disabled={saving}/></label>
            <label className="team-field">Конец рабочего дня<input type="time" value={endTime} onChange={event => setEndTime(event.target.value)} required disabled={saving}/></label>
          </div>
          <button className="button" type="submit" disabled={saving || loading}>{saving ? 'Сохраняем…' : 'Сохранить расписание'}</button>
        </form>
      </>}
  </section>
}
