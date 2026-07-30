import { useEffect, useState } from 'react'
import { normalizePresets } from '../shared/presets'
import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings } from '../shared/settings'

type Props = {
  settings: AppSettings
  onSaved: (settings: AppSettings) => void
}

type PresetDraft = { speedsKmh: string[]; inclinesPercent: string[] }
type ProfileDraft = { ageYears: string; sex: string; weightKg: string; heightCm: string }
type Draft = PresetDraft & { showDiagnostics: boolean; profile: ProfileDraft }

const toDraft = (settings: AppSettings): Draft => ({
  speedsKmh: settings.presets.speedsKmh.map(String),
  inclinesPercent: settings.presets.inclinesPercent.map(String),
  showDiagnostics: settings.showDiagnostics,
  profile: {
    ageYears: settings.profile.ageYears === null ? '' : String(settings.profile.ageYears),
    sex: settings.profile.sex ?? '',
    weightKg: settings.profile.weightKg === null ? '' : String(settings.profile.weightKg),
    heightCm: settings.profile.heightCm === null ? '' : String(settings.profile.heightCm),
  },
})

export function Settings({ settings, onSaved }: Props) {
  // Edits are held as text so a half-typed value like "1." survives until Save.
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings))
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => setDraft(toDraft(settings)), [settings])

  const edit = (row: keyof PresetDraft, index: number, value: string) => {
    setSaved(null)
    setDraft((previous) => {
      const values = [...previous[row]]
      values[index] = value
      return { ...previous, [row]: values }
    })
  }

  const editProfile = (field: keyof ProfileDraft, value: string) => {
    setSaved(null)
    setDraft((previous) => ({ ...previous, profile: { ...previous.profile, [field]: value } }))
  }

  const save = async () => {
    const stored = await window.vifito.saveSettings(
      normalizeSettings({
        presets: normalizePresets(draft),
        showDiagnostics: draft.showDiagnostics,
        profile: draft.profile,
      }),
    )
    onSaved(stored)
    setDraft(toDraft(stored))
    setSaved('Saved')
  }

  const reset = () => {
    setDraft(toDraft(DEFAULT_SETTINGS))
    setSaved(null)
  }

  const row = (label: string, key: keyof PresetDraft, unit: string, step: string) => (
    <div className="settings-row">
      <div className="preset-row">
        <div className="control-label">{label}</div>
        {draft[key].map((value, index) => (
          <input
            key={`${key}-${index}`}
            type="number"
            step={step}
            min="0"
            value={value}
            onChange={(event) => edit(key, index, event.target.value)}
          />
        ))}
        <span className="control-note">{unit}</span>
      </div>
    </div>
  )

  const field = (label: string, key: keyof ProfileDraft, unit: string, step: string) => (
    <label className="settings-field">
      <span>
        {label} {unit && <span className="control-note">({unit})</span>}
      </span>
      <input
        type="number"
        step={step}
        min="0"
        value={draft.profile[key]}
        onChange={(event) => editProfile(key, event.target.value)}
      />
    </label>
  )

  return (
    <div className="panel">
      <h2 className="row">
        <span>Settings</span>
        {saved && <span className="note">{saved}</span>}
      </h2>
      <div className="settings-heading">Preset buttons</div>
      <div className="hint" style={{ marginBottom: 12 }}>
        These values sit on the buttons in the Control panel and are sent to the treadmill as they are.
        A value the console cannot reach stays visible but greys out. Anything unusable falls back to
        its default when saved.
      </div>

      {row('Speed presets', 'speedsKmh', 'km/h', '0.5')}
      {row('Incline presets', 'inclinesPercent', '%', '0.5')}

      <div className="settings-heading">Profile</div>
      <div className="hint" style={{ marginBottom: 12 }}>
        Used to estimate the calories of a workout. The estimate is driven by your weight together with
        the speed, incline and time the console reports; age, sex and height are only stored. Leave a
        field empty and it stays unset. Without a weight the app shows whatever the console counted
        instead, and calories are an estimate either way.
      </div>
      <div className="settings-fields">
        {field('Weight', 'weightKg', 'kg', '0.5')}
        {field('Height', 'heightCm', 'cm', '1')}
        {field('Age', 'ageYears', 'years', '1')}
        <label className="settings-field">
          <span>Sex</span>
          <select value={draft.profile.sex} onChange={(event) => editProfile('sex', event.target.value)}>
            <option value="">not set</option>
            <option value="male">male</option>
            <option value="female">female</option>
          </select>
        </label>
      </div>

      <div className="settings-toggle-row">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={draft.showDiagnostics}
            onChange={(event) => {
              setSaved(null)
              setDraft((previous) => ({ ...previous, showDiagnostics: event.target.checked }))
            }}
          />
          <span>Show diagnostics</span>
        </label>
        <div className="hint">Show the Diagnostics tab with raw Bluetooth data and the FTMS capability inventory.</div>
      </div>

      <div className="settings-actions">
        <button className="primary" onClick={() => void save()}>
          Save
        </button>
        <button onClick={reset}>Reset to defaults</button>
        <span className="control-note">Reset fills all defaults, Save writes them.</span>
      </div>
    </div>
  )
}
