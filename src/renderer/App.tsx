import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScannedDevice } from '../preload/index'
import type { DaySummary, Sample, StatsOverview } from '../shared/stats'
import {
  dumpGatt,
  openControl,
  readMachineInfo,
  requestTreadmill,
  startNotifications,
  type ControlChannel,
  type MachineInfo,
  type ServiceDump,
} from './ble/connection'
import {
  encodeSetIncline,
  encodeSetSpeed,
  encodeStart,
  quantize,
  type ControlCommand,
  type ControlResponse,
} from './ble/controlPoint'
import { mergeFrames, parseTreadmillData, type Range, type TreadmillData } from './ble/ftms'
import { Capabilities } from './Capabilities'
import { Settings } from './Settings'
import { DailyChart, Stats } from './Stats'
import { UUID } from './ble/uuids'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/settings'

type Phase = 'idle' | 'scanning' | 'connecting' | 'connected'
type Tab = 'live' | 'stats' | 'diag' | 'settings'
type StatusLine = { t: number; label: string; hex: string }

const HISTORY_POINTS = 180
const FLUSH_MS = 5000
const RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY_MS = 2000
/** A burst of clicks on +/- has to leave as one command, the Control Point takes one at a time. */
const COMMAND_DEBOUNCE_MS = 250
const SPEED_STEP = 0.5
const INCLINE_STEP = 0.5
/**
 * How long the reported speed has to disagree with what the app believes before the big button
 * flips. The console reports zero for a moment while it spins the belt up and keeps reporting
 * motion while it slows down, and a button that follows every frame would flicker through both.
 */
const BELT_STATE_SETTLE_MS = 2500
/**
 * How long the carry-over question waits for an answer. The samples keep buffering meanwhile, so
 * nothing is lost; after this the safe answer is assumed and the walk is logged from the connection
 * onwards.
 */
const CARRY_OVER_TIMEOUT_MS = 60_000

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

/** A preset the console cannot reach is shown but not clickable. */
function outOfRange(value: number, range: Range | undefined): boolean {
  return range !== undefined && (value < range.min || value > range.max)
}

