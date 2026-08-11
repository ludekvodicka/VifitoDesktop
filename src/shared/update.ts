/**
 * What the main process knows about the GitHub Releases feed. The renderer only draws it, so every
 * state the updater can reach has to be one of these: a missing case would leave the status bar
 * showing the previous state forever.
 */
export type UpdateState =
  | { kind: 'disabled' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'failed'; message: string }

export type UpdateTone = 'muted' | 'working' | 'ready' | 'failed'

export type UpdateLabel = { text: string; tone: UpdateTone }

export function describeUpdate(state: UpdateState): UpdateLabel {
  if (state.kind === 'disabled') return { text: 'updates are off in a dev build', tone: 'muted' }
  else if (state.kind === 'checking') return { text: 'checking for updates', tone: 'working' }
  else if (state.kind === 'current') return { text: 'up to date', tone: 'muted' }
  else if (state.kind === 'available') return { text: `version ${state.version} available`, tone: 'ready' }
  else if (state.kind === 'downloading')
    return { text: `downloading ${state.version}, ${Math.round(state.percent)} %`, tone: 'working' }
  else if (state.kind === 'downloaded') return { text: `${state.version} ready`, tone: 'ready' }
  else if (state.kind === 'failed') return { text: 'update check failed', tone: 'failed' }
  else throw new Error(`Unknown update state: ${JSON.stringify(state)}`)
}
