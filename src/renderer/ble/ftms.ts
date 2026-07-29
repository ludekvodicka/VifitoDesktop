export type TreadmillData = {
  speedKmh?: number
  avgSpeedKmh?: number
  distanceM?: number
  inclinePercent?: number
  rampAngleDeg?: number
  elevationGainPosM?: number
  elevationGainNegM?: number
  paceKmPerMin?: number
  avgPaceKmPerMin?: number
  energyTotalKcal?: number
  energyPerHourKcal?: number
  energyPerMinKcal?: number
  heartRateBpm?: number
  metabolicEquivalent?: number
  elapsedSec?: number
  remainingSec?: number
  forceOnBeltN?: number
  powerW?: number
  flags: number
  hex: string
  /** The flags announced more fields than the console actually sent. */
  truncated: boolean
}

export function toHex(view: DataView): string {
  const out: string[] = []
  for (let i = 0; i < view.byteLength; i++) out.push(view.getUint8(i).toString(16).padStart(2, '0'))
  return out.join(' ')
}

/**
 * FTMS Treadmill Data (0x2ACD). Fields come in a fixed order, the flag bits decide which are
 * present. Bit 0 is "More Data" and reads inverted: 0 means instantaneous speed IS present.
 */
export function parseTreadmillData(view: DataView): TreadmillData {
  const flags = view.getUint16(0, true)
  const out: TreadmillData = { flags, hex: toHex(view), truncated: false }
  let offset = 2

  const room = (bytes: number) => {
    if (offset + bytes <= view.byteLength) return true
    out.truncated = true
    return false
  }
  const u8 = () => (room(1) ? view.getUint8(offset++) : undefined)
  const u16 = () => {
    if (!room(2)) return undefined
    const v = view.getUint16(offset, true)
    offset += 2
    return v
  }
  const s16 = () => {
    if (!room(2)) return undefined
    const v = view.getInt16(offset, true)
    offset += 2
    return v
  }
  const u24 = () => {
    if (!room(3)) return undefined
    const v = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
    offset += 3
    return v
  }
  const scaled = (raw: number | undefined, factor: number) => (raw === undefined ? undefined : raw * factor)
  /** 0xFFFF, or 0xFF for a byte, means "value not available". */
  const unless = (raw: number | undefined, missing: number) => (raw === undefined || raw === missing ? undefined : raw)

  const bit = (n: number) => (flags & (1 << n)) !== 0

  if (!bit(0)) out.speedKmh = scaled(u16(), 0.01)
  if (bit(1)) out.avgSpeedKmh = scaled(u16(), 0.01)
  if (bit(2)) out.distanceM = u24()
  if (bit(3)) {
    out.inclinePercent = scaled(s16(), 0.1)
    out.rampAngleDeg = scaled(s16(), 0.1)
  }
  if (bit(4)) {
    out.elevationGainPosM = scaled(u16(), 0.1)
    out.elevationGainNegM = scaled(u16(), 0.1)
  }
  if (bit(5)) out.paceKmPerMin = scaled(u8(), 0.1)
  if (bit(6)) out.avgPaceKmPerMin = scaled(u8(), 0.1)
  if (bit(7)) {
    out.energyTotalKcal = unless(u16(), 0xffff)
    out.energyPerHourKcal = unless(u16(), 0xffff)
    out.energyPerMinKcal = unless(u8(), 0xff)
  }
  if (bit(8)) out.heartRateBpm = u8()
  if (bit(9)) out.metabolicEquivalent = scaled(u8(), 0.1)
  if (bit(10)) out.elapsedSec = u16()
  if (bit(11)) out.remainingSec = u16()
  if (bit(12)) {
    out.forceOnBeltN = s16()
    out.powerW = s16()
  }
  return out
}

/**
 * A console need not send every field in every frame, two different flag sets often alternate.
 * Without merging, the tiles would blink empty between frames, so the last known value is kept.
 */
export function mergeFrames(previous: TreadmillData | null, frame: TreadmillData): TreadmillData {
  if (!previous) return frame
  const merged = { ...previous } as Record<string, unknown>
  for (const [key, value] of Object.entries(frame)) {
    if (value !== undefined) merged[key] = value
  }
  return merged as unknown as TreadmillData
}

const FEATURE_BITS = [
  'Average Speed',
  'Cadence',
  'Total Distance',
  'Inclination',
  'Elevation Gain',
  'Pace',
  'Step Count',
  'Resistance Level',
  'Stride Count',
  'Expended Energy',
  'Heart Rate',
  'Metabolic Equivalent',
  'Elapsed Time',
  'Remaining Time',
  'Power Measurement',
  'Force on Belt and Power Output',
  'User Data Retention',
]

const TARGET_BITS = [
  'Speed Target',
  'Inclination Target',
  'Resistance Target',
  'Power Target',
  'Heart Rate Target',
  'Expended Energy Target',
  'Step Number Target',
  'Stride Number Target',
  'Distance Target',
  'Training Time Target',
  'Time in Two HR Zones',
  'Time in Three HR Zones',
  'Time in Five HR Zones',
  'Indoor Bike Simulation',
  'Wheel Circumference',
  'Spin Down Control',
  'Cadence Target',
]

export type MachineFeatures = {
  features: string[]
  /** What the console says it allows setting over the Control Point. */
  targets: string[]
  hex: string
}

/** FTMS Fitness Machine Feature (0x2ACC): 2x uint32, the second word is Target Setting Features. */
export function parseMachineFeature(view: DataView): MachineFeatures {
  const decode = (word: number, names: string[]) => names.filter((_, i) => (word & (1 << i)) !== 0)
  const features = view.byteLength >= 4 ? decode(view.getUint32(0, true), FEATURE_BITS) : []
  const targets = view.byteLength >= 8 ? decode(view.getUint32(4, true), TARGET_BITS) : []
  return { features, targets, hex: toHex(view) }
}

export type Range = { min: number; max: number; step: number }

/** Supported Speed Range (0x2AD4): min, max, step, all uint16 in 0.01 km/h. */
export function parseSpeedRange(view: DataView): Range {
  return {
    min: view.getUint16(0, true) * 0.01,
    max: view.getUint16(2, true) * 0.01,
    step: view.getUint16(4, true) * 0.01,
  }
}

/** Supported Inclination Range (0x2AD5): min and max sint16, step uint16, all in 0.1 %. */
export function parseInclinationRange(view: DataView): Range {
  return {
    min: view.getInt16(0, true) * 0.1,
    max: view.getInt16(2, true) * 0.1,
    step: view.getUint16(4, true) * 0.1,
  }
}
