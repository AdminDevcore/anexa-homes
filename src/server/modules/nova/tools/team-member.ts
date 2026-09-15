import { getTeamMembers } from "@/server/modules/team/queries";
import { refuseUnless } from "../access";
import { NOT_SET } from "../format";
import { defineTool, z } from "./define";

export const getTeamMember = defineTool({
  name: "get_team_member",
  kind: "read",
  description: "Look up a teammate by name: role, title, email, phone, team and status.",
  input: z.object({
    name: z.string().trim().min(2).max(60).describe("Part or all of the person's name."),
  }),
  async run(ctx, { name }) {
    // The Team page's own gate. A sales rep holds no User grant, so a rep is
    // refused here exactly as the page redirects them.
    const refused = refuseUnless(
      ctx.user,
      "read",
      "User",
      "look up team members — that needs access to the Team page"
    );
    if (refused) return refused;

    // getTeamMembers narrows a manager to their own team, as the page does.
    const tokens = name.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (await getTeamMembers(ctx.user)).filter((m) =>
      tokens.every((t) => m.name.toLowerCase().includes(t))
    );

    return {
      ok: true,
      data: {
        matches: matches.slice(0, 5).map((m) => ({
          name: m.name,
          role: m.roleLabel,
          title: m.title ?? NOT_SET,
          email: m.email ?? NOT_SET,
          phone: m.phone ?? NOT_SET,
          team: m.team ?? NOT_SET,
          status: m.status,
        })),
      },
    };
  },
});
