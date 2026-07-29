import type { Range } from './ftms'

export const ControlOp = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetSpeed: 0x02,
  setTargetInclination: 0x03,
  start: 0x07,
  stop: 0x08,
} as const

export type ControlOpCode = (typeof ControlOp)[keyof typeof ControlOp]

/** Pinned to a plain ArrayBuffer because that is what Web Bluetooth accepts as a write payload. */
export type ControlCommand = Uint8Array<ArrayBuffer>

/** Every response the machine indicates starts with this op code, the rest is the echoed request. */
const RESPONSE_CODE = 0x80

const RESULTS: Record<number, string> = {
  0x01: 'Success',
  0x02: 'Op Code not supported',
  0x03: 'Invalid Parameter',
  0x04: 'Operation Failed',
  0x05: 'Control Not Permitted',
}

const OP_NAMES: Record<number, string> = {
  [ControlOp.requestControl]: 'Request Control',
  [ControlOp.reset]: 'Reset',
  [ControlOp.setTargetSpeed]: 'Set Target Speed',
  [ControlOp.setTargetInclination]: 'Set Target Inclination',
  [ControlOp.start]: 'Start or Resume',
  [ControlOp.stop]: 'Stop or Pause',
}

export type ControlResponse = {
  requestOp: number
  requestName: string
  result: number
  ok: boolean
  /** Set when the machine refused because control was never taken or has timed out. */
  notPermitted: boolean
  message: string
}

export function opName(op: number): string {
  return OP_NAMES[op] ?? `0x${op.toString(16).padStart(2, '0')}`
}

export function encodeRequestControl(): ControlCommand {
  return Uint8Array.of(ControlOp.requestControl)
}

export function encodeStart(): ControlCommand {
  return Uint8Array.of(ControlOp.start)
}

/** Parameter 1 stops the belt, 2 only pauses it. Stopping is the safe default. */
export function encodeStop(): ControlCommand {
  return Uint8Array.of(ControlOp.stop, 0x01)
}

export function encodeSetSpeed(kmh: number): ControlCommand {
  const raw = Math.round(kmh * 100)
  if (raw < 0 || raw > 0xffff) throw new Error(`Speed out of range: ${kmh} km/h`)
  return Uint8Array.of(ControlOp.setTargetSpeed, raw & 0xff, (raw >> 8) & 0xff)
}

export function encodeSetIncline(percent: number): ControlCommand {
  const raw = Math.round(percent * 10)
  if (raw < -0x8000 || raw > 0x7fff) throw new Error(`Inclination out of range: ${percent} %`)
  return Uint8Array.of(ControlOp.setTargetInclination, raw & 0xff, (raw >> 8) & 0xff)
}

export function parseControlResponse(view: DataView): ControlResponse | null {
  if (view.byteLength < 3 || view.getUint8(0) !== RESPONSE_CODE) return null
  const requestOp = view.getUint8(1)
  const result = view.getUint8(2)
  const requestName = opName(requestOp)
  return {
    requestOp,
    requestName,
    result,
    ok: result === 0x01,
    notPermitted: result === 0x05,
    message: `${requestName}: ${RESULTS[result] ?? `unknown result 0x${result.toString(16)}`}`,
  }
}

/**
 * Clamps to the range the console advertises and snaps to its step. A value off that grid comes
 * back as Invalid Parameter, so the rounding has to happen before the write, not in the display.
 */
export function quantize(value: number, range: Range | undefined, fallbackStep: number): number {
  const step = range?.step && range.step > 0 ? range.step : fallbackStep
  const min = range?.min ?? 0
  const max = range?.max
  const clamped = Math.max(min, max === undefined ? value : Math.min(max, value))
  const snapped = min + Math.round((clamped - min) / step) * step
  const bounded = Math.max(min, max === undefined ? snapped : Math.min(max, snapped))
  // Binary fractions of 0.1 steps accumulate visible noise (2.9000000000000004), so pin the result
  // to the precision the step itself carries.
  const decimals = (String(step).split('.')[1] ?? '').length
  return Number(bounded.toFixed(decimals))
}
