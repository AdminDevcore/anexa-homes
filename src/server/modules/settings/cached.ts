import { cache } from "react";
import { settingsInventory } from "./inventory";
import { workspaceSetupGaps } from "./workspace-health";

/**
 * The Settings hub's numbers, deduped for one render pass.
 *
 * The rail wants them on EVERY screen under /portal/settings, and the hub wants
 * them too — so on the hub itself the layout and the page would each run all
 * sixteen counting queries. `cache` collapses that to one per request; Prisma
 * does no deduplication of its own.
 *
 * Their own module rather than an export beside each query, so the rail's
 * caching is one thing in one place rather than a line hidden at the bottom of
 * two unrelated files.
 */
export const settingsInventoryCached = cache(settingsInventory);

/** The same, for the "never set up" checks the rail dots come from. */
export const workspaceSetupGapsCached = cache(workspaceSetupGaps);
