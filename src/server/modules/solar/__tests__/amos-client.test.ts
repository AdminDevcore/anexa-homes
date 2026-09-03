import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitToAmos, AmosSubmissionError } from '../amos-client'

const payload = {
  externalId: 'design-abc',
  productSlug: 'solar-installation-financing',
  applicant: { firstName: 'Dana', lastName: 'Reyes', email: 'd@e.com', phone: '5125550143' },
  property: {
    line1: '1 Main St',
    city: 'Austin',
    state: 'TX',
    postalCode: '78735',
    ownerOccupied: true,
  },
  requestedAmount: '48750.00',
  termMonths: 300,
  salesRepName: 'Marco Diaz',
  delivery: 'in_person' as const,
}

const creds = { baseUrl: 'https://lender.test', apiKey: 'ak_live_secret' }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('submitToAmos', () => {
  it('posts to the partner endpoint with a bearer key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        applicationId: 'app-1',
        referenceNumber: 'AMS-1042',
        customerUrl: 'https://lender.test/complete/tok',
        sentTo: 'd@e.com',
        expiresAt: '2026-09-10T00:00:00.000Z',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await submitToAmos(creds, payload)
    expect(r.referenceNumber).toBe('AMS-1042')
    expect(r.customerUrl).toBe('https://lender.test/complete/tok')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://lender.test/api/v1/partner/applications')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer ak_live_secret')
    expect(JSON.parse(init.body).externalId).toBe('design-abc')
  })

  it('tolerates a trailing slash on the configured base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { applicationId: 'a', referenceNumber: 'r', customerUrl: null, sentTo: 'd@e.com', expiresAt: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    await submitToAmos({ ...creds, baseUrl: 'https://lender.test/' }, payload)
    expect(fetchMock.mock.calls[0][0]).toBe('https://lender.test/api/v1/partner/applications')
  })

  it('surfaces the lender’s own message and code on a 422', async () => {
    // A fresh Response per call: a body can only be read once, so a shared
    // instance would make the second call look like a parse failure.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        jsonResponse(422, {
          error: {
            code: 'unknown_equipment',
            message: 'One or more equipment items are not on the approved vendor list.',
            details: [{ kind: 'battery', brand: 'Tesla', model: 'Powerwall 3' }],
          },
        }),
      ),
    )
    await expect(submitToAmos(creds, payload)).rejects.toMatchObject({
      code: 'unknown_equipment',
      status: 422,
    })
    // The rep needs to see WHICH item, not just that something was wrong.
    await expect(submitToAmos(creds, payload)).rejects.toThrow(/Powerwall 3/)
  })

  it('reports a revoked key as a configuration problem, not a deal problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { error: { code: 'key_revoked', message: 'This API key has been revoked.' } }),
      ),
    )
    await expect(submitToAmos(creds, payload)).rejects.toMatchObject({
      code: 'key_revoked',
      isConfigProblem: true,
    })
  })

  it('does not treat a 500 as retryable-forever — it reports it once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: { code: 'internal_error', message: 'oops' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitToAmos(creds, payload)).rejects.toMatchObject({ code: 'internal_error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('turns a non-JSON response into a readable error instead of a parse crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 })),
    )
    await expect(submitToAmos(creds, payload)).rejects.toBeInstanceOf(AmosSubmissionError)
  })

  it('turns a network failure into a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(submitToAmos(creds, payload)).rejects.toMatchObject({ code: 'network_error' })
  })

  it('never puts the API key in the error it throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    try {
      await submitToAmos(creds, payload)
      expect.unreachable()
    } catch (e) {
      expect(JSON.stringify({ m: (e as Error).message, s: (e as Error).stack })).not.toContain(
        'ak_live_secret',
      )
    }
  })
})
