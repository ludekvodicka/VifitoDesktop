import { useState } from 'react'
import { PLAN_COLORS, PLAN_LIMITS, phaseLabel, planDurationSec, type Plan, type PlanColor, type PlanPhase } from '../shared/plans'
import { fmtDuration } from './format'
import { PlanMedal } from './PlanMedal'
import { newPhase, phaseWarnings, readDraft, type PhaseDraft } from './plans/planDraft'
import { isRunActive, type PhaseTargets, type PlanRunState } from './plans/planRunner'
import { describeEnd, describeRun } from './plans/runView'
import { useNow } from './plans/useNow'
import type { PlansModel } from './plans/usePlans'

type Props = {
  model: PlansModel
  run: PlanRunState
  canPlay: boolean
  playDisabledReason: string | null
  targetsFor: ((phase: PlanPhase) => PhaseTargets) | null
  maxInclinePercent: number | null
  onPlay: (plan: Plan) => void
  onEndPlan: () => void
  onRetry: () => void
  onSave: (planId: string) => Promise<void>
  onDismiss: () => void
}

function Swatches({ color, onChange }: { color: PlanColor; onChange: (color: PlanColor) => void }) {
  return (
    <div className="swatches" role="group" aria-label="Plan color">
      {Object.entries(PLAN_COLORS).map(([key, hex]) => (
        <button
          key={key}
          type="button"
          className="swatch"
          style={{ backgroundColor: hex }}
          aria-label={key}
          aria-pressed={color === key}
          title={key}
          onClick={() => onChange(key as PlanColor)}
        />
      ))}
    </div>
  )
}

