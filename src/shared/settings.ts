import { DEFAULT_PRESETS, normalizePresets, type Presets } from './presets'

export type Sex = 'male' | 'female'

/** Every field is optional: nothing here has a sensible default, an unset weight is not a zero. */
export type Profile = {
  ageYears: number | null
  sex: Sex | null
  weightKg: number | null
  heightCm: number | null
}

export type AppSettings = {
  presets: Presets
  showDiagnostics: boolean
  profile: Profile
}

export const DEFAULT_PROFILE: Profile = {
  ageYears: null,
  sex: null,
  weightKg: null,
  heightCm: null,
}

export const DEFAULT_SETTINGS: AppSettings = {
  presets: DEFAULT_PRESETS,
  showDiagnostics: true,
  profile: DEFAULT_PROFILE,
}

const PROFILE_LIMITS = {
  ageYears: { min: 5, max: 120 },
  weightKg: { min: 20, max: 300 },
  heightCm: { min: 80, max: 250 },
} as const

/**
 * Same reasoning as the presets normalizer: Number(null) and Number('') are 0, so an emptied field
 * would read as a real value. Only a number or a non-empty numeric string counts.
 */
function clampedOrNull(value: unknown, key: keyof typeof PROFILE_LIMITS): number | null {
  const candidate = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(candidate)) return null
  const { min, max } = PROFILE_LIMITS[key]
  return Math.round(Math.min(max, Math.max(min, candidate)) * 10) / 10
}

function normalizeProfile(value: unknown): Profile {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    ageYears: clampedOrNull(source.ageYears, 'ageYears'),
    sex: source.sex === 'male' || source.sex === 'female' ? source.sex : null,
    weightKg: clampedOrNull(source.weightKg, 'weightKg'),
    heightCm: clampedOrNull(source.heightCm, 'heightCm'),
  }
}

export function normalizeSettings(value: unknown): AppSettings {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    presets: normalizePresets(source.presets),
    showDiagnostics:
      typeof source.showDiagnostics === 'boolean' ? source.showDiagnostics : DEFAULT_SETTINGS.showDiagnostics,
    profile: normalizeProfile(source.profile),
  }
}
