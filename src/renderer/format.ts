export function fmtDistance(meters: number | undefined): string {
  if (meters === undefined) return '-'
  return meters < 1000 ? `${Math.round(meters)}` : (meters / 1000).toFixed(2)
}

export function fmtDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '-'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function distanceUnit(meters: number | undefined): string {
  return (meters ?? 0) < 1000 ? 'm' : 'km'
}
