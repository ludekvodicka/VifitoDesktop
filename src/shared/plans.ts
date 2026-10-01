import { toNumber } from './presets'

export const PLAN_COLORS = {
  blue: '#4cc2ff',
  green: '#47d18a',
  yellow: '#ffd166',
  orange: '#ffb454',
  red: '#ff6b6b',
  pink: '#ff8fc8',
  purple: '#b39dff',
  white: '#e6e9f0',
} as const

export type PlanColor = keyof typeof PLAN_COLORS

export type PlanPhase = {
  id: string
  /** An empty name uses its position, so the label follows a deletion. */
  name: string
  speedKmh: number
  inclinePercent: number
  durationSec: number
}

export type Plan = { id: string; name: string; color: PlanColor; phases: PlanPhase[] }
export type PlansFile = { version: number; plans: Plan[] }
/** `recoveredFrom` names the quarantined copy when plans.json could not be read. */
export type PlansSnapshot = { plans: Plan[]; recoveredFrom: string | null }

export const PLANS_FILE_VERSION = 1

export const PLAN_LIMITS = {
  speedKmh: { min: 0.1, max: 30 },
  inclinePercent: { min: 0, max: 30 },
  /** 5 s leaves room for two answered commands; 99:59 fits the minutes and seconds fields. */
  durationSec: { min: 5, max: 99 * 60 + 59 },
  nameLength: 60,
  phaseNameLength: 40,
} as const

function normalizeId(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : crypto.randomUUID()
}

function clampedNumber(value: unknown, { min, max }: { min: number; max: number }): number {
  return Math.min(max, Math.max(min, toNumber(value) ?? min))
}

function normalizePhase(value: unknown): PlanPhase | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  return {
    id: normalizeId(source.id),
    name: typeof source.name === 'string' ? source.name.trim().slice(0, PLAN_LIMITS.phaseNameLength) : '',
    speedKmh: Math.round(clampedNumber(source.speedKmh, PLAN_LIMITS.speedKmh) * 10) / 10,
    inclinePercent: Math.round(clampedNumber(source.inclinePercent, PLAN_LIMITS.inclinePercent) * 10) / 10,
    durationSec: Math.round(clampedNumber(source.durationSec, PLAN_LIMITS.durationSec)),
  }
}

export function normalizePlan(value: unknown): Plan | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const name = typeof source.name === 'string' ? source.name.trim().slice(0, PLAN_LIMITS.nameLength) : ''
  return {
    id: normalizeId(source.id),
    name: name || 'Untitled plan',
    color:
      typeof source.color === 'string' && Object.hasOwn(PLAN_COLORS, source.color) ? (source.color as PlanColor) : 'blue',
    phases: Array.isArray(source.phases) ? source.phases.map(normalizePhase).filter((phase) => phase !== null) : [],
  }
}

export function normalizePlans(value: unknown): Plan[] {
  return Array.isArray(value) ? value.map(normalizePlan).filter((plan) => plan !== null) : []
}

export function phaseLabel(name: string, index: number): string {
  return name || `Phase ${index + 1}`
}

export function planDurationSec(plan: Plan): number {
  return plan.phases.reduce((total, phase) => total + phase.durationSec, 0)
}
