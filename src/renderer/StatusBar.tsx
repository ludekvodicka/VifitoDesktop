import { useEffect, useState } from 'react'
import { describeUpdate, type UpdateState, type UpdateTone } from '../shared/update'

/** The bar reuses the header dot, so the tone only has to pick one of its existing colours. */
function dotClass(tone: UpdateTone): string {
  if (tone === 'muted') return 'dot'
  else if (tone === 'working') return 'dot working'
  else if (tone === 'ready') return 'dot connected'
  else if (tone === 'failed') return 'dot failed'
  else throw new Error(`Unknown update tone: ${tone}`)
}

export function StatusBar() {
  const [version, setVersion] = useState('')
  const [state, setState] = useState<UpdateState>({ kind: 'disabled' })

  // The pull matters as much as the subscription: the check can finish before this mounts, and the
  // event it sent then is gone.
  useEffect(() => {
    void window.vifito.getVersion().then(setVersion)
    void window.vifito.getUpdateState().then(setState)
    return window.vifito.onUpdateState(setState)
  }, [])

  const label = describeUpdate(state)
  // Checking again while one runs, or once a build is already downloaded, would only throw the
  // ready state away and start the same download over.
  const canCheck = state.kind === 'current' || state.kind === 'available' || state.kind === 'failed'

  return (
    <footer className="statusbar">
      <span>Vifito Desktop {version}</span>
      <div className="spacer" />
      <span className={dotClass(label.tone)} />
      <span title={state.kind === 'failed' ? state.message : undefined}>{label.text}</span>
      {state.kind === 'downloaded' && (
        <button className="primary" onClick={() => void window.vifito.installUpdate()}>
          Restart and install
        </button>
      )}
      <button disabled={!canCheck} onClick={() => void window.vifito.checkForUpdate()}>
        Check now
      </button>
    </footer>
  )
}
