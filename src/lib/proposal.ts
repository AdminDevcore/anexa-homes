// Pure logic for the customer-facing roofing presentation/proposal.
// No DB access — shared by the builder, the server serializers, and the renderer
// so all three agree. Money is in integer cents. NOTHING here may expose internal
// cost, profit, commission, or supplement margin to the customer.

export type ProposalUpgrade = { label: string; priceCents: number; selected: boolean };

export type ProposalSectionRef = { id: ProposalSectionId; enabled: boolean; order: number };

export type ProposalContent = {
  roofType?: string;
  damageSummary?: string;
  recommendedNextStep?: string;
  dateOfLoss?: string | null;
  // Customer-paid deductible (cents). When set, overrides the claim's deductible
  // in the customer-facing financial summary; falls back to the claim if unset.
  deductibleCents?: number;
  // General project discount (cents) applied to the customer's out-of-pocket.
  // This is NOT a deductible rebate — the deductible figure is shown intact so the
  // Texas §707 disclaimer stays accurate. The discount reduces the out-of-pocket total.
  projectDiscountCents?: number;
  // Optional 0%-interest financing of the out-of-pocket, presented as monthly options.
  financing?: { enabled: boolean; termsMonths: number[] };
  // Damage-type + roof-condition checkboxes (e.g. hail_damage, missing_shingles, …).
  conditionFlags?: Record<string, boolean>;
  // Editable hail/wind explanation paragraph for the condition section.
  conditionNarrative?: string;
  // fileAssetId -> caption/note.
  photoCaptions?: Record<string, string>;
  // fileAssetIds to include in the gallery (empty/undefined = include all).
  includedPhotoIds?: string[];
  upgrades?: ProposalUpgrade[];
  selectedSections?: ProposalSectionRef[];
  faq?: { q: string; a: string }[];
  whyAnexa?: string[];
  financialNote?: string;
};

export const PROPOSAL_SECTIONS = [
  "cover",
  "overview",
  "photos",
  "condition",
  "scope",
  "upgrades",
  "timeline",
  "financial",
  "why",
  "faq",
  "signature",
] as const;

export type ProposalSectionId = (typeof PROPOSAL_SECTIONS)[number];

export const SECTION_LABELS: Record<ProposalSectionId, string> = {
  cover: "Cover",
  overview: "Project Overview",
  photos: "Inspection Photos",
  condition: "Roof Condition Summary",
  scope: "Scope of Work",
  upgrades: "Upgrades & Recommendations",
  timeline: "Timeline",
  financial: "Financial Summary",
  why: "Why Anexa Homes",
  faq: "FAQ",
  signature: "Next Steps",
};

// Cause-of-loss checkpoints shown next to the affected areas in the builder + condition section.
export const DAMAGE_TYPE_ITEMS: { key: string; label: string }[] = [
  { key: "hail_damage", label: "Hail damage" },
  { key: "wind_damage", label: "Wind damage" },
];

// Roof-condition checkboxes shown in the builder + condition section.
export const ROOF_CONDITION_ITEMS: { key: string; label: string }[] = [
  { key: "missing_shingles", label: "Missing shingles" },
  { key: "creased_shingles", label: "Creased shingles" },
  { key: "lifted_shingles", label: "Lifted shingles" },
  { key: "soft_metals", label: "Soft metals (vents, flashing, gutters)" },
  { key: "gutters", label: "Gutter damage" },
  { key: "screens", label: "Window screen damage" },
];

export type ProposalFinancials = {
  customerUpgradesCents: number;
  totalProjectValueCents: number;
  projectDiscountCents: number;
  estimatedOutOfPocketCents: number;
};

/** Customer-facing money summary. Out-of-pocket = deductible + upgrades − discount
 *  (upgrades are above the insurance scope; the discount is a general project
 *  discount, never a deductible rebate). Recoverable depreciation is shown/noted
 *  but is NOT out-of-pocket (the carrier releases it after completion). */
