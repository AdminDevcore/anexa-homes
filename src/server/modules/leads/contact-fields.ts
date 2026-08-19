import { z } from "zod";

/**
 * The contact half of a lead.
 *
 * Shared by the full deal edit form and the solar proposal builder's Customer
 * step, extracted rather than duplicated: two definitions of a valid name are
 * two places for them to drift, and the drift shows up as a value one screen
 * accepts and the other rejects.
 *
 * Deliberately NOT the whole lead. A proposal screen has no business posting a
 * stage or an assigned rep back, so the narrow action composed from this cannot
 * change one by accident.
 */
export const leadContactFields = {
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  coOwnerName: z.string().max(80).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  address: z.string().max(160).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  state: z.string().max(40).optional().or(z.literal("")),
  zip: z.string().max(12).optional().or(z.literal("")),
};
