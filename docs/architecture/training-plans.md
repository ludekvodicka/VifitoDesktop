# Training plans

## Behavior and decision

The Plans tab stores named, colored plans of timed phases. Each phase has a speed, an incline and a
duration, with an optional name. Play runs the saved plan. Only one run can be active; unsaved
drafts do not affect it. App owns drafts, expanded rows and the runner so switching tabs does not
lose edits or interrupt a run.

**Play authorizes one run.** It authorizes Set Target Speed followed by Set Target Inclination at
the first phase, each phase boundary, Retry after a failure, and Save changes when the running
phase's speed or incline changes. It also authorizes the final Stop. If the belt is stopped, Play
uses the existing lowest-speed-first Start path before sending phase targets. Control is taken
lazily through the existing serialized FTMS Control Point channel.

Outside that run, commands require a user action. Connecting, reconnecting, loading plans and app
startup send no control commands. STOP, End plan, a disconnect, a confirmed stationary belt and
closing the app end the run. No run is persisted or resumed on reconnect. End plan and closing the
app send no Stop and leave the last speed and incline in effect.

The run strip appears under the navigation on every tab. It shows the plan, current phase, phase
countdown, total remaining time, End plan and STOP. End plan is disabled while starting the belt;
STOP remains available. A failed phase adds Retry. The active phase is marked in blue independently
of the plan's chosen text color.

## State and constraints

The runner is a React-free factory with injected command and display callbacks. App creates it
once, and ref-backed callbacks provide current settings and console ranges.

| State | Meaning |
| --- | --- |
| `idle` | No run or result is displayed. |
| `starting` | Waiting for the lowest speed and Start to be accepted. |
| `running` | A phase is active, with a deadline in `phaseEndsAt`. |
| `held` | Slowdown has paused the timer, preserving `remainingMs`. |
| `failed` | A phase command failed or was refused; remaining time and the error are kept for Retry. |
| `finished` | The last phase ended; the medal is kept and the final Stop is requested. |
| `ended` | The run ended early, with an end reason and no medal. |

`starting`, `running`, `held` and `failed` count as active. Play cannot replace an active run or
start a plan with no phases. Dismissing a finished or ended result returns to `idle`.

| End reason | Trigger |
| --- | --- |
| `endPlan` | The user clicks End plan. |
| `stop` | The user clicks STOP. |
| `disconnected` | A manual disconnect or a lost Bluetooth connection. |
| `beltStopped` | Reported belt speed stays stationary through the existing 2.5-second hysteresis. |
| `startRefused` | The lowest-speed-first Start path does not succeed. |
| `phaseRemoved` | A saved plan no longer contains the active phase, or has no first phase after Start. |

Closing the renderer discards all run state rather than storing an app-exit reason. It sends no
shutdown command to the belt.

### Command batches and the start token

Each phase target batch has a token. After each awaited answer, the runner checks that the batch
is still current before sending the next target. `end()` invalidates the token and clears the
phase timer synchronously. App calls it before STOP or either disconnect path, and before clearing
Slowdown on a confirmed console stop. An old answer cannot revive an ended run.

`startBelt()` has a separate request token and returns a boolean. It sends the lowest supported
speed, waits for acceptance, checks the token, then sends Start and checks again. STOP and both
disconnect paths invalidate this token. A late lowest-speed acknowledgement therefore cannot queue
Start after STOP, and the runner never enters phase 1 after a cancelled or refused start.

The Control Point queue drops waiting commands when STOP or channel close increments its
generation. STOP needs no confirmation. A command already sent cannot be recalled. Each phase
entry clears pending manual stepper debounce timers and displays its quantized targets before
sending them.

### Timing, automatic Stop and medal

Each phase uses `performance.now()` and one timeout for its end. Held and failed states keep the
remaining time. Console elapsed time is not used because consoles reset it. `useNow` refreshes
countdown text without driving transitions. The Electron window sets `backgroundThrottling: false`
so minimizing it does not deliberately throttle the runner's timers.

When the last phase ends, the runner enters `finished` before calling App's existing `stopBelt()`.
That path's `end('stop')` then finds no active run and preserves the medal. The final Stop is the
last command authorized by this run. A refusal is still reported by the Control panel; the medal
records the plan finishing, not confirmation that the physical belt is stationary.

The medal shows the sum of the saved phase durations and the distance counted during the run. The
duration is not elapsed wall time including Slowdown holds. The first distance frame is a baseline;
later increments and console resets use the same shared counters as Stats. Distance includes
movement while starting, held or failed. If no distance frame arrives, distance is omitted. The
medal appears in the plan box and run strip until dismissed or replaced by another run, and is
never persisted.

### Editing during a run

Save changes affects the run only after persistence succeeds. A saved speed or incline change to
the running phase sends both phase targets immediately, provided the phase still has time left.
Changing a duration shifts the phase deadline by the difference, preserving time already spent.
If the new deadline has passed, the runner advances immediately. Name-only changes send nothing.
Later phases use the latest saved values when reached.

