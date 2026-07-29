import { parseInclinationRange, parseMachineFeature, parseSpeedRange, toHex, type MachineFeatures, type Range } from './ftms'
import { OPTIONAL_SERVICES, UUID, uuidName } from './uuids'

export type CharacteristicDump = {
  uuid: string
  name: string
  properties: string[]
  hex?: string
  decoded?: string
  error?: string
}

export type ServiceDump = {
  uuid: string
  name: string
  characteristics: CharacteristicDump[]
}

export type MachineInfo = {
  features?: MachineFeatures
  speedRange?: Range
  inclinationRange?: Range
}

export function requestTreadmill(): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES })
}

function propertyList(c: BluetoothRemoteGATTCharacteristic): string[] {
  const p = c.properties
  const names: string[] = []
  if (p.read) names.push('read')
  if (p.write) names.push('write')
  if (p.writeWithoutResponse) names.push('writeNoResp')
  if (p.notify) names.push('notify')
  if (p.indicate) names.push('indicate')
  return names
}

function decodeText(view: DataView): string {
  return new TextDecoder().decode(view.buffer).replace(/\0+$/, '')
}

function decodeKnown(uuid: string, view: DataView): string | undefined {
  const short = uuid.slice(4, 8)
  if (short === '2acc') {
    const f = parseMachineFeature(view)
    return `features: ${f.features.join(', ') || 'none'} | targets: ${f.targets.join(', ') || 'none'}`
  }
  if (short === '2ad4') {
    const r = parseSpeedRange(view)
    return `${r.min.toFixed(2)} to ${r.max.toFixed(2)} km/h, step ${r.step.toFixed(2)}`
  }
  if (short === '2ad5') {
    const r = parseInclinationRange(view)
    return `${r.min.toFixed(1)} to ${r.max.toFixed(1)} %, step ${r.step.toFixed(1)}`
  }
  if (short === '2a19') return `${view.getUint8(0)} %`
  if (['2a24', '2a26', '2a27', '2a28', '2a29'].includes(short)) return decodeText(view)
  return undefined
}

/**
 * Dump of every reachable service and characteristic. Web Bluetooth returns only the services
 * listed in OPTIONAL_SERVICES, a blind scan of the whole GATT is not possible from a browser.
 */
export async function dumpGatt(server: BluetoothRemoteGATTServer): Promise<ServiceDump[]> {
  const services = await server.getPrimaryServices()
  const dump: ServiceDump[] = []
  for (const service of services) {
    const entry: ServiceDump = { uuid: service.uuid, name: uuidName(service.uuid), characteristics: [] }
    try {
      for (const characteristic of await service.getCharacteristics()) {
        const item: CharacteristicDump = {
          uuid: characteristic.uuid,
          name: uuidName(characteristic.uuid),
          properties: propertyList(characteristic),
        }
        if (characteristic.properties.read) {
          try {
            const value = await characteristic.readValue()
            item.hex = toHex(value)
            item.decoded = decodeKnown(characteristic.uuid, value)
          } catch (err) {
            item.error = String(err)
          }
        }
        entry.characteristics.push(item)
      }
    } catch (err) {
      entry.characteristics.push({ uuid: service.uuid, name: 'failed to read characteristics', properties: [], error: String(err) })
    }
    dump.push(entry)
  }
  return dump
}

export async function readMachineInfo(server: BluetoothRemoteGATTServer): Promise<MachineInfo> {
  const info: MachineInfo = {}
  const ftms = await server.getPrimaryService(UUID.fitnessMachine)
  const read = async (uuid: string) => {
    try {
      return await (await ftms.getCharacteristic(uuid)).readValue()
    } catch {
      return undefined
    }
  }
  const feature = await read(UUID.machineFeature)
  if (feature) info.features = parseMachineFeature(feature)
  const speed = await read(UUID.speedRange)
  if (speed) info.speedRange = parseSpeedRange(speed)
  const incline = await read(UUID.inclinationRange)
  if (incline) info.inclinationRange = parseInclinationRange(incline)
  return info
}

export type NotificationHandlers = {
  onTreadmillData: (view: DataView) => void
  onStatus: (label: string, hex: string) => void
}

/**
 * Subscribes to Treadmill Data and the status characteristics. Returns an unsubscribe function.
 * There is deliberately no write to the Control Point (0x2AD9), this app is read-only.
 */
export async function startNotifications(
  server: BluetoothRemoteGATTServer,
  handlers: NotificationHandlers,
): Promise<() => Promise<void>> {
  const ftms = await server.getPrimaryService(UUID.fitnessMachine)
  const data = await ftms.getCharacteristic(UUID.treadmillData)
  const onData = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value
    if (value) handlers.onTreadmillData(value)
  }
  data.addEventListener('characteristicvaluechanged', onData)
  await data.startNotifications()

  const optional: { uuid: string; label: string; characteristic?: BluetoothRemoteGATTCharacteristic; listener?: (e: Event) => void }[] = [
    { uuid: UUID.machineStatus, label: 'Machine Status' },
    { uuid: UUID.trainingStatus, label: 'Training Status' },
  ]
  for (const item of optional) {
    try {
      const characteristic = await ftms.getCharacteristic(item.uuid)
      const listener = (event: Event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value
        if (value) handlers.onStatus(item.label, toHex(value))
      }
      characteristic.addEventListener('characteristicvaluechanged', listener)
      await characteristic.startNotifications()
      item.characteristic = characteristic
      item.listener = listener
    } catch {
      // the console does not expose this characteristic, which is not an error
    }
  }

  return async () => {
    data.removeEventListener('characteristicvaluechanged', onData)
    try {
      await data.stopNotifications()
    } catch {
      // the connection is already gone
    }
    for (const item of optional) {
      if (!item.characteristic || !item.listener) continue
      item.characteristic.removeEventListener('characteristicvaluechanged', item.listener)
      try {
        await item.characteristic.stopNotifications()
      } catch {
        // the connection is already gone
      }
    }
  }
}
