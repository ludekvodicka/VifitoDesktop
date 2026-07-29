const full = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`

export const UUID = {
  fitnessMachine: full('1826'),
  deviceInformation: full('180a'),
  battery: full('180f'),
  heartRate: full('180d'),
  cyclingSpeedCadence: full('1816'),
  /** Cheap consoles (FitShow and friends) often carry their data in a vendor service. */
  vendorFff0: full('fff0'),
  vendorFfe0: full('ffe0'),
  vendorFee7: full('fee7'),

  treadmillData: full('2acd'),
  machineFeature: full('2acc'),
  controlPoint: full('2ad9'),
  machineStatus: full('2ada'),
  trainingStatus: full('2ad3'),
  speedRange: full('2ad4'),
  inclinationRange: full('2ad5'),
} as const

/**
 * Web Bluetooth exposes only the services listed here. Generic Access (1800) and Generic
 * Attribute (1801) are on the Chromium blocklist, which is why they are missing.
 */
export const OPTIONAL_SERVICES: string[] = [
  UUID.fitnessMachine,
  UUID.deviceInformation,
  UUID.battery,
  UUID.heartRate,
  UUID.cyclingSpeedCadence,
  UUID.vendorFff0,
  UUID.vendorFfe0,
  UUID.vendorFee7,
]

const NAMES: Record<string, string> = {
  '1826': 'Fitness Machine (FTMS)',
  '180a': 'Device Information',
  '180f': 'Battery',
  '180d': 'Heart Rate',
  '1816': 'Cycling Speed and Cadence',
  fff0: 'Vendor 0xFFF0',
  ffe0: 'Vendor 0xFFE0',
  fee7: 'Vendor 0xFEE7',
  '2acc': 'Fitness Machine Feature',
  '2acd': 'Treadmill Data',
  '2ad9': 'Control Point',
  '2ada': 'Fitness Machine Status',
  '2ad3': 'Training Status',
  '2ad4': 'Supported Speed Range',
  '2ad5': 'Supported Inclination Range',
  '2a19': 'Battery Level',
  '2a24': 'Model Number',
  '2a26': 'Firmware Revision',
  '2a27': 'Hardware Revision',
  '2a28': 'Software Revision',
  '2a29': 'Manufacturer Name',
  '2a37': 'Heart Rate Measurement',
}

export function uuidName(uuid: string): string {
  const short = uuid.slice(4, 8)
  return NAMES[short] ?? `0x${short.toUpperCase()}`
}
