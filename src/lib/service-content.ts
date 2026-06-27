import type { Metadata } from "next";
import { SERVICES, type Service } from "@/lib/site";

// Rich, page-level content for each marketing service page. Keeping this in one
// place lets the <ServicePage> component stay declarative and every service
// page file stay a one-liner. Pain-points, process, FAQs and a gallery make the
// pages feel complete and trustworthy rather than thin.

export type ProcessStep = { step: string; title: string; body: string };
export type Faq = { q: string; a: string };
export type Pair = { title: string; body: string };

export type ServiceContent = {
  slug: string;
  // Hero headline is split so we can paint one phrase in the gold gradient.
  heroLead: string;
  heroHighlight: string;
  heroTail: string;
  heroDescription: string;
  overviewTitle: string;
  overviewBody: string;
  // Optional object-position for the hero crop (defaults bias slightly upward
  // for rooflines; override when the subject sits lower/left, e.g. HVAC).
  heroPosition?: string;
  benefits: Pair[];
  problemsTitle: string;
  problemsIntro: string;
  problems: Pair[];
  process: ProcessStep[];
  faqs: Faq[];
  gallery: string[]; // caption labels for the project grid
  // Optional per-tile gallery images (parallel to `gallery`). Falls back to the
  // service's primary image when omitted.
  galleryImages?: string[];
  related: string[]; // slugs of services to cross-link
  metaTitle: string;
  metaDescription: string;
};

