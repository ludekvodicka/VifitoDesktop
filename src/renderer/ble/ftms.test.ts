import { describe, expect, it } from 'vitest'
import { mergeFrames, parseInclinationRange, parseMachineFeature, parseSpeedRange, parseTreadmillData } from './ftms'

function frame(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer)
}

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff]
const u24 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]

describe('parseTreadmillData', () => {
  it('reads speed only when the flags are zero', () => {
    const data = parseTreadmillData(frame([...u16(0x0000), ...u16(450)]))
    expect(data.speedKmh).toBeCloseTo(4.5)
    expect(data.distanceM).toBeUndefined()
    expect(data.truncated).toBe(false)
  })

  it('skips speed when the More Data bit is set', () => {
    const data = parseTreadmillData(frame([...u16(0x0001)]))
    expect(data.speedKmh).toBeUndefined()
  })

  it('reads a typical treadmill frame: speed, distance, incline, energy, heart rate, time', () => {
    const flags = (1 << 2) | (1 << 3) | (1 << 7) | (1 << 8) | (1 << 10)
    const data = parseTreadmillData(
      frame([
        ...u16(flags),
        ...u16(612), // 6.12 km/h
        ...u24(1234), // 1234 m
        ...u16(25), // incline 2.5 %
        ...u16(0), // ramp angle 0
        ...u16(87), // 87 kcal
        ...u16(340), // 340 kcal/h
        6, // 6 kcal/min
        112, // heart rate
        ...u16(905), // 905 s
      ]),
    )
    expect(data.speedKmh).toBeCloseTo(6.12)
    expect(data.distanceM).toBe(1234)
    expect(data.inclinePercent).toBeCloseTo(2.5)
    expect(data.rampAngleDeg).toBeCloseTo(0)
    expect(data.energyTotalKcal).toBe(87)
    expect(data.energyPerHourKcal).toBe(340)
    expect(data.energyPerMinKcal).toBe(6)
    expect(data.heartRateBpm).toBe(112)
    expect(data.elapsedSec).toBe(905)
    expect(data.truncated).toBe(false)
  })

  it('reads a negative incline as sint16', () => {
    const data = parseTreadmillData(frame([...u16(1 << 3), ...u16(450), ...u16(0xffce), ...u16(0)]))
    expect(data.inclinePercent).toBeCloseTo(-5)
  })

  it('reports unavailable energy as undefined', () => {
    const data = parseTreadmillData(frame([...u16(1 << 7), ...u16(450), ...u16(0xffff), ...u16(0xffff), 0xff]))
    expect(data.energyTotalKcal).toBeUndefined()
    expect(data.energyPerMinKcal).toBeUndefined()
  })

  it('marks a frame truncated when the console promised more fields than it sent', () => {
    const flags = (1 << 2) | (1 << 10)
    const data = parseTreadmillData(frame([...u16(flags), ...u16(450), ...u24(500)]))
    expect(data.distanceM).toBe(500)
    expect(data.elapsedSec).toBeUndefined()
    expect(data.truncated).toBe(true)
  })
})

describe('mergeFrames', () => {
  it('keeps the last known value when the next frame omits it', () => {
    const withDistance = parseTreadmillData(frame([...u16(1 << 2), ...u16(500), ...u24(300)]))
    const speedOnly = parseTreadmillData(frame([...u16(0x0000), ...u16(520)]))
    const merged = mergeFrames(withDistance, speedOnly)
    expect(merged.speedKmh).toBeCloseTo(5.2)
    expect(merged.distanceM).toBe(300)
    expect(merged.hex).toBe(speedOnly.hex)
  })

  it('passes the first frame through unchanged', () => {
    const first = parseTreadmillData(frame([...u16(0x0000), ...u16(500)]))
    expect(mergeFrames(null, first)).toBe(first)
  })

  it('treats zero as a valid value, not as a missing field', () => {
    const running = parseTreadmillData(frame([...u16(0x0000), ...u16(500)]))
    const stopped = parseTreadmillData(frame([...u16(0x0000), ...u16(0)]))
    expect(mergeFrames(running, stopped).speedKmh).toBe(0)
  })
})

describe('parseMachineFeature', () => {
  it('decodes the capability and target-setting flags', () => {
    // features: Total Distance (2), Inclination (3), Expended Energy (9), Elapsed Time (12)
    // targets: Speed Target (0), Inclination Target (1)
    const features = (1 << 2) | (1 << 3) | (1 << 9) | (1 << 12)
    const targets = (1 << 0) | (1 << 1)
    const view = new DataView(new ArrayBuffer(8))
    view.setUint32(0, features, true)
    view.setUint32(4, targets, true)
    const parsed = parseMachineFeature(view)
    expect(parsed.features).toEqual(['Total Distance', 'Inclination', 'Expended Energy', 'Elapsed Time'])
    expect(parsed.targets).toEqual(['Speed Target', 'Inclination Target'])
  })
})

describe('ranges', () => {
  it('reads the speed range in 0.01 km/h', () => {
    const r = parseSpeedRange(frame([...u16(100), ...u16(1800), ...u16(10)]))
    expect(r).toEqual({ min: 1, max: 18, step: 0.1 })
  })

  it('reads the inclination range in 0.1 %', () => {
    const r = parseInclinationRange(frame([...u16(0), ...u16(150), ...u16(10)]))
    expect(r).toEqual({ min: 0, max: 15, step: 1 })
  })
})
