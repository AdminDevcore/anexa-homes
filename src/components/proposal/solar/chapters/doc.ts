import type {
  SolarProposalSnapshot,
  ProposalPaymentOption,
  SnapshotFinancing,
  SnapshotContractAdjustment,
  SavingsModel,
  VppCredit,
} from "@/lib/solar-proposal";
import type { CreditLadder } from "@/lib/solar-credit-ladder";
import type { LifetimeFigure } from "@/lib/solar-proposal-pitch";

/**
 * EVERYTHING THE SHEETS ARE ALLOWED TO KNOW.
 *
 * The document's derivations happen once, in the view, and arrive here already
 * settled. A chapter file reads this and renders; it does not decide what
 * `systemPriceCents` means on a programme deal, or which of two payment figures
 * is the honest one to lead with. Those are decisions with comments and tests
 * behind them, and they stay in one place where the next person can find them
 * all together.
 *
 * The practical reason is the same one that split the chapters out of a
 * 1,800-line file: a sheet you can read end to end is a sheet whose layout you
 * can change without wondering what else moved.
 */
export type Doc = {
  s: SolarProposalSnapshot;
  /** Every way this household may pay. The quoted one is first. */
  options: ProposalPaymentOption[];
  /** The one currently under the reader's eyes. */
  option: ProposalPaymentOption;
  f: SnapshotFinancing;
  sv: SavingsModel;
  isPurchase: boolean;
  /** The partner's contract reconciliation, where the deal carries one. */
  adjustment: SnapshotContractAdjustment | null;
  /** The contract → credits → net cost ladder, where the deal carries one. */
  ladder: CreditLadder | null;
  /** What the cost table calls the system price. See the view for why. */
  systemPriceCents: number | null;
  /** Adders the company chose to explain to the customer in words. */
  showcased: NonNullable<SnapshotFinancing["adders"]>;
  lifetime: LifetimeFigure;
  vpp: VppCredit[];
  vppAnnualCents: number;
  vppUpfrontCents: number;
  /** Who actually pays the battery money — the programme, not the wires company. */
  vppPayer: string;
  /** What the household pays for power today. */
  billCents: number;
  /** Payment plus the utility bill that does not go away. */
  afterAllCents: number;
  /** 1-based position of a chapter that exists on THIS document. */
  num: (id: string) => number;
  /** How many chapters this document actually has. */
  total: number;
};
