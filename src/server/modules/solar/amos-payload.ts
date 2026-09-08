/**
 * Translating an Anexa deal into a lender's partner-API application.
 *
 * Pure functions, no I/O — the network call lives in `amos-client.ts`. Kept
 * apart so the mapping can be tested exhaustively without a lender to talk to,
 * because a wrong figure here becomes a real credit application.
 *
 * WHAT WE DELIBERATELY DO NOT SEND
 *
 * No SSN, no date of birth, no consent flag. Not because the lender's contract
 * rejects them — it does — but because the authorization to pull a consumer
 * report has to be the customer's own, captured on the lender's page under
 * their disclosures. Anexa never handles that data, and staying out of it
 * keeps this system out of scope for it.
 */

/** The subset of a Lead this mapping reads. */
export type AmosLeadInput = {
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  /**
   * What the household would rather be spoken to in, free text, because which
   * languages a company serves is business config here rather than an enum.
   *
   * The lender's own field is a two-value enum, so `languageFor` translates and
   * SENDS NOTHING it cannot recognise — their default is English either way,
   * and an unrecognised value is a 422 on the whole application.
   */
  preferredLanguage?: string | null
}

type EquipmentRef = {
  manufacturer: string | null
  model: string
  /**
   * Nameplate watts, where the catalogue carries it. Read for ONE thing: how
   * many of this inverter it takes to carry the array — see `inverterCount`.
   */
  ratingW?: number | null
  /**
   * What the DEAL'S LENDER calls this same item on its own approved-vendor
   * list, from `SolarEquipmentLender`. Null where nobody has mapped it.
   *
   * Resolved by the caller, not looked up here, because this module is pure —
   * and because which translation applies is a fact about the deal's lender
   * rather than about the catalogue item.
   */
  lenderBrand?: string | null
  lenderModel?: string | null
} | null

/** The subset of a SolarDesign this mapping reads. */
export type AmosDesignInput = {
  id: string
  systemSizeKwDc: number
  /**
   * Production and usage USED TO LIVE HERE, read off the live design. They now
   * arrive on the options as part of `AmosSystemFigures`, from the frozen
   * proposal — because the saving is computed from the same three numbers, and
   * a lender handed a production figure that does not reconcile with the saving
   * beside it has been handed two different deals.
   */
  moduleQty: number
  batteryQty: number
  module: EquipmentRef
  inverter: EquipmentRef
  battery: EquipmentRef
}

/**
 * THE LENDER'S SAVINGS ANALYSIS: five figures, and all five are required.
 *
 * Amos will not underwrite a solar deal without them. Their intake calls the
 * set "the savings analysis" and refuses the application by name when any is
 * missing — which is how this was found: the API shipped requiring three
 * figures its own request schema had no fields for, so every solar submission
 * answered 500 and no payload could have succeeded.
 *
 * ALL FIVE COME FROM THE FROZEN PROPOSAL, never from the live rows. Same rule
 * the money follows and for the same reason: a lender has to be told what the
 * sheet in front of the household says, and a rep re-pricing mid-application
 * must not be able to move it. See `loadQuoted`.
 */
export type AmosSystemFigures = {
  /** Year one, as the document quotes it. */
  annualProductionKwh: number
  /** What the house uses, the denominator the offset was worked out against. */
  annualConsumptionKwh: number
  /**
   * The retail rate the proposal was priced at, in TENTHS OF A CENT per kWh —
   * `assumptions.currentRateMillsPerKwh`. 233 is $0.233/kWh.
   *
   * Kept in the snapshot's own unit all the way to the wire so there is exactly
   * one conversion, in `ratePerKwhString`, with a test on it. A rate that
   * crosses a boundary as "23.3" once and "0.233" the next is the shape of a
   * hundredfold error on a credit application.
   */
  retailRateMillsPerKwh: number
  /**
   * Year-one utility cost the system avoids — see `year1UtilityAvoidedCents`.
   * GROSS of the loan payment, which is what a savings analysis asks for.
   */
  annualUtilityAvoidedCents: number
  /**
   * THE ANNUAL UTILITY RISE THE COMPARISON ASSUMES, as a percentage: 3.5.
   *
   * Optional on the lender's contract and the reason to send it anyway is on
   * THEIR side of the wire, not ours: with no figure of their own their
   * disclosure line prints blank and their contract preflight refuses the send,
   * so a deal that was accepted stalls later for a field nobody was asked for.
   *
   * `assumptions.utilityEscalationPct` on the frozen snapshot — the same
   * assumption that escalated every year of the saving beside it, so the two
   * reconcile. Null on a document too old to carry one; we then say nothing and
   * their house rate stands, which is the honest reading of a document that
   * does not state it.
   */
  utilityEscalationPct?: number | null
}

