"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { createWelcomeCall, resendWelcomeCall, voidWelcomeCall, confirmWelcomeCall } from "./service";
import { asCallKind, type CallKind } from "./types";

function fail(error: string) {
  return { ok: false as const, error };
}
function ok<T extends object = object>(extra?: T) {
  return { ok: true as const, ...(extra ?? ({} as T)) };
}

const nameSchema = z.string().trim().min(1, "Enter a name.").max(80, "Name is too long.");
const itemSchema = z.object({ id: z.string().min(1), title: z.string().max(200), body: z.string().max(4000) });
const contentSchema = z.object({
  intro: z.string().max(4000),
  closing: z.string().max(4000),
  items: z.array(itemSchema).max(50),
});
const TPL_PATH = "/portal/settings/call-templates";

// --------------------------- Template CRUD (admins) -------------------------

export async function createWelcomeCallTemplateAction(name: string, kind: CallKind = "welcome") {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const last = await prisma.welcomeCallTemplate.findFirst({ where: { companyId: user.companyId }, orderBy: { position: "desc" }, select: { position: true } });
  const created = await prisma.welcomeCallTemplate.create({
    data: { companyId: user.companyId, name: parsed.data, kind: asCallKind(kind), position: (last?.position ?? -1) + 1 },
    select: { id: true },
  });
  revalidatePath(TPL_PATH);
  return ok({ id: created.id });
}

export async function setWelcomeCallTemplateKindAction(id: string, kind: CallKind) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const t = await prisma.welcomeCallTemplate.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!t) return fail("Template not found.");
  await prisma.welcomeCallTemplate.update({ where: { id }, data: { kind: asCallKind(kind) } });
  revalidatePath(TPL_PATH);
  revalidatePath(`${TPL_PATH}/${id}`);
  return ok();
}

export async function renameWelcomeCallTemplateAction(id: string, name: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const t = await prisma.welcomeCallTemplate.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!t) return fail("Template not found.");
  await prisma.welcomeCallTemplate.update({ where: { id }, data: { name: parsed.data } });
  revalidatePath(TPL_PATH);
  revalidatePath(`${TPL_PATH}/${id}`);
  return ok();
}

export async function updateWelcomeCallTemplateContentAction(id: string, content: { intro: string; closing: string; items: { id: string; title: string; body: string }[] }) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  // Normalize: ensure every item has a stable id.
  const normalized = { ...content, items: content.items.map((it) => ({ ...it, id: it.id || nanoid(8) })) };
  const parsed = contentSchema.safeParse(normalized);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const t = await prisma.welcomeCallTemplate.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!t) return fail("Template not found.");
  await prisma.welcomeCallTemplate.update({
    where: { id },
    data: { intro: parsed.data.intro || null, closing: parsed.data.closing || null, items: parsed.data.items },
  });
  revalidatePath(`${TPL_PATH}/${id}`);
  return ok();
}

export async function setWelcomeCallTemplateActiveAction(id: string, active: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const t = await prisma.welcomeCallTemplate.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!t) return fail("Template not found.");
  await prisma.welcomeCallTemplate.update({ where: { id }, data: { active } });
  revalidatePath(TPL_PATH);
  return ok();
}

export async function moveWelcomeCallTemplateAction(id: string, dir: "up" | "down") {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const all = await prisma.welcomeCallTemplate.findMany({ where: { companyId: user.companyId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return fail("Template not found.");
  const target = dir === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= all.length) return ok();
  const order = all.map((s) => s.id);
  [order[idx], order[target]] = [order[target], order[idx]];
  await prisma.$transaction(order.map((sid, i) => prisma.welcomeCallTemplate.update({ where: { id: sid }, data: { position: i } })));
  revalidatePath(TPL_PATH);
  return ok();
}

export async function deleteWelcomeCallTemplateAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const t = await prisma.welcomeCallTemplate.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!t) return fail("Template not found.");
  // Sent sessions keep their snapshot (templateId is SET NULL on delete).
  await prisma.welcomeCallTemplate.delete({ where: { id } });
  revalidatePath(TPL_PATH);
  return ok();
}

// --------------------------- Send / resend / void (staff) -------------------

export async function sendWelcomeCallAction(leadId: string, templateId: string) {
  const user = await requireUser();
  if (!can(user, "create", "Document")) return fail("Not allowed.");
  const res = await createWelcomeCall(user.companyId, user.userId, leadId, templateId);
  if (res.ok) revalidatePath(`/portal/leads/${leadId}`);
  return res;
}

export async function resendWelcomeCallAction(sessionId: string) {
  const user = await requireUser();
  if (!can(user, "create", "Document")) return fail("Not allowed.");
  const res = await resendWelcomeCall(user.companyId, sessionId);
  if (res.ok) revalidatePath("/portal/documents");
  return res;
}

export async function voidWelcomeCallAction(sessionId: string) {
  const user = await requireUser();
  if (!can(user, "create", "Document")) return fail("Not allowed.");
  const res = await voidWelcomeCall(user.companyId, sessionId);
  if (res.ok) revalidatePath("/portal/documents");
  return res;
}

// --------------------------- Customer confirm (public) ----------------------

export async function confirmWelcomeCallAction(token: string, ackedIds: string[]) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return confirmWelcomeCall(token, ackedIds, ip);
}
