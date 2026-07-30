import type { UseRecord } from './stats'

/** Above this the ACSM running equation applies instead of the walking one. */
export const RUNNING_THRESHOLD_KMH = 8

/**
 * ACSM metabolic equations, gross value, expressed per kilogram of body weight so the result can be
 * stored once and multiplied by whatever weight the profile holds at display time.
 *
 * VO2 (ml/kg/min) walking = 3.5 + 0.1*v + 1.8*v*g, running = 3.5 + 0.2*v + 0.9*v*g,
 * with v in m/min and g the grade as a fraction. 1 litre of O2 is about 5 kcal.
 */
export function kcalPerKgPerSec(speedKmh: number, inclinePercent: number): number {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) return 0
  const metresPerMin = (speedKmh * 1000) / 60
  const grade = Number.isFinite(inclinePercent) ? inclinePercent / 100 : 0
  const vo2 =
    speedKmh >= RUNNING_THRESHOLD_KMH
      ? 3.5 + 0.2 * metresPerMin + 0.9 * metresPerMin * grade
      : 3.5 + 0.1 * metresPerMin + 1.8 * metresPerMin * grade
  return ((vo2 / 1000) * 5) / 60
}

export type RecordKcal = { value: number; source: 'estimate' | 'console' }

/**
 * What a record shows. The estimate wins when a weight is known because it follows the profile;
 * the console value is the only number available for records logged with no weight filled in.
 */
export function recordKcal(
  record: Pick<UseRecord, 'kcalPerKg' | 'kcalConsole'>,
  weightKg: number | null,
): RecordKcal | null {
  if (weightKg !== null && weightKg > 0 && record.kcalPerKg > 0)
    return { value: Math.round(record.kcalPerKg * weightKg), source: 'estimate' }
  if (record.kcalConsole > 0) return { value: Math.round(record.kcalConsole), source: 'console' }
  return null
}