export type AmosSubmitOptions = {
  productSlug: string
  /**
   * The reference this application is filed under, and the thing the lender is
   * idempotent on. Passed in rather than read off the design so a deal whose
   * reference the LENDER has broken can be given a fresh one — see
   * `SolarDesign.lenderSubmissionAttempt`.
   */
  externalId: string
  amountCents: number
  termMonths: number
  salesRepName: string
  /** The rep's answer. Anexa does not store this, so it is asked at send time. */
  ownerOccupied: boolean
  /**
   * Whether the response ALSO carries the completion link.
   *
   * BOTH VALUES EMAIL THE CUSTOMER. The lender's invitation always emails, and
   * texts too when a phone number is on file — there is no per-channel switch
   * and no way to suppress delivery. `in_person` only adds the link to the
   * response so a rep can hand over their own device.
   *
   * This matters for testing: there is no such thing as a silent submission.
   * A smoke test reaches whoever is on the lead, so put your own email AND
   * your own phone on it first.
   */
  delivery?: 'in_person' | 'customer'
  /**
   * Who bills the household for electricity, as the deal records it.
   *
   * Free text to the lender and matched loosely on their side, so a name that
   * is not on their curated list degrades rather than failing. They use it for
   * the interconnection paperwork after the sale, which is why it is worth
   * sending even imperfectly.
   */
  utilityProvider?: string | null
  /** The savings analysis, resolved from the document the customer was shown. */
  system: AmosSystemFigures
}

type EquipmentLine = {
  kind: 'panel' | 'inverter' | 'battery'
  brand: string
  model: string
  quantity: number
}

export type AmosApplicationPayload = {
  externalId: string
  productSlug: string
  applicant: {
    firstName: string
    lastName: string
    email: string
    phone: string
    /** Which language the lender emails and texts this household in. */
    languagePreference?: 'en' | 'es'
  }
  property: {
    line1: string
    city: string
    state: string
    postalCode: string
    ownerOccupied: boolean
    /** Who bills them for electricity. Omitted rather than sent empty. */
    utilityProvider?: string
  }
  system: {
    annualProductionKwh: number
    annualConsumptionKwh: number
    /** Dollars per kWh, as a string: "0.233". */
    retailRatePerKwh: string
    /** Dollars, two decimals, both of them at least 1.00 — the lender's floor. */
    estMonthlySaving: string
    estAnnualSaving: string
    /** Percent per year, as a string: "3.5". "0" is a real answer. */
    utilityEscalation?: string
  }
  equipment?: EquipmentLine[]
  requestedAmount: string
  termMonths: number
  salesRepName: string
  delivery: 'in_person' | 'customer'
}

/**
 * Everything that would make a submission fail, listed at once.
 *
 * Reported before the rep clicks rather than after, because the alternative is
 * an error message in front of a customer. Each string is written to be shown
 * to a rep verbatim.
 */
