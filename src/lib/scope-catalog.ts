// Master scope catalog — the company-wide list of possible insurance-restoration
// line items. NO pricing here: cost/supplement/insurance prices live in separate
// versioned templates and in each Project → Scope of Work.

export const SCOPE_UNITS = ["SQ", "SF", "LF", "EA", "DAY", "SYSTEM", "PERCENT", "HR"] as const;
export type ScopeUnit = (typeof SCOPE_UNITS)[number];

export const SCOPE_UNIT_HINT: Record<string, string> = {
  SQ: "roofing square (100 sq ft)",
  SF: "square foot",
  LF: "linear foot",
  EA: "each",
  DAY: "per day",
  SYSTEM: "full system",
  PERCENT: "percentage",
  HR: "hourly",
};

export type CatalogSeedItem = {
  category: string;
  subcategory: string;
  trade: string;
  description: string;
  unit: string;
  common: boolean; // is a common insurance item
  supplement: boolean; // is supplement eligible
};

// Compact group form: [description, unit, common, supplementEligible].
type Row = [string, string, boolean, boolean];
type Group = { category: string; subcategory: string; trade: string; items: Row[] };

const GROUPS: Group[] = [
  {
    category: "Roofing", subcategory: "Asphalt Shingles", trade: "Roofing",
    items: [
      ["Tear off, haul, and dispose composition shingles", "SQ", true, false],
      ["Composition shingle roofing", "SQ", true, false],
      ["Architectural/laminated shingles", "SQ", true, false],
      ["3-tab shingles", "SQ", true, false],
      ["Starter course", "LF", true, true],
      ["Ridge cap shingles", "LF", true, true],
      ["Hip cap shingles", "LF", true, true],
      ["Roofing felt 15 lb", "SQ", true, false],
      ["Roofing felt 30 lb", "SQ", true, false],
      ["Synthetic underlayment", "SQ", true, true],
      ["Ice and water shield", "LF", true, true],
      ["Valley metal", "LF", true, true],
      ["Drip edge", "LF", true, true],
      ["Rake edge", "LF", true, true],
      ["Step flashing", "LF", true, true],
      ["Counter flashing", "LF", true, true],
      ["Apron flashing", "LF", true, true],
      ["Pipe jack flashing", "EA", true, true],
      ["Furnace vent flashing", "EA", true, true],
      ["Chimney flashing", "EA", true, true],
      ["Skylight flashing", "EA", true, true],
      ["Box vent", "EA", true, true],
      ["Turtle vent", "EA", true, true],
      ["Turbine vent", "EA", true, true],
      ["Ridge vent", "LF", true, true],
      ["Off ridge vent", "EA", true, true],
      ["Power attic vent", "EA", false, true],
      ["Detach and reset satellite dish", "EA", false, true],
      ["Detach and reset solar panel array", "EA", false, true],
      ["Detach and reset HVAC roof unit", "EA", false, true],
      ["High roof charge", "SQ", false, true],
      ["Steep roof charge", "SQ", false, true],
      ["Two-story charge", "SQ", false, true],
      ["Additional layer tear off", "SQ", false, true],
      ["Rotten decking replacement", "SF", false, true],
      ["OSB decking replacement", "SF", false, true],
      ["Plywood decking replacement", "SF", false, true],
    ],
  },
  {
    category: "Roofing", subcategory: "Metal Roof", trade: "Roofing",
    items: [
      ["Standing seam metal roofing", "SQ", true, false],
      ["R-panel metal roofing", "SQ", true, false],
      ["Corrugated metal roofing", "SQ", true, false],
      ["Metal roof tear off", "SQ", true, false],
      ["Metal roof underlayment", "SQ", true, true],
      ["Metal ridge cap", "LF", true, true],
      ["Metal hip cap", "LF", true, true],
      ["Metal rake trim", "LF", true, true],
      ["Metal eave trim", "LF", true, true],
      ["Metal valley trim", "LF", true, true],
      ["Metal flashing", "LF", true, true],
      ["Metal roof screws/fasteners", "SQ", true, false],
      ["Metal closure strips", "LF", true, true],
      ["Metal pipe boot flashing", "EA", true, true],
      ["Metal roof panel replacement", "SQ", false, true],
      ["Metal roof coating", "SQ", false, true],
      ["Metal roof sealant", "LF", false, true],
    ],
  },
  {
    category: "Gutters", subcategory: "Gutters", trade: "Gutters",
    items: [
      ["Aluminum gutter up to 5 inch", "LF", true, false],
      ["Aluminum gutter 6 inch", "LF", true, false],
      ["Downspout", "LF", true, false],
      ["Gutter guard/screen", "LF", false, true],
      ["Gutter apron", "LF", true, true],
      ["Gutter miters/corners", "EA", true, true],
      ["Splash block", "EA", false, true],
      ["Detach and reset gutters", "LF", false, true],
      ["Remove and replace gutters", "LF", true, false],
    ],
  },
  {
    category: "Windows & Screens", subcategory: "Windows & Screens", trade: "Windows",
    items: [
      ["Window screen repair", "EA", true, false],
      ["Window screen replacement", "EA", true, false],
      ["Window glass replacement", "SF", true, false],
      ["Window frame repair", "EA", false, true],
      ["Window trim repair", "LF", false, true],
      ["Detach and reset window screen", "EA", false, true],
    ],
  },
  {
    category: "Siding / Fascia / Soffit", subcategory: "Siding", trade: "Siding",
    items: [
      ["Vinyl siding", "SQ", true, false],
      ["Fiber cement siding", "SQ", true, false],
      ["Wood siding", "SQ", true, false],
      ["Metal siding", "SQ", true, false],
      ["Siding trim", "LF", true, true],
    ],
  },
  {
    category: "Siding / Fascia / Soffit", subcategory: "Fascia & Soffit", trade: "Siding",
    items: [
      ["Fascia board", "LF", true, true],
      ["Aluminum fascia wrap", "LF", true, true],
      ["Soffit panel", "SF", true, true],
      ["Soffit vent", "EA", true, true],
      ["Frieze board", "LF", false, true],
    ],
  },
  {
    category: "Exterior Paint", subcategory: "Exterior Paint", trade: "Painting",
    items: [
      ["Paint exterior siding", "SF", true, false],
      ["Paint fascia", "LF", true, true],
      ["Paint soffit", "SF", true, true],
      ["Paint trim", "LF", true, true],
      ["Paint door", "EA", false, true],
      ["Paint shutters", "EA", false, true],
      ["Stain fence", "LF", false, true],
      ["Seal exterior penetration", "EA", false, true],
    ],
  },
  {
    category: "Interior", subcategory: "Drywall & Paint", trade: "Interior",
    items: [
      ["Drywall repair", "SF", true, false],
      ["Drywall replacement", "SF", true, false],
      ["Tape, bed, and texture", "SF", true, true],
      ["Interior paint wall", "SF", true, false],
      ["Interior paint ceiling", "SF", true, false],
      ["Baseboard replacement", "LF", true, true],
      ["Crown molding replacement", "LF", false, true],
      ["Insulation replacement", "SF", true, true],
    ],
  },
  {
    category: "Interior", subcategory: "Flooring & Finishes", trade: "Interior",
    items: [
      ["Carpet replacement", "SF", true, false],
      ["Laminate flooring", "SF", true, false],
      ["Tile flooring", "SF", true, false],
      ["Cabinet repair", "LF", false, true],
      ["Countertop repair", "SF", false, true],
    ],
  },
  {
    category: "Fence", subcategory: "Fence", trade: "Fencing",
    items: [
      ["Wood fence repair", "LF", true, false],
      ["Wood fence replacement", "LF", true, false],
      ["Metal fence repair", "LF", true, false],
      ["Chain link fence repair", "LF", true, false],
      ["Fence post replacement", "EA", true, true],
      ["Gate replacement", "EA", false, true],
      ["Stain fence", "LF", false, true],
    ],
  },
  {
    category: "HVAC", subcategory: "HVAC", trade: "HVAC",
    items: [
      ["HVAC condenser combing", "EA", true, true],
      ["HVAC condenser replacement", "EA", false, true],
      ["Furnace vent cap", "EA", true, true],
      ["Flue pipe flashing", "EA", true, true],
      ["Duct repair", "LF", false, true],
      ["Duct replacement", "LF", false, true],
      ["Thermostat replacement", "EA", false, true],
      ["Detach and reset HVAC unit", "EA", false, true],
    ],
  },
  {
    category: "Electrical", subcategory: "Electrical", trade: "Electrical",
    items: [
      ["Electrical mast repair", "EA", true, true],
      ["Meter base repair", "EA", false, true],
      ["Weatherhead repair", "EA", true, true],
      ["Exterior light fixture", "EA", false, true],
      ["Interior light fixture", "EA", false, true],
      ["Outlet replacement", "EA", false, true],
      ["Switch replacement", "EA", false, true],
    ],
  },
  {
    category: "Solar", subcategory: "Solar", trade: "Solar",
    items: [
      ["Solar panel detach and reset", "EA", true, true],
      ["Solar array detach and reset", "SYSTEM", true, true],
      ["Solar rail detach and reset", "LF", true, true],
      ["Solar roof penetration flashing", "EA", true, true],
      ["Solar conduit detach and reset", "LF", true, true],
    ],
  },
  {
    category: "Water Mitigation", subcategory: "Water Mitigation", trade: "Water Mitigation",
    items: [
      ["Water extraction", "SF", true, false],
      ["Dehumidifier", "DAY", true, true],
      ["Air mover", "DAY", true, true],
      ["Moisture monitoring", "DAY", true, true],
      ["Flood cut drywall", "LF", true, true],
      ["Remove wet insulation", "SF", true, true],
      ["Antimicrobial treatment", "SF", true, true],
    ],
  },
  {
    category: "General / Misc", subcategory: "General / Misc", trade: "General",
    items: [
      ["Dumpster / haul off", "EA", true, false],
      ["Labor minimum", "EA", true, true],
      ["Roofing labor minimum", "EA", true, true],
      ["Window labor minimum", "EA", false, true],
      ["Permit", "EA", true, true],
      ["Emergency tarp", "SQ", true, true],
      ["Temporary repair", "EA", false, true],
      ["Final clean up", "EA", true, false],
      ["Material delivery", "EA", false, true],
      ["O&P overhead and profit", "PERCENT", false, true],
      ["Code upgrade", "EA", false, true],
      ["Engineering report", "EA", false, true],
      ["Ladder assist", "EA", false, true],
    ],
  },
];

export const DEFAULT_SCOPE_CATALOG: CatalogSeedItem[] = GROUPS.flatMap((g) =>
  g.items.map(([description, unit, common, supplement]) => ({
    category: g.category,
    subcategory: g.subcategory,
    trade: g.trade,
    description,
    unit,
    common,
    supplement,
  }))
);
