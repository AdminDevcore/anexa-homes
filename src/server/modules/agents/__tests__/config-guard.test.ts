import { describe, it, expect, vi } from "vitest";
import { findSecretValues, keyNamesSecret, parseSecretRef, readEnvRef } from "../config-guard";

const LENDER = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

describe("parseSecretRef", () => {
  it("reads an AGENT_ env reference and a lender reference", () => {
    expect(parseSecretRef("env:AGENT_BANK_PASSWORD")).toEqual({ kind: "env", name: "AGENT_BANK_PASSWORD" });
    expect(parseSecretRef(`lender:${LENDER}`)).toEqual({ kind: "lender", lenderId: LENDER });
  });

  it("refuses an env var outside the AGENT_ prefix", () => {
    expect(parseSecretRef("env:AUTH_SECRET")).toBeNull();
    expect(parseSecretRef("env:CRON_SECRET")).toBeNull();
  });

  it("refuses anything else", () => {
    expect(parseSecretRef("hunter2")).toBeNull();
    expect(parseSecretRef("lender:not-a-uuid")).toBeNull();
    expect(parseSecretRef("vault:abc")).toBeNull();
  });
});

describe("keyNamesSecret", () => {
  it("matches whole words inside camelCase and snake_case keys", () => {
    for (const key of [
      "password",
      "portalPassword",
      "api_key",
      "apiKey",
      "clientSecret",
      "mfaSeed",
      "otp",
      "accessToken",
      "credentials",
      // Acronym runs and trailing digits, not just lower-to-upper camelCase.
      "SFTPPassword",
      "SMTPPassword",
      "APIToken",
      "JWTToken",
      "OTPSecret",
      "AWSSecretAccessKey",
      "password2",
      // Plurals and private-key, added alongside the existing "api key".
      "secrets",
      "passwords",
      "passcodes",
      "apiKeys",
      "privateKey",
    ]) {
      expect(keyNamesSecret(key), key).toBe(true);
    }
  });

  it("does not trip on words that merely contain the letters", () => {
    for (const key of ["footprint", "bypass", "passport", "tokenizerMode", "keyboard", "stages"]) {
      expect(keyNamesSecret(key), key).toBe(false);
    }
  });

  it("allows maxTokens — plural tokens alone is not a secret", () => {
    expect(keyNamesSecret("maxTokens")).toBe(false);
  });
});

describe("findSecretValues", () => {
  it("allows a config with no secret-looking keys", () => {
    expect(findSecretValues({ stages: ["ntp_submitted_9"], maxDeals: 20 })).toBeNull();
  });

  it("allows maxTokens, since plural tokens alone must stay allowed", () => {
    expect(findSecretValues({ maxTokens: 5 })).toBeNull();
  });

  it("refuses a secret value at any depth", () => {
    expect(findSecretValues({ portal: { password: "hunter2" } })).toMatch(/config\.portal\.password/);
    expect(findSecretValues({ logins: [{ apiKey: "sk-live" }] })).toMatch(/config\.logins\[0\]\.apiKey/);
  });

  it("refuses the plural and private-key forms too", () => {
    expect(findSecretValues({ secrets: { bank: "x" } })).toMatch(/config\.secrets/);
  });

  it("allows a Ref key holding a valid reference, and refuses one holding a value", () => {
    expect(findSecretValues({ passwordRef: "env:AGENT_BANK_PASSWORD" })).toBeNull();
    expect(findSecretValues({ credentialsRef: `lender:${LENDER}` })).toBeNull();
    expect(findSecretValues({ passwordRef: "hunter2" })).toMatch(/must be a reference/);
  });
});

describe("readEnvRef", () => {
  it("returns the value, or null when unset or blank", () => {
    expect(readEnvRef("AGENT_X", { AGENT_X: "v" })).toBe("v");
    expect(readEnvRef("AGENT_X", { AGENT_X: "  " })).toBeNull();
    expect(readEnvRef("AGENT_X", {})).toBeNull();
  });

  it("refuses a non-AGENT_ name even when that env var is set", () => {
    vi.stubEnv("AUTH_SECRET", "hunter2");
    try {
      expect(readEnvRef("AUTH_SECRET", process.env)).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