const CONTENT: Record<string, ServiceContent> = {
  roofing: {
    slug: "roofing",
    heroLead: "Roofing built to ",
    heroHighlight: "protect",
    heroTail: " and to last.",
    heroDescription:
      "From full replacement to precise repair, Anexa Homes delivers craftsmanship that stands up to Texas storms — documented end to end and backed by manufacturer and workmanship warranties.",
    overviewTitle: "Roof replacement and repair, done right the first time.",
    overviewBody:
      "We install industry-leading shingle systems with meticulous attention to ventilation, flashing, and underlayment — the details that decide how long a roof truly lasts. Every project starts with a thorough inspection, a transparent scope, and a clean, respectful job site from tear-off to final nail sweep.",
    benefits: [
      { title: "Certified Installers", body: "Manufacturer-certified crews follow strict installation specs that protect your warranty." },
      { title: "Premium Materials", body: "GAF, Owens Corning, and other top systems engineered for high-wind and hail resistance." },
      { title: "Lifetime Warranty", body: "Workmanship plus manufacturer coverage gives you decades of protection and peace of mind." },
    ],
    problemsTitle: "A failing roof shouldn't keep you up at night.",
    problemsIntro:
      "Most homeowners only think about their roof when something goes wrong. By then, small problems have usually become expensive ones.",
    problems: [
      { title: "Hidden storm damage", body: "Hail bruising and lifted shingles rarely show from the ground — but they shorten a roof's life fast." },
      { title: "Leaks and rising bills", body: "Failing flashing and poor ventilation drive interior damage and higher energy costs every month." },
      { title: "Pushy, unclear contractors", body: "Vague scopes and surprise change-orders leave you guessing what you're actually paying for." },
    ],
    process: [
      { step: "01", title: "Free Inspection", body: "We assess your roof for storm and wear damage and document everything with photos." },
      { step: "02", title: "Transparent Scope", body: "You get a clear, line-item scope and material options — no guesswork, no pressure." },
      { step: "03", title: "Agreement", body: "Choose your shingle and color, then sign digitally right from your phone." },
      { step: "04", title: "Production", body: "Certified crews install with precision, daily updates, and a tidy job site." },
      { step: "05", title: "QC & Cleanup", body: "We finish with a quality inspection and a magnetic nail sweep of your yard." },
      { step: "06", title: "Warranty & Closeout", body: "You receive your warranties and a digital closeout packet with every photo and document." },
    ],
    faqs: [
      { q: "How long does a roof replacement take?", a: "Most residential roofs are completed in one to two days, weather permitting. We schedule around forecasts to protect your home." },
      { q: "What shingle brands do you install?", a: "We install leading systems like GAF and Owens Corning, and we'll match the right product to your home, HOA, and budget." },
      { q: "Can you handle my insurance claim?", a: "Yes. If your roof was storm-damaged we document it, meet your adjuster, and manage the claim so you typically pay only your deductible." },
      { q: "What warranty do I get?", a: "Both a workmanship warranty and the manufacturer's warranty, plus a digital closeout packet for your records." },
    ],
    gallery: ["Hail-damaged shingles — before", "New architectural shingle roof — after", "Detail: flashing & valleys", "Clean job site at closeout"],
    related: ["storm-restoration", "insurance-claims", "gutters", "solar"],
    metaTitle: "Roofing — Replacement & Repair",
    metaDescription:
      "Premium roof replacement and repair from Anexa Homes. Certified crews, top-tier materials, and lifetime workmanship warranties across North Texas.",
  },

  solar: {
    slug: "solar",
    heroLead: "Smarter solar, designed around ",
    heroHighlight: "your home",
    heroTail: ".",
    heroDescription:
      "We design high-efficiency solar around your actual usage and roof — so you get real savings, dependable backup power, and a system that pays off for decades.",
    overviewTitle: "Solar that's engineered, not just installed.",
    overviewBody:
      "Off-the-shelf solar leaves savings on the table. We start with an energy review, model your production and offset, and design a system — with optional battery backup — that fits your roof, your budget, and your long-term goals. Then our team handles permitting, install, and utility interconnection.",
    benefits: [
      { title: "Usage-Based Design", body: "We size your array to your real consumption, not a one-size-fits-all template." },
      { title: "Battery Backup", body: "Keep the lights, fridge, and AC running through outages with optional storage." },
      { title: "Financing Support", body: "Flexible options and incentive guidance make going solar approachable." },
    ],
    problemsTitle: "Going solar shouldn't feel like a gamble.",
    problemsIntro:
      "Solar is a long-term investment. Done wrong, it disappoints — done right, it pays you back for 25+ years.",
    problems: [
      { title: "Rising utility rates", body: "Energy costs keep climbing, and renters of the grid have no control over the next increase." },
      { title: "Oversized, overpriced systems", body: "Many companies sell more panels than you need — you pay for production you never use." },
      { title: "Outages with no backup", body: "Solar without storage still goes dark when the grid does. We design for resilience." },
    ],
    process: [
      { step: "01", title: "Energy Review", body: "We analyze your bills and usage to find the right offset for your home." },
      { step: "02", title: "System Design", body: "Custom layout and production model tailored to your roof and goals." },
      { step: "03", title: "Battery Options", body: "Add storage for backup power and to maximize self-consumption." },
      { step: "04", title: "Financing", body: "We walk you through incentives and payment options that fit your budget." },
      { step: "05", title: "Installation", body: "Permitting, install, and utility interconnection handled by our team." },
      { step: "06", title: "Monitoring", body: "Track production and savings from your phone, with support if anything changes." },
    ],
    faqs: [
      { q: "Will solar really lower my bill?", a: "A correctly sized system offsets most or all of your usage. We model expected savings before you commit, so there are no surprises." },
      { q: "Do I need a battery?", a: "Not required, but storage gives you backup power during outages and helps you use more of what you generate. We'll show you the trade-offs." },
      { q: "What happens on cloudy days or at night?", a: "Your home draws from the grid (or your battery) seamlessly. Net metering credits the excess your panels send back." },
      { q: "How long does installation take?", a: "Most installs are completed in one to three days after permitting, with interconnection following utility approval." },
    ],
    gallery: ["Roof array — install day", "Battery & inverter — interior", "Production dashboard", "Completed system — exterior"],
    related: ["roofing", "hvac", "windows", "insurance-claims"],
    metaTitle: "Solar — Design, Storage & Installation",
    metaDescription:
      "Smarter solar from Anexa Homes — usage-based system design, battery backup, financing support, and monitoring across North Texas.",
  },

  hvac: {
    slug: "hvac",
    heroLead: "Comfort that's ",
    heroHighlight: "quietly efficient",
    heroTail: ", room to room.",
    heroDescription:
      "High-efficiency heating and cooling, sized correctly for your home — so you get even comfort, cleaner air, and lower bills, backed by a team that does it right.",
    overviewTitle: "Heating and cooling, properly sized and installed.",
    overviewBody:
      "An oversized or poorly installed system short-cycles, wastes energy, and never quite feels comfortable. We perform a real load calculation, recommend the right high-efficiency equipment, and install it cleanly — ductwork, refrigerant, and airflow dialed in so your home stays comfortable and your bills stay low.",
    // Subject (technician + condenser) sits lower-left over a dark, moody scene.
    // Bias left (so it leads on mobile) and slightly up toward the lit window /
    // condenser top, keeping it out of the darkest ground area.
    heroPosition: "33% 46%",
    benefits: [
      { title: "Right-Sized Systems", body: "A proper load calculation means even temperatures and no wasted energy." },
      { title: "Cleaner Air", body: "Better filtration and balanced airflow improve the air your family breathes." },
      { title: "Lower Energy Bills", body: "High-efficiency equipment and smart thermostats cut monthly costs." },
    ],
    problemsTitle: "If a room is always too hot or too cold, the system is the problem.",
    problemsIntro:
      "Comfort issues are rarely about the thermostat — they trace back to sizing, ductwork, and installation quality.",
    problems: [
      { title: "Uneven temperatures", body: "Hot and cold rooms usually mean an unbalanced or undersized system, not a setting." },
      { title: "Sky-high summer bills", body: "Aging or oversized units run constantly and drive your energy costs up." },
      { title: "Surprise breakdowns", body: "Deferred maintenance turns small issues into emergency, peak-season failures." },
    ],
    process: [
      { step: "01", title: "Home Assessment", body: "We evaluate your equipment, ductwork, and comfort complaints in person." },
      { step: "02", title: "Load Calculation", body: "We size the system to your home — no guessing, no oversizing." },
      { step: "03", title: "Equipment Options", body: "Clear options for AC, heat pumps, and furnaces at every efficiency tier." },
      { step: "04", title: "Clean Installation", body: "Tidy install with airflow, refrigerant, and ductwork done to spec." },
      { step: "05", title: "Smart Controls", body: "Smart thermostats and zoning for comfort you actually control." },
      { step: "06", title: "Tune-Up & Support", body: "Seasonal maintenance keeps the system efficient and the warranty intact." },
    ],
    faqs: [
      { q: "How do I know if I need a new system?", a: "Frequent repairs, uneven temperatures, rising bills, or a unit over 12–15 years old are common signs. We'll give you an honest assessment." },
      { q: "Heat pump or traditional AC and furnace?", a: "It depends on your home and goals. Heat pumps are highly efficient for our climate; we'll compare options and run the numbers with you." },
      { q: "Can a new system really lower my bill?", a: "Yes — right-sized, high-efficiency equipment paired with a smart thermostat typically reduces monthly energy use noticeably." },
      { q: "Do you service what you install?", a: "We do. Seasonal tune-ups keep your system efficient and protect your manufacturer warranty." },
    ],
    gallery: ["New condenser — exterior", "Air handler & ductwork", "Smart thermostat install", "Clean equipment closet"],
    related: ["solar", "windows", "water-filtration", "roofing"],
    metaTitle: "HVAC — Heating, Cooling & Air Quality",
    metaDescription:
      "High-efficiency HVAC from Anexa Homes — properly sized AC, heat pumps, and furnaces, cleaner air, and lower bills across North Texas.",
  },

  "water-filtration": {
    slug: "water-filtration",
    heroLead: "Cleaner water at ",
    heroHighlight: "every tap",
    heroTail: ".",
    heroDescription:
      "Whole-home filtration and softening that protects your family, your fixtures, and your appliances — tailored to what's actually in your water.",
    overviewTitle: "Whole-home water treatment, matched to your water.",
    overviewBody:
      "North Texas water is hard and heavily treated. We test what's coming into your home, then design filtration and softening that removes contaminants, ends scale buildup, and makes every tap taste better. The result is healthier water, longer-lasting appliances, and softer skin and laundry.",
    // Hero spans the filtration system (left) + luxury kitchen (right). Bias
    // left so the system leads on mobile; desktop shows both.
    heroPosition: "25% 50%",
    benefits: [
      { title: "Tested, Not Guessed", body: "We test your water first and design treatment around the actual results." },
      { title: "Appliance Protection", body: "Softening ends scale that destroys water heaters, fixtures, and appliances." },
      { title: "Better Every Day", body: "Cleaner water for drinking, cooking, bathing, and laundry throughout the home." },
    ],
    problemsTitle: "Hard, over-chlorinated water costs you more than you think.",
    problemsIntro:
      "You can't always see it, but untreated water quietly damages your home and affects your family every day.",
    problems: [
      { title: "Scale and buildup", body: "Hard water destroys water heaters and fixtures and leaves spots on everything." },
      { title: "Taste and odor", body: "Chlorine and contaminants make tap water unpleasant to drink and cook with." },
      { title: "Dry skin and dull laundry", body: "Hard water is rough on skin, hair, and clothing load after load." },
    ],
    process: [
      { step: "01", title: "Water Test", body: "A free test reveals hardness, chlorine, and contaminants in your supply." },
      { step: "02", title: "System Design", body: "We match filtration and softening to your results and household size." },
      { step: "03", title: "Drinking Water", body: "Optional reverse-osmosis for bottled-quality water at the kitchen tap." },
      { step: "04", title: "Professional Install", body: "Clean, code-compliant installation at your main and points of use." },
      { step: "05", title: "Walkthrough", body: "We show you how it works and what to expect day to day." },
      { step: "06", title: "Service & Filters", body: "Simple maintenance and filter reminders keep the water great long term." },
    ],
    faqs: [
      { q: "Do I really need a softener in North Texas?", a: "Most of the metroplex has hard water that scales appliances and fixtures. A test tells us exactly what your home needs." },
      { q: "What's the difference between filtration and softening?", a: "Filtration removes contaminants and improves taste; softening removes the minerals that cause scale. Many homes benefit from both." },
      { q: "Is reverse osmosis worth it?", a: "For drinking and cooking, RO delivers bottled-quality water at the tap and pairs well with whole-home treatment." },
      { q: "How much maintenance is involved?", a: "Very little — periodic salt and filter changes. We set reminders and can service it for you." },
    ],
    gallery: ["Whole-home filtration system", "Pure water in the kitchen", "Filtered water on tap", "Multi-stage pre-filtration"],
    galleryImages: ["/img/water-system.jpg", "/img/water-kitchen.jpg", "/img/water-faucet.jpg", "/img/water-filters.jpg"],
    related: ["hvac", "roofing", "windows", "solar"],
    metaTitle: "Water Filtration & Softening",
    metaDescription:
      "Whole-home water filtration and softening from Anexa Homes — tested, tailored treatment for cleaner, softer water at every tap in North Texas.",
  },

  windows: {
    slug: "windows",
    heroLead: "Windows that look better and ",
    heroHighlight: "feel better",
    heroTail: ".",
    heroDescription:
      "Premium replacement windows that cut energy loss, quiet your home, and lift its curb appeal — custom-fit and professionally installed.",
    overviewTitle: "Replacement windows that pay you back in comfort.",
    overviewBody:
      "Drafty, single-pane, or failing windows waste energy and let the outside in. We measure and custom-fit energy-efficient windows with low-E glass, then install them properly — sealed, square, and finished — so you feel the difference in comfort, noise, and your energy bill.",
    // Hero spans the luxury home (left) + installer at the window (right).
    // Bias well right so the installer/window lead on mobile; desktop shows both
    // (no horizontal crop on the wide hero, so this only affects narrow screens).
    heroPosition: "84% 42%",
    benefits: [
      { title: "Energy-Efficient Glass", body: "Low-E, insulated glass keeps heat out in summer and in during winter." },
      { title: "Custom-Fit", body: "Every window is measured and built for your exact openings — no gaps, no drafts." },
      { title: "Curb Appeal", body: "Clean lines and modern profiles instantly elevate your home's exterior." },
    ],
    problemsTitle: "Old windows quietly drain comfort and money.",
    problemsIntro:
      "Failing windows are one of the biggest sources of energy loss in a home — and one of the easiest to fix.",
    problems: [
      { title: "Drafts and energy loss", body: "Single-pane and failing seals let conditioned air escape all year long." },
      { title: "Outside noise", body: "Thin glass lets traffic and neighborhood noise straight into your living space." },
      { title: "Foggy, hard-to-use windows", body: "Condensation between panes and sticking sashes mean the seals have failed." },
    ],
    process: [
      { step: "01", title: "In-Home Consult", body: "We assess your current windows and talk through styles and priorities." },
      { step: "02", title: "Precise Measurement", body: "Every opening is measured for a true custom fit." },
      { step: "03", title: "Glass & Style", body: "Choose efficient glass packages, frames, and finishes for your home." },
      { step: "04", title: "Custom Build", body: "Your windows are manufactured to your exact specifications." },
      { step: "05", title: "Professional Install", body: "Clean install with proper sealing, insulation, and finish work." },
      { step: "06", title: "Final Walkthrough", body: "We confirm operation, seal, and finish on every window installed." },
    ],
    faqs: [
      { q: "How much can new windows save me?", a: "Energy-efficient windows reduce heating and cooling loss; savings vary by home, but most owners notice steadier comfort and lower bills." },
      { q: "Do you replace the whole window or just the glass?", a: "We do full replacements for the best efficiency and fit, and we'll advise if an insert makes sense for your situation." },
      { q: "How long does an install take?", a: "Most whole-home projects are completed in one to two days, with minimal disruption." },
      { q: "Are the windows custom-sized?", a: "Yes — every window is measured and built to your exact openings for a precise, draft-free fit." },
    ],
    gallery: ["Premium replacement windows", "Expert installation", "Natural light, black frames", "Modern black-framed glass"],
    galleryImages: ["/img/windows-exterior.jpg", "/img/windows-installer.jpg", "/img/windows-interior.jpg", "/img/windows-detail.jpg"],
    related: ["hvac", "roofing", "solar", "gutters"],
    metaTitle: "Replacement Windows",
    metaDescription:
      "Premium replacement windows from Anexa Homes — energy-efficient, custom-fit, and professionally installed for comfort and curb appeal in North Texas.",
  },

  gutters: {
    slug: "gutters",
    heroLead: "Gutters that ",
    heroHighlight: "protect the whole home",
    heroTail: ".",
    heroDescription:
      "Seamless gutters and guards that move water away from your roof, siding, and foundation — sized and pitched right, and built to stay clog-free.",
    overviewTitle: "Seamless gutters engineered to move water, not collect it.",
    overviewBody:
      "Undersized, clogged, or poorly pitched gutters send water exactly where you don't want it — behind fascia, down siding, and into your foundation. We install seamless gutters custom-formed on site, with the right pitch, downspouts, and optional guards so water always ends up where it belongs.",
    benefits: [
      { title: "Seamless & Custom", body: "Formed on site to your exact runs — fewer seams means fewer leaks." },
      { title: "Gutter Guards", body: "Keep leaves and debris out so water flows freely with less maintenance." },
      { title: "Foundation Protection", body: "Proper downspouts and drainage carry water safely away from your home." },
    ],
    problemsTitle: "Where your water goes decides what it damages.",
    problemsIntro:
      "Gutters are easy to ignore — until overflow shows up as rotted fascia, stained siding, or a wet foundation.",
    problems: [
      { title: "Overflow and clogs", body: "Debris-packed gutters spill over and dump water against your home." },
      { title: "Foundation and erosion", body: "Poor drainage pools water at the foundation and washes out landscaping." },
      { title: "Rotting fascia and soffit", body: "Constant overflow rots the wood your roof edge depends on." },
    ],
    process: [
      { step: "01", title: "Inspection", body: "We check your roofline, drainage, and any water-damage trouble spots." },
      { step: "02", title: "Sizing & Pitch", body: "We design runs, sizes, and downspouts to handle Texas downpours." },
      { step: "03", title: "Color & Guards", body: "Choose colors to match your home and optional guards for less upkeep." },
      { step: "04", title: "Seamless Forming", body: "Gutters are formed on site for a precise, low-seam fit." },
      { step: "05", title: "Installation", body: "Secure mounting, correct pitch, and downspouts routed away from the foundation." },
      { step: "06", title: "Final Check", body: "We test flow and confirm water is leaving your home cleanly." },
    ],
    faqs: [
      { q: "Are gutter guards worth it?", a: "For homes with nearby trees, yes — guards dramatically cut cleaning and prevent the clogs that cause overflow damage." },
      { q: "Should I replace gutters with my roof?", a: "It's the ideal time. Doing both together ensures flashing, drip edge, and gutters all work as one system." },
      { q: "What are seamless gutters?", a: "They're formed on site in continuous runs, so the only seams are at corners and downspouts — far fewer leak points." },
      { q: "Can you fix drainage that floods my yard?", a: "Yes. We route downspouts and add drainage so water is carried away from the foundation and landscaping." },
    ],
    gallery: ["Overflowing old gutter — before", "New seamless run — after", "Gutter guard detail", "Downspout & drainage"],
    related: ["roofing", "storm-restoration", "windows", "insurance-claims"],
    metaTitle: "Seamless Gutters & Guards",
    metaDescription:
      "Seamless gutters and guards from Anexa Homes — properly sized, pitched, and clog-resistant to protect your roof, siding, and foundation in North Texas.",
  },

  "storm-restoration": {
    slug: "storm-restoration",
    heroLead: "After the storm, ",
    heroHighlight: "we restore everything",
    heroTail: ".",
    heroDescription:
      "Hail and wind recovery handled start to finish — documented damage, emergency tarping, full restoration, and an insurance claim managed on your behalf.",
    overviewTitle: "Complete storm recovery, with the claim handled for you.",
    overviewBody:
      "A major storm leaves more than a damaged roof — and dealing with it alone is overwhelming. We inspect and document everything, protect your home from further damage, and restore your roof and exterior to better than before. Because we manage the insurance claim too, you get one team from first inspection to final walkthrough.",
    benefits: [
      { title: "Rapid Response", body: "Emergency tarping and fast inspections protect your home right after the storm." },
      { title: "Full Documentation", body: "Detailed photos and reports build a strong, defensible insurance claim." },
      { title: "One Team, Start to Finish", body: "Inspection, claim, and restoration handled by one accountable crew." },
    ],
    problemsTitle: "Storm season shouldn't leave you fighting alone.",
    problemsIntro:
      "After a hail or wind event, homeowners are left confused about damage, deadlines, and what insurance actually owes them.",
    problems: [
      { title: "Damage you can't see", body: "Hail bruising and wind lift often aren't visible from the ground but still fail your roof." },
      { title: "Claim confusion", body: "Deadlines, adjusters, and paperwork are stressful — and easy to get wrong." },
      { title: "Underpaid scopes", body: "Initial insurance offers frequently miss damage that a trained eye catches." },
    ],
    process: [
      { step: "01", title: "Emergency Response", body: "Tarping and stabilization to stop further damage to your home." },
      { step: "02", title: "Damage Inspection", body: "A thorough, documented assessment of roof and exterior storm damage." },
      { step: "03", title: "Claim Filing", body: "We help open your claim and assemble the photo and report evidence." },
      { step: "04", title: "Adjuster Meeting", body: "Our specialist meets your adjuster on site to align on a fair scope." },
      { step: "05", title: "Restoration", body: "Certified crews restore your roof and exterior to better than before." },
      { step: "06", title: "Closeout", body: "Final walkthrough, warranties, and a digital packet of all documentation." },
    ],
    faqs: [
      { q: "How do I know if my roof has storm damage?", a: "Often you can't tell from the ground. Our free inspection documents hail and wind damage with photos so you know exactly where you stand." },
      { q: "Is there a deadline to file a storm claim?", a: "Yes — most policies limit how long after a storm you can file. The sooner we inspect, the better we protect your options." },
      { q: "What if my claim was denied or underpaid?", a: "We frequently identify missed damage and help pursue supplements so your approved scope reflects the real repairs needed." },
      { q: "What will I pay out of pocket?", a: "On approved claims, homeowners typically pay only their deductible. We'll explain exactly what to expect up front." },
    ],
    gallery: ["Hail-damaged roof — documented", "Emergency tarp in place", "Restoration in progress", "Restored roof — after"],
    related: ["roofing", "insurance-claims", "gutters", "windows"],
    metaTitle: "Storm Restoration — Hail & Wind Damage",
    metaDescription:
      "Storm restoration from Anexa Homes — documented hail and wind damage, emergency tarping, full restoration, and insurance claims managed for you in North Texas.",
  },

  "insurance-claims": {
    slug: "insurance-claims",
    heroLead: "Your claim, handled by people who ",
    heroHighlight: "do this every day",
    heroTail: ".",
    heroDescription:
      "We document the damage, meet your adjuster, and manage supplements and depreciation — so your claim is handled correctly and you typically pay only your deductible.",
    overviewTitle: "Insurance claim support, start to finish.",
    overviewBody:
      "A storm claim is its own full-time job — documentation, adjuster meetings, supplements, depreciation, and deadlines. We've done it thousands of times. Our specialists build the evidence, advocate for a fair scope, and manage every step alongside your restoration, so nothing falls through the cracks and you're never negotiating alone.",
    benefits: [
      { title: "Done-For-You Documentation", body: "We build the photo and report evidence that supports a fair, complete claim." },
      { title: "Adjuster Advocacy", body: "Our specialists meet your adjuster on site to align on the right scope." },
      { title: "Deductible-Only Goal", body: "We pursue supplements and recover depreciation so you typically pay just your deductible." },
    ],
    problemsTitle: "Insurance claims should be documented correctly — the first time.",
    problemsIntro:
      "Homeowners lose money every day to claims that were under-documented, under-scoped, or simply filed wrong.",
    problems: [
      { title: "Confusing process", body: "Adjusters, supplements, depreciation, and deadlines are a lot to manage alone." },
      { title: "Missed damage", body: "Untrained eyes miss damage that belongs in your scope — and your settlement." },
      { title: "Leaving money behind", body: "Without supplements and recovered depreciation, many homeowners are underpaid." },
    ],
    process: [
      { step: "01", title: "Free Inspection", body: "We document all storm damage with detailed photos and a written report." },
      { step: "02", title: "Claim Filing", body: "We help you open the claim and submit the supporting evidence." },
      { step: "03", title: "Adjuster Meeting", body: "Our specialist attends the adjuster visit to advocate for a fair scope." },
      { step: "04", title: "Supplements", body: "We document and submit missed items to correct an incomplete scope." },
      { step: "05", title: "Depreciation Recovery", body: "We help recover withheld depreciation once work is completed." },
      { step: "06", title: "Closeout", body: "Final paperwork and a digital packet so your records are complete." },
    ],
    faqs: [
      { q: "Do you really handle the whole claim?", a: "Yes. We document the damage, file the claim, meet your adjuster, negotiate supplements, and help recover depreciation — so you typically pay only your deductible." },
      { q: "Is this legal / allowed?", a: "Absolutely. As your contractor we document damage and advocate for an accurate scope of repairs. We coordinate directly with your carrier and adjuster." },
      { q: "What does it cost me?", a: "Claim support is part of your restoration project. On approved claims, your out-of-pocket is typically just your deductible." },
      { q: "What if my claim was already denied?", a: "We can re-inspect, document missed damage, and help you pursue a supplement or reconsideration where it's warranted." },
    ],
    gallery: ["Documented hail damage", "Adjuster meeting on site", "Supplement evidence", "Approved scope & closeout"],
    related: ["storm-restoration", "roofing", "gutters", "windows"],
    metaTitle: "Insurance Claim Support",
    metaDescription:
      "Insurance claim support from Anexa Homes — documentation, adjuster meetings, supplements, and depreciation recovery so you typically pay only your deductible.",
  },
};

export function serviceContent(slug: string): ServiceContent {
  const content = CONTENT[slug];
  if (!content) throw new Error(`No service content for slug: ${slug}`);
  return content;
}

export function serviceFor(slug: string): Service {
  const service = SERVICES.find((s) => s.slug === slug);
  if (!service) throw new Error(`No service for slug: ${slug}`);
  return service;
}

export function serviceMetadata(slug: string): Metadata {
  const c = serviceContent(slug);
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    alternates: { canonical: serviceFor(slug).href },
    openGraph: {
      title: `${c.metaTitle} | Anexa Homes`,
      description: c.metaDescription,
      images: [{ url: serviceFor(slug).image }],
      url: serviceFor(slug).href,
    },
  };
}
