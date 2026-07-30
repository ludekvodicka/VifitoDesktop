import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESETS } from './presets'
import { DEFAULT_PROFILE, normalizeSettings } from './settings'

describe('normalizeSettings', () => {
  it('enables diagnostics when migrating the old presets-only format', () => {
    expect(normalizeSettings({ presets: DEFAULT_PRESETS })).toEqual({
      presets: DEFAULT_PRESETS,
      showDiagnostics: true,
      profile: DEFAULT_PROFILE,
    })
  })

  it('keeps diagnostics disabled when explicitly stored', () => {
    expect(normalizeSettings({ showDiagnostics: false }).showDiagnostics).toBe(false)
  })

  it('enables diagnostics for an invalid stored value', () => {
    for (const value of [undefined, null, 'false', 0])
      expect(normalizeSettings({ showDiagnostics: value }).showDiagnostics).toBe(true)
  })

  it('normalizes presets together with the diagnostics setting', () => {
    expect(
      normalizeSettings({
        presets: { speedsKmh: ['4.5', 'fast', 6, 7, 8, 9] },
        showDiagnostics: false,
      }),
    ).toEqual({
      presets: {
        speedsKmh: [4.5, DEFAULT_PRESETS.speedsKmh[1], 6, 7, 8, 9],
        inclinesPercent: DEFAULT_PRESETS.inclinesPercent,
      },
      showDiagnostics: false,
      profile: DEFAULT_PROFILE,
    })
  })
})

describe('normalizeSettings profile', () => {
  it('leaves every field unset when the stored file has no profile', () => {
    expect(normalizeSettings({ presets: DEFAULT_PRESETS }).profile).toEqual(DEFAULT_PROFILE)
  })

  it('passes a valid profile through', () => {
    const profile = { ageYears: 41, sex: 'male' as const, weightKg: 82.5, heightCm: 183 }
    expect(normalizeSettings({ profile }).profile).toEqual(profile)
  })

  it('accepts numeric strings, which is what a number input hands over', () => {
    expect(normalizeSettings({ profile: { weightKg: '82.5', heightCm: '183' } }).profile).toMatchObject({
      weightKg: 82.5,
      heightCm: 183,
    })
  })

  it('treats an emptied field as unset rather than as a zero', () => {
    expect(normalizeSettings({ profile: { weightKg: '', heightCm: null, ageYears: undefined } }).profile).toEqual(
      DEFAULT_PROFILE,
    )
  })

  it('rejects a value that is not a number at all', () => {
    expect(normalizeSettings({ profile: { weightKg: 'heavy', ageYears: {} } }).profile).toMatchObject({
      weightKg: null,
      ageYears: null,
    })
  })

  it('clamps a value that is out of range instead of dropping it', () => {
    expect(normalizeSettings({ profile: { ageYears: -5, weightKg: 1000, heightCm: 10 } }).profile).toMatchObject({
      ageYears: 5,
      weightKg: 300,
      heightCm: 80,
    })
  })

  it('accepts only the two known values for sex', () => {
    expect(normalizeSettings({ profile: { sex: 'female' } }).profile.sex).toBe('female')
    for (const value of ['yes', 'Male', '', 1, null]) expect(normalizeSettings({ profile: { sex: value } }).profile.sex).toBeNull()
  })

  it('keeps presets and diagnostics untouched while normalizing a broken profile', () => {
    const settings = normalizeSettings({ showDiagnostics: false, profile: { weightKg: 'heavy' } })
    expect(settings.showDiagnostics).toBe(false)
    expect(settings.presets).toEqual(DEFAULT_PRESETS)
  })
})
