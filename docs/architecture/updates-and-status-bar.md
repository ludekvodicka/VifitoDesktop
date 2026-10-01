# Updates and the status bar

## Decision

Updates come from two shared members under `shared/electron/`: `autoUpdate` (the updater logic for the main
process, preload and renderer) and `autoUpdateWidgets` (the indicator and the panel). Several Electron apps use the
same members, so the update behavior and its tests live in one place. Before this, Vifito had its own 60-line
updater with no periodic check, no portable or macOS handling and a second notification from the operating system.

The members are mounted from a shared source repository. A clone of this repository carries them as ordinary files,
so the public build needs nothing else; a newer version of the members arrives with the next commit of this app.

## Behavior

| Build | What happens |
| --- | --- |
| Started from source | "Updates off": no check runs, which keeps development traffic away from the release feed |
| Windows `Setup`, Linux AppImage or deb | first check 45 seconds after start, then every 2 hours; a new version downloads in the background; "Restart and install" applies it, otherwise it installs on the next normal quit |
| Windows `Portable`, unsigned macOS | check only; the panel shows the new version and opens its release page |
| A build without `app-update.yml` (a `--dir` build) | "Updates off: This build has no update feed." |

- A failed background check keeps what the bar showed before: being offline is not an update failure. A failed
  "Check now" or download shows "Update failed" with a retry.
- The panel shows the release notes of the new version as plain text and offers "View on GitHub". The main process
  composes the release page URL and opens only `https://github.com/...`.
- The operating system notification of `checkForUpdatesAndNotify` is gone; the status bar is the one signal.

## How the state travels

The main process holds the state and sends every change to every open window, not to one remembered window: the
renderer can be reloaded, and macOS builds a second window from the `activate` handler. The renderer subscribes
before it pulls the current state, so a check that finished before the window mounted still shows.

## Entry points

- `src/main/index.ts` creates `AutoUpdateMain` with the release page of this repository, starts it before the
  window opens and stops it on `will-quit`.
- `src/preload/index.ts` nests `AutoUpdateBridge.create(ipcRenderer)` as `window.vifito.autoUpdate`.
- `src/renderer/StatusBar.tsx` draws the version, the shared `AutoUpdateIndicator` and `AutoUpdatePanel`;
  `src/renderer/App.tsx` mounts it below `main`.
- `src/renderer/app.css` maps the app's colours onto the widgets' `--auto-update-*` custom properties.
- `shared/electron/autoUpdate/README.md` documents the members; their tests run in the shared source, so
  `tsconfig.json` excludes them here.
