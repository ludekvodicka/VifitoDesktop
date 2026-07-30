export type Presets = {
  speedsKmh: number[]
  inclinesPercent: number[]
}

export const PRESET_COUNT = 6

export const DEFAULT_PRESETS: Presets = {
  speedsKmh: [3, 4, 5, 6, 7, 8],
  inclinesPercent: [0, 2, 4, 6, 8, 10],
}

/** Wide enough for any treadmill, narrow enough to keep a typo out of the file. */
const LIMITS = {
  speedsKmh: { min: 0, max: 30 },
  inclinesPercent: { min: 0, max: 30 },
} as const

/**
 * Deliberately not `Number(value)`: that turns null, an empty string and false into 0, so an emptied
 * input field or a null in the file would read as a real zero instead of falling back.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeRow(value: unknown, key: keyof Presets): number[] {
  const fallback = DEFAULT_PRESETS[key]
  const source = Array.isArray(value) ? value : []
  const { min, max } = LIMITS[key]
  return fallback.map((preset, index) => {
    const candidate = toNumber(source[index])
    if (candidate === null) return preset
    const clamped = Math.min(max, Math.max(min, candidate))
    return Math.round(clamped * 10) / 10
  })
}

/**
 * Turns anything, including a hand-edited or truncated settings file, into exactly PRESET_COUNT
 * usable values per row. A single bad entry falls back to its default instead of taking the whole
 * row with it.
 */
export function normalizePresets(value: unknown): Presets {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    speedsKmh: normalizeRow(source.speedsKmh, 'speedsKmh'),
    inclinesPercent: normalizeRow(source.inclinesPercent, 'inclinesPercent'),
  }
}
