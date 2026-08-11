import { describe, expect, it } from 'vitest'
import { describeUpdate, type UpdateState } from './update'

describe('describeUpdate', () => {
  it('says nothing is checked in a dev build', () => {
    expect(describeUpdate({ kind: 'disabled' })).toEqual({ text: 'updates are off in a dev build', tone: 'muted' })
  })

  it('keeps the two waiting states amber', () => {
    expect(describeUpdate({ kind: 'checking' }).tone).toBe('working')
    expect(describeUpdate({ kind: 'downloading', version: '0.4.0', percent: 45 }).tone).toBe('working')
  })

  it('names the new version in every state that has one', () => {
    expect(describeUpdate({ kind: 'available', version: '0.4.0' }).text).toBe('version 0.4.0 available')
    expect(describeUpdate({ kind: 'downloaded', version: '0.4.0' }).text).toBe('0.4.0 ready')
  })

  it('rounds the download percentage, the updater reports fractions', () => {
    expect(describeUpdate({ kind: 'downloading', version: '0.4.0', percent: 45.37 }).text).toBe(
      'downloading 0.4.0, 45 %',
    )
  })

  it('holds the failure message back, the bar only has room for the fact', () => {
    const label = describeUpdate({ kind: 'failed', message: 'ENOTFOUND github.com' })
    expect(label).toEqual({ text: 'update check failed', tone: 'failed' })
  })

  it('reports being current without shouting about it', () => {
    expect(describeUpdate({ kind: 'current' })).toEqual({ text: 'up to date', tone: 'muted' })
  })

  it('throws on a state it does not know, rather than drawing the previous one', () => {
    expect(() => describeUpdate({ kind: 'installing' } as unknown as UpdateState)).toThrow(/Unknown update state/)
  })
})
