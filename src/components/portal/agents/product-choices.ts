import type { Product } from "@/lib/agent-labels";
import { companyVerticals, userVerticals } from "@/server/auth/vertical";

/**
 * What an editor may set an agent's product to: Both, or a live workspace they
 * hold.
 *
 * Server-only, despite living beside the components: `userVerticals` reaches
 * for the request's cookies. The pages call this and pass the RESULT — a plain
 * array of strings — into the form.
 */
export function productChoicesFor(user: Parameters<typeof userVerticals>[0]): Product[] {
  const held = userVerticals(user);
  return ["both", ...companyVerticals().filter((v) => held.includes(v))];
}
