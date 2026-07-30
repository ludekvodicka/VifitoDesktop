import { recordKcal } from '../shared/calories'
import type { DayStats, StatsOverview, UseRecord } from '../shared/stats'

/** How many calendar days the chart shows, ending with today. */
const CHART_DAYS = 14
/** A record whose last sample is this fresh is still being walked. */
const IN_PROGRESS_MS = 30_000

const fmtDuration = (seconds: number): string => {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

const fmtKm = (metres: number): string => (metres / 1000).toFixed(2)

const fmtClock = (t: number): string =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const fmtDay = (day: string): string => {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

const dayKeyOf = (t: number): string => {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The last CHART_DAYS calendar days ending today, so days without a workout stay visible as gaps. */
function chartSlots(stats: StatsOverview, weightKg: number | null) {
  const byDay = new Map(stats.days.map((entry) => [entry.day, entry]))
  const today = new Date()
  const slots = []
  for (let back = CHART_DAYS - 1; back >= 0; back--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
    const day = dayKeyOf(date.getTime())
    const stat = byDay.get(day)
    slots.push({
      day,
      distanceM: stat?.totals.distanceM ?? 0,
      kcal: stat ? dayKcal(stat, weightKg) : null,
    })
  }
  return slots
}

export function DailyChart({ stats, weightKg }: { stats: StatsOverview | null; weightKg: number | null }) {
  if (!stats) return <div className="hint">Statistics load once the app has read the log.</div>
  const slots = chartSlots(stats, weightKg)
  if (slots.every((slot) => slot.distanceM === 0))
    return <div className="hint">Nothing walked in the last {CHART_DAYS} days.</div>
  // A floor on the scale keeps a single short walk from filling the whole panel.
  const max = Math.max(1000, ...slots.map((slot) => slot.distanceM))

  return (
    <div className="daily-chart">
      {slots.map((slot) => {
        const km = fmtKm(slot.distanceM)
        const label = slot.kcal === null ? `${km} km` : `${km} km, ${slot.kcal} kcal`
        return (
          <div className="daily-bar" key={slot.day} title={`${fmtDay(slot.day)}: ${label}`}>
            <span className="daily-value">{slot.distanceM > 0 ? km : ''}</span>
            <div className="daily-column">
              <div className="daily-fill" style={{ height: `${(slot.distanceM / max) * 100}%` }} />
            </div>
            <span className="daily-day">{Number(slot.day.slice(-2))}</span>
          </div>
        )
      })}
    </div>
  )
}

function dayKcal(day: DayStats, weightKg: number | null): number | null {
  const total = day.records.reduce((sum, record) => {
    const kcal = recordKcal(record, weightKg)
    return sum + (kcal?.value ?? 0)
  }, 0)
  return total > 0 ? total : null
}

function Row({ record, live, weightKg }: { record: UseRecord; live: boolean; weightKg: number | null }) {
  const kcal = recordKcal(record, weightKg)
  return (
    <tr>
      <td className="mono">
        {fmtClock(record.startedAt)}
        <span className="hex"> - {fmtClock(record.endedAt)}</span>
        {live && <span className="badge">in progress</span>}
      </td>
      <td className="mono">{fmtDuration(record.durationSec)}</td>
      <td className="mono">{fmtKm(record.distanceM)}</td>
      <td className="mono">
        {record.avgSpeedKmh.toFixed(1)}
        {record.maxSpeedKmh !== undefined && <span className="hex"> / {record.maxSpeedKmh.toFixed(1)}</span>}
      </td>
      <td className="mono">
        {record.avgInclinePercent === undefined ? '-' : record.avgInclinePercent.toFixed(1)}
        {record.maxInclinePercent !== undefined && <span className="hex"> / {record.maxInclinePercent.toFixed(1)}</span>}
      </td>
      <td className="mono">
        {kcal === null ? '-' : kcal.value}
        {kcal !== null && <span className="hex"> {kcal.source === 'estimate' ? 'est.' : 'console'}</span>}
      </td>
      <td className="mono">{record.avgHeartRateBpm === undefined ? '-' : Math.round(record.avgHeartRateBpm)}</td>
      <td className="mono hex">
        {record.targetSpeedKmh === undefined ? '-' : `${record.targetSpeedKmh.toFixed(1)} km/h`}
        {record.targetInclinePercent !== undefined && ` / ${record.targetInclinePercent.toFixed(1)} %`}
      </td>
    </tr>
  )
}

export function Stats({ stats, weightKg }: { stats: StatsOverview | null; weightKg: number | null }) {
  const days = (stats?.days ?? []).filter((day) => day.records.length > 0)
  if (days.length === 0)
    return (
      <div className="panel">
        <h2>Workouts</h2>
        <div className="hint">
          Connect the treadmill and walk. Every use of the machine shows up here, newest first, and is
          saved as you go.
        </div>
      </div>
    )

  const now = Date.now()
  return (
    <>
      {days.map((day) => {
        const kcal = dayKcal(day, weightKg)
        return (
          <div className="panel" key={day.day}>
            <h2 className="row">
              <span>{fmtDay(day.day)}</span>
              <span className="note">
                {fmtKm(day.totals.distanceM)} km, {fmtDuration(day.totals.movingSec)}
                {kcal !== null && `, ${kcal} kcal`}
              </span>
            </h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '20%' }}>time</th>
                  <th>duration</th>
                  <th>km</th>
                  <th>speed avg/max</th>
                  <th>incline avg/max</th>
                  <th>kcal</th>
                  <th>bpm</th>
                  <th>last target</th>
                </tr>
              </thead>
              <tbody>
                {[...day.records].reverse().map((record) => (
                  <Row
                    key={`${record.startedAt}-${record.endedAt}`}
                    record={record}
                    live={now - record.endedAt < IN_PROGRESS_MS}
                    weightKg={weightKg}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </>
  )
}
