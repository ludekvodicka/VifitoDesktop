import { describe, expect, it } from 'vitest'
import {
  encodeRequestControl,
  encodeSetIncline,
  encodeSetSpeed,
  encodeStart,
  encodeStop,
  limitInclineRange,
  parseControlResponse,
  quantize,
} from './controlPoint'

const bytes = (values: Uint8Array) => [...values]
const response = (values: number[]): DataView => new DataView(Uint8Array.from(values).buffer)

describe('control point commands', () => {
  it('encodes the parameterless commands', () => {
    expect(bytes(encodeRequestControl())).toEqual([0x00])
    expect(bytes(encodeStart())).toEqual([0x07])
  })

  it('stops rather than pauses', () => {
    expect(bytes(encodeStop())).toEqual([0x08, 0x01])
  })

  it('encodes the target speed as uint16 in 0.01 km/h', () => {
    expect(bytes(encodeSetSpeed(6.12))).toEqual([0x02, 0x64, 0x02])
    expect(bytes(encodeSetSpeed(0))).toEqual([0x02, 0x00, 0x00])
  })

  it('encodes the target inclination as sint16 in 0.1 %', () => {
    expect(bytes(encodeSetIncline(2.5))).toEqual([0x03, 0x19, 0x00])
    expect(bytes(encodeSetIncline(-5))).toEqual([0x03, 0xce, 0xff])
  })

  it('refuses a value that does not fit the wire format', () => {
    expect(() => encodeSetSpeed(700)).toThrow()
    expect(() => encodeSetIncline(-4000)).toThrow()
  })
})

describe('parseControlResponse', () => {
  it('reads a successful response', () => {
    const parsed = parseControlResponse(response([0x80, 0x02, 0x01]))
    expect(parsed?.ok).toBe(true)
    expect(parsed?.notPermitted).toBe(false)
    expect(parsed?.message).toBe('Set Target Speed: Success')
  })

  it('flags a refusal that means control was never taken', () => {
    const parsed = parseControlResponse(response([0x80, 0x07, 0x05]))
    expect(parsed?.ok).toBe(false)
    expect(parsed?.notPermitted).toBe(true)
    expect(parsed?.message).toBe('Start or Resume: Control Not Permitted')
  })

  it('names every documented result', () => {
    const messages = [0x01, 0x02, 0x03, 0x04, 0x05].map(
      (result) => parseControlResponse(response([0x80, 0x00, result]))?.message,
    )
    expect(messages).toEqual([
      'Request Control: Success',
      'Request Control: Op Code not supported',
      'Request Control: Invalid Parameter',
      'Request Control: Operation Failed',
      'Request Control: Control Not Permitted',
    ])
  })

  it('keeps an unknown result readable instead of dropping it', () => {
    expect(parseControlResponse(response([0x80, 0x02, 0x42]))?.message).toBe('Set Target Speed: unknown result 0x42')
  })

  it('ignores anything that is not a control response', () => {
    expect(parseControlResponse(response([0x04, 0x02, 0x01]))).toBeNull()
    expect(parseControlResponse(response([0x80, 0x02]))).toBeNull()
  })
})

describe('quantize', () => {
  const speed = { min: 1, max: 18, step: 0.1 }
  const incline = { min: 0, max: 15, step: 0.5 }

  it('snaps to the step the console reports', () => {
    expect(quantize(6.14, speed, 0.1)).toBe(6.1)
    expect(quantize(2.3, incline, 0.1)).toBe(2.5)
  })

  it('clamps to the advertised range', () => {
    expect(quantize(0.2, speed, 0.1)).toBe(1)
    expect(quantize(25, speed, 0.1)).toBe(18)
    expect(quantize(-3, incline, 0.1)).toBe(0)
  })

  it('does not step outside the range when rounding up at the edge', () => {
    expect(quantize(17.98, { min: 1, max: 18, step: 0.5 }, 0.1)).toBe(18)
  })

  it('falls back to the given step when the console reports no range', () => {
    expect(quantize(6.14, undefined, 0.1)).toBe(6.1)
  })

  it('keeps the result free of binary fraction noise', () => {
    expect(quantize(2.9, { min: 0, max: 15, step: 0.1 }, 0.1)).toBe(2.9)
    expect(quantize(0.7, { min: 0, max: 15, step: 0.1 }, 0.1)).toBe(0.7)
  })
})

describe('limitInclineRange', () => {
  const range = { min: 0, max: 15, step: 0.5 }

  it('keeps the original range when there is no cap', () => {
    expect(limitInclineRange(range, null, 0.5)).toBe(range)
    expect(limitInclineRange(undefined, null, 0.5)).toBeUndefined()
  })

  it('floors the cap to the console grid before quantizing a target', () => {
    const limited = limitInclineRange(range, 12.3, 0.5)
    expect(limited).toEqual({ min: 0, max: 12, step: 0.5 })
    if (limited === null) throw new Error('Expected an allowed incline range')
    expect(quantize(14, limited, 0.5)).toBe(12)
    expect(range.max).toBe(15)
  })

  it('keeps an exact tenth despite binary fraction rounding', () => {
    expect(limitInclineRange({ min: 0, max: 15, step: 0.1 }, 1.2, 0.5)).toEqual({ min: 0, max: 1.2, step: 0.1 })
  })

  it('keeps the console maximum when the cap is higher', () => {
    expect(limitInclineRange(range, 20, 0.5)).toEqual(range)
  })

  it('uses the fallback grid when no console range is available', () => {
    expect(limitInclineRange(undefined, 12.3, 0.5)).toEqual({ min: 0, max: 12, step: 0.5 })
  })

  it.each([0, -0.5])('uses the fallback when the advertised step is %s', (step) => {
    expect(limitInclineRange({ ...range, step }, 12.3, 0.5)).toEqual({ min: 0, max: 12, step: 0.5 })
  })

  it('anchors the grid to the console minimum', () => {
    expect(limitInclineRange({ min: 0.2, max: 15.2, step: 0.5 }, 12.3, 0.5)).toEqual({ min: 0.2, max: 12.2, step: 0.5 })
  })

  it('allows no incline when the cap is below the console minimum', () => {
    expect(limitInclineRange({ min: 1, max: 15, step: 0.5 }, 0.5, 0.5)).toBeNull()
  })

  it.each([1, 1.2])('allows the console minimum when the cap is %s', (cap) => {
    expect(limitInclineRange({ min: 1, max: 15, step: 0.5 }, cap, 0.5)).toEqual({ min: 1, max: 1, step: 0.5 })
  })

  it('supports a zero incline cap', () => {
    const limited = limitInclineRange(range, 0, 0.5)
    if (limited === null) throw new Error('Expected an allowed incline range')
    expect(quantize(14, limited, 0.5)).toBe(0)
  })
})
