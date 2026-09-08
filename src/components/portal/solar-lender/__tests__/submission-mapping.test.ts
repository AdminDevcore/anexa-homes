import { describe, expect, it } from 'vitest'
import { BUILT_IN, CONSTANT, rowSelection } from '../submission-mapping'

/**
 * The picker's own state, which is where this feature first broke.
 *
 * Every case below was a live defect or is one keystroke from being one: the
 * row that will not stay on "a constant" is invisible in a screenshot and
 * indistinguishable from a select that simply did not register the click.
 */
describe('rowSelection', () => {
  it('shows the built-in source when nobody has mapped the row', () => {
    expect(rowSelection(undefined)).toBe(BUILT_IN)
  })

  it('stays on “a constant” before one has been typed', () => {
    // THE BUG. Choosing the constant stores an empty one; reading the mode off
    // the literal made that identical to "not mapped", so the select snapped
    // back and the box to type in never appeared.
    expect(rowSelection({ sourceKey: null, literal: '' })).toBe(CONSTANT)
  })

  it('stays on “a constant” once one has', () => {
    expect(rowSelection({ sourceKey: null, literal: 'apps@partner.test' })).toBe(CONSTANT)
  })

  it('shows the chosen source when the row points at one', () => {
    expect(rowSelection({ sourceKey: 'lead.fullName', literal: '' })).toBe('lead.fullName')
  })

  it('agrees with the wire when a row somehow carries both', () => {
    // `applyFieldMap` sends the literal in that case. The save action stores one
    // or the other so it cannot happen today, but a screen that disagreed with
    // the wire about which half was live is a bug nobody would go looking for.
    expect(rowSelection({ sourceKey: 'lead.email', literal: 'x' })).toBe(CONSTANT)
  })
})
