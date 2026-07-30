import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESETS, normalizePresets, PRESET_COUNT } from './presets'

describe('normalizePresets', () => {
  it('keeps a valid set untouched', () => {
    const input = { speedsKmh: [1, 2, 3, 4, 5, 6], inclinesPercent: [1, 1, 1, 1, 1, 1] }
    expect(normalizePresets(input)).toEqual(input)
  })

  it('falls back to the defaults for anything that is not an object', () => {
    for (const value of [undefined, null, 'presets', 42, []]) expect(normalizePresets(value)).toEqual(DEFAULT_PRESETS)
  })

  it('pads a short row from the defaults', () => {
    const presets = normalizePresets({ speedsKmh: [2, 2] })
    expect(presets.speedsKmh).toEqual([2, 2, ...DEFAULT_PRESETS.speedsKmh.slice(2)])
    expect(presets.inclinesPercent).toEqual(DEFAULT_PRESETS.inclinesPercent)
  })

  it('drops the extra entries of a long row', () => {
    expect(normalizePresets({ speedsKmh: [1, 2, 3, 4, 5, 6, 7, 8] }).speedsKmh).toHaveLength(PRESET_COUNT)
  })

  it('replaces a single unusable entry and leaves its neighbours alone', () => {
    const presets = normalizePresets({ speedsKmh: [1, 'fast', 3, null, 5, NaN] })
    expect(presets.speedsKmh).toEqual([1, DEFAULT_PRESETS.speedsKmh[1], 3, DEFAULT_PRESETS.speedsKmh[3], 5, DEFAULT_PRESETS.speedsKmh[5]])
  })

  it('accepts a numeric string, which is what a number input hands over', () => {
    expect(normalizePresets({ speedsKmh: ['4.5', '5', '6', '7', '8', '9'] }).speedsKmh).toEqual([4.5, 5, 6, 7, 8, 9])
  })

  it('clamps a value that is out of range instead of refusing it', () => {
    const presets = normalizePresets({ speedsKmh: [-5, 999, 3, 4, 5, 6], inclinesPercent: [-1, 99, 4, 6, 8, 10] })
    expect(presets.speedsKmh.slice(0, 2)).toEqual([0, 30])
    expect(presets.inclinesPercent.slice(0, 2)).toEqual([0, 30])
  })

  it('rounds to one decimal, the finest step any console reports', () => {
    expect(normalizePresets({ speedsKmh: [3.14159, 4, 5, 6, 7, 8] }).speedsKmh[0]).toBe(3.1)
  })
})
