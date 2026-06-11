"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/server/db/client";
import { dashboardPathForRole } from "./session";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export type LoginState = { error?: string } | undefined;

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) {
    return { error: "Please enter a valid email and password." };
  }
  const { email, password, next } = parsed.data;

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw err;
  }

  // Determine destination by role (cookie isn't readable within this request yet).
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim() },
    select: { role: true },
  });

  const dest =
    next && next.startsWith("/portal")
      ? next
      : user
        ? dashboardPathForRole(user.role)
        : "/portal/dashboard";

  redirect(dest);
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
