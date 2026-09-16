# Federal tax credits, the dealer fee and the customer's price — facts for counsel

**Prepared:** 2026-09-15, by engineering, at the owner's request.
**Company:** Anexa Homes (solar).
**Contracting entity named in the paperwork:** Central Plains Electric LLC (DBA CP Electric LLC).

**What this is.** A statement of what the software computes, what it prints for customers, what the signed paperwork says, and how many deals are affected. Every figure was read from the production database on 2026-09-15 inside a read-only transaction, or is produced by the pricing code and pinned by automated tests. Quotations from the agreements are verbatim.

**This document makes no legal argument and gives no recommendation.**

---

## 1. What the software computes, and what it prints

### 1.1 The order of operations, in plain English

1. **Base price.** The sales representative sells the system at a price per watt. Base price = that rate × the system's watts. This is the figure the company keeps for the system, and the only figure a representative's commission is measured on.
2. **Extra work and equipment**, at catalogue price: adders (main panel upgrade, steep roof, re-roof) and the battery.
3. **Gross price** = base + extra work + equipment. This is what the company keeps in total.
4. **Dealer fee.** A lender that finances the deal takes a percentage of the whole job. The software **grosses the price up** so that what survives the lender's cut is the gross price: **final price = gross ÷ (1 − dealer fee)**. On the deals in production that fee is **65% on five deals and 50% on one**.
5. **Final price** is the figure printed on the customer's proposal.
6. **Federal credits.** The software applies the credit percentages the deal claims — the 30% investment credit, and the 10% energy community and 10% domestic content bonuses where marked — **to the final price**, and prints the result as the customer's price after credits. All six priced deals in production claim all three, i.e. **50% of the final price**.
7. **The monthly payment** printed on the proposal is computed from the amount financed **after** those credits.

### 1.2 Worked example, in dollars (illustrative, pinned by test)

A 10 kW system sold at $3.00/W through a 25% dealer-fee loan programme, with a $2,700 main panel upgrade, a $0.10/W steep-roof charge ($1,000) and one $15,000 battery:

| Line | Amount |
|---|---|
| Base price (10,000 W × $3.00) | $30,000.00 |
| Extra work, at catalogue | $3,700.00 |
| Battery, at catalogue | $15,000.00 |
| **Gross price — what the company keeps** | **$48,700.00** |
| Dealer fee, 25% of the final price | $16,233.33 |
| **Final price — printed on the customer's proposal** | **$64,933.33** |
| Federal investment credit, 30% of the final price | $19,480.00 |
| **Price after credits — printed on the customer's proposal** | **$45,453.33** |
| Monthly payment, 25 years at 6.99%, credits applied | $320.96 |
| Monthly payment, same terms, credits not applied | $458.52 |

**The same system quoted as cash** carries no lender and therefore no dealer fee: $30,000 + $3,700 + $15,000 = **$48,700.00**. The financed price for the identical system is **$16,233.33 higher**, and that difference is the dealer fee.

### 1.3 Worked example, in dollars (a real signed deal)

Customer **Tessa Resendez**, signed **2026-09-06 22:19 UTC**, signer "TESSA RESENDEZ" (420tay@gmail.com). Loan through **Amos Capital Fund**, programme "Amos 30 Year Solar", dealer fee **65%**. A 15.84 kW system. These figures are frozen into the document she signed:

| Line on her document | Amount |
|---|---|
| Contract value | **$167,120.00** |
| Federal solar tax credit (30%) | −$50,136.00 |
| Energy community bonus (10%) | −$16,712.00 |
| Domestic content bonus (10%) | −$16,712.00 |
| **Total credits shown** | **−$83,560.00** |
| After credits | $83,560.00 |
| **Net cost to the household** | **$83,560.00** |
| Monthly payment on the full contract value | $464.22 |
| **Monthly payment she was quoted** (credits applied) | **$232.11** |

For reference, the price the system was quoted at is **$87,120.00** — the `quotedPriceCents` figure inside the credit ladder frozen into her signed document, which is also the price stored on the deal itself (`solar_finance.contractPriceCents`). The credits took the contract $3,560 below it.

### 1.4 What the company receives, and what the software records

The company receives the gross price. The lender pays the company the final price less its dealer fee.

The owner states that the federal credits are **not** claimed by the customer: they are sold to a third-party monetizer for approximately 50 cents on the dollar, and their value is applied to reduce what the customer owes.

**The software has no field for that arrangement.** It computes the credits as a reduction of the customer's price, exactly as shown above, and nothing in the database records who claims them, who they are transferred to, or what a monetizer pays. No customer document and no agreement we send says the company claims or transfers them. That contradiction is the reason for this brief.

---

## 2. What the customer's document says about who claims the credit

