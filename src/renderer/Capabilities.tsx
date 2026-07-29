import type { MachineInfo, ServiceDump } from './ble/connection'
import type { TreadmillData } from './ble/ftms'
import { UUID } from './ble/uuids'

type Props = {
  info: MachineInfo | null
  dump: ServiceDump[] | null
  /** OR of every flag seen since connecting, tells what the console really sends. */
  seenFlags: number
  framesSeen: number
  data: TreadmillData | null
}

type ReadableRow = {
  label: string
  unit: string
  /** Flag bit that announces the field. Speed uses bit 0 inverted, hence null. */
  bit: number | null
  feature: string | null
  value: (data: TreadmillData) => number | undefined
  digits: number
}

const READABLE: ReadableRow[] = [
  { label: 'Instantaneous speed', unit: 'km/h', bit: null, feature: null, value: (d) => d.speedKmh, digits: 2 },
  { label: 'Average speed', unit: 'km/h', bit: 1, feature: 'Average Speed', value: (d) => d.avgSpeedKmh, digits: 2 },
  { label: 'Total distance', unit: 'm', bit: 2, feature: 'Total Distance', value: (d) => d.distanceM, digits: 0 },
  { label: 'Incline', unit: '%', bit: 3, feature: 'Inclination', value: (d) => d.inclinePercent, digits: 1 },
  { label: 'Ramp angle', unit: '°', bit: 3, feature: 'Inclination', value: (d) => d.rampAngleDeg, digits: 1 },
  { label: 'Elevation gain up', unit: 'm', bit: 4, feature: 'Elevation Gain', value: (d) => d.elevationGainPosM, digits: 1 },
  { label: 'Elevation gain down', unit: 'm', bit: 4, feature: 'Elevation Gain', value: (d) => d.elevationGainNegM, digits: 1 },
  { label: 'Instantaneous pace', unit: 'km/min', bit: 5, feature: 'Pace', value: (d) => d.paceKmPerMin, digits: 1 },
  { label: 'Average pace', unit: 'km/min', bit: 6, feature: 'Pace', value: (d) => d.avgPaceKmPerMin, digits: 1 },
  { label: 'Total energy burned', unit: 'kcal', bit: 7, feature: 'Expended Energy', value: (d) => d.energyTotalKcal, digits: 0 },
  { label: 'Energy per hour', unit: 'kcal/h', bit: 7, feature: 'Expended Energy', value: (d) => d.energyPerHourKcal, digits: 0 },
  { label: 'Energy per minute', unit: 'kcal/min', bit: 7, feature: 'Expended Energy', value: (d) => d.energyPerMinKcal, digits: 0 },
  { label: 'Heart rate (hand pulse)', unit: 'bpm', bit: 8, feature: 'Heart Rate', value: (d) => d.heartRateBpm, digits: 0 },
  { label: 'Metabolic equivalent', unit: 'MET', bit: 9, feature: 'Metabolic Equivalent', value: (d) => d.metabolicEquivalent, digits: 1 },
  { label: 'Elapsed time', unit: 's', bit: 10, feature: 'Elapsed Time', value: (d) => d.elapsedSec, digits: 0 },
  { label: 'Remaining time', unit: 's', bit: 11, feature: 'Remaining Time', value: (d) => d.remainingSec, digits: 0 },
  { label: 'Force on belt', unit: 'N', bit: 12, feature: 'Force on Belt and Power Output', value: (d) => d.forceOnBeltN, digits: 0 },
  { label: 'Power output', unit: 'W', bit: 12, feature: 'Force on Belt and Power Output', value: (d) => d.powerW, digits: 0 },
]

type ControlRow = {
  op: string
  name: string
  what: string
  param: string
  /** Bit from Target Setting Features. null = mandatory op every Control Point must support. */
  target: string | null
}