function formatPreset(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const [dumpPath, setDumpPath] = useState<string | null>(null)
  /** What the console had already counted when this connection started, until the user answers. */
  const [carryOver, setCarryOver] = useState<{ elapsedSec: number; distanceM: number } | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const presets = settings.presets
  const [hasControlPoint, setHasControlPoint] = useState(false)
  const [controlMessage, setControlMessage] = useState<string | null>(null)
  /** null means the target follows what the console reports, until the user changes it. */
  const [targetSpeed, setTargetSpeed] = useState<number | null>(null)
  const [targetIncline, setTargetIncline] = useState<number | null>(null)
  /** Drives which of the two big buttons is shown, see the hysteresis effect below. */
  const [running, setRunning] = useState(false)

  const disagreeSinceRef = useRef<number | null>(null)
  const deviceRef = useRef<BluetoothDevice | null>(null)
  const stopRef = useRef<(() => Promise<void>) | null>(null)
  const controlRef = useRef<ControlChannel | null>(null)
  const speedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inclineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualRef = useRef(false)
  const bufferRef = useRef<Sample[]>([])
  /** Last merged state the tiles are built from. */
  const lastRef = useRef<TreadmillData | null>(null)
  // Mirrors of the two target states, so the sample callback can stamp them without being recreated.
  const targetSpeedRef = useRef<number | null>(null)
  const targetInclineRef = useRef<number | null>(null)
  const carryOverAskedRef = useRef(false)
  const carryOverPendingRef = useRef(false)
  const carryOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * `mine` credits the counters the console was already carrying to this walk; otherwise they become
   * the starting point. The answer is stamped on the first buffered sample, so it lives in the raw
   * log and a cache rebuild reaches the same result.
   */
  const answerCarryOver = useCallback((mine: boolean) => {
    if (carryOverTimerRef.current) clearTimeout(carryOverTimerRef.current)
    carryOverTimerRef.current = null
    carryOverPendingRef.current = false
    setCarryOver(null)
    const first = bufferRef.current[0]
    if (first && !mine) first.counterBaseline = true
  }, [])

  useEffect(() => {
    targetSpeedRef.current = targetSpeed
  }, [targetSpeed])

  useEffect(() => {
    targetInclineRef.current = targetIncline
  }, [targetIncline])

  const refreshToday = useCallback(async () => {
    setToday(await window.vifito.today())
    setStats(await window.vifito.getStats())
  }, [])

  useEffect(() => {
    void refreshToday()
    void window.vifito.getSettings().then(setSettings)
    return window.vifito.onDevices(setDevices)
  }, [refreshToday])

  useEffect(() => {
    const timer = setInterval(() => {
      // Hold everything back while the carry-over question is open: the answer belongs on the first
      // sample of the connection, and that sample must not be written before it is known.
      if (carryOverPendingRef.current) return
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
    // The console keeps counting with no computer attached, so the first frame of a connection can
    // arrive with a workout already in progress. Whose it is, only the user knows.
    if (!carryOverAskedRef.current && (merged.elapsedSec ?? 0) + (merged.distanceM ?? 0) > 0) {
      carryOverAskedRef.current = true
      carryOverPendingRef.current = true
      setCarryOver({ elapsedSec: merged.elapsedSec ?? 0, distanceM: merged.distanceM ?? 0 })
      carryOverTimerRef.current = setTimeout(() => answerCarryOver(false), CARRY_OVER_TIMEOUT_MS)
    }
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
      // Read from refs: this callback is created once, so the state values would be stale here.
      targetSpeedKmh: targetSpeedRef.current ?? undefined,
      targetInclinePercent: targetInclineRef.current ?? undefined,
    })
  }, [])

  const onStatus = useCallback((label: string, hex: string) => {
    setStatuses((prev) => [{ t: Date.now(), label, hex }, ...prev].slice(0, 12))
  }, [])

  // Frames decide whether the belt runs, but only once they have disagreed with the app long enough.
  // Our own start and stop set the state directly, so the button reacts to the click, not to the
  // console catching up.
  useEffect(() => {
    const speed = data?.speedKmh
    if (speed === undefined) return
    const observed = speed > 0
    if (observed === running) {
      disagreeSinceRef.current = null
      return
    }
    const now = Date.now()
    if (disagreeSinceRef.current === null) disagreeSinceRef.current = now
    else if (now - disagreeSinceRef.current >= BELT_STATE_SETTLE_MS) {
      disagreeSinceRef.current = null
      setRunning(observed)
    }
  }, [data, running])

  const setBeltState = useCallback((next: boolean) => {
    disagreeSinceRef.current = null
    setRunning(next)
  }, [])

  const clearPendingCommands = useCallback(() => {
    for (const timer of [speedTimerRef, inclineTimerRef]) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const runCommand = useCallback(async (command: ControlCommand): Promise<ControlResponse | null> => {
    const channel = controlRef.current
    if (!channel) return null
    try {
      const response = await channel.send(command)
      if (response) setControlMessage(response.message)
      return response
    } catch (err) {
      setControlMessage(describeError(err))
      return null
    }
  }, [])

  const schedule = useCallback(
    (timer: typeof speedTimerRef, build: () => ControlCommand) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        void runCommand(build())
      }, COMMAND_DEBOUNCE_MS)
    },
    [runCommand],
  )

  const stopBelt = useCallback(async () => {
    clearPendingCommands()
    setBeltState(false)
    setTargetSpeed(null)
    const channel = controlRef.current
    if (!channel) return
    try {
      const response = await channel.stop()
      if (response) setControlMessage(response.message)
    } catch (err) {
      setControlMessage(describeError(err))
    }
  }, [clearPendingCommands])

  const attach = useCallback(
    async (device: BluetoothDevice) => {
      if (!device.gatt) throw new Error('The device has no GATT server.')
      const server = await device.gatt.connect()
      const services = await dumpGatt(server)
      setDump(services)
      if (!services.some((service) => service.uuid === UUID.fitnessMachine)) {
        if (settings.showDiagnostics) setTab('diag')
        throw new Error(
          settings.showDiagnostics
            ? 'The console does not advertise the Fitness Machine service (0x1826). Check Diagnostics for what it returns, and whether the vendor services 0xFFF0 or 0xFFE0 are there instead.'
            : 'The console does not advertise the Fitness Machine service (0x1826). It may expose the vendor services 0xFFF0 or 0xFFE0 instead.',
        )
      }
      setInfo(await readMachineInfo(server))
      stopRef.current = await startNotifications(server, { onTreadmillData, onStatus })
      await controlRef.current?.close()
      controlRef.current = await openControl(server)
      setHasControlPoint(controlRef.current !== null)
      setPhase('connected')
    },
    [onStatus, onTreadmillData, settings.showDiagnostics],
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
    // A fresh connection asks about the standing counters again: the machine may have been used by
    // somebody else in the meantime.
    carryOverAskedRef.current = false
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
    clearPendingCommands()
    await stopRef.current?.()
    stopRef.current = null
    await controlRef.current?.close()
    controlRef.current = null
    setHasControlPoint(false)
    setBeltState(false)
    setTargetSpeed(null)
    setTargetIncline(null)
    setControlMessage(null)
    deviceRef.current?.gatt?.disconnect()
    setPhase('idle')
    const batch = bufferRef.current.splice(0, bufferRef.current.length)
    if (batch.length > 0) await window.vifito.logSamples(batch).then(refreshToday)
  }, [clearPendingCommands, refreshToday])

  // stable sort, the likely treadmill goes up, the rest keeps the scan order
  const sortedDevices = [...devices].sort((a, b) => Number(isLikelyTreadmill(b)) - Number(isLikelyTreadmill(a)))
  const chartMax = Math.max(2, ...history)

  const shownSpeed = targetSpeed ?? data?.speedKmh ?? info?.speedRange?.min ?? 0
  const shownIncline = targetIncline ?? data?.inclinePercent ?? info?.inclinationRange?.min ?? 0
  const lowestSpeed = quantize(info?.speedRange?.min ?? SPEED_STEP, info?.speedRange, SPEED_STEP)
  // Trust the reported speed when the console sends it. A console that never sends the field would
  // otherwise hide the stop button while the belt runs, so there the app's own start decides.
  // A console that reports no target is not necessarily unable to obey one; cheap consoles get their
  // capability flags wrong both ways. The buttons stay live and the console's own answer decides.
  const unannounced = (target: string) =>
    info?.features !== undefined && !info.features.targets.includes(target)

  const nudgeSpeed = (direction: number) => {
    const next = quantize(shownSpeed + direction * SPEED_STEP, info?.speedRange, SPEED_STEP)
    setTargetSpeed(next)
    schedule(speedTimerRef, () => encodeSetSpeed(next))
  }

  const nudgeIncline = (direction: number) => {
    const next = quantize(shownIncline + direction * INCLINE_STEP, info?.inclinationRange, INCLINE_STEP)
    setTargetIncline(next)
    schedule(inclineTimerRef, () => encodeSetIncline(next))
  }

  // A preset is one decision, so it goes out at once. The 250 ms wait exists for a run of clicks on
  // the steppers, and any such wait still pending would land after the preset and undo it.
  const applySpeed = (value: number) => {
    if (speedTimerRef.current) clearTimeout(speedTimerRef.current)
    speedTimerRef.current = null
    const next = quantize(value, info?.speedRange, SPEED_STEP)
    setTargetSpeed(next)
    void runCommand(encodeSetSpeed(next))
  }

  const applyIncline = (value: number) => {
    if (inclineTimerRef.current) clearTimeout(inclineTimerRef.current)
    inclineTimerRef.current = null
    const next = quantize(value, info?.inclinationRange, INCLINE_STEP)
    setTargetIncline(next)
    void runCommand(encodeSetIncline(next))
  }

  // The target speed goes first and the belt only starts once the console has accepted it. Starting
  // on a refused target would run the belt at whatever speed the console still had in mind.
  const saveDump = async () => {
    if (!dump) return
    try {
      setDumpPath(await window.vifito.saveGattDump({ savedAt: new Date().toISOString(), deviceName, services: dump }))
    } catch (err) {
      setDumpPath(describeError(err))
    }
  }

  const startBelt = async () => {
    setTargetSpeed(lowestSpeed)
    const accepted = await runCommand(encodeSetSpeed(lowestSpeed))
    if (!accepted?.ok) return
    const started = await runCommand(encodeStart())
    if (started?.ok) setBeltState(true)
  }

  const dotClass = phase === 'connected' ? 'connected' : phase === 'idle' ? (error ? 'failed' : '') : 'working'
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
        <h1>Vifito iR</h1>
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
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          Stats
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Settings
        </button>
        {settings.showDiagnostics && (
          <button
            className={tab === 'diag' ? 'diagnostics-tab active' : 'diagnostics-tab'}
            onClick={() => setTab('diag')}
          >
            Diagnostics
          </button>
        )}
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
            {carryOver && (
              <div className="panel carry-over">
                <h2>Already on the console</h2>
                <div className="hint" style={{ marginBottom: 12 }}>
                  The console was counting before this connection: <b>{fmtDuration(carryOver.elapsedSec)}</b> and{' '}
                  <b>{(carryOver.distanceM / 1000).toFixed(2)} km</b>. It keeps counting with no computer attached, so
                  this may be your own walk from earlier, or somebody else's. Nothing is written until you answer.
                </div>
                <div className="control-confirm">
                  <button className="primary" onClick={() => answerCarryOver(true)}>
                    That was me, count it
                  </button>
                  <button onClick={() => answerCarryOver(false)}>Start from zero</button>
                  <span className="control-note">Unanswered for a minute counts as starting from zero.</span>
                </div>
              </div>
            )}

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

            {phase === 'connected' && (
              <div className="panel">
                <h2 className="row">
                  <span>Control</span>
                  {controlMessage && <span className="note">{controlMessage}</span>}
                </h2>

                {!hasControlPoint ? (
                  <div className="hint">
                    The console exposes no Control Point (0x2AD9), so it cannot be driven from here. Speed and incline
                    stay on the console itself.
                  </div>
                ) : (
                  <>
                    <div className="control-split">
                      <div className="control-steppers">
                        <div className="control-row">
                          <span className="control-label">Speed</span>
                          <button onClick={() => nudgeSpeed(-1)}>−</button>
                          <span className="control-value">
                            {shownSpeed.toFixed(1)}
                            <span className="unit">km/h</span>
                          </span>
                          <button onClick={() => nudgeSpeed(1)}>+</button>
                          <span className="control-note">
                            steps of {SPEED_STEP}
                            {info?.speedRange
                              ? `, range ${info.speedRange.min.toFixed(1)} - ${info.speedRange.max.toFixed(1)}`
                              : ', range unknown'}
                            {unannounced('Speed Target') && ', not advertised by the console'}
                          </span>
                        </div>

                        <div className="control-row">
                          <span className="control-label">Incline</span>
                          <button onClick={() => nudgeIncline(-1)}>−</button>
                          <span className="control-value">
                            {shownIncline.toFixed(1)}
                            <span className="unit">%</span>
                          </span>
                          <button onClick={() => nudgeIncline(1)}>+</button>
                          <span className="control-note">
                            steps of {INCLINE_STEP}
                            {info?.inclinationRange
                              ? `, range ${info.inclinationRange.min.toFixed(1)} - ${info.inclinationRange.max.toFixed(1)}`
                              : ', range unknown'}
                            {unannounced('Inclination Target') && ', not advertised by the console'}
                          </span>
                        </div>
                      </div>

                      <div className="control-presets">
                        <div className="preset-row">
                          <div className="control-label">Speed presets</div>
                          {presets.speedsKmh.map((preset, index) => (
                            <button
                              key={`speed-${index}`}
                              disabled={outOfRange(preset, info?.speedRange)}
                              onClick={() => applySpeed(preset)}
                            >
                              {formatPreset(preset)}
                            </button>
                          ))}
                          <span className="control-note">km/h</span>
                        </div>

                        <div className="preset-row">
                          <div className="control-label">Incline presets</div>
                          {presets.inclinesPercent.map((preset, index) => (
                            <button
                              key={`incline-${index}`}
                              disabled={outOfRange(preset, info?.inclinationRange)}
                              onClick={() => applyIncline(preset)}
                            >
                              {formatPreset(preset)}
                            </button>
                          ))}
                          <span className="control-note">%</span>
                        </div>
                      </div>
                    </div>

                    {running ? (
                      <button className="big stop" onClick={() => void stopBelt()}>
                        STOP
                      </button>
                    ) : (
                      <button className="big primary" onClick={() => void startBelt()}>
                        START AT {lowestSpeed.toFixed(1)} KM/H
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="panel">
              <h2 className="row">
                <span>Last 14 days</span>
                <span className="note">km walked per day</span>
              </h2>
              <DailyChart stats={stats} weightKg={settings.profile.weightKg} />
            </div>

            <div className="panel">
              <h2 className="row">
                <span>Speed over time</span>
                {history.length > 1 && <span className="note">max {chartMax.toFixed(1)} km/h</span>}
              </h2>
              <SpeedChart points={history} max={chartMax} />
            </div>

            {phase === 'idle' && !data && (
              <div className="panel">
                <h2>How to start</h2>
                <div className="hint">
                  Switch the treadmill console on, disconnect the mobile app (BLE holds a single connection) and click
                  Connect treadmill. Once connected you can set speed and incline from here, and stop the belt. Whether
                  the console accepts any of that is up to its firmware, and it answers every command.
                </div>
              </div>
            )}
          </>
        )}

        {settings.showDiagnostics && tab === 'diag' && (
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
                  What the console says it allows setting:
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
              <h2 className="row">
                <span>GATT services and characteristics</span>
                <span className="note">
                  <button disabled={!dump} onClick={() => void saveDump()}>
                    Save dump
                  </button>
                </span>
              </h2>
              {!dump && <div className="hint">The dump is filled in after connecting.</div>}
              {dumpPath && <div className="hint mono">Saved to {dumpPath}</div>}
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

            <Capabilities info={info} dump={dump} seenFlags={seenFlags} framesSeen={framesSeen} data={data} />
          </>
        )}

        {tab === 'stats' && <Stats stats={stats} weightKg={settings.profile.weightKg} />}

        {tab === 'settings' && <Settings settings={settings} onSaved={setSettings} />}
      </main>
    </div>
  )
}
