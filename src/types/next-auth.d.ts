import type { Role } from "@prisma/client";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      companyId: string;
      companySlug: string;
      role: Role;
      sessionVersion: number;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    companyId: string;
    companySlug: string;
    role: Role;
    sessionVersion: number;
  }
}
