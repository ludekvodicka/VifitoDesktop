import { useCallback, useEffect, useRef, useState } from 'react'
import type { DaySummary, Sample, ScannedDevice } from '../preload/index'
import { dumpGatt, readMachineInfo, requestTreadmill, startNotifications, type MachineInfo, type ServiceDump } from './ble/connection'
import { mergeFrames, parseTreadmillData, type TreadmillData } from './ble/ftms'
import { Capabilities } from './Capabilities'
import { UUID } from './ble/uuids'

type Phase = 'idle' | 'scanning' | 'connecting' | 'connected'
type Tab = 'live' | 'diag' | 'caps'
type StatusLine = { t: number; label: string; hex: string }

const HISTORY_POINTS = 180
const FLUSH_MS = 5000
const RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY_MS = 2000

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A console running FitShow firmware advertises as FS-XXXXXX, which is the right entry here. */
const isLikelyTreadmill = (device: ScannedDevice) => /^fs-/i.test(device.deviceName ?? '')

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'NotFoundError') return 'No device was selected.'
  return message
}

function fmtNumber(value: number | undefined, digits: number): string {
  return value === undefined ? '-' : value.toFixed(digits)
}

function fmtDistance(meters: number | undefined): string {
  if (meters === undefined) return '-'
  return meters < 1000 ? `${Math.round(meters)}` : (meters / 1000).toFixed(2)
}

function fmtDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '-'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  )
}