Every proposal that shows credits prints this caveat under the credit rows. It is stored once in company settings (`solar_settings.creditDisclaimer`) and copied into each document. **The production settings row and all 26 documents that carry it hold this text, character for character (267 characters):**

> Tax credits are claimed on your own federal return and depend on your tax liability and on your eligibility for each credit shown. They are not a discount applied by us and they are not a guarantee. We are not tax advisers — please confirm with your tax professional.

Each credit is printed as its own named row, with its percentage and dollar amount:

- "Federal solar tax credit", 30%
- "Energy community bonus", 10%
- "Domestic content bonus", 10%

The surrounding page copy, which lives in the software rather than in settings, reads:

- Chapter lede: "…the federal credits this system earns and what it costs you once they are claimed."
- Section heading: "What your tax credits are worth"
- Row labels: "After tax credits", "Your net cost after credits"
- General estimate caveat, printed at the back of every proposal: "…Figures do not constitute tax advice."

One mechanical point: the caveat is **frozen** into each document, but the headings and lede around it are **rendered live from the software**. Re-opening a document signed in August displays today's wording around the frozen figures.

The proposal is signed electronically by the customer, and the signed copy is filed as a PDF.

---

## 3. The installation agreement

Both installation agreements in production are uploaded PDFs of the same 12-page document, "Central Plains Electric LLC (DBA CP Electric LLC) · Solar PV Installation Agreement", filed under two names ("CPE Solar IA" and "CPE Battery IA"; identical file).

### 3.1 Article 2 — Contract Price, verbatim

> **ARTICLE 2 — CONTRACT PRICE**
> The total cash price for all materials and labor under this Agreement, subject to additions or deductions by authorized written change orders, is:
> TOTAL CASH CONTRACT PRICE  $ ____________
> Total Cash Contract Price (written): ____________ Dollars ($ ____ ).
> Note: The Total Cash Contract Price stated above is the full price of the goods and services and does not include any separate finance charges imposed by a third-party lender. If Owner finances this purchase, finance charges, APR, and the total of payments are disclosed by the lender in separate financing documents.

### 3.2 Article 3, Section B — Financed Purchase, verbatim

> **B. Financed Purchase**
> If Owner elects to finance this purchase through a third-party lender or finance partner ("Lender"), the following applies:
> 1. Owner will enter into a separate loan or financing agreement directly with the Lender. That agreement governs the amount financed, annual percentage rate (APR), finance charges, payment schedule, and total of payments, and controls in the event of any conflict regarding financing terms.
> 2. Contractor will invoice and receive payment from the Lender according to the Lender's funding milestones (for example, at contract signing, at installation, and at final completion / permission-to-operate). Owner authorizes such disbursements to Contractor.
> **3. The Total Cash Contract Price in Article 2 is the same whether Owner pays cash or finances. Any dealer fee charged by the Lender to Contractor is not added to Owner's price under this Agreement.**
> 4. Owner's obligation to repay the Lender is independent of this Agreement, except to the extent required by applicable law (including any preservation-of-claims/"Holder Rule" notice contained in the financing documents).
> 5. This Agreement is not contingent on financing approval unless the box here is checked: ☐ This Agreement is void if Owner's financing is not approved within ______ days.
> 6. **Loan cancellation on cancellation (required by Texas law).** If financing is provided by a third-party lender that is affiliated with or referred by Contractor, that lender is required to cancel any accompanying loan made to Owner upon cancellation of this Agreement during the cancellation period described in Article 19. Owner will owe nothing to that lender for the cancelled transaction.

### 3.3 Where clause B.3 and the software differ

| Clause B.3 says | The software does |
|---|---|
| The total cash contract price is the same whether the owner pays cash or finances. | The financed price is the cash price divided by (1 − dealer fee). On the illustrative example: $48,700 cash, $64,933.33 financed — a difference of $16,233.33 on one 10 kW system. |
| Any dealer fee charged by the lender to the contractor is not added to the owner's price. | The dealer fee is added to the owner's price by construction: it is the difference between the gross price and the final price the customer signs. |

The same agreement notes at Article 2 that the price "does not include any separate finance charges imposed by a third-party lender". The dealer fee in this software is not a finance charge disclosed by the lender to the customer: it is a percentage of the job, added before the customer's price is printed, and it is never shown to the customer.

This was true before the current pricing work began; no recent change created it.

### 3.4 What the installation agreement says about credits

The installation agreement contains **no clause on the ownership of tax credits**. The only mentions are disclaimers:

> **18.5 No Reliance on Oral Statements.** Owner acknowledges that no salesperson, agent, or representative is authorized to make guarantees regarding energy production, utility-bill savings, tax credits, or system performance, and that Owner is not relying on any oral or written statement outside this Agreement. Only the written terms of this Agreement (and signed change orders) govern. Energy and savings figures are estimates, not guarantees.

