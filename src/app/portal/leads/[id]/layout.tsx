import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { leadAccessible } from "@/server/rbac/lead-access";

/**
 * One row-scope check in front of every page under a deal.
 *
 * `/portal/leads/<id>` has always resolved its deal through `listScope` and
 * 404'd a rep who does not own it. The routes UNDERNEATH it did not: the three
 * solar proposal pages each fetched `{ id, companyId }`, so the same rep the
 * deal page refused could read that customer's name, address, system and price
 * ladder by typing a longer URL. The bug was not in any one of them — it was
 * that each new child route had to remember, and eventually one did not.
 *
 * THIS IS A BACKSTOP, NOT THE BOUNDARY. Next.js renders layouts and pages
 * independently, and a soft navigation can request a child segment on its own
 * without re-running an unchanged parent layout. So this catches a child route
 * that forgets, on a cold request, which is the common case — but every page
 * below still resolves its own lead through `listScope` / `leadAccessible`,
 * and must keep doing so. Two checks, deliberately, because one of them is
 * cheap and the other is the one that is always true.
 *
 * `notFound()` rather than a redirect: a rep who guesses an id should not be
 * able to tell "no such deal" from "somebody else's deal".
 */
export default async function LeadScopeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!(await leadAccessible(user, id))) notFound();
  return <>{children}</>;
}
