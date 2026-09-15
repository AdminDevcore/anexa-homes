import { afterEach, describe, expect, it, vi } from "vitest";
import { kickSignedProposalFiling } from "../signed-filing-kick";

/**
 * Signing asks the filing route to file THIS proposal straight away, so the
 * signed PDF lands in the deal's Proposal folder as part of signing rather than
 * whenever an admin next opens the deal. What is pinned here is the call: the
 * right route, the one proposal, the cron secret — and that nothing about it
 * can throw into the customer's signature.
 */

const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe("filing the signed proposal as part of signing", () => {
  it("asks the filing route for exactly this proposal, with the cron secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await kickSignedProposalFiling("prop-123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.example.com/api/cron/file-signed-proposals?proposalId=prop-123");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s3cret");
  });

  it("does nothing on a deployment with no cron secret — the route would refuse it", async () => {
    delete process.env.CRON_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await kickSignedProposalFiling("prop-123");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws: a failed call leaves it to the scheduled sweep", async () => {
    process.env.CRON_SECRET = "s3cret";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(kickSignedProposalFiling("prop-123")).resolves.toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    await expect(kickSignedProposalFiling("prop-123")).resolves.toBeUndefined();
  });
});
