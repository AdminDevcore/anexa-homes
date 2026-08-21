# Sign in with Google

"Continue with Google" on `/login`, alongside email + password. Off until
configured: with no client id the provider is not registered at all and the
button is not rendered, so shipping this changed nothing until the environment
variables below were set.

## What it is, and what it is not

Google is **identity proof, not signup**. The `User` row must already exist —
created by an admin on the Team page — and signing in attaches that Google
identity to it. Nothing in this flow creates a user, so somebody with a Google
account and the login URL still cannot get in.

The gate applies the same rules as the password path:

| Check | Refusal |
|---|---|
| Google shared an email | `google_email_missing` |
| Google says it is verified | `google_email_unverified` |
| Workspace domain matches, when restricted | `google_domain_not_allowed` |
| A user row exists for that address | `no_account` |
| Its status is `active` or `invited` | `account_inactive` |
| Its role is a staff role | `account_not_staff` |
| Exactly one row matches | `account_ambiguous` |

Each refusal redirects to `/login?error=<reason>` and renders its own sentence.
Auth.js collapses every refusal into a single `AccessDenied`, which is why the
callback returns its own code instead — the difference between "no account uses
this address" and "your account is disabled" is the whole diagnostic value.

`invited` is admitted deliberately: signing in with Google is a legitimate way
to accept an invite, and the credentials path admits it too. Those two lists
must stay in agreement.

## Setup

**1 · Google Cloud Console** → APIs & Services → Credentials →
Create credentials → OAuth client ID → **Web application**.

Authorised redirect URIs — exact, one per environment:

```
https://anexahomes.com/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

The path is fixed by Auth.js. A trailing slash or a missing `/api` produces
`redirect_uri_mismatch`, which Google reports and the app never sees.

**2 · Environment variables** (Vercel → Settings → Environment Variables, and
`.env` locally):

```
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
GOOGLE_ALLOWED_HD=          # optional
```

`GOOGLE_ALLOWED_HD` restricts sign-in to one Google Workspace domain, e.g.
`anexahomes.com`. A personal `@gmail.com` account carries no `hd` claim at all
and is refused whenever this is set — which is the point of setting it. Leave it
empty and any Google address that matches a staff row may sign in.

**3 · Redeploy.** The provider list is built at boot from these variables, so a
running instance does not pick them up.

## Where the code is

- `src/lib/google-signin.ts` — the decision, pure and unit-tested
  (`src/lib/__tests__/google-signin.test.ts`)
- `src/server/auth/google.ts` — the database half, plus `isGoogleEnabled`
- `src/server/auth/config.ts` — provider registration, `signIn` gate, and the
  `jwt` callback that resolves the real user

There is deliberately no `@auth/prisma-adapter`. This schema has no `Account`,
`Session` or `VerificationToken` model for an adapter to write to, sessions are
JWTs, and `getUserByEmail` would fail regardless because `User` is keyed
`@@unique([companyId, email])` with no standalone unique on `email`.

That last detail is also why matching is case-insensitive: nothing stops
`Dana@x.com` and `dana@x.com` from both existing, and Google returns whatever
casing the address was registered with. When several rows match, an exact match
wins; if that still leaves more than one, the sign-in is refused rather than
guessed at, because choosing between two accounts would be authenticating as
the wrong person.

## What is not covered by tests

The OAuth round trip itself. `e2e/auth.spec.ts` covers the two ends — the button
appears only when configured, and a refusal renders a sentence — but signing in
through Google needs real credentials and a real Google account. Verify that by
hand once after setup.
