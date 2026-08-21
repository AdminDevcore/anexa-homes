import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "./password";
import { isLoginAllowed, recordFailedLogin, clearLoginAttempts } from "./rate-limit";
import { isStaff } from "@/server/rbac/matrix";
import { authorizeGoogleSignIn, googleTokenClaims, isGoogleEnabled } from "./google";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authConfig: NextAuthConfig = {
  secret: process.env.AUTH_SECRET,
  trustHost: process.env.AUTH_TRUST_HOST === "true",
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  logger: {
    error(error) {
      // A session cookie encrypted with a previous AUTH_SECRET can't be decrypted
      // ("no matching decryption secret"). That's an expected logged-out state, not a
      // server error — swallow it so it doesn't spam the console / dev issues badge.
      if (error?.name === "JWTSessionError") return;
      console.error(error);
    },
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Throttle repeated failures for this identifier.
        if (!isLoginAllowed(email)) return null;

        const user = await prisma.user.findFirst({
          where: { email: email.toLowerCase().trim() },
          include: { company: { select: { slug: true } } },
        });
        // Staff only. Every live role is a staff role, so a row carrying a
        // retired one (`customer`, from before homeowner accounts were dropped)
        // is refused here — this is what makes "there is no customer portal" a
        // property of the system rather than a missing button.
        if (!user || user.status === "disabled" || user.status === "suspended" || !isStaff(user.role)) {
          recordFailedLogin(email);
          return null;
        }
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          recordFailedLogin(email);
          return null;
        }

        clearLoginAttempts(email);

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`.trim(),
          companyId: user.companyId,
          companySlug: user.company.slug,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    // Added only when credentials exist: Auth.js throws on boot for a provider
    // with no client id, and a deployment without Google configured must still
    // start. The login page reads `isGoogleEnabled` to decide whether to render
    // the button, so the two can never disagree.
    ...(isGoogleEnabled
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            // No `allowDangerousEmailAccountLinking`: Auth.js only reads that
            // inside its adapter path, which this config does not use. Linking
            // a Google identity to an existing staff row happens explicitly in
            // ./google.ts, behind the invite-only gate.
            //
            // Always show the account chooser, so somebody already signed into
            // a personal Google account picks deliberately rather than being
            // silently signed in as the wrong identity.
            authorization: { params: { prompt: "select_account" } },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Credentials sign-ins were already authorized in `authorize` above.
      if (account?.provider !== "google") return true;

      const p = profile as { hd?: string; email_verified?: boolean } | null;
      const outcome = await authorizeGoogleSignIn({
        email: user.email,
        emailVerified: p?.email_verified ?? null,
        hostedDomain: p?.hd ?? null,
      });
      if (outcome.ok) return true;

      // A string redirects there, instead of collapsing every refusal into
      // Auth.js's single `AccessDenied`. That distinction is the difference
      // between "no Anexa account uses this address" and "your account is
      // disabled" — both of which otherwise land on an unchanged login form
      // with nothing to read.
      return `/login?error=${outcome.reason}`;
    },
    async jwt({ token, user, account }) {
      // Google hands us a profile-shaped user whose `id` is Google's `sub`, not
      // our row id, and which carries no company, role or session version. The
      // real identity has to be looked up, or the session is a stranger with a
      // valid cookie.
      if (account?.provider === "google") {
        const claims = await googleTokenClaims(user?.email ?? (token.email as string | undefined));
        if (!claims) return token;
        token.userId = claims.userId;
        token.companyId = claims.companyId;
        token.companySlug = claims.companySlug;
        token.role = claims.role;
        token.sessionVersion = claims.sessionVersion;
        token.name = claims.name;
        return token;
      }
      if (user) {
        token.userId = user.id as string;
        token.companyId = (user as { companyId: string }).companyId;
        token.companySlug = (user as { companySlug: string }).companySlug;
        token.role = (user as { role: Role }).role;
        token.sessionVersion = (user as { sessionVersion: number }).sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.companyId = token.companyId as string;
        session.user.companySlug = token.companySlug as string;
        session.user.role = token.role as Role;
        session.user.sessionVersion = token.sessionVersion as number;
      }
      return session;
    },
  },
};