During `starting`, a save updates the first phase used after Start succeeds. During `held` or
`failed`, a save updates the plan and remaining time but sends nothing. Resuming a hold sends no
phase targets; Retry sends the latest targets if time remains, otherwise it advances. Removing the
active phase through an older draft ends the run without stopping the belt. The active row's remove
button and the active plan's delete button are disabled.

### Slowdown and manual changes

A manual speed or incline choice lasts until the next phase sends its targets. Slowdown holds the
timer on request, before its acknowledgement, so a phase transition cannot race that request. A
refused slowdown or an accepted restore continues the timer. A refused restore leaves it held.
Choosing a manual speed clears Slowdown and continues the timer; changing incline preserves the
hold. See [Temporary slowdown](temporary-slowdown.md#during-a-plan-run).

### Maximum incline

`maxInclinePercent` is an optional setting from 0 to 30%, rounded to 0.1%. Empty means `null`, with
no additional cap. App derives one incline range with `limitInclineRange`, flooring the maximum to
the console grid before quantization. For example, a cap of 12.3% on a 0.5% grid allows 12%.

Steppers, presets, phase targets and editor warnings use this range. Presets above it are disabled;
phases above it remain saveable and show the value they will actually send. Lowering the setting
sends nothing and applies to subsequent incline commands.

When the console minimum is above the configured maximum, no incline is sent, the Live data
incline controls are disabled, and connected plan phases show a warning.
Plans then change speed only, including on Save and Retry, without changing the displayed incline
target or failing because incline was skipped.

### Persistence

Main owns `data/plans.json`, separate from `settings.json`, under the existing data directory for
the installed or source build. The file contains `{ version: 1, plans: [...] }`. Plan and phase ids
survive normalization; colors are one of eight named keys, with unknown colors falling back to
blue. Numeric fields are normalized before storage.

The store serializes reads and per-plan changes. A save writes `plans.json.tmp`, then atomically
renames it over `plans.json`; the cached list changes only after the rename succeeds. A failed
write or rename leaves the previous list intact. A leftover temporary file is not loaded on startup.

Malformed JSON or an invalid top-level structure is renamed to `plans.corrupt-<stamp>.json` before
the store starts an empty list. `PlansSnapshot.recoveredFrom` keeps the quarantine path for the
recovery notice, including after later saves in that process. A missing file starts empty; other
read errors and failed quarantine renames propagate instead of silently replacing plans. The
quarantine preserves the source bytes for recovery; it does not reconstruct the damaged plans.

## Entry points

- `src/shared/plans.ts`: plan model, colors, limits and normalization.
- `src/shared/counters.ts`: distance baseline and increments shared with Stats.
- `src/main/plans-store.ts`: serialized persistence, atomic replacement and quarantine.
- `src/main/index.ts`, `src/preload/index.ts`: `plans:list`, `plans:upsert`, `plans:remove` and the
  `getPlans`, `savePlan`, `deletePlan` renderer API; the window setting lives in main.
- `src/renderer/plans/planRunner.ts`: run states, tokens, timing, editing and completion.
- `src/renderer/plans/runView.ts`, `useNow.ts`, `planDraft.ts`, `usePlans.ts`: view data, countdowns,
  draft validation and App-owned plan editing state.
- `src/renderer/Plans.tsx`, `RunStrip.tsx`, `PlanMedal.tsx`: editor, controls and result display.
- `src/renderer/App.tsx`: command callbacks, Start token, end conditions, Slowdown and capped range.
- `src/shared/settings.ts`, `src/renderer/Settings.tsx`: maximum incline normalization and editing.
- `src/renderer/ble/controlPoint.ts`, `connection.ts`: target quantization, encoding and the
  serialized command queue.

## Trade-offs

- Console-button changes may be invisible as target changes. The runner does not restore its
  targets continuously; the next phase sends its own values. A confirmed stationary belt ends it.
- End plan and closing the app leave the last targets in effect. Stopping the belt requires STOP
  or the console controls; app closure has no confirmation or automatic Stop.
- A console refusing incline fails the phase even if it accepted speed. The timer stops with an
  error and Retry; no speed-only fallback is assumed, and the belt may keep moving.
- Renderer timers allow testing the runner without React and keep execution local. Disabling
  background throttling does not prove physical timing or operation during computer sleep.
- Atomic replacement protects the previous file during a failed save. Quarantine preserves corrupt
  input, but recovery is manual and the replacement list starts empty.

## Verification

On 2026-10-01, `pnpm run check` passed release metadata, the third-party inventory (21 runtime
packages), TypeScript, all 349 tests in 15 files, and the Electron build. The built renderer passed
all 16 browser scenarios below through its real App, plan runner and serialized FTMS command
channel. Web Bluetooth and IPC were simulated. No product defect or source change was required.

Each scenario asserted its entire ordered command list, including refused commands. In this table,
`S(v)` means Set Target Speed in km/h, `I(v)` means Set Target Inclination in percent, `Start` is
`[7]`, and `Stop` is `[8,1]`. Speed is `[2,lo,hi]` with the little-endian integer `v * 100`;
incline is `[3,lo,hi]` with `v * 10`. Thus `S(3.5)` is `[2,94,1]` and `I(12)` is `[3,120,0]`.
An empty list means no Control Point write, including no Request Control.

| # | Scenario and result | Exact ordered command list |
| --- | --- | --- |
| 1 | PASS: connect and open Plans send nothing. | `[]` |
| 2 | PASS: Play on a running belt marks the active row; the strip and STOP appear on all five tabs. | `S(2), I(1)` |
| 3 | PASS: the next phase starts on time and total remaining falls. | `S(2), I(1), S(3), I(2)` |
| 4 | PASS: final Stop, both medals show 0:10 and 17 m, Close dismisses both, and Play replaces a later medal. | `S(2), I(1), S(3), I(2), Stop, S(1), Start, S(2), I(1), S(3), I(2), Stop, S(1), Start, S(2), I(1)` |
| 5 | PASS: Play on a stopped belt uses the lowest speed, Start, then phase 1. | `S(1), Start, S(2), I(1)` |
| 6 | PASS: strip STOP during an 800 ms phase-speed ACK delay sends nothing after Stop. | `S(2), I(1), S(3), Stop` |
| 7 | PASS: strip STOP during an 800 ms lowest-speed ACK delay prevents Start. | `S(1), Stop` |
| 8 | PASS: End plan sends nothing more and enables Play again. | `S(2), I(1)` |
| 9 | PASS: both lost-connection and manual disconnect/reconnect end the run; neither reconnect sends anything. A new Play separates the two runs. | `S(2), I(1), S(2), I(1)` |
| 10 | PASS: speed 0 first preserves the run during hysteresis, then ends it as `beltStopped` after more than 2.5 s. | `S(2), I(1)` |
| 11 | PASS: Slowdown freezes the countdown, resume continues it, and refused Slowdown keeps it running. The final `S(1)` was refused. | `S(2), I(1), S(1), S(2), S(1)` |
| 12 | PASS: manual preset lasts until the phase boundary; a stepper click 100 ms before that boundary is dropped. | `S(2), I(1), S(4), S(3), I(2)` |
| 13 | PASS: refused incline pauses with Retry; Retry resends both targets; End plan cancels further commands. The first `I(1)` was refused. | `S(2), I(1), S(2), I(1)` |
| 14 | PASS: Save sends changed active targets, shortening an elapsed phase advances immediately, and saving a stale draft without the new active phase ends the run. | `S(2), I(1), S(3.5), I(4), S(3), I(2), S(2.5), I(0)` |
| 15 | PASS: maximum 12 holds the stepper at 12, disables 14/15 presets, and makes a 14% phase warn and send 12. A second plus click at the limit sends 12 again. | `I(12), I(12), S(2), I(12)` |
| 16 | PASS: Settings save and a fresh renderer load retain `maxInclinePercent: 12`; both send nothing. | `[]` |

The browser phase boundary measured 5,001 ms for a five-second phase. The timing assertion allowed
500 ms of scheduling tolerance. STOP, End plan, reconnect, console stop, Retry followed by End plan,
and stale-draft removal were also observed beyond the cancelled phase's original deadline.
Scenario 16 retained settings in the IPC mock's browser storage across a full page load; it verifies
renderer wiring, not a physical console or an Electron disk write. Plan-file persistence is covered
by the plans-store unit tests. A transient harness failure in scenario 13 was fixed by waiting for the strip to mount;
the product behavior and expected command list were unchanged.

### Minimized Electron window

One `pnpm dev` Electron window was tested with the same pasted Bluetooth mock and in-memory IPC
handlers. The real window was minimized before connecting and playing and remained minimized
through the check. The five-second phase changed at 5,002 ms, with exactly
`S(2), I(1), S(3), I(2)`, and the countdown fell. The main-process window configuration retains
`backgroundThrottling: false`. This checks renderer timing while minimized, not timing during
computer sleep or a real console's response. The test Electron process was closed afterward.

### Screenshots and limits

The running and finished states were captured at 1280 x 1024 with simulated data and visually
checked. [The running screenshot](../screenshot-plans.png) is embedded under Training plans in the
README. The local captures are `.aidocs/screenshots/plans-running-1280x1024.png` and
`.aidocs/screenshots/plans-medal-1280x1024.png`; the latter uses a short 15-second demonstration run.

**The physical belt was not tested in this session.** Run this checklist on the treadmill:

1. Play from a stopped belt starts at the lowest speed, then phase 1.
2. Phases change on time, also with the window minimized.
3. The incline never passes the maximum.
4. STOP in the run strip stops at once, also during a phase change.
5. The console's stop button and safety key end the run; nothing is sent afterwards.
6. The last phase stops the belt; the medal distance is close to the console's distance for the run.
7. Switching the console off mid-run ends the run; after the reconnect nothing is sent.