export function computeProposalFinancials(i: {
  rcvCents: number;
  acvCents: number;
  deductibleCents: number;
  depreciationCents: number;
  approvedSupplementsCents: number;
  upgrades: ProposalUpgrade[];
  projectDiscountCents?: number;
}): ProposalFinancials {
  const customerUpgradesCents = i.upgrades
    .filter((u) => u.selected)
    .reduce((s, u) => s + Math.max(0, u.priceCents || 0), 0);
  const totalProjectValueCents = i.rcvCents + i.approvedSupplementsCents + customerUpgradesCents;
  // The discount can't exceed the gross out-of-pocket (no negative cost shown).
  const grossOutOfPocketCents = i.deductibleCents + customerUpgradesCents;
  const projectDiscountCents = Math.min(grossOutOfPocketCents, Math.max(0, i.projectDiscountCents || 0));
  const estimatedOutOfPocketCents = grossOutOfPocketCents - projectDiscountCents;
  return { customerUpgradesCents, totalProjectValueCents, projectDiscountCents, estimatedOutOfPocketCents };
}

// Standard 0%-interest financing terms (months) offered on the out-of-pocket.
export const FINANCING_TERMS = [12, 18, 24, 36, 48, 60] as const;

export type FinancingOption = { months: number; monthlyCents: number };

/** 0%-interest monthly options for a given amount. Last payment may differ by a
 *  cent or two; monthly is rounded up so the schedule never under-collects. */
export function financingOptions(amountCents: number, termsMonths: number[]): FinancingOption[] {
  return termsMonths
    .filter((m) => m > 0)
    .slice()
    .sort((a, b) => a - b)
    .map((months) => ({ months, monthlyCents: Math.ceil(amountCents / months) }));
}

/** True once every REQUIRED checklist slot has at least one uploaded photo.
 *  `counts` maps a checklist item id -> number of photos in that slot. */
export function requiredPhotosMet(
  items: { id: string; required: boolean }[],
  counts: Record<string, number>,
): boolean {
  return items.filter((it) => it.required).every((it) => (counts[it.id] ?? 0) > 0);
}

export function defaultSections(): ProposalSectionRef[] {
  return PROPOSAL_SECTIONS.map((id, order) => ({ id, enabled: true, order }));
}

export function defaultUpgrades(): ProposalUpgrade[] {
  return [
    "Architectural shingles",
    "Impact-resistant shingles",
    "Synthetic underlayment",
    "Ice & water shield",
    "Ridge ventilation",
    "Gutter replacement",
    "Metal roof option",
  ].map((label) => ({ label, priceCents: 0, selected: false }));
}

export function roofingTimeline(): string[] {
  return [
    "Inspection completed",
    "Claim filed",
    "Adjuster meeting",
    "Scope review",
    "Supplement request (if needed)",
    "Material selection",
    "Production scheduled",
    "Roof installation",
    "Final inspection",
    "Depreciation request",
    "Final closeout",
  ];
}

export function defaultFaq(): { q: string; a: string }[] {
  return [
    {
      q: "Do I have to pay my deductible?",
      a: "Yes. In Texas your insurance deductible is your responsibility and by law cannot be waived, rebated, or absorbed by the contractor.",
    },
    {
      q: "What happens if insurance missed items?",
      a: "We document everything with photos and file a supplement to your carrier for any missed or underpaid items.",
    },
    {
      q: "How long does a roof replacement take?",
      a: "Most residential roofs are installed in 1–2 days once materials are delivered and production is scheduled.",
    },
    {
      q: "What happens if the decking is bad?",
      a: "Damaged or rotten decking found during tear-off is documented and supplemented to your carrier; we replace it to code.",
    },
    {
      q: "When is depreciation released?",
      a: "Recoverable depreciation is released by your carrier after the work is completed and final invoices and photos are submitted.",
    },
    {
      q: "Can I upgrade materials?",
      a: "Yes. You can select upgrades such as impact-resistant shingles; the cost above the insurance scope is your out-of-pocket.",
    },
    {
      q: "What if more damage is found during production?",
      a: "We pause, document it, and supplement your claim before proceeding so nothing is missed.",
    },
  ];
}

export function defaultWhyAnexa(): string[] {
  return [
    "Licensed & insured",
    "Full insurance-restoration support",
    "Complete photo documentation",
    "Dedicated production coordination",
    "Clean closeout package",
    "Workmanship warranty support",
  ];
}

/** Build a fresh content blob for a new draft proposal. */
export function defaultProposalContent(): ProposalContent {
  return {
    conditionFlags: {},
    photoCaptions: {},
    upgrades: defaultUpgrades(),
    selectedSections: defaultSections(),
    faq: defaultFaq(),
    whyAnexa: defaultWhyAnexa(),
  };
}