export function Plans(props: Props) {
  const { model } = props
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<PlanColor>('blue')

  const create = async () => {
    const plan = await model.create(name, color)
    if (!plan) return
    setCreating(false)
    setName('')
    setColor('blue')
  }

  return (
    <div className="plans">
      {model.recoveredFrom && (
        <div className="panel carry-over plan-notice" role="status">
          <span>Plans could not be read. The original file was kept as <b>{model.recoveredFrom}</b>.</span>
          <button aria-label="Dismiss recovery notice" onClick={model.dismissRecovery}>×</button>
        </div>
      )}
      {model.error && <div className="error" role="alert">{model.error}</div>}
      <button disabled={model.loading || creating} onClick={() => setCreating(true)}>New plan</button>
      {creating && (
        <form className="panel plan-new" onSubmit={(event) => { event.preventDefault(); void create() }}>
          <fieldset disabled={model.creating}>
            <label className="settings-field plan-title-field">
              <span>Plan name</span>
              <input autoFocus required maxLength={PLAN_LIMITS.nameLength} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <Swatches color={color} onChange={setColor} />
            <div className="plan-actions">
              <button className="primary" type="submit" disabled={name.trim() === ''}>Create</button>
              <button type="button" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}
      {model.loading && <p className="hint">Loading plans...</p>}
      {!model.loading && model.plans.length === 0 && <p className="hint">Create a plan, then add its phases.</p>}
      {model.plans.map((plan) => <PlanBox key={plan.id} {...props} plan={plan} />)}
    </div>
  )
}

function PlanBox({ plan, model, run, canPlay, playDisabledReason, targetsFor, maxInclinePercent,
  onPlay, onEndPlan, onRetry, onSave, onDismiss }: Props & { plan: Plan }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const draft = model.draftOf(plan.id)
  const dirty = model.isDirty(plan.id)
  const checked = readDraft(draft, plan.id)
  const expanded = model.expanded.has(plan.id)
  const pending = model.pending.has(plan.id)
  const error = model.errorOf(plan.id)
  const mine = run.kind !== 'idle' && run.plan.id === plan.id
  const live = mine && isRunActive(run) ? run : null
  const now = useNow(live?.kind === 'running')
  const view = live ? describeRun(live, now) : null
  const playHint = !canPlay ? playDisabledReason : pending ? 'A change to this plan is being saved.'
    : plan.phases.length === 0 ? 'Add and save a phase before playing.' : null

  const editPhase = (id: string, field: keyof Omit<PhaseDraft, 'id'>, value: string) => model.edit(plan.id, (previous) => ({
    ...previous,
    phases: previous.phases.map((phase) => phase.id === id ? { ...phase, [field]: value } : phase),
  }))

  const remove = async () => {
    if (live || pending) return
    if (mine && (run.kind === 'finished' || run.kind === 'ended')) onDismiss()
    await model.remove(plan.id)
    setConfirmDelete(false)
  }

  return (
    <section className="panel plan" aria-label={plan.name}>
      <div className="plan-head">
        {live ? (
          <button disabled={live.kind === 'starting'} onClick={onEndPlan}>End plan</button>
        ) : (
          <button
            className="play"
            aria-label={`Play ${plan.name}`}
            title={playHint ?? 'Play the saved plan'}
            disabled={!canPlay || plan.phases.length === 0 || pending}
            onClick={() => { model.expand(plan.id); onPlay(plan) }}
          >
            <svg className="play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
          </button>
        )}
        <span className="plan-name" style={{ color: PLAN_COLORS[plan.color] }}>{plan.name}</span>
        {dirty && (
          <>
            <button className="primary" disabled={!checked.ok || pending} onClick={() => void onSave(plan.id)}>
              Save changes
            </button>
            <button disabled={pending} onClick={() => model.discard(plan.id)}>Discard</button>
          </>
        )}
        <span className="control-note">
          {view ? `${view.phaseNumber}/${view.phaseCount}, ${fmtDuration(view.totalRemainingSec)} left`
            : `${plan.phases.length} ${plan.phases.length === 1 ? 'phase' : 'phases'}, ${fmtDuration(planDurationSec(plan))}`}
        </span>
        <button className="chevron" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${plan.name}`}
          aria-expanded={expanded} aria-controls={`plan-${plan.id}`} onClick={() => model.toggle(plan.id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      {!live && playHint && <div className="hint plan-note">{playHint}</div>}
      {live && live.kind !== 'running' && live.kind !== 'failed' && <div className="hint plan-note">{view?.status}</div>}
      {mine && run.kind === 'finished' && <PlanMedal result={run} onClose={onDismiss} />}
      {mine && run.kind === 'ended' && (
        <div className="hint plan-notice" role="status">
          <span>{describeEnd(run.reason)}</span><button aria-label="Close" onClick={onDismiss}>×</button>
        </div>
      )}
      {live?.kind === 'failed' && (
        <div className="plan-warning plan-notice" role="alert"><span>{live.message}</span><button onClick={onRetry}>Retry</button></div>
      )}
      {expanded && (
        <div className="plan-editor" id={`plan-${plan.id}`}>
          <label className="settings-field plan-title-field">
            <span>Plan name</span>
            <input maxLength={PLAN_LIMITS.nameLength} value={draft.name}
              onChange={(event) => model.edit(plan.id, (previous) => ({ ...previous, name: event.target.value }))} />
          </label>
          <Swatches color={draft.color} onChange={(color) => model.edit(plan.id, (previous) => ({ ...previous, color }))} />
          <div className="plan-actions">
            <button aria-label="Add phase" onClick={() => model.edit(plan.id, (previous) => ({
              ...previous, phases: [...previous.phases, newPhase(previous.phases.at(-1))],
            }))}>+</button>
            {dirty && <span className="hint">Play runs the saved version until you save.</span>}
          </div>
          {draft.phases.map((phase, index) => {
            const active = live !== null && live.kind !== 'starting' && live.phaseId === phase.id
            const label = phaseLabel(phase.name.trim(), index)
            const numberInput = (field: 'speedKmh' | 'inclinePercent' | 'minutes' | 'seconds', unit: string, min: number, max: number, step: number) => (
              <label className="plan-phase-field">
                <input type="number" aria-label={`${label} ${unit}`} value={phase[field]} min={min} max={max} step={step}
                  onChange={(event) => editPhase(phase.id, field, event.target.value)} />
                <span className="control-note">{unit}</span>
              </label>
            )
            return (
              <div key={phase.id} className={`settings-row plan-phase${active ? ' active' : ''}`}>
                <input className="plan-phase-name" aria-label={`Phase ${index + 1} name`} maxLength={PLAN_LIMITS.phaseNameLength}
                  value={phase.name} placeholder={phaseLabel('', index)} onChange={(event) => editPhase(phase.id, 'name', event.target.value)} />
                {numberInput('speedKmh', 'km/h', PLAN_LIMITS.speedKmh.min, PLAN_LIMITS.speedKmh.max, 0.1)}
                {numberInput('inclinePercent', '%', PLAN_LIMITS.inclinePercent.min, PLAN_LIMITS.inclinePercent.max, 0.1)}
                {numberInput('minutes', 'min', 0, 99, 1)}
                {numberInput('seconds', 's', 0, 59, 1)}
                {active && view && <span className="countdown" aria-label="Phase time left">{fmtDuration(view.phaseRemainingSec)}</span>}
                <button disabled={active} aria-label={`Delete phase ${index + 1}`} onClick={() => model.edit(plan.id, (previous) => ({
                  ...previous, phases: previous.phases.filter((entry) => entry.id !== phase.id),
                }))}>×</button>
                {phaseWarnings(phase, targetsFor, maxInclinePercent).map((text) => (
                  <div key={text} className="plan-warning">{text}</div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {!checked.ok && (
        <ul className="plan-problems" aria-label="Plan problems">
          {checked.problems.map((problem) => <li key={`${problem.phaseId}:${problem.message}`}>{problem.message}</li>)}
        </ul>
      )}
      {error && <div className="error plan-note" role="alert">{error}</div>}
      {expanded && (
        <div className="plan-actions">
          {confirmDelete ? (
            <div className="control-confirm">
              <span>Delete this plan?</span>
              <button disabled={live !== null || pending} onClick={() => void remove()}>Yes, delete</button>
              <button disabled={pending} onClick={() => setConfirmDelete(false)}>No</button>
            </div>
          ) : (
            <button disabled={live !== null || pending} onClick={() => setConfirmDelete(true)}>Delete plan</button>
          )}
        </div>
      )}
    </section>
  )
}
