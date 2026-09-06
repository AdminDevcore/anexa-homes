import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const can = vi.fn()
vi.mock('@/server/auth/session', () => ({ requireUser: () => requireUser() }))
vi.mock('@/server/rbac/guards', () => ({ can: (...a: unknown[]) => can(...a) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const proposalFindFirst = vi.fn()
const designFindFirst = vi.fn()
const designUpdate = vi.fn()
const eventFindFirst = vi.fn()
const activityCreate = vi.fn()
vi.mock('@/server/db/client', () => ({
  prisma: {
    solarProposal: { findFirst: (...a: unknown[]) => proposalFindFirst(...a) },
    solarDesign: {
      findFirst: (...a: unknown[]) => designFindFirst(...a),
      update: (...a: unknown[]) => designUpdate(...a),
    },
    solarProposalEvent: { findFirst: (...a: unknown[]) => eventFindFirst(...a) },
    activityLog: { create: (...a: unknown[]) => activityCreate(...a) },
  },
}))

const { resetLenderSubmissionKeyAction } = await import('../lender-submission-key')
const { lenderReference } = await import('../lender-submit')

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', companyId: 'co-1' })
  can.mockReset().mockReturnValue(true)
  proposalFindFirst.mockReset().mockResolvedValue({ leadId: 'lead-1' })
  designFindFirst
    .mockReset()
    .mockResolvedValue({ id: 'design-abc', lenderSubmissionAttempt: 0, lenderId: 'lender-1' })
  designUpdate.mockReset().mockResolvedValue({})
  eventFindFirst.mockReset().mockResolvedValue(null)
  activityCreate.mockReset().mockResolvedValue({})
})

describe('lenderReference', () => {
  /**
   * Attempt 0 MUST be the bare design id — that is the reference every deal
   * already submits under, and a migration that changed it would orphan every
   * application a lender is holding.
   */
  it('is the bare design id until a reference has been abandoned', () => {
    expect(lenderReference('design-abc', 0)).toBe('design-abc')
  })

  it('is suffixed once one has', () => {
    expect(lenderReference('design-abc', 2)).toBe('design-abc-2')
  })
})

describe('resetLenderSubmissionKeyAction', () => {
  it('denies a caller who may not touch the deal', async () => {
    can.mockReturnValue(false)
    expect(await resetLenderSubmissionKeyAction('prop-1')).toMatchObject({ ok: false })
    expect(designUpdate).not.toHaveBeenCalled()
  })

  it('finds nothing for a proposal in another company', async () => {
    proposalFindFirst.mockResolvedValue(null)
    expect(await resetLenderSubmissionKeyAction('prop-elsewhere')).toMatchObject({
      ok: false,
      error: 'Proposal not found.',
    })
    expect(designUpdate).not.toHaveBeenCalled()
  })

  it('bumps the counter and hands back the new reference', async () => {
    const r = await resetLenderSubmissionKeyAction('prop-1')
    expect(r).toEqual({ ok: true, reference: 'design-abc-1', attempt: 1 })
    expect(designUpdate.mock.calls[0]?.[0]?.data).toEqual({ lenderSubmissionAttempt: 1 })
  })

  it('writes it onto the deal, so a duplicate can be accounted for later', async () => {
    await resetLenderSubmissionKeyAction('prop-1')
    const msg = activityCreate.mock.calls[0]?.[0]?.data?.message
    expect(msg).toContain('design-abc-1')
    expect(activityCreate.mock.calls[0]?.[0]?.data?.leadId).toBe('lead-1')
  })

  /**
   * THE GUARD THE WHOLE MODULE EXISTS AROUND. A reference that already produced
   * an application is not broken; a fresh one would file the household twice.
   */
  it('REFUSES once the deal has been submitted successfully', async () => {
    eventFindFirst.mockResolvedValue({ id: 'ev-1' })
    const r = await resetLenderSubmissionKeyAction('prop-1')
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toContain('second application')
    expect(designUpdate).not.toHaveBeenCalled()
  })

  it('refuses a deal with no lender to submit to', async () => {
    designFindFirst.mockResolvedValue({ id: 'd', lenderSubmissionAttempt: 0, lenderId: null })
    expect(await resetLenderSubmissionKeyAction('prop-1')).toMatchObject({ ok: false })
    expect(designUpdate).not.toHaveBeenCalled()
  })

  it('stops after four, rather than letting somebody press it all night', async () => {
    designFindFirst.mockResolvedValue({
      id: 'design-abc',
      lenderSubmissionAttempt: 4,
      lenderId: 'lender-1',
    })
    const r = await resetLenderSubmissionKeyAction('prop-1')
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toContain('support')
    expect(designUpdate).not.toHaveBeenCalled()
  })
})
