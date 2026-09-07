import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitToAmos, fetchAmosCatalog, AmosSubmissionError } from '../amos-client'

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
  system: {
    annualProductionKwh: 14200,
    annualConsumptionKwh: 15800,
    retailRatePerKwh: '0.233',
    estMonthlySaving: '301.00',
    estAnnualSaving: '3611.96',
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

  it('turns a network failure into a readable error naming the host', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(submitToAmos(creds, payload)).rejects.toMatchObject({ code: 'network_error' })
    await expect(submitToAmos(creds, payload)).rejects.toThrow(/lender\.test/)
  })

  it('names a DNS failure as an address problem, not a connection one', async () => {
    // The single most common cause is a typo in the configured address, and
    // "could not reach the lender" sends an admin to their firewall instead.
    const dnsError = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ENOTFOUND' },
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(dnsError))
    await expect(submitToAmos(creds, payload)).rejects.toThrow(/does not resolve/)
  })

  it('distinguishes a refused connection from a missing host', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(refused))
    await expect(submitToAmos(creds, payload)).rejects.toThrow(/Nothing is answering/)
  })

  it('sends successfully with a key that carries a shell prompt glyph', async () => {
    // The real incident: "❯" (U+276F) on the front of the key made the
    // Authorization header impossible to encode, so fetch threw before
    // sending. A byte outside printable ASCII cannot be part of a working
    // credential, so stripping it recovers exactly the key that was issued.
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse(201, {
        applicationId: 'app-1',
        referenceNumber: 'AMS-1042',
        customerUrl: null,
        sentTo: 'd@e.com',
        expiresAt: 'x',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await submitToAmos({ ...creds, apiKey: '❯ak_live_secret' }, payload)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer ak_live_secret')
  })

  it('strips a trailing newline from a key too', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse(201, {
        applicationId: 'a',
        referenceNumber: 'r',
        customerUrl: null,
        sentTo: 'd@e.com',
        expiresAt: 'x',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await submitToAmos({ ...creds, apiKey: 'ak_live_secret\n' }, payload)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer ak_live_secret')
  })

  it('refuses when nothing usable is left after stripping', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitToAmos({ ...creds, apiKey: '❯❯❯' }, payload)).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed address before attempting a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      submitToAmos({ baseUrl: 'not a url', apiKey: 'ak_live_secret' }, payload),
    ).rejects.toThrow(/not a valid API address/)
    expect(fetchMock).not.toHaveBeenCalled()
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

describe('fetchAmosCatalog', () => {
  it('asks for the catalogue with the key, and returns their list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        products: [{ slug: 'solar-30-year-cpe', name: 'Solar 30 Year CPE' }],
        equipment: [
          { kind: 'panel', brand: 'Silfab', model: 'PRIME DCA2 (SIL440QD-DCA2)', watts: 440 },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const catalog = await fetchAmosCatalog(creds)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://lender.test/api/v1/partner/catalog')
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.Authorization).toBe('Bearer ak_live_secret')
    expect(catalog.products).toEqual([{ slug: 'solar-30-year-cpe', name: 'Solar 30 Year CPE' }])
    expect(catalog.equipment).toEqual([
      {
        kind: 'panel',
        brand: 'Silfab',
        model: 'PRIME DCA2 (SIL440QD-DCA2)',
        watts: 440,
        capacityKwh: null,
      },
    ])
  })

  it('surfaces the lender\'s own sentence when the key is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { code: 'unauthorized', message: 'This API key is not recognized.' },
        }),
      ),
    )
    // The whole reason an admin presses the button: it establishes whether the
    // stored credential works, before a homeowner does it for them.
    await expect(fetchAmosCatalog(creds)).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'This API key is not recognized.',
      isConfigProblem: true,
    })
  })

  it('drops rows that could not be a mapping target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          equipment: [
            { kind: 'panel', brand: '', model: 'No brand', watts: null },
            { kind: 'panel', brand: 'Qcells', model: '   ', watts: null },
            { kind: 'nonsense', brand: 'Qcells', model: 'Q.PEAK', watts: null },
            { kind: 'battery', brand: 'Tesla', model: 'Powerwall 3', capacityKwh: 13.5 },
          ],
        }),
      ),
    )
    const catalog = await fetchAmosCatalog(creds)
    expect(catalog.equipment).toEqual([
      { kind: 'battery', brand: 'Tesla', model: 'Powerwall 3', watts: null, capacityKwh: 13.5 },
    ])
  })

  it('never sends a key the header cannot carry, and says so', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      fetchAmosCatalog({ baseUrl: 'https://lender.test', apiKey: '\u276f\u276f' }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
