# Settings and diagnostics

## Decision

The app persists one settings object instead of storing preset buttons through a separate API. The
object contains:

- `presets`: speed and incline button values
- `showDiagnostics`: whether the Diagnostics tab is available

`showDiagnostics` defaults to `true`. Reading an older `{ presets }` file or an invalid toggle value
also produces `true`, so the change is backward compatible.

## Resulting UI

The navigation keeps Live data and Settings on the left. Diagnostics is the last tab and aligns to
the right. When `showDiagnostics` is false, neither its navigation button nor its content renders.

Diagnostics contains the raw GATT data, recent treadmill frames, status notifications and the FTMS
capability inventory. Live data does not repeat the last raw frame.

## Entry points

- `src/shared/settings.ts` owns the settings type, defaults and input normalization.
- `src/main/settings.ts` reads and writes `data/settings.json`.
- `src/main/index.ts` and `src/preload/index.ts` expose whole-object `settings:get` and `settings:set`
  calls.
- `src/renderer/Settings.tsx` edits and saves the object.
- `src/renderer/App.tsx` controls tab visibility and renders the merged Diagnostics content.

Saving the whole object prevents one setting from overwriting another in the same JSON file. The
trade-off is that adding a setting requires updating the shared type and normalizer.