const CONTROLS: ControlRow[] = [
  { op: '0x00', name: 'Request Control', what: 'takes control, must precede every other command', param: 'no parameter', target: null },
  { op: '0x01', name: 'Reset', what: 'resets the machine state', param: 'no parameter', target: null },
  { op: '0x02', name: 'Set Target Speed', what: 'sets the belt speed', param: 'uint16, 0.01 km/h', target: 'Speed Target' },
  { op: '0x03', name: 'Set Target Inclination', what: 'sets the incline', param: 'sint16, 0.1 %', target: 'Inclination Target' },
  { op: '0x04', name: 'Set Target Resistance', what: 'resistance, unused on a treadmill', param: 'uint8, 0.1', target: 'Resistance Target' },
  { op: '0x05', name: 'Set Target Power', what: 'target power', param: 'sint16, W', target: 'Power Target' },
  { op: '0x06', name: 'Set Target Heart Rate', what: 'target heart rate', param: 'uint8, bpm', target: 'Heart Rate Target' },
  { op: '0x07', name: 'Start or Resume', what: 'starts the belt', param: 'no parameter', target: null },
  { op: '0x08', name: 'Stop or Pause', what: 'stop or pause', param: 'uint8: 1 stop, 2 pause', target: null },
  { op: '0x09', name: 'Set Targeted Expended Energy', what: 'energy goal', param: 'uint16, kcal', target: 'Expended Energy Target' },
  { op: '0x0A', name: 'Set Targeted Number of Steps', what: 'step count goal', param: 'uint16', target: 'Step Number Target' },
  { op: '0x0B', name: 'Set Targeted Number of Strides', what: 'stride count goal', param: 'uint16', target: 'Stride Number Target' },
  { op: '0x0C', name: 'Set Targeted Distance', what: 'distance goal', param: 'uint24, m', target: 'Distance Target' },
  { op: '0x0D', name: 'Set Targeted Training Time', what: 'training time goal', param: 'uint16, s', target: 'Training Time Target' },
  { op: '0x13', name: 'Spin Down Control', what: 'calibration, unused on a treadmill', param: 'uint8', target: 'Spin Down Control' },
  { op: '0x14', name: 'Set Targeted Cadence', what: 'target cadence', param: 'uint16, 0.5 /min', target: 'Cadence Target' },
]

const OTHER_READS = [
  { uuid: UUID.machineFeature, label: 'Fitness Machine Feature', what: 'what the console can measure and what it allows setting' },
  { uuid: UUID.speedRange, label: 'Supported Speed Range', what: 'min, max and step of the speed' },
  { uuid: UUID.inclinationRange, label: 'Supported Inclination Range', what: 'min, max and step of the incline' },
  { uuid: UUID.machineStatus, label: 'Fitness Machine Status', what: 'notifications about machine state changes' },
  { uuid: UUID.trainingStatus, label: 'Training Status', what: 'training state, for example warm-up or pause' },
]

function Mark({ ok, unknown, yes, no }: { ok: boolean; unknown: boolean; yes: string; no: string }) {
  if (unknown) return <span className="no">-</span>
  return ok ? <span className="yes">{yes}</span> : <span className="no">{no}</span>
}

