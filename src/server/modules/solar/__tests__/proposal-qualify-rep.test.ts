import { beforeEach, describe, expect, it, vi } from 'vitest'

const submitDealToLender = vi.fn()
vi.mock('../lender-submit', () => ({
  submitDealToLender: (...a: unknown[]) => submitDealToLender(...a),
}))

vi.mock('@/server/vertical/context', () => ({
  runInVertical: (_v: string, fn: () => unknown) => fn(),
  asActiveVertical: (v: string) => v,
}))

const eventCreate = vi.fn()
const activityCreate = vi.fn()
vi.mock('@/server/db/client', () => ({
  prisma: {
    solarProposalEvent: { create: (...a: unknown[]) => eventCreate(...a) },
    activityLog: { create: (...a: unknown[]) => activityCreate(...a) },
  },
}))

const { qualifyOnProposalAsRep } = await import('../proposal-qualify-rep')

const PROPOSAL = {
  id: 'prop-1',
  leadId: 'lead-1',
  companyId: 'co-1',
  version: 33,
  supersededAt: null as Date | null,
  lead: { vertical: 'solar' as const },
}

const REP = { fullName: 'Mustafa Joulani' }
const INPUT = { ownerOccupied: true, ip: '203.0.113.4' }

beforeEach(() => {
  submitDealToLender.mockReset().mockResolvedValue({
    ok: true,
    referenceNumber: 'AMS-1042',
    customerUrl: 'https://lender.test/complete/tok',
    sentTo: 'dana@example.com',
    lenderName: 'Amos Capital Fund',
  })
  eventCreate.mockReset().mockResolvedValue({})
  activityCreate.mockReset().mockResolvedValue({})
})

describe('qualifyOnProposalAsRep', () => {
  it('refuses a superseded version without troubling the lender', async () => {
    const res = await qualifyOnProposalAsRep(
      { ...PROPOSAL, supersededAt: new Date('2026-09-04') },
      REP,
      INPUT,
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    // Named, because the rep has to know WHICH one to go and open.
    expect(res.error).toContain('v33')
    expect(res.retryable).toBe(false)
    expect(submitDealToLender).not.toHaveBeenCalled()
  })

  it('names the acting rep as BOTH the fallback and the submitter', async () => {
    // Two fields for one person here, because they are not the same fact: the
    // customer's own door has a fallback and no submitter at all. Delivery is
    // no longer stated by either door — it is the partner's rule now.
    await qualifyOnProposalAsRep(PROPOSAL, REP, INPUT)
    expect(submitDealToLender).toHaveBeenCalledWith({
      leadId: 'lead-1',
      companyId: 'co-1',
      ownerOccupied: true,
      fallbackRepName: 'Mustafa Joulani',
      submitterName: 'Mustafa Joulani',
    })
  })

  it('hands back the reference and the completion link rather than redirecting', async () => {
    const res = await qualifyOnProposalAsRep(PROPOSAL, REP, INPUT)
    expect(res).toMatchObject({
      ok: true,
      lenderName: 'Amos Capital Fund',
      referenceNumber: 'AMS-1042',
      customerUrl: 'https://lender.test/complete/tok',
    })
  })

  /**
   * The whole reason this module exists beside the customer's one. An office
   * reading the deal has to be able to tell an application the household
   * started from one their rep started for them.
   */
  it('records the attempt under the rep, never as "Customer"', async () => {
    await qualifyOnProposalAsRep(PROPOSAL, REP, INPUT)

    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalId: 'prop-1',
        type: 'qualify_submitted',
        actorName: 'Mustafa Joulani',
      }),
    })
    const message = activityCreate.mock.calls[0][0].data.message as string
    expect(message).toContain('Mustafa Joulani')
    expect(message).not.toContain('Customer')
    expect(message).toContain('v33')
  })

  /**
   * The other half of it. `customerFacing()` on the customer's door turns every
   * failure into the same apology on purpose; in front of the person who can go
   * and fix the deal, that sentence is the only useless one available.
   */
  it('tells a rep what actually went wrong, preflight problems and all', async () => {
    submitDealToLender.mockResolvedValue({
      ok: false,
      kind: 'deal',
      error: 'This deal is missing information the lender requires.',
      problems: ['The selected panel has no manufacturer.', 'The customer has no phone number on file.'],
    })

    const res = await qualifyOnProposalAsRep(PROPOSAL, REP, INPUT)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('The selected panel has no manufacturer.')
    expect(res.error).toContain('no phone number on file')
    expect(res.retryable).toBe(false)

    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'qualify_failed', actorName: 'Mustafa Joulani' }),
    })
  })

  it('marks a transient failure retryable so the live button stays live', async () => {
    submitDealToLender.mockResolvedValue({
      ok: false,
      kind: 'transient',
      error: 'The lender did not answer.',
    })
    const res = await qualifyOnProposalAsRep(PROPOSAL, REP, INPUT)
    expect(res).toMatchObject({ ok: false, retryable: true })
  })

  it('never lets the bookkeeping cost the submission', async () => {
    eventCreate.mockRejectedValue(new Error('activity table is on fire'))
    const res = await qualifyOnProposalAsRep(PROPOSAL, REP, INPUT)
    expect(res.ok).toBe(true)
  })
})