export function preflightAmosSubmission(
  lead: AmosLeadInput,
  design: AmosDesignInput,
  /** Named in the mapping problems, which send somebody to this partner's screen. */
  lenderName = 'This lender',
  /**
   * Boxes a hand-written field mapping now fills, so the deal is not blocked
   * over a value the partner is no longer told.
   *
   * Empty for every partner nobody has mapped, which is the default and was the
   * only behaviour before mappings existed. See `suppliedByMapping` — only an
   * override that actually RESOLVES gets in here, so a mapping that comes out
   * empty leaves its original blocker exactly where it was.
   */
  supplied: ReadonlySet<string> = new Set(),
): string[] {
  const problems: string[] = []

  if (!supplied.has('email') && !lead.email?.trim()) problems.push('The customer has no email address on file.')
  if (!supplied.has('phone') && !lead.phone?.trim()) problems.push('The customer has no phone number on file.')
  if (!supplied.has('address') && !lead.address?.trim()) problems.push('The property has no street address.')
  if (!supplied.has('city') && !lead.city?.trim()) problems.push('The property has no city.')
  if (!supplied.has('state') && !lead.state?.trim()) problems.push('The property has no state.')
  if (!supplied.has('zip') && !lead.zip?.trim()) problems.push('The property has no ZIP code.')

  if (!design.module) {
    problems.push('The design has no panel selected.')
  } else {
    if (!design.module.manufacturer?.trim()) {
      problems.push('The selected panel has no manufacturer — the lender matches on brand and model.')
    }
    if (design.moduleQty < 1) problems.push('The design has no panel quantity.')
  }

  if (!design.inverter) {
    problems.push('The design has no inverter selected.')
  } else if (!design.inverter.manufacturer?.trim()) {
    problems.push('The selected inverter has no manufacturer — the lender matches on brand and model.')
  }

  if (design.batteryQty > 0 && design.battery && !design.battery.manufacturer?.trim()) {
    problems.push('The selected battery has no manufacturer — the lender matches on brand and model.')
  }

  /**
   * THE ITEM IS ON OUR CATALOGUE AND NOT ON THEIRS, OR IS ON BOTH UNDER TWO
   * NAMES. Either way the lender answers 422 `unknown_equipment` and the deal
   * bounces — so it is caught here, before the button is offered, rather than
   * after a homeowner has pressed it.
   *
   * Only the items that will actually be SENT are checked: a design with no
   * battery on it is not blocked by a battery nobody mapped.
   */
  for (const item of equipmentToMap(design)) {
    if (!isMapped(item.ref)) {
      problems.push(
        `${lenderName} has no name on file for the ${item.what} “${describe(item.ref)}”. ` +
          `Map it to their approved-vendor list in Settings → Lenders → ${lenderName} → Equipment.`,
      )
    }
  }

  return problems
}

/**
 * THE LENDER'S FLOOR ON A SAVING: one dollar a month, and one a year.
 *
 * Their schema rejects zero and cannot express a negative at all — the amount
 * pattern has no minus sign in it. That is not an oversight on their part: the
 * figure they are asking for is the electricity bill that stops arriving, which
 * is positive on any system that generates anything.
 */
const LENDER_MIN_SAVING_CENTS = 100

/**
 * Everything about the SAVINGS ANALYSIS that would make a submission fail.
 *
 * Separate from `preflightAmosSubmission` because these five figures come from
 * a different place — the frozen document rather than the deal's own rows — and
 * a caller that has not resolved one yet has nothing to check. Each string is
 * written to be shown to a rep verbatim, and every one of them names the thing
 * to go and fix.
 */
export function savingsProblems(figures: AmosSystemFigures | null): string[] {
  if (!figures) {
    return [
      'This deal has no generated proposal, and the lender will not take an application without ' +
        'the savings figures a proposal works out. Generate one first.',
    ]
  }

  const problems: string[] = []

  if (figures.annualProductionKwh <= 0) {
    problems.push('The proposal quotes no annual production. Draw the array and generate it again.')
  }
  if (figures.annualConsumptionKwh <= 0) {
    problems.push(
      "The proposal quotes no annual usage, so there is nothing to measure a saving against. " +
        'Put the household’s usage on the Energy step and generate it again.',
    )
  }
  if (figures.retailRateMillsPerKwh <= 0) {
    problems.push(
      'The proposal has no utility rate on it, which is what the saving is worked out from. ' +
        'Set the rate on the Energy step and generate it again.',
    )
  }

  // Checked on the MONTHLY figure as well as the annual one, because both cross
  // the wire and the lender applies its floor to each: a year that clears a
  // dollar by a hair divides into twelve months that do not.
  const monthly = monthlyFrom(figures.annualUtilityAvoidedCents)
  if (
    figures.annualUtilityAvoidedCents < LENDER_MIN_SAVING_CENTS ||
    monthly < LENDER_MIN_SAVING_CENTS
  ) {
    problems.push(
      'This proposal shows no saving on the electricity bill, and the lender will not accept an ' +
        'application without one. Check the usage, the rate and the array before sending it.',
    )
  }

  return problems
}

/** The pieces of a design that become equipment lines, where they exist. */
function equipmentToMap(design: AmosDesignInput): { what: string; ref: NonNullable<EquipmentRef> }[] {
  const out: { what: string; ref: NonNullable<EquipmentRef> }[] = []
  if (design.module?.manufacturer?.trim() && design.moduleQty > 0) {
    out.push({ what: 'panel', ref: design.module })
  }
  if (design.inverter?.manufacturer?.trim() && design.moduleQty > 0) {
    out.push({ what: 'inverter', ref: design.inverter })
  }
  if (design.battery?.manufacturer?.trim() && design.batteryQty > 0) {
    out.push({ what: 'battery', ref: design.battery })
  }
  return out
}

