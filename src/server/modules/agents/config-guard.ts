/**
 * Agent config holds REFERENCES to secrets, never secret values.
 *
 * `CompanySettings.bookkeepingApiKey` is stored in plaintext; this is the guard
 * that stops agent config from repeating that. A key that names a secret must
 * end in `Ref` and hold a reference this module can parse.
 */

export type SecretRef = { kind: "env"; name: string } | { kind: "lender"; lenderId: string };

const ENV_REF = /^env:(AGENT_[A-Z0-9_]+)$/;
const LENDER_REF = /^lender:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * `env:` is limited to AGENT_-prefixed variables so a config can never point a
 * handler at AUTH_SECRET, CRON_SECRET, or any other key the app itself runs on.
 */
export function parseSecretRef(ref: string): SecretRef | null {
  const env = ENV_REF.exec(ref);
  if (env) return { kind: "env", name: env[1] };
  const lender = LENDER_REF.exec(ref);
  if (lender) return { kind: "lender", lenderId: lender[1] };
  return null;
}

/**
 * A second guard alongside `parseSecretRef`: this refuses to read anything
 * outside the AGENT_ prefix even if a caller reaches for it directly, so
 * AUTH_SECRET or CRON_SECRET can never come back through this path either.
 * The value is returned exactly as stored, not trimmed — trimming is only
 * used to decide whether it's set to something.
 */
export function readEnvRef(name: string, env: Record<string, string | undefined>): string | null {
  if (!name.startsWith("AGENT_")) return null;
  const value = env[name];
  return value && value.trim() ? value : null;
}

const SECRET_WORDS = new Set([
  "password",
  "passwords",
  "passwd",
  "passcode",
  "passcodes",
  "secret",
  "secrets",
  "token",
  "credential",
  "credentials",
  "otp",
  "totp",
  "mfa",
  "apikey",
]);

/** Adjacent whole words that only mean "secret" as a pair — "tokens" alone must stay allowed. */
const SECRET_WORD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["api", "key"],
  ["api", "keys"],
  ["private", "key"],
];

/**
 * "portalApiKey" → ["portal", "api", "key"]; "client_secret" → ["client", "secret"];
 * "SFTPPassword" → ["sftp", "password"]; "password2" → ["password", "2"].
 */
function words(key: string): string[] {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** True when the key names a secret as a whole word — "footprint" is not "otp". */
export function keyNamesSecret(key: string): boolean {
  const w = words(key);
  if (w.some((x) => SECRET_WORDS.has(x))) return true;
  return SECRET_WORD_PAIRS.some(([a, b]) => w.some((x, i) => x === a && w[i + 1] === b));
}

/**
 * The first place `config`'s KEY NAMES look like a secret, as a message; null
 * when clean. This checks names, not values: a raw credential stored under
 * an innocent key — `{ portal: { pw: "…" } }` — is not detected. That gap is
 * why how agent credentials get stored is still an open question.
 */
export function findSecretValues(config: unknown, path = "config"): string | null {
  if (Array.isArray(config)) {
    for (let i = 0; i < config.length; i++) {
      const hit = findSecretValues(config[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (config === null || typeof config !== "object") return null;

  for (const [key, value] of Object.entries(config)) {
    const here = `${path}.${key}`;
    if (keyNamesSecret(key)) {
      const w = words(key);
      if (w[w.length - 1] !== "ref") {
        return `${here} looks like a secret. Store a reference instead: a key ending in "Ref" holding env:AGENT_NAME or lender:<id>.`;
      }
      if (typeof value !== "string" || !parseSecretRef(value)) {
        return `${here} must be a reference: env:AGENT_NAME or lender:<id>.`;
      }
      continue;
    }
    const hit = findSecretValues(value, here);
    if (hit) return hit;
  }
  return null;
}
