import { afterEach, describe, expect, it } from "vitest";
import { createRateLimiter, novaAccess, novaEnabled } from "../gate";

const user = { userId: "u1", companyId: "c1", role: "sales_rep" as const };
const open = { enabled: true, user, activeVertical: "solar" as const, hasModelKey: true };

describe("novaAccess", () => {
  it("lets a signed-in user in the Solar workspace through", () => {
    expect(novaAccess(open)).toEqual({ ok: true });
  });

  it("looks like no route at all while the feature flag is off — even signed out", () => {
    expect(novaAccess({ ...open, enabled: false })).toMatchObject({ ok: false, status: 404 });
    expect(novaAccess({ ...open, enabled: false, user: null })).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a signed-out caller", () => {
    expect(novaAccess({ ...open, user: null })).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses outside the Solar workspace", () => {
    const res = novaAccess({ ...open, activeVertical: "roofing" });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(!res.ok && res.message).toMatch(/Solar/);
  });

  it("says plainly when the language model is not configured", () => {
    expect(novaAccess({ ...open, hasModelKey: false })).toMatchObject({ ok: false, status: 503 });
  });
});

describe("novaEnabled", () => {
  const before = process.env.NOVA_ENABLED;
  afterEach(() => {
    if (before === undefined) delete process.env.NOVA_ENABLED;
    else process.env.NOVA_ENABLED = before;
  });

  it("is off unless NOVA_ENABLED is 1 or true", () => {
    delete process.env.NOVA_ENABLED;
    expect(novaEnabled()).toBe(false);
    process.env.NOVA_ENABLED = "0";
    expect(novaEnabled()).toBe(false);
    process.env.NOVA_ENABLED = "1";
    expect(novaEnabled()).toBe(true);
    process.env.NOVA_ENABLED = "true";
    expect(novaEnabled()).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit in a window, then refuses", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect([1, 2, 3, 4].map(() => limiter.allow("u1", 0))).toEqual([true, true, true, false]);
  });

  it("frees up once the window has passed", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.allow("u1", 0)).toBe(true);
    expect(limiter.allow("u1", 59_999)).toBe(false);
    expect(limiter.allow("u1", 60_000)).toBe(true);
  });

  it("counts each person separately", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.allow("u1", 0)).toBe(true);
    expect(limiter.allow("u2", 0)).toBe(true);
    expect(limiter.allow("u1", 1)).toBe(false);
  });
});