/** Both halves or neither — see `submittedName`. */
function isMapped(ref: NonNullable<EquipmentRef>): boolean {
  return !!ref.lenderBrand?.trim() && !!ref.lenderModel?.trim()
}

/** Our own name for an item, as it reads in a sentence to a rep. */
function describe(ref: NonNullable<EquipmentRef>): string {
  return [ref.manufacturer, ref.model].filter(Boolean).join(' ').trim() || ref.model
}

/**
 * How many of this inverter the array needs.
 *
 * Anexa stores no inverter count, and this used to send the PANEL count on the
 * reasoning that a microinverter system has one per panel and a string design
 * "is corrected by the lender's own review". It is not corrected: a real
 * submission went out claiming 29 Tesla PV Standalone Inverters — a 220 kW
 * bill of materials on a 12.76 kW roof — for a system that has one or two.
 *
 * Nameplate answers it without a new column. A 366 W microinverter cannot
 * carry a 12.76 kW array, so the arithmetic asks for 35 and the clamp brings
 * it back to the 29 panels there are; a 7.6 kW string inverter asks for 2 and
 * gets 2. The clamp is the part that makes this safe in both directions —
 * there can never be more inverters than panels on a microinverter design.
 *
 * With no wattage on the catalogue row there is nothing to reason from, so it
 * falls back to the panel count exactly as before. That is a guess, and it is
 * the guess this system has always made; filling the rated watts in on the
 * equipment item is what turns it into an answer.
 */
export function inverterCount(design: AmosDesignInput): number {
  const rated = design.inverter?.ratingW
  if (!rated || rated <= 0) return design.moduleQty
  const arrayWatts = design.systemSizeKwDc * 1000
  if (arrayWatts <= 0) return 1
  return Math.min(design.moduleQty, Math.max(1, Math.ceil(arrayWatts / rated)))
}

/**
 * A year's figure as the month the lender asks for.
 *
 * Rounded ONCE, from the annual number, so the two amounts on the wire are the
 * same fact told twice rather than two independent roundings that fail to
 * multiply back to one another.
 */
function monthlyFrom(annualCents: number): number {
  return Math.round(annualCents / 12)
}

/**
 * Tenths of a cent per kWh -> dollars per kWh, as a string: 233 -> "0.233".
 *
 * THREE DECIMALS, which is the precision the customer's own document prints
 * ("Your current rate — $0.233 per kWh") and one more than money carries. A
 * residential rate rounded to cents is 12% wrong at the bottom of the range,
 * and this figure is an input to the lender's own arithmetic, not a display.
 */
function ratePerKwhString(mills: number): string {
  return (mills / 1000).toFixed(3)
}

/**
 * THE LENDER'S TWO LANGUAGES, out of our free-text one.
 *
 * Their field is an enum and an unrecognised member is a 422 on the WHOLE
 * application, so this recognises rather than translates: anything it does not
 * know returns undefined and the field is left off, which lands the household
 * on their English default — the same place they were before this was sent at
 * all. A Vietnamese-speaking customer is not a reason to refuse a loan.
 *
 * Deliberately generous about how the word was typed, because this box is a rep
 * typing what somebody said at a door: "Spanish", "spanish", "Español",
 * "espanol", "ES" are all the same answer.
 */
function languageFor(raw: string | null | undefined): 'en' | 'es' | undefined {
  const t = (raw ?? '')
    .trim()
    .toLowerCase()
    // Strip the accents so "español" and "espanol" are one answer.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  if (t === '') return undefined
  if (/^(es|esp|spa|spanish|espanol|castellano)$/.test(t)) return 'es'
  if (/^(en|eng|english|ingles)$/.test(t)) return 'en'
  return undefined
}

/**
 * The utility rise as the lender wants it: a percentage string, "0" to "10".
 *
 * Zero is a real answer and must survive — a company that assumes rates hold
 * flat is saying something, and dropping it would silently substitute their
 * house rate for a deliberate assumption. Anything outside their range, or not
 * a number at all, is left off instead of clamped: a clamp would send a figure
 * the proposal never used, and their fallback is a stated rate rather than a
 * blank.
 *
 * Two decimals at most, trailing zeros trimmed, so 3.5 goes as "3.5".
 */
function escalationString(pct: number | null | undefined): string | undefined {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return undefined
  if (pct < 0 || pct > 10) return undefined
  return String(Number(pct.toFixed(2)))
}

