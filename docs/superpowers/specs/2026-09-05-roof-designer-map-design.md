# The roof designer becomes a map

2026-09-05

## The report

> "can we make a simpler ui and easy control also need more map view google and
> ping and a few more some new houses are not showing"

Three complaints. They turned out to be one cause and one loose end.

## The cause

The designer was not a map. It drew on ONE photograph: a single Google Static
Maps image, 1280 px square, hard-centred on the deal's geocoded coordinate, at
one of two zooms. Forty metres of world, take it or leave it. Panning was a CSS
scroll over that fixed picture, so the edge of the photograph was the edge of
what existed.

Everything follows:

- **"I can't move the map."** There was nothing to move.
- **"It's showing the wrong house."** The centre WAS the geocode. In a new
  subdivision Google has only the street to interpolate along, so the picture
  framed a neighbour or the road, and no control could correct it.
- **"New houses aren't showing."** One vendor, one flight date, no alternative,
  and a grey tile whenever the requested depth had no imagery.

## What was measured rather than assumed

Checked against the live key on GCP project 1048785747692, 2026-09-05:

| Claim | Reality |
|---|---|
| Map Tiles API is available | **Disabled.** `createSession` answers 403 for every map type. This also means the Field Map's two Google basemap buttons currently draw nothing — a separate live bug. |
| Static Maps serves zoom 22 | **No.** A zoom=22 request returns an image byte-identical to zoom=21 (same MD5, same 1280×1280), HTTP 200, no warning. Asking deeper does not fail, it silently misreports scale. |
| Esri World Imagery goes deep | **Max 20 in this market.** z21+ returns a grey "Map data not yet available" JPEG with HTTP 200. |
| Esri can be drawn on our canvas | **Yes.** `Access-Control-Allow-Origin: *`, so a CORS image draws without tainting the canvas. |

The first fact killed the original plan (Map Tiles as the pannable layer). The
replacement is Google **Static Maps supertiles**: 640×640 at `scale=2`, needing
no GCP change, and about 15× fewer billed requests per screen than 256 px tiles
at the same pixel density.

## The design

### 1. A view, separate from the imagery that fills it

`src/lib/map-view.ts` — pure, 53 unit tests.

The coordinate system is unchanged, deliberately. Panels are stored in ground
metres east/north of the deal's coordinate and still are; that is what lets a
layout reopen at any zoom with every module where it was left. One thing is
added — a **centre** that may sit somewhere other than the origin — and `mpp`
(metres per CSS pixel) replaces the fixed zoom-and-scale pair.

In the designer the whole pan lives in **two lines**: one `ctx.translate` at the
top of `paint`, and the view offset folded into `toCanvas` where a real event
becomes a canvas position. Everything downstream — hit testing, the rubber band,
the facing-arrow grab radius — was written against a canvas centred on the deal
and still is.

The canvas is now the size of the viewport rather than a fixed square scaled to
fit, drawn in CSS pixels and scaled by the device pixel ratio once at the top.

### 2. Four basemaps

| | What it is for |
|---|---|
| **Satellite** | Google's photo, no labels. What the customer's picture is drawn on. |
| **Hybrid** | Street names and house numbers over the photo — how you check you are on the right roof. |
| **Esri** | A different vendor on a different flight schedule. The second chance on a new build. |
| **Road** | New subdivisions are platted here long before any aerial shows the houses. |

Past a vendor's last real zoom the view keeps going and the imagery is drawn
magnified, with a line on screen saying so. That beats a grey square, and it is
what the old screen did when a rep scaled the fixed photograph up.

**Honest limit, stated on screen:** if neither vendor has flown since the house
was built, no free source will show it. What the rep gets then is Road + Hybrid
to place the lot, and the pin to put the array on the right footprint.

### 3. The pin

Drag it onto the right roof; it writes the deal's coordinate, stamped so the
nightly geocoder never overwrites a person's correction.

The load-bearing detail: **moving the pin is a change of origin.** Every panel,
traced face, setback and roof plane is stored in metres from it, so all of them
are re-expressed against the new origin in the same breath — and so are the undo
stack and the "put the saved design back" snapshot. Miss those two and the design
sits correctly until the rep presses undo, at which point the array jumps by
exactly the distance the pin moved, for no reason they could connect to the pin.

The corrected coordinate travels **with** the re-based geometry in one write, so
there is no window in which the deal disagrees with itself. Bounded to 400 m: a
correction crosses a street, it does not move to the next town.

Address search moves the **view** only. Searching never edits the deal;
committing to what was found is a separate, deliberate act.

### 4. Security of the imagery route

A supertile is addressed as an **offset from a lead**, never as a coordinate.
The route resolves the centre itself from a lead the caller can already read, so
no browser can hand it a latitude and turn an authenticated session into a
general-purpose satellite proxy billed to this company. Offsets are bounded to
±6 supertiles; fractional offsets are allowed (see below) and widen nothing.

### 5. The customer's picture

Framed on the **array**, not on wherever the rep left the map — previously it
exported the designer's fixed frame, which was fine only because the frame could
not move. A rep who panned to the real house would have sent a photograph of the
ground beside it.

Rendered from **one** Static Maps image, not the mosaic on screen: every Static
Maps square carries Google's logo and imagery credit in its corners, so a
picture built from four of them carries four, scattered across a document sent to
a homeowner. Cropping them is not an option — attribution is a licence
condition. One image centred on the array carries exactly one, in the corner.
That is what the fractional offset is for. A rep on the Road layer exports
satellite: the customer gets a photograph, not a street diagram.

### 6. Simpler UI

- Five top-bar dropdowns (module, inverter, battery, quantity, imagery) become
  one **System** button reading "12.76 kW · 29 × Silfab 440". Each was a decision
  made once and then looked at, competing for width with the address.
- The eleven-row palette leads with **Fill this roof**, then Trim to usage, then
  the five tools a roof is usually drawn with; Move panel, Setbacks and Roof
  planes sit behind **More**. Nothing was removed and every keyboard shortcut
  still fires.
- The rail collapses, because it sits on the roof and sometimes the roof is what
  you need to see.

### 7. Gestures

Two-finger scroll pans, pinch zooms towards the cursor, space-drag pans over any
tool, middle and right drag pan. The wheel listener is attached by hand with
`passive: false` — React registers wheel at the root as passive, so a
`preventDefault` in an `onWheel` prop is ignored and a pinch zooms the browser
chrome instead of the roof.

## Bugs found and fixed on the way

- **Tile-count runaway.** A view wider than any source is offered at made the
  grid ask for tens of millions of tiles; the first test run killed the vitest
  worker. Now budgeted to 64, spent on the middle of the screen.
- **`Number("") === 0`.** `?tx=0&ty=` parsed as "the tile the house is on" and
  served the wrong ground with a 200 — the third time that trap has bitten this
  file. Blank is now rejected, not guessed.
- **DPR hydration mismatch.** Reading `window.devicePixelRatio` in a state
  initialiser rendered `width="1280"` on the server and `2560` on the client;
  React declines to patch canvas attributes up.
- **Undo after a pin move.** See above.
- **Canvas taint.** Esri must be requested as a CORS image or `toBlob` throws on
  save — a failure that would surface an hour later as a missing layout picture.

## Testing

- 53 unit tests on the view and tile maths; the projection round-trip, the
  measured vendor ceilings, the pan bound, the single-image export.
- Supertile parsing and bounds, including fractional offsets.
- The 18 designer Playwright specs, updated where they reach for a tool that now
  lives under `More`.
- Driven by hand in the browser: pan, zoom, all four basemaps, drawing, and a
  pin move verified to leave the array exactly where it was drawn.