> **9.10 No Unauthorized Promises.** No salesperson, agent, or representative is authorized to make any promise, guarantee, or commitment — including any promise of a roof replacement, upgrade, repair, rebate, product, service, or credit — outside this written Agreement. Any promise not stated in writing in this Agreement will not be honored or fulfilled, and Owner is not relying on any such statement.

Neither assigns the credits to anyone.

---

## 4. Which agreement each product uses

**The software does not link a finance product to a document template.** A template is chosen by hand when an envelope is sent; templates carry no product field, and no code selects one by product.

| Product | What the customer signs in practice | What it says about credit ownership |
|---|---|---|
| **Cash** | CPE Solar PV Installation Agreement | **Silent** (only the disclaimers in §3.4) |
| **Loan** | CPE Solar PV Installation Agreement, plus the lender's own loan agreement, which we do not author | **Silent**, as above |
| **Lease** | Participate Energy Customer Agreement (third-party) | **Explicit: the credits are not the customer's** |
| **PPA** | None in use | — |

**The Participate lease agreement is not in the software.** Production holds 15 document templates and none of them is the Participate agreement; the 48-page PDF exists only outside the system. No lease or PPA deal has ever been priced, quoted or signed. It is quoted here because it is the only agreement associated with the company that addresses credit ownership, and because it shows the contrast:

> **Tax Credits:** Any state or federal tax credits generated by the System WILL NOT be owned by you but WILL be owned by System Owner.

> **9. OWNERSHIP OF THE SYSTEM; TAX CREDITS AND/OR REBATES.**
> 9.1 System Ownership and Lease Classification. This Agreement is for the lease of the System, not the sale of the System or the System Interests (as defined below). System Owner exclusively owns and holds all right, title, and interest in and to the System. Other than the limited leasehold right to use the System and receive the Electricity it produces, you have no ownership rights in the System.
> 9.2.1 Exclusive Ownership. System Owner shall have the exclusive right to enjoy and use all such benefits, whether such benefits exist now or in the future. System Owner exclusively owns all System components and associated intangible value streams, including, but not limited to: (i) all federal, state, and local tax credits, deductions, and allowances; (ii) all renewable energy credits, green tags, carbon offset credits, environmental certificates, or similar non-power attributes ("RECs"); (iii) all utility rebates, grants, or incentives related to the installation, ownership, or production of the System; and (iv) all rights to participate in Grid Services or demand response programs related to the System ("System Interests") unless otherwise stated in Exhibit C.

That wording governs a **leased** system the customer never owns. Every deal in production is a **loan**, under which the customer owns the system.

---

## 5. How many deals are affected, and what each was told

**Proposal documents in production: 43**, of which 28 were generated but never sent, 2 sent, 4 viewed and **9 signed**. **26 carry a credit block** and therefore the caveat in §2. Signed documents belong to **two households**.

### Household A — the owner's own internal lead (`2307d609`, "mustafa joulani")

Loan, no lender programme recorded, 50% dealer fee stored on the deal. 36 of the 43 proposals belong to this lead, which on its face is internal testing rather than a sale; this brief does not assert that as a legal characterisation.

| Version | Signed | Final price | Credits applied | Price after credits | Payment on the full price | Payment quoted |
|---|---|---|---|---|---|---|
| 13 | 2026-08-28 | $60,500.00 | — (no credit block) | — | $168.06 | $168.06 |
| 21 | 2026-08-30 | $128,080.00 | $64,040.00 | $58,080.00 | $355.78 | not carried |
| 26 | 2026-08-30 | $128,080.00 | $64,040.00 | $58,080.00 | $355.78 | $161.33 |
| 28 | 2026-08-31 | $140,180.00 | $70,090.00 | $70,090.00 | $389.39 | $194.69 |
| 30 | 2026-09-04 | $150,180.00 | $75,090.00 | $70,180.00 | $417.17 | $194.94 |
| 33 | 2026-09-06 | $150,180.00 | $75,090.00 | $70,180.00 | $417.17 | $194.94 |
| 35 | 2026-09-09 | $190,180.00 | $95,090.00 | $95,090.00 | $528.28 | $264.14 |
| **36 (current)** | **2026-09-10** | **$105,180.00** | **$21,036.00** | **$70,180.00** | **$292.17** | **$194.94** |

Versions 21 to 35 claimed all three credits (50% of the final price). The current signed version, v36, claims only the two 10% bonuses ($10,518.00 each); the 30% investment credit is not on it.

### Household B — Tessa Resendez (`5886e6ac`)

Amos Capital Fund, "Amos 30 Year Solar", 65% dealer fee. One signed version, detailed in §1.3.