/** Their box is 120 characters; ours is unbounded. Omitted rather than blank. */
function utilityProviderString(raw: string | null | undefined): string | undefined {
  const t = (raw ?? '').trim()
  if (t === '') return undefined
  return t.slice(0, 120)
}

/** Integer cents -> a decimal string. Money never crosses the wire as a float. */
function centsToDecimalString(cents: number): string {
  const whole = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100)
  return `${whole}.${String(rest).padStart(2, '0')}`
}

/**
 * The name to send for one item: the partner's own, where somebody has written
 * it down, and ours otherwise.
 *
 * Both halves move together on purpose. A row that pairs their brand with our
 * model — or the reverse — is not a name either catalogue contains, so a
 * half-filled mapping is treated as no mapping at all rather than as an
 * improvement on ours.
 */
function submittedName(ref: NonNullable<EquipmentRef>): { brand: string; model: string } {
  const brand = ref.lenderBrand?.trim()
  const model = ref.lenderModel?.trim()
  if (brand && model) return { brand, model }
  return { brand: (ref.manufacturer ?? '').trim(), model: ref.model.trim() }
}

function line(
  kind: EquipmentLine['kind'],
  ref: EquipmentRef,
  quantity: number,
): EquipmentLine | null {
  if (!ref || !ref.manufacturer?.trim() || quantity < 1) return null
  return { kind, ...submittedName(ref), quantity }
}

/**
 * Build the request body.
 *
 * Call `preflightAmosSubmission` first — this function assumes the deal is
 * complete and coerces what it is given rather than validating again.
 */
export function buildAmosPayload(
  lead: AmosLeadInput,
  design: AmosDesignInput,
  opts: AmosSubmitOptions,
): AmosApplicationPayload {
  const equipment = [
    line('panel', design.module, design.moduleQty),
    line('inverter', design.inverter, inverterCount(design)),
    line('battery', design.battery, design.batteryQty),
  ].filter((l): l is EquipmentLine => l !== null)

  const f = opts.system
  const monthlyAvoidedCents = monthlyFrom(f.annualUtilityAvoidedCents)
  const escalation = escalationString(f.utilityEscalationPct)
  const system: AmosApplicationPayload['system'] = {
    annualProductionKwh: f.annualProductionKwh,
    annualConsumptionKwh: f.annualConsumptionKwh,
    retailRatePerKwh: ratePerKwhString(f.retailRateMillsPerKwh),
    estMonthlySaving: centsToDecimalString(monthlyAvoidedCents),
    estAnnualSaving: centsToDecimalString(f.annualUtilityAvoidedCents),
    // Every optional field is OMITTED rather than sent empty. Their validator
    // reads a present-but-blank box as an answer and a missing one as silence,
    // and silence is what we mean.
    ...(escalation !== undefined ? { utilityEscalation: escalation } : {}),
  }

  const language = languageFor(lead.preferredLanguage)
  const utilityProvider = utilityProviderString(opts.utilityProvider)

  return {
    // Re-sending the same reference returns the same application instead of
    // creating a second one. Normally the design id; see `externalId`.
    externalId: opts.externalId,
    productSlug: opts.productSlug,
    applicant: {
      firstName: lead.firstName.trim(),
      lastName: lead.lastName.trim(),
      email: (lead.email ?? '').trim().toLowerCase(),
      phone: (lead.phone ?? '').replace(/[\s()\-.]/g, ''),
      ...(language !== undefined ? { languagePreference: language } : {}),
    },
    property: {
      line1: (lead.address ?? '').trim(),
      city: (lead.city ?? '').trim(),
      state: (lead.state ?? '').trim().toUpperCase(),
      postalCode: (lead.zip ?? '').trim(),
      ownerOccupied: opts.ownerOccupied,
      ...(utilityProvider !== undefined ? { utilityProvider } : {}),
    },
    // System size is deliberately absent: the lender derives DC nameplate from
    // panel wattage x count for any deal carrying a panel and ignores a
    // submitted figure. Sending ours would imply it is authoritative.
    //
    // The block itself is never omitted any more. It used to be dropped when
    // production and usage were both zero, which is a shape their solar product
    // refuses outright — see `savingsProblems`, which stops such a deal before
    // a homeowner can press anything.
    system,
    ...(equipment.length > 0 ? { equipment } : {}),
    requestedAmount: centsToDecimalString(opts.amountCents),
    termMonths: opts.termMonths,
    salesRepName: opts.salesRepName.trim(),
    delivery: opts.delivery ?? 'in_person',
  }
}