function SpeedChart({ points, max }: { points: number[]; max: number }) {
  if (points.length < 2) return <div className="hint">The chart is drawn once the first samples arrive.</div>
  const step = 600 / (HISTORY_POINTS - 1)
  const path = points
    .map((value, index) => {
      const x = (index + (HISTORY_POINTS - points.length)) * step
      const y = 150 - (value / max) * 140
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="chart" viewBox="0 0 600 160" preserveAspectRatio="none">
      <line x1="0" y1="150" x2="600" y2="150" stroke="#2a2f3b" />
      <path d={path} fill="none" stroke="#4cc2ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [tab, setTab] = useState<Tab>('live')
  const [devices, setDevices] = useState<ScannedDevice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState<string>('')
  const [data, setData] = useState<TreadmillData | null>(null)
  const [history, setHistory] = useState<number[]>([])
  const [frames, setFrames] = useState<TreadmillData[]>([])
  const [statuses, setStatuses] = useState<StatusLine[]>([])
  const [dump, setDump] = useState<ServiceDump[] | null>(null)
  /** OR of every flag seen since connecting, tells which fields the console really sends. */
  const [seenFlags, setSeenFlags] = useState(0)
  const [framesSeen, setFramesSeen] = useState(0)
  const [info, setInfo] = useState<MachineInfo | null>(null)
  const [today, setToday] = useState<DaySummary | null>(null)

  const deviceRef = useRef<BluetoothDevice | null>(null)
  const stopRef = useRef<(() => Promise<void>) | null>(null)
  const manualRef = useRef(false)
  const bufferRef = useRef<Sample[]>([])
  /** Last merged state the tiles are built from. */
  const lastRef = useRef<TreadmillData | null>(null)

  const refreshToday = useCallback(async () => {
    setToday(await window.vifito.today())
  }, [])

  useEffect(() => {
    void refreshToday()
    return window.vifito.onDevices(setDevices)
  }, [refreshToday])

  useEffect(() => {
    const timer = setInterval(() => {
      const batch = bufferRef.current.splice(0, bufferRef.current.length)
      if (batch.length === 0) return
      void window.vifito.logSamples(batch).then(refreshToday)
    }, FLUSH_MS)
    return () => clearInterval(timer)
  }, [refreshToday])

  const onTreadmillData = useCallback((view: DataView) => {
    const parsed = parseTreadmillData(view)
    const merged = mergeFrames(lastRef.current, parsed)
    lastRef.current = merged
    setData(merged)
    setFrames((prev) => [parsed, ...prev].slice(0, 12))
    setSeenFlags((prev) => prev | parsed.flags)
    setFramesSeen((prev) => prev + 1)
    setHistory((points) => [...points, merged.speedKmh ?? 0].slice(-HISTORY_POINTS))
    bufferRef.current.push({
      t: Date.now(),
      speedKmh: merged.speedKmh,
      distanceM: merged.distanceM,
      inclinePercent: merged.inclinePercent,
      elapsedSec: merged.elapsedSec,
      energyTotalKcal: merged.energyTotalKcal,
      heartRateBpm: merged.heartRateBpm,
    })
  }, [])

  const onStatus = useCallback((label: string, hex: string) => {
    setStatuses((prev) => [{ t: Date.now(), label, hex }, ...prev].slice(0, 12))
  }, [])

  const attach = useCallback(
    async (device: BluetoothDevice) => {
      if (!device.gatt) throw new Error('The device has no GATT server.')
      const server = await device.gatt.connect()
      const services = await dumpGatt(server)
      setDump(services)
      if (!services.some((service) => service.uuid === UUID.fitnessMachine)) {
        setTab('diag')
        throw new Error(
          'The console does not advertise the Fitness Machine service (0x1826). Check Diagnostics for ' +
            'what it returns, and whether the vendor services 0xFFF0 or 0xFFE0 are there instead.',
        )
      }
      setInfo(await readMachineInfo(server))
      stopRef.current = await startNotifications(server, { onTreadmillData, onStatus })
      setPhase('connected')
    },
    [onStatus, onTreadmillData],
  )

  const onDisconnected = useCallback(async () => {
    stopRef.current = null
    if (manualRef.current) return
    setPhase('connecting')
    for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
      await delay(RECONNECT_DELAY_MS)
      const device = deviceRef.current
      if (manualRef.current || !device) return
      try {
        await attach(device)
        setError(null)
        return
      } catch {
        // the console is not back yet, try again
      }
    }
    setPhase('idle')
    setError('Could not restore the connection. Check that the console is on and no phone is holding it.')
  }, [attach])

  const connect = useCallback(async () => {
    setError(null)
    setDevices([])
    setPhase('scanning')
    manualRef.current = false
    lastRef.current = null
    setData(null)
    setHistory([])
    setFrames([])
    setSeenFlags(0)
    setFramesSeen(0)
    try {
      const device = await requestTreadmill()
      deviceRef.current = device
      setDeviceName(device.name ?? '(unnamed)')
      device.addEventListener('gattserverdisconnected', () => void onDisconnected())
      setPhase('connecting')
      await attach(device)
    } catch (err) {
      setPhase('idle')
      setError(describeError(err))
    }
  }, [attach, onDisconnected])

  const disconnect = useCallback(async () => {
    manualRef.current = true
    await stopRef.current?.()
    stopRef.current = null
    deviceRef.current?.gatt?.disconnect()
    setPhase('idle')
    const batch = bufferRef.current.splice(0, bufferRef.current.length)
    if (batch.length > 0) await window.vifito.logSamples(batch).then(refreshToday)
  }, [refreshToday])

  // stable sort, the likely treadmill goes up, the rest keeps the scan order
  const sortedDevices = [...devices].sort((a, b) => Number(isLikelyTreadmill(b)) - Number(isLikelyTreadmill(a)))
  const chartMax = Math.max(2, ...history)

  const dotClass = phase === 'connected' ? 'connected' : phase === 'idle' ? (error ? 'error' : '') : 'working'
  const statusText =
    phase === 'connected'
      ? `connected: ${deviceName}`
      : phase === 'scanning'
        ? 'scanning'
        : phase === 'connecting'
          ? 'connecting'
          : 'disconnected'

  return (
    <div className="app">
      <header>
        <h1>Vifito Rio 45 iR</h1>
        <div className="status">
          <span className={`dot ${dotClass}`} />
          {statusText}
        </div>
        <div className="spacer" />
        {today && (
          <div className="today">
            <span>
              today <b>{(today.distanceM / 1000).toFixed(2)}</b> km
            </span>
            <span>
              walking <b>{fmtDuration(today.movingSec)}</b>
            </span>
          </div>
        )}
        {phase === 'connected' ? (
          <button onClick={() => void disconnect()}>Disconnect</button>
        ) : (
          <button className="primary" onClick={() => void connect()} disabled={phase !== 'idle'}>
            Connect treadmill
          </button>
        )}
      </header>

      <nav>
        <button className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>
          Live data
        </button>
        <button className={tab === 'diag' ? 'active' : ''} onClick={() => setTab('diag')}>
          Diagnostics
        </button>
        <button className={tab === 'caps' ? 'active' : ''} onClick={() => setTab('caps')}>
          What can be read and set
        </button>
      </nav>

      <main>
        {error && <div className="error">{error}</div>}

        {phase === 'scanning' && (
          <div className="panel">
            <h2>Devices found</h2>
            <div className="hint" style={{ marginBottom: 10 }}>
              This treadmill console runs FitShow firmware and advertises as <b>FS-…</b>, so that entry is highlighted
              and sorted first. If it is missing, switch the console off and scan again: the device that disappears from
              the list is the treadmill.
            </div>
            <div className="devices">
              {devices.length === 0 && <div className="hint">Scanning. The console must be on and not held by a phone.</div>}
              {sortedDevices.map((device) => (
                <button
                  key={device.deviceId}
                  className={isLikelyTreadmill(device) ? 'likely' : ''}
                  onClick={() => window.vifito.pick(device.deviceId)}
                >
                  <span>
                    {device.deviceName || '(unnamed)'}
                    {isLikelyTreadmill(device) && <span className="badge">likely the treadmill</span>}
                  </span>
                  <span className="id mono">{device.deviceId.slice(0, 17)}</span>
                </button>
              ))}
              <button onClick={() => window.vifito.cancel()}>Cancel scan</button>
            </div>
          </div>
        )}

        {tab === 'live' && (
          <>
            <div className="tiles">
              <Tile label="Speed" value={fmtNumber(data?.speedKmh, 1)} unit="km/h" />
              <Tile label="Incline" value={fmtNumber(data?.inclinePercent, 1)} unit="%" />
              <Tile
                label="Distance"
                value={fmtDistance(data?.distanceM)}
                unit={data?.distanceM !== undefined && data.distanceM < 1000 ? 'm' : 'km'}
              />
              <Tile label="Time" value={fmtDuration(data?.elapsedSec)} />
              <Tile label="Calories" value={data?.energyTotalKcal === undefined ? '-' : String(data.energyTotalKcal)} unit="kcal" />
              <Tile label="Heart rate" value={data?.heartRateBpm ? String(data.heartRateBpm) : '-'} unit="bpm" />
            </div>

            <div className="panel">
              <h2 className="row">
                <span>Speed over time</span>
                {history.length > 1 && <span className="note">max {chartMax.toFixed(1)} km/h</span>}
              </h2>
              <SpeedChart points={history} max={chartMax} />
            </div>

            {data && (
              <div className="panel">
                <h2>Last frame</h2>
                <div className="mono hex">{data.hex}</div>
                {data.truncated && (
                  <div className="hint">
                    The flags promised more fields than the console sent. The parser skipped the rest.
                  </div>
                )}
              </div>
            )}

            {phase === 'idle' && !data && (
              <div className="panel">
                <h2>How to start</h2>
                <div className="hint">
                  Switch the treadmill console on, disconnect the mobile app (BLE holds a single connection) and click
                  Connect treadmill. This app only reads, it never writes to the treadmill, so it cannot start the belt
                  or change the incline.
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'diag' && (
          <>
            <div className="panel">
              <h2>Device</h2>
              <div className="hint">
                {deviceName || 'not connected yet'} {deviceRef.current?.id && <span className="mono">({deviceRef.current.id.slice(0, 17)})</span>}
              </div>
            </div>

            {info && (
              <div className="panel">
                <h2>Console capabilities (0x2ACC, 0x2AD4, 0x2AD5)</h2>
                <div style={{ marginBottom: 8 }}>
                  {info.features?.features.map((name) => (
                    <span className="pill" key={name}>
                      {name}
                    </span>
                  )) ?? <span className="hint">none</span>}
                </div>
                <div className="hint" style={{ marginBottom: 6 }}>
                  What the console would allow setting (information only, this app never writes):
                </div>
                <div style={{ marginBottom: 8 }}>
                  {info.features?.targets.length ? (
                    info.features.targets.map((name) => (
                      <span className="pill" key={name}>
                        {name}
                      </span>
                    ))
                  ) : (
                    <span className="hint">none, the console does not support remote control</span>
                  )}
                </div>
                {info.speedRange && (
                  <div className="hint">
                    Speed {info.speedRange.min.toFixed(1)} to {info.speedRange.max.toFixed(1)} km/h, step{' '}
                    {info.speedRange.step.toFixed(2)}
                  </div>
                )}
                {info.inclinationRange && (
                  <div className="hint">
                    Incline {info.inclinationRange.min.toFixed(1)} to {info.inclinationRange.max.toFixed(1)} %, step{' '}
                    {info.inclinationRange.step.toFixed(1)}
                  </div>
                )}
              </div>
            )}

            <div className="panel">
              <h2>GATT services and characteristics</h2>
              {!dump && <div className="hint">The dump is filled in after connecting.</div>}
              {dump?.map((service) => (
                <div key={service.uuid} style={{ marginBottom: 14 }}>
                  <div style={{ marginBottom: 4 }}>
                    <b>{service.name}</b> <span className="mono hex">{service.uuid}</span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '26%' }}>characteristic</th>
                        <th style={{ width: '16%' }}>properties</th>
                        <th>value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {service.characteristics.map((characteristic) => (
                        <tr key={characteristic.uuid + characteristic.name}>
                          <td>
                            {characteristic.name}
                            <div className="mono hex">{characteristic.uuid.slice(4, 8)}</div>
                          </td>
                          <td className="mono">{characteristic.properties.join(', ')}</td>
                          <td>
                            {characteristic.decoded && <div>{characteristic.decoded}</div>}
                            {characteristic.hex && <div className="mono hex">{characteristic.hex}</div>}
                            {characteristic.error && <div className="mono hex">{characteristic.error}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            <div className="panel">
              <h2>Last Treadmill Data frames (0x2ACD)</h2>
              <div className="frames">
                {frames.length === 0 && <div className="hint">Nothing has arrived yet.</div>}
                {frames.map((frame, index) => (
                  <div key={index} className="mono hex">
                    flags 0x{frame.flags.toString(16).padStart(4, '0')} | {frame.hex}
                    {frame.truncated && ' | TRUNCATED'}
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <h2>Status notifications (0x2ADA, 0x2AD3)</h2>
              <div className="frames">
                {statuses.length === 0 && <div className="hint">Nothing has arrived yet.</div>}
                {statuses.map((status, index) => (
                  <div key={index} className="mono hex">
                    {new Date(status.t).toLocaleTimeString()} | {status.label} | {status.hex}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'caps' && (
          <Capabilities info={info} dump={dump} seenFlags={seenFlags} framesSeen={framesSeen} data={data} />
        )}
      </main>
    </div>
  )
}