export function Capabilities({ info, dump, seenFlags, framesSeen, data }: Props) {
  const features = info?.features
  const ftms = dump?.find((service) => service.uuid === UUID.fitnessMachine)
  const controlPoint = ftms?.characteristics.find((characteristic) => characteristic.uuid === UUID.controlPoint)
  const knownCharacteristics = new Set(ftms?.characteristics.map((characteristic) => characteristic.uuid) ?? [])

  const arrived = (bit: number | null) => {
    if (framesSeen === 0) return false
    // Bit 0 is More Data and reads inverted: zero means the frame carries the speed.
    if (bit === null) return (seenFlags & 1) === 0
    return (seenFlags & (1 << bit)) !== 0
  }

  return (
    <>
      <div className="panel">
        <h2>What this is for</h2>
        <div className="hint">
          An overview of everything the FTMS protocol offers for a treadmill, and which of it your console reports as
          supported. The <b>console reports</b> column comes from characteristic 0x2ACC, the <b>actually arrived</b>{' '}
          column from the flags of the frames received since connecting. The two can differ, and the right one wins.
        </div>
      </div>

      <div className="panel">
        <h2>Readable values (Treadmill Data 0x2ACD)</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>value</th>
              <th style={{ width: '10%' }}>unit</th>
              <th style={{ width: '8%' }}>bit</th>
              <th style={{ width: '16%' }}>console reports</th>
              <th style={{ width: '16%' }}>actually arrived</th>
              <th>last value</th>
            </tr>
          </thead>
          <tbody>
            {READABLE.map((row) => {
              const value = data ? row.value(data) : undefined
              return (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="hex">{row.unit}</td>
                  <td className="mono hex">{row.bit === null ? '0 (inv)' : row.bit}</td>
                  <td>
                    {row.feature === null ? (
                      <span className="yes">mandatory</span>
                    ) : (
                      <Mark ok={features?.features.includes(row.feature) ?? false} unknown={!features} yes="yes" no="no" />
                    )}
                  </td>
                  <td>
                    <Mark ok={arrived(row.bit)} unknown={framesSeen === 0} yes="yes" no="no" />
                  </td>
                  <td className="mono">{value === undefined ? '-' : value.toFixed(row.digits)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Other readable characteristics</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: '28%' }}>characteristic</th>
              <th style={{ width: '10%' }}>uuid</th>
              <th style={{ width: '14%' }}>console has it</th>
              <th>what it is for</th>
            </tr>
          </thead>
          <tbody>
            {OTHER_READS.map((row) => (
              <tr key={row.uuid}>
                <td>{row.label}</td>
                <td className="mono hex">{row.uuid.slice(4, 8)}</td>
                <td>
                  <Mark ok={knownCharacteristics.has(row.uuid)} unknown={!dump} yes="yes" no="no" />
                </td>
                <td className="hint">{row.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Settable values (Control Point 0x2AD9)</h2>
        <div className="hint" style={{ marginBottom: 10 }}>
          The dashboard uses <b>Set Target Speed</b>, <b>Set Target Inclination</b>, <b>Start or Resume</b> and{' '}
          <b>Stop or Pause</b>. The rest of the table is an overview of what the protocol offers.
          {controlPoint ? (
            <>
              {' '}
              The console has a Control Point, properties <span className="mono">{controlPoint.properties.join(', ')}</span>.
            </>
          ) : dump ? (
            ' The console reports no Control Point, so remote control would not work.'
          ) : (
            ''
          )}
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: '8%' }}>op</th>
              <th style={{ width: '22%' }}>command</th>
              <th style={{ width: '16%' }}>parameter</th>
              <th style={{ width: '14%' }}>console allows</th>
              <th>what it does</th>
            </tr>
          </thead>
          <tbody>
            {CONTROLS.map((row) => (
              <tr key={row.op}>
                <td className="mono">{row.op}</td>
                <td>{row.name}</td>
                <td className="mono hex">{row.param}</td>
                <td>
                  {row.target === null ? (
                    <span className="yes">mandatory</span>
                  ) : (
                    <Mark ok={features?.targets.includes(row.target) ?? false} unknown={!features} yes="yes" no="no" />
                  )}
                </td>
                <td className="hint">
                  {row.what}
                  {row.op === '0x02' && info?.speedRange && (
                    <>
                      {' '}
                      <span className="mono">
                        ({info.speedRange.min.toFixed(1)} to {info.speedRange.max.toFixed(1)} km/h, step{' '}
                        {info.speedRange.step.toFixed(2)})
                      </span>
                    </>
                  )}
                  {row.op === '0x03' && info?.inclinationRange && (
                    <>
                      {' '}
                      <span className="mono">
                        ({info.inclinationRange.min.toFixed(1)} to {info.inclinationRange.max.toFixed(1)} %, step{' '}
                        {info.inclinationRange.step.toFixed(1)})
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
