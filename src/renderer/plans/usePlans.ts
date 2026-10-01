import { useEffect, useRef, useState } from 'react'
import type { Plan, PlanColor } from '../../shared/plans'
import { isDirty, readDraft, toDraft, type PlanDraft } from './planDraft'

export type PlansModel = {
  plans: Plan[]
  loading: boolean
  creating: boolean
  recoveredFrom: string | null
  dismissRecovery: () => void
  error: string | null
  errorOf: (id: string) => string | null
  pending: ReadonlySet<string>
  expanded: ReadonlySet<string>
  draftOf: (id: string) => PlanDraft
  isDirty: (id: string) => boolean
  create: (name: string, color: PlanColor) => Promise<Plan | null>
  edit: (id: string, change: (draft: PlanDraft) => PlanDraft) => void
  save: (id: string) => Promise<Plan | null>
  discard: (id: string) => void
  remove: (id: string) => Promise<void>
  toggle: (id: string) => void
  expand: (id: string) => void
}

function omit<T>(all: Record<string, T>, id: string): Record<string, T> {
  const next = { ...all }
  delete next[id]
  return next
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function usePlans(): PlansModel {
  const [plans, setPlans] = useState<Plan[]>([])
  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const pendingRef = useRef(new Set<string>())
  const creatingRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [recoveredFrom, setRecoveredFrom] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let current = true
    void window.vifito.getPlans().then((snapshot) => {
      if (!current) return
      setPlans(snapshot.plans)
      setRecoveredFrom(snapshot.recoveredFrom)
      setLoading(false)
    }, (err: unknown) => {
      if (!current) return
      setError(`Plans could not be read: ${describe(err)}`)
      setLoading(false)
    })
    return () => { current = false }
  }, [])

  const savedPlan = (id: string): Plan => {
    const plan = plans.find((entry) => entry.id === id)
    if (!plan) throw new Error(`Unknown plan: ${id}`)
    return plan
  }

  const draftOf = (id: string): PlanDraft => Object.hasOwn(drafts, id) ? drafts[id] : toDraft(savedPlan(id))

  const expand = (id: string) => setExpanded((all) => new Set([...all, id]))

  const setBusy = (id: string, busy: boolean) => {
    if (busy) pendingRef.current.add(id)
    else pendingRef.current.delete(id)
    setPending(new Set(pendingRef.current))
  }

  const create = async (name: string, color: PlanColor): Promise<Plan | null> => {
    if (loading || creatingRef.current) return null
    const result = readDraft({ name, color, phases: [] }, crypto.randomUUID())
    if (!result.ok) {
      setError(result.problems.map((problem) => problem.message).join(' '))
      return null
    }
    creatingRef.current = true
    setCreating(true)
    try {
      const stored = await window.vifito.savePlan(result.plan)
      const plan = stored.find((entry) => entry.id === result.plan.id)
      if (!plan) throw new Error('The saved plan was not returned.')
      setPlans(stored)
      expand(plan.id)
      setError(null)
      return plan
    } catch (err) {
      setError(`The plan was not created: ${describe(err)}`)
      return null
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const edit = (id: string, change: (draft: PlanDraft) => PlanDraft) => {
    setDrafts((all) => ({ ...all, [id]: change(Object.hasOwn(all, id) ? all[id] : toDraft(savedPlan(id))) }))
  }

  const save = async (id: string): Promise<Plan | null> => {
    const sent = Object.hasOwn(drafts, id) ? drafts[id] : undefined
    if (!sent || pendingRef.current.has(id)) return null
    const result = readDraft(sent, id)
    if (!result.ok) return null
    setBusy(id, true)
    try {
      const stored = await window.vifito.savePlan(result.plan)
      const plan = stored.find((entry) => entry.id === id)
      if (!plan) throw new Error('The saved plan was not returned.')
      setPlans(stored)
      // A newer draft may contain edits typed while IPC was writing the saved version.
      setDrafts((all) => all[id] === sent ? omit(all, id) : all)
      setErrors((all) => omit(all, id))
      return plan
    } catch (err) {
      setErrors((all) => ({ ...all, [id]: `The plan was not saved: ${describe(err)}` }))
      return null
    } finally {
      setBusy(id, false)
    }
  }

  const discard = (id: string) => {
    if (pendingRef.current.has(id)) return
    setDrafts((all) => omit(all, id))
    setErrors((all) => omit(all, id))
  }

  const remove = async (id: string): Promise<void> => {
    if (pendingRef.current.has(id)) return
    setBusy(id, true)
    try {
      const stored = await window.vifito.deletePlan(id)
      setPlans(stored)
      setDrafts((all) => omit(all, id))
      setErrors((all) => omit(all, id))
      setExpanded((all) => {
        const next = new Set(all)
        next.delete(id)
        return next
      })
    } catch (err) {
      setErrors((all) => ({ ...all, [id]: `The plan was not deleted: ${describe(err)}` }))
    } finally {
      setBusy(id, false)
    }
  }

  const toggle = (id: string) => setExpanded((all) => {
    const next = new Set(all)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return {
    plans, loading, creating, recoveredFrom, error, pending, expanded,
    dismissRecovery: () => setRecoveredFrom(null),
    errorOf: (id) => Object.hasOwn(errors, id) ? errors[id] : null,
    draftOf,
    isDirty: (id) => isDirty(draftOf(id), savedPlan(id)),
    create, edit, save, discard, remove, toggle, expand,
  }
}
