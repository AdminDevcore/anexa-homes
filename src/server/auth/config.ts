import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "./password";
import { isLoginAllowed, recordFailedLogin, clearLoginAttempts } from "./rate-limit";

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
        // The customer role is retired — no customer may sign in or access the app.
        if (!user || user.status === "disabled" || user.status === "suspended" || user.role === "customer") {
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
  ],
  callbacks: {
    async jwt({ token, user }) {
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
