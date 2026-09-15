# Temporary slowdown

## Behavior and decision

While the belt runs, Slowdown appears beside STOP. A click sends a target speed of exactly 1 km/h
and remembers the previous displayed target, falling back to reported speed when no target was set.
After the console accepts the command, the button shows a pause icon and the saved resume speed.
A second click restores that speed through Set Target Speed. Incline is unchanged.

This uses speed control because the belt must keep moving at 1 km/h. The FTMS pause command stops
the belt and therefore does not implement this behavior. No start command is sent by Slowdown.

## State and constraints

- Resume speed is local renderer state and is never persisted or restored automatically.
- Slowdown is disabled at or below 1 km/h and when the advertised speed grid cannot represent 1.
- While awaiting a response, Slowdown and the speed controls are disabled. STOP stays available.
- A refusal or communication failure leaves the previous target and resume state unchanged so the
  user can retry. The existing Control message shows the error.
- STOP, a confirmed stationary belt, manual speed selection, and either kind of disconnect clear
  the saved speed. Changing incline preserves it.
- Pending speed stepper clicks are cancelled before toggling. Commands already submitted use the
  existing serialized Control Point queue, whose STOP cancels commands still waiting to be sent.
- Each toggle has a request token. Clearing slowdown invalidates the token, preventing a late
  response from reinstating state after STOP or disconnect. A command already sent cannot be recalled.

## Entry points

- `src/renderer/App.tsx`: toggle state, acknowledgement handling, cancellation and the buttons.
- `src/renderer/app.css`: the two-button row and the active pause indicator.
- `src/renderer/ble/connection.ts`: existing serialized command channel and priority STOP.
- `src/renderer/ble/controlPoint.ts`: existing target-speed encoding and speed-grid validation.

## Trade-offs

The saved speed follows the value displayed by the existing speed controls. If the app has already
set a target while the belt is accelerating, the saved value is that target, not a transient measured
speed. The app cannot infer console-button changes that are not exposed as target notifications.

## Verification

On 2026-09-15, `pnpm run check` passed release metadata, third-party inventory, TypeScript, all
101 existing tests and the Electron build. A browser run of the built renderer with simulated Web
Bluetooth and IPC passed 12 scenarios through the actual FTMS command channel: round-trip speed
restoration, repeated toggles, incline preservation, manual speed overrides, double-click suppression,
refusals, timeout, STOP and disconnect races, console stop, unsupported speed range and reconnect.
Both button states were visually checked at the desktop window size. Physical belt behavior was not
tested in this session.