| Version | Signed | Final price | Credits applied | Price after credits | Payment on the full price | Payment quoted |
|---|---|---|---|---|---|---|
| 1 | 2026-09-06 | $167,120.00 | $83,560.00 | $83,560.00 | $464.22 | $232.11 |

That version has since been superseded by a newer, unsigned one.

### The exposure, counted

| | Count |
|---|---|
| Households that signed a document applying federal credits to their price | **2** (one is the owner's own internal lead) |
| Signed documents applying credits | **8 of 9** |
| Signed documents whose quoted monthly payment is computed **after** credits | **7 of 9** |
| Signed documents telling the customer they claim the credits on their own return | **8 of 9** |
| Signed documents saying the company claims or transfers the credits | **0** |
| Largest single credit figure on a signed document | **$95,090.00** (Household A, v35) |
| Credits on the live signed versions | **$21,036.00** (Household A) and **$83,560.00** (Household B) |

Both households are **loans**, under which the customer owns the system.

### A separate observation, for completeness

Six signed documents carry a stored "ownership note" field containing placeholder text: `jalfkjbrcljhbsedfvibsrdfvisvfpijfs` on Household A's versions 21, 26 and 28, and `N/A N/A` on Household A's versions 30 and 33 and on Household B's version 1. Nothing in the current software writes or displays that field; it survives in stored documents only. It is noted here solely because the field's name refers to ownership.

---

## 6. Federal law status — a question for counsel, not a conclusion

Nothing in this section is a legal position. It records what the company has been told, and asks counsel to confirm or correct it, because the answer may change the pricing model itself rather than only the paperwork.

**The premise to confirm.** Internal Revenue Code **Section 25D** — the residential credit the software applies — is understood to have been **repealed for expenditures made after 31 December 2025** (P.L. 119-21), and for these purposes an expenditure is understood to be **treated as made when the installation is completed**, not when the contract is signed, financed or paid.

**The facts that meet that premise.** Every deal the software has priced is a **loan**, under which **the customer owns the system** (§5). The software applies the credits to the customer's own price and tells them, in writing, that they claim the credits on their own return (§2) — while the company's revenue model treats the credits as **sold to a monetizer** (§1.4).

**What counsel is asked to determine.**

1. Whether **any federal credit exists at all** on these deals, given the installation dates below.
2. If one exists, **who is entitled to claim it**, and whether it can be **transferred or sold** — and by whom.
3. Whether the **monetizer arrangement requires third-party ownership** of the system (i.e. whether it is a **Section 48E** structure rather than a 25D one), and if so, whether a loan under which the customer takes title can support it at all.
4. If no federal credit exists on a 2026 installation, what follows for the **eight signed documents** that applied one to the customer's price and, in seven cases, to the monthly payment they were quoted (§5).

**No installation has been completed.** Every deal below is scheduled or unscheduled; the `completedAt` field is empty on every project in production.

| Deal | Customer | Project | Install completed | Install scheduled | Signed docs applying credits | Credits on the live signed version |
|---|---|---|---|---|---|---|
| `2307d609` | mustafa joulani (the owner's own internal lead) | `not_started` | **none** | **2026-08-27** | 7 | $21,036.00 (v36) |
| `5886e6ac` | Tessa Resendez | no project record | **none** | not scheduled | 1 | $83,560.00 (v1) |
| `0eeaab8a` | San Juanita Escamilla | no project record | **none** | not scheduled | 0 (2 unsigned proposals carry credits) | — |

**Read against the premise:** exactly one deal has an installation date of any kind, and it falls in **2026**. The other two credit-bearing deals have no installation scheduled, so the date on which their expenditure would be treated as made is not yet fixed by anything in the system.

Counsel should note that the deal with the 2026 installation date is the owner's own internal lead, and that this brief does not assert whether it is a sale.

---

## 7. Where these facts come from

| Fact | Source |
|---|---|
| The pricing order and the illustrative example | `src/lib/solar-money.ts` (`priceUnits`), pinned by `src/lib/__tests__/pricing-golden.test.ts` |
| Credits applied to the final price | `src/lib/solar-credit-ladder.ts`, `src/lib/solar-proposal.ts` |
| The customer caveat text | Company settings (`solar_settings.creditDisclaimer`) and each stored proposal document |
| Deal, proposal, template and envelope counts and figures | Production database, read-only, 2026-09-15, every statement inside `BEGIN READ ONLY … ROLLBACK` |
| Contract wording | The uploaded PDF in the production template library and the Participate PDF held outside the system, quoted verbatim |

A fuller technical description of the pricing model, including every formula and a second worked example, is in `docs/PRICING_LOGIC.md` in the company's code repository (§8.1 for the business model, §4 for the worked example).
