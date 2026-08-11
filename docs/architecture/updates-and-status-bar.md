# Updates and the status bar

## Decision

The updater's progress is application state, not a log line. `src/main/update.ts` keeps one
`UpdateState` value, and the status bar along the bottom of the window draws it next to the running
version. Before this, `electron-updater` wrote to the console and the only visible sign of a new
build was the notification the operating system raised after the download had already finished.

The state is a discriminated union with seven cases, defined in `src/shared/update.ts`:

| kind | reached when |
| --- | --- |
| `disabled` | the app is not packaged, so no check runs at all |
| `checking` | a check is on its way to GitHub Releases |
| `current` | the feed offers nothing newer |
| `available` | a newer version exists; the download starts by itself |
| `downloading` | carries the percentage the updater reports |
| `downloaded` | the build is on disk and installs on quit |
| `failed` | carries the message, shown as a tooltip |

`describeUpdate()` turns a state into the bar's text and its colour, and throws on a kind it does not
know rather than leaving the previous label on screen. It is pure, so the wording is unit tested
without an updater.

## How the state travels

The main process holds it. Each `autoUpdater` event sets a new state, which is sent to every open
window rather than to one remembered window: the renderer can be reloaded, and macOS builds a second
window from the `activate` handler. Both then draw the current state without the updater being
re-wired.

The renderer pulls `update:get` on mount as well as subscribing to `update:state`. Without the pull,
a check that finished before the window mounted would leave the bar empty until the next event, which
in a healthy app never comes.

## What the buttons do

- **Restart and install** appears only in the `downloaded` state and calls `quitAndInstall()`.
- **Check now** repeats the check, because it otherwise runs once at startup and a long-running app
  would never notice a release. It is disabled while a check or download runs, and once a build is
  downloaded: checking again there would only throw the ready state away and download the same file
  a second time.

## Limits

Windows `Portable` and the unsigned macOS build cannot install an update over themselves, so they
never reach `downloaded`; for them the bar is a notice that a new version exists. Windows `Setup` and
the Linux packages complete the whole path. A build started from source stays at `disabled`, which
keeps development traffic away from the release feed.

## Entry points

- `src/shared/update.ts` owns the state type and the state-to-label mapping.
- `src/main/update.ts` subscribes to `autoUpdater`, holds the state, broadcasts it, and exposes the
  check and install actions.
- `src/main/index.ts` handles `app:version`, `update:get`, `update:check` and `update:install`.
- `src/preload/index.ts` exposes them, with `onUpdateState` following the `onDevices` pattern.
- `src/renderer/StatusBar.tsx` draws the bar; `src/renderer/App.tsx` mounts it below `main`.
