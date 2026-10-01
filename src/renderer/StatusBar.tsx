import { useEffect, useState } from 'react'
import { useAutoUpdate } from '../../shared/electron/autoUpdate/renderer/useAutoUpdate'
import { AutoUpdateIndicator } from '../../shared/electron/autoUpdateWidgets/autoUpdateIndicator'
import { AutoUpdatePanel } from '../../shared/electron/autoUpdateWidgets/autoUpdatePanel'

export function StatusBar() {
  const [version, setVersion] = useState('')
  const [updateOpen, setUpdateOpen] = useState(false)
  const update = useAutoUpdate(window.vifito.autoUpdate)

  useEffect(() => {
    void window.vifito.getVersion().then(setVersion)
  }, [])

  return (
    <footer className="statusbar">
      <span>Vifito Desktop {version}</span>
      <div className="spacer" />
      <AutoUpdateIndicator update={update} onOpen={() => setUpdateOpen(true)} />
      <AutoUpdatePanel update={update} open={updateOpen} onClose={() => setUpdateOpen(false)} />
    </footer>
  )
}
