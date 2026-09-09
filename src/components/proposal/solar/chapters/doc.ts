import type {
  SolarProposalSnapshot,
  ProposalPaymentOption,
  SnapshotFinancing,
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
  /**
   * The horizon under the scenario currently on screen — see `credits`. Every
   * sheet reads this and never `option.savings`, so one switch moves the whole
   * document rather than the sheet that happens to hold the control.
   */
  sv: SavingsModel;
  /**
   * What this option asks for each month under the same scenario. Null on cash,
   * which has no monthly at all.
   */
  monthlyCents: number | null;
  /**
   * THE TAX-CREDIT SWITCH, or null on a deal with no credits to claim.
   *
   * Two readings of one deal, both frozen at generation: `on` false is the
   * household that never claims the credit and pays the higher figure for the
   * whole term, `on` true is the household that claims it and has it applied to
   * the loan. Off is the default because it is the one a proposal has to be
   * able to survive.
   */
  credits: {
    on: boolean;
    set: (on: boolean) => void;
    /** The payment each way, for the control's own two faces. */
    offMonthlyCents: number | null;
    onMonthlyCents: number | null;
    /** Everything the ladder takes off the contract, for the caption. */
    reliefCents: number;
  } | null;
  isPurchase: boolean;
  /** The price → credits → net cost ladder, where the deal claims any. */
  ladder: CreditLadder | null;
  /** What the cost table calls the system price. See the view for why. */
  systemPriceCents: number | null;
  /**
   * THE TOTAL THE HOUSEHOLD IS QUOTED — the figure every customer-facing
   * surface means when it says "the price".
   */
  quotedTotalCents: number | null;
  /** That price per installed watt, derived from it. Null on storage. */
  quotedPpwCents: number | null;
  /**
   * What the loan is carrying under the scenario on screen — the price with
   * the credits unclaimed, the balance left once they have been applied. The
   * principal the payment beside it was quoted on, so the two divide.
   */
  financedAmountCents: number | null;
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
