import { beforeEach, describe, expect, it, vi } from 'vitest'

const readLenderSubmission = vi.fn()
const submitDealToLender = vi.fn()
vi.mock('../lender-submit', () => ({
  readLenderSubmission: (...a: unknown[]) => readLenderSubmission(...a),
  submitDealToLender: (...a: unknown[]) => submitDealToLender(...a),
}))

// The workspace wrapper is exercised by its own suite; here it only has to
// pass the callback through so the assertions are about the qualify logic.
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

const { readProposalQualifyOffer, qualifyOnProposal } = await import('../proposal-qualify')

const PROPOSAL = {
  id: 'prop-1',
  leadId: 'lead-1',
  companyId: 'co-1',
  version: 3,
  supersededAt: null as Date | null,
  signedAt: null as Date | null,
  approvedAt: null as Date | null,
  lead: { vertical: 'solar' as const },
}

const SUMMARY = {
  customer: 'Dana Reyes',
  property: '4120 Sage Hollow Dr, Austin, TX, 78735',
  system: '10.7 kW · 26 x Qcells Q.PEAK 410',
  financing: '$48,750 over 300 months',
}

beforeEach(() => {
  readLenderSubmission.mockReset()
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

describe('readProposalQualifyOffer', () => {
  it('offers nothing when the lender has no integration', async () => {
    readLenderSubmission.mockResolvedValue({ mode: 'link' })
    expect(await readProposalQualifyOffer(PROPOSAL, 'customer')).toBeNull()
    expect(await readProposalQualifyOffer(PROPOSAL, 'rep')).toBeNull()
  })

  it('offers the ready case to both audiences', async () => {
    readLenderSubmission.mockResolvedValue({
      mode: 'api',
      lenderName: 'Amos Capital Fund',
      ready: true,
      summary: SUMMARY,
    })
    expect(await readProposalQualifyOffer(PROPOSAL, 'customer')).toEqual({
      state: 'ready',
      lenderName: 'Amos Capital Fund',
      summary: SUMMARY,
    })
    expect(await readProposalQualifyOffer(PROPOSAL, 'rep')).toMatchObject({ state: 'ready' })
  })

  it('NEVER puts the blockers on the customer’s copy', async () => {
    readLenderSubmission.mockResolvedValue({
      mode: 'api',
      lenderName: 'Amos Capital Fund',
      ready: false,
      problems: ['The customer has no phone number on file.'],
    })
    // The customer sees the ordinary application link and is told nothing about
    // a document their own company had not finished.
    expect(await readProposalQualifyOffer(PROPOSAL, 'customer')).toBeNull()
  })

  it('gives the rep the blockers, which is the whole point of the preview', async () => {
    readLenderSubmission.mockResolvedValue({
      mode: 'api',
      lenderName: 'Amos Capital Fund',
      ready: false,
      problems: ['The customer has no phone number on file.'],
    })
    expect(await readProposalQualifyOffer(PROPOSAL, 'rep')).toEqual({
      state: 'blocked',
      lenderName: 'Amos Capital Fund',
      problems: ['The customer has no phone number on file.'],
    })
  })

  /**
   * A BUTTON THAT ALWAYS ERRORS IS WORSE THAN NO BUTTON.
   *
   * The offer used to answer only "is this deal submittable", never "may THIS
   * document submit" — so a household on a superseded draft was handed the
   * automatic control and an error the moment they pressed it. They get the
   * lender's ordinary application link instead, which is a road that works.
   */
  it('offers nothing on a document that may not start an application', async () => {
    readLenderSubmission.mockResolvedValue({
      mode: 'api',
      lenderName: 'Amos Capital Fund',
      ready: true,
      summary: SUMMARY,
    })
    const stale = { ...PROPOSAL, supersededAt: new Date() }
    expect(await readProposalQualifyOffer(stale, 'customer')).toBeNull()
  })

  it('tells a REP why the button is not live on a stale version', async () => {
    readLenderSubmission.mockResolvedValue({
      mode: 'api',
      lenderName: 'Amos Capital Fund',
      ready: true,
      summary: SUMMARY,
    })
    const offer = await readProposalQualifyOffer(
      { ...PROPOSAL, supersededAt: new Date() },
      'rep',
    )
    expect(offer).toMatchObject({ state: 'blocked' })
    expect((offer as { problems: string[] }).problems.join(' ')).toContain('replaced')
  })

  it('still offers the automatic route on the signed version', async () => {
    readLenderSubmission.mockResolvedValue({
      mode: 'api',
      lenderName: 'Amos Capital Fund',
      ready: true,
      summary: SUMMARY,
    })
    const signed = { ...PROPOSAL, supersededAt: new Date(), signedAt: new Date() }
    expect(await readProposalQualifyOffer(signed, 'customer')).toMatchObject({ state: 'ready' })
  })
})

describe('qualifyOnProposal', () => {
  const input = { ownerOccupied: true, ip: '203.0.113.9' }

  it('submits the deal and hands back the lender’s own page', async () => {
    const r = await qualifyOnProposal(PROPOSAL, input)
    expect(r).toEqual({
      ok: true,
      lenderName: 'Amos Capital Fund',
      referenceNumber: 'AMS-1042',
      customerUrl: 'https://lender.test/complete/tok',
      sentTo: 'dana@example.com',
    })
  })

  it('re-reads the deal on the server rather than trusting the page', async () => {
    await qualifyOnProposal(PROPOSAL, input)
    expect(submitDealToLender).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        companyId: 'co-1',
        ownerOccupied: true,
        // WHICH DOCUMENT was pressed, so the lender is quoted this sheet's
        // figures rather than whatever version happens to be newest.
        proposalId: 'prop-1',
      }),
    )
  })

  /**
   * THE CASE THE WHOLE CHANGE EXISTS FOR.
   *
   * The customer signs v13; the rep then generates a v14. `mayInheritLiveLink`
   * deliberately keeps the live link on the SIGNED row, so the household is
   * still holding v13 — now superseded — and a freshly generated v14 has no
   * public token at all. Refusing here told them to "open the most recent one
   * your representative sent you", which did not exist, and closed the only
   * door the deal had.
   */
  it('submits from the version the customer signed, newer versions or not', async () => {
    const r = await qualifyOnProposal(
      { ...PROPOSAL, supersededAt: new Date('2026-09-05'), signedAt: new Date('2026-09-04') },
      input,
    )
    expect(r).toMatchObject({ ok: true, referenceNumber: 'AMS-1042' })
    expect(submitDealToLender).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'prop-1' }),
    )
  })

  it('submits from a version an admin approved as the one this deal sold', async () => {
    const r = await qualifyOnProposal(
      { ...PROPOSAL, supersededAt: new Date('2026-09-05'), approvedAt: new Date('2026-09-04') },
      input,
    )
    expect(r).toMatchObject({ ok: true })
  })

  it('refuses a superseded document without calling the lender', async () => {
    const r = await qualifyOnProposal({ ...PROPOSAL, supersededAt: new Date() }, input)
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toContain('replaced')
    expect(submitDealToLender).not.toHaveBeenCalled()
  })

  it('tells the office a customer applied, on the deal', async () => {
    await qualifyOnProposal(PROPOSAL, input)
    expect(eventCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      proposalId: 'prop-1',
      type: 'qualify_submitted',
      actorName: 'Customer',
    })
    expect(activityCreate.mock.calls[0]?.[0]?.data?.message).toContain('AMS-1042')
    expect(activityCreate.mock.calls[0]?.[0]?.data?.leadId).toBe('lead-1')
  })

  it('tells the office when a customer TRIED and could not', async () => {
    submitDealToLender.mockResolvedValue({
      ok: false,
      kind: 'deal',
      error: 'This deal is missing information the lender requires.',
      problems: ['The customer has no phone number on file.'],
    })
    await qualifyOnProposal(PROPOSAL, input)
    expect(eventCreate.mock.calls[0]?.[0]?.data?.type).toBe('qualify_failed')
    expect(activityCreate.mock.calls[0]?.[0]?.data?.message).toContain('failed')
  })

  it('never repeats our preflight wording back to the homeowner', async () => {
    submitDealToLender.mockResolvedValue({
      ok: false,
      kind: 'deal',
      error: 'This deal is missing information the lender requires.',
      problems: ['The selected panel has no manufacturer — the lender matches on brand and model.'],
    })
    const r = await qualifyOnProposal(PROPOSAL, input)
    const shown = (r as { error: string }).error
    expect(shown).not.toContain('manufacturer')
    expect(shown).not.toContain('deal')
    expect(shown).toContain('application link')
  })

  it('tells them to try again when it was the network, not the deal', async () => {
    submitDealToLender.mockResolvedValue({ ok: false, kind: 'transient', error: 'no route' })
    const r = await qualifyOnProposal(PROPOSAL, input)
    expect((r as { error: string }).error).toContain('try again')
  })

  /**
   * SAYING "try again" IS NOT ENOUGH — the document has to still be able to.
   *
   * A transient failure used to swap the automatic control for a plain link to
   * the lender's website for the life of the page. The message asked for a
   * retry, the button could no longer perform one, and every press afterwards
   * opened a blank form instead: a real application sat stranded for two hours
   * with nothing reaching the API. `retryable` is what the document branches
   * on, so it is asserted here rather than left to the component.
   */
  it('marks a transient failure retryable', async () => {
    submitDealToLender.mockResolvedValue({ ok: false, kind: 'transient', error: 'no route' })
    expect(await qualifyOnProposal(PROPOSAL, input)).toMatchObject({
      ok: false,
      retryable: true,
    })
  })

  it('marks a deal problem NOT retryable — pressing again cannot fix it', async () => {
    submitDealToLender.mockResolvedValue({ ok: false, kind: 'deal', error: 'x', problems: [] })
    expect(await qualifyOnProposal(PROPOSAL, input)).toMatchObject({
      ok: false,
      retryable: false,
    })
  })

  it('marks a config problem NOT retryable — only an admin can move it', async () => {
    submitDealToLender.mockResolvedValue({ ok: false, kind: 'config', error: 'x' })
    expect(await qualifyOnProposal(PROPOSAL, input)).toMatchObject({
      ok: false,
      retryable: false,
    })
  })

  it('a superseded document is never retryable', async () => {
    const r = await qualifyOnProposal({ ...PROPOSAL, supersededAt: new Date() }, input)
    expect(r).toMatchObject({ ok: false, retryable: false })
    expect(submitDealToLender).not.toHaveBeenCalled()
  })

  it('still returns the application when the bookkeeping throws', async () => {
    // The household is already through to the lender by then.
    eventCreate.mockRejectedValue(new Error('db down'))
    expect(await qualifyOnProposal(PROPOSAL, input)).toMatchObject({ ok: true })
  })
})
