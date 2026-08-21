import { test, expect, type Page } from "@playwright/test";

/**
 * The designer's contract, end to end: what a rep draws on the roof is what the
 * deal is sized from, and it survives a reload.
 *
 * The module count used to be typed into a box. How many panels fit a roof is
 * something you find out by putting them on it, so the box is gone and this is
 * what replaced it.
 *
 * The designer is its own SCREEN now rather than a section of the System design
 * step — a roof is landscape and a form is a column — so every test here starts
 * at `/solar-proposal/design`.
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/**
 * Marcus Webb, not Priya Raman.
 *
 * Drawing an array rewrites the deal's module count and system size, and
 * solar-no-insurance.spec.ts pins Priya's deal at exactly 10.00 kW. This spec
 * gets a deal of its own that it is free to change.
 */
async function openDesignerDeal(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
  await page.goto("/portal/leads?q=Marcus");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  return page.url().split("/").pop()!;
}

/** Straight into the designer, with the canvas up. */
async function openDesigner(page: Page): Promise<string> {
  const leadId = await openDesignerDeal(page);
  await page.goto(`/portal/leads/${leadId}/solar-proposal/design`);
  await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 15000 });
  return leadId;
}

/**
 * Pick a tool, THEN measure the canvas.
 *
 * The toolbar floats over the top-left of the picture, so a drag is started
 * well clear of it — a gesture that begins under a button is a gesture the
 * canvas never sees, which reads as "the tool is broken" rather than "the test
 * aimed at the toolbar".
 */
async function pickTool(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  return (await page.getByTestId("layout-canvas").boundingBox())!;
}

/**
 * How many panels are on the roof right now.
 *
 * The specs in this file share one deal and each of them SAVES, so the roof a
 * test opens is whatever the test before it left. Assertions are therefore
 * deltas, never absolutes — "0 panels" is only true for whichever test happens
 * to run first, and pinning it makes the suite order-dependent.
 */
async function panelsOnRoof(page: Page): Promise<number> {
  const text = (await page.getByTestId("panel-count").textContent())!;
  return parseInt(text.trim(), 10);
}

/**
 * Find a thing on the canvas by the COLOUR drawn there, and click its middle.
 *
 * Aiming at a fraction of the picture is how the ghost test used to miss: a
 * green square is one module wide, which is 2.8% of a 40 m picture, so "click
 * at 0.735" is a guess with a three-pixel margin that moves whenever the fitted
 * zoom does. The canvas already knows exactly where it drew things, so ask it.
 *
 * Matching pixels are grouped into BLOBS and the click lands on a blob's
 * centroid, never on an extreme pixel. The extreme pixel of a ghost is its
 * border stroke, and a stroke is centred on the path — so half of it is outside
 * the shape, and a click there hits the roof instead of the button.
 *
 * The colour tests assume the blank fallback tile, which is what this suite
 * runs on: the E2E Maps key is deliberately invalid, so no imagery ever arrives
 * and the canvas background is the flat #1f2937 fill.
 */
async function clickCanvasColour(
  page: Page,
  what: "ghost" | "panel",
  pick: "rightmost" | "largest" | "smallest" | "first" = "largest"
): Promise<boolean> {
  return page.evaluate(
    ({ what, pick }) => {
      const c = document.querySelector('[data-testid="layout-canvas"]') as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      // Every pixel, not every other one. A knocked-out cell is ONE module, and
      // on a seed whose catalogue module is small that is nine pixels across —
      // a step of 2 reduced it to four samples, under the noise threshold
      // below, so "the smallest green shape" found a side ghost instead of the
      // hole and the array grew by a whole column.
      const STEP = 1;
      const W = Math.floor(c.width / STEP);
      const H = Math.floor(c.height / STEP);

      // Ghost fill: rgba(74,222,128,.35) over the background. Panel fill:
      // rgba(17,32,56,.82) over it — darker in red than the background is.
      // The ghost's FILL, never its border. The four side ghosts are separated
      // only by the array between them, and their border strokes very nearly
      // meet at the corners — matching the stroke merges all four into one
      // ring-shaped blob whose centroid is the middle of the array, so "click
      // the right-hand ghost" clicked a panel and nothing grew.
      //   fill  = rgba(74,222,128,.35) over #1f2937 → ~(46,104,81)
      //   hole  = rgba(74,222,128,.22) over #1f2937 → ~(41,81,71)
      //   border= rgba(22,163,74,.9)   over #1f2937 → ~(23,151,72), excluded by g
      const want = (r: number, g: number, b: number) =>
        what === "ghost"
          ? r > 33 && r < 58 && g > 70 && g < 118 && b > 58 && b < 92
          : r < 26 && g > 26 && g < 42 && b > 45 && b < 70;

      const at = (x: number, y: number) => {
        const r = c.getBoundingClientRect();
        const pos = {
          clientX: r.left + ((x * STEP) / c.width) * r.width,
          clientY: r.top + ((y * STEP) / c.height) * r.height,
        };
        for (const t of ["pointerdown", "pointerup"]) {
          c.dispatchEvent(
            new PointerEvent(t, {
              ...pos, bubbles: true, pointerId: 1, isPrimary: true, button: 0,
              buttons: t === "pointerup" ? 0 : 1,
            })
          );
        }
        return true;
      };

      const mask = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * STEP * c.width + x * STEP) * 4;
          if (want(d[i], d[i + 1], d[i + 2])) {
            // A centroid is only inside its shape when the shape is convex and
            // alone. Two arrays that touch merge into one blob whose middle is
            // the gap between them, and a click there hits the roof. The first
            // matching pixel is always on something.
            if (pick === "first") return at(x, y);
            mask[y * W + x] = 1;
          }
        }
      }

      // Flood the mask into blobs, so "the right-hand ghost" is a shape rather
      // than whichever stray pixel happened to be furthest right.
      const seen = new Uint8Array(W * H);
      const blobs: { n: number; cx: number; cy: number }[] = [];
      const stack: number[] = [];
      for (let p0 = 0; p0 < mask.length; p0++) {
        if (!mask[p0] || seen[p0]) continue;
        stack.length = 0;
        stack.push(p0);
        seen[p0] = 1;
        let n = 0, sx = 0, sy = 0;
        while (stack.length) {
          const p = stack.pop()!;
          const x = p % W;
          const y = (p / W) | 0;
          n++; sx += x; sy += y;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const q = ny * W + nx;
            if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
          }
        }
        // Two samples is noise, not a shape.
        if (n > 6) blobs.push({ n, cx: sx / n, cy: sy / n });
      }
      if (!blobs.length) return false;

      const chosen = blobs.reduce((best, b) =>
        pick === "rightmost" ? (b.cx > best.cx ? b : best)
        : pick === "smallest" ? (b.n < best.n ? b : best)
        : (b.n > best.n ? b : best)
      );

      return at(chosen.cx, chosen.cy);
    },
    { what, pick }
  );
}

/**
 * Start every drawing test on an empty roof.
 *
 * These specs share one deal and each of them SAVES, so without this the roof
 * accumulates until the save action's own 500-panel sanity check refuses it —
 * and a test that fails because the test before it drew too much is a test that
 * tells you nothing about the code.
 */
async function clearRoof(page: Page) {
  await page.getByRole("button", { name: "Move array", exact: true }).click();
  let last = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 80; i++) {
    const n = await panelsOnRoof(page);
    if (n === 0) break;
    // No progress twice running means the clicks are no longer landing on
    // anything, and another 70 rounds of the same will not help.
    if (n >= last) break;
    last = n;
    if (!(await clickCanvasColour(page, "panel", "first"))) break;
    await page.keyboard.press("Delete");
  }
  // Loud on failure: a test that quietly starts on someone else's 400 panels
  // fails later, somewhere else, for a reason that has nothing to do with it.
  expect(await panelsOnRoof(page)).toBe(0);
}

/** A rectangle dragged across a clear part of the picture. */
async function dragArray(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.66, { steps: 12 });
  await page.mouse.up();
}

test.describe(FLAG_ON ? "the panel layout designer" : "the panel layout designer (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("the design step hands off to the designer and asks for nothing nobody decides there", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=design`);

    // The step's job is now to get a rep INTO the designer, not to be one.
    await expect(page.getByRole("link", { name: /Draw the array|Open the designer/ })).toBeVisible({
      timeout: 15000,
    });

    // Interconnection paperwork, a shading figure typed from memory, and
    // equipment nobody has ordered yet: gone from the app entirely.
    for (const gone of [
      "Utility account #",
      "Meter #",
      "Rate plan / tariff",
      "Net metering programme",
      "TSRF %",
      "Module quantity",
    ]) {
      await expect(page.getByLabel(gone)).toHaveCount(0);
    }

    // Usage and the bill still EXIST — they moved to the Energy step, which owns
    // them. Every step stays mounted and is hidden with display:none, so the
    // assertion here is that they are not on this one, not that they are absent.
    for (const moved of ["Annual usage (kWh)", "Average monthly bill ($)"]) {
      await expect(page.getByLabel(moved)).not.toBeVisible();
    }
  });

  test("drawing an array sizes the system, and survives a reload", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openDesigner(page);

    const box = await pickTool(page, "Draw array");
    const before = await panelsOnRoof(page);
    await dragArray(page, box);

    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBeGreaterThan(before);
    const drawn = await panelsOnRoof(page);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/panels? saved/)).toBeVisible({ timeout: 15000 });

    // The count is the deal's module quantity now, so it has to come back from
    // the database rather than from component state.
    await page.reload();
    await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 15000 });
    expect(await panelsOnRoof(page)).toBe(drawn);
  });

  /**
   * The regression that every other drag test in this file was too slow to
   * catch.
   *
   * `page.mouse.move(..., { steps: 12 })` sends a dozen separate moves with a
   * render between each, so by the time the release arrives React has long
   * since committed the rectangle. A real mouse does not do that: release the
   * button in the same frame as the last movement — which is most drags, and
   * every quick one — and the move and the up land in ONE task with no render
   * between them. The handlers read `drag` from the render closure, so they
   * measured the rectangle as it was before it was dragged: 0.0 m x 0.0 m, on
   * a rectangle covering half a roof.
   *
   * Dispatching the gesture by hand is the only way to pin the timing down;
   * asking Playwright for a fast drag still gives you a slow one.
   */
  test("a drag whose release lands in the same task still draws the array", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openDesigner(page);

    /** The whole gesture in one task, optionally without any move at all. */
    const gesture = (withMove: boolean) =>
      page.evaluate((move: boolean) => {
        const c = document.querySelector('[data-testid="layout-canvas"]') as HTMLCanvasElement;
        const r = c.getBoundingClientRect();
        const at = (fx: number, fy: number) => ({
          clientX: r.left + r.width * fx,
          clientY: r.top + r.height * fy,
        });
        const fire = (type: string, pos: { clientX: number; clientY: number }) =>
          c.dispatchEvent(
            new PointerEvent(type, {
              ...pos,
              bubbles: true,
              pointerId: 1,
              isPrimary: true,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
            })
          );
        fire("pointerdown", at(0.45, 0.3));
        if (move) fire("pointermove", at(0.72, 0.68));
        fire("pointerup", at(0.72, 0.68));
      }, withMove);

    await pickTool(page, "Draw array");
    const start = await panelsOnRoof(page);
    await gesture(true);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBeGreaterThan(start);
    const afterMove = await panelsOnRoof(page);

    // And with no `pointermove` at all, which is what a flick across a
    // trackpad delivers: the release position is on the pointerup event, so
    // there is a rectangle whether or not a move was ever processed.
    await pickTool(page, "Draw array");
    await gesture(false);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBeGreaterThan(afterMove);
  });

  test("a single panel placed on an empty roof stands on its own", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openDesigner(page);
    await clearRoof(page);

    // ONE panel, placed by clicking. The whole reason this tool grew a
    // per-panel mode: a rectangle drag cannot put a module beside a vent.
    const box = await pickTool(page, "Add panel");
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBe(1);
    await expect(page.getByText("Panel", { exact: true })).toBeVisible();

    // Placing it selects it, so the arrow keys have something to move. The
    // count must not change — a nudge that duplicates or drops a panel is a
    // nudge that silently reprices the deal.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    expect(await panelsOnRoof(page)).toBe(1);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/panels? saved/)).toBeVisible({ timeout: 15000 });

    await page.reload();
    await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 15000 });
    expect(await panelsOnRoof(page)).toBe(1);
  });

  /**
   * The complaint this behaviour answers: adding panels one at a time used to
   * drop a free-standing module wherever the pointer was, so six clicks left
   * six independent arrays, each a few centimetres out of line with the others.
   * A click near an existing array now lands on THAT array's lattice.
   */
  test("a panel added beside an array joins it rather than starting another", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openDesigner(page);
    await clearRoof(page);

    const drawBox = await pickTool(page, "Draw array");
    await dragArray(page, drawBox);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBeGreaterThan(0);
    const drawn = await panelsOnRoof(page);

    // Aim at the green ghost just past the array's edge — the cell where the
    // lattice continues. Under Add panel that is ONE panel, not the whole
    // column a ghost click gives under Move array.
    await pickTool(page, "Add panel");
    expect(await clickCanvasColour(page, "ghost", "rightmost")).toBe(true);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBe(drawn + 1);

    // And it joined: the selection is the array, not a loose module.
    await expect(page.getByText(/^Array · /)).toBeVisible();
    await expect(page.getByText("Panel", { exact: true })).toHaveCount(0);

    // Three more clicks, three more panels — one each, still on one array.
    for (let i = 2; i <= 4; i++) {
      expect(await clickCanvasColour(page, "ghost", "rightmost")).toBe(true);
      await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBe(drawn + i);
    }
    await expect(page.getByText(/^Array · /)).toBeVisible();
  });

  test("pulling one panel out of an array keeps the count the same", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openDesigner(page);

    const drawBox = await pickTool(page, "Draw array");
    const before = await panelsOnRoof(page);
    await dragArray(page, drawBox);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBeGreaterThan(before);
    const drawn = await panelsOnRoof(page);

    // Grab a module out of the middle of the grid and drag it clear. It leaves
    // the array and becomes its own panel; the total is untouched, because the
    // hole it came from is knocked out at the same moment.
    const box = await pickTool(page, "Move panel");
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.8, { steps: 10 });
    await page.mouse.up();

    expect(await panelsOnRoof(page)).toBe(drawn);
    await expect(page.getByText("Panel", { exact: true })).toBeVisible();
  });

  /**
   * The green squares around a selected array: click one and the array grows by
   * a row or a column, click a gap and the panel comes back.
   *
   * This is the affordance the tool was missing — an array was built by dragging
   * a rectangle and then fighting a resize grip, and taking one module out left
   * the rest to be redrawn.
   */
  test("clicking a ghost adds a panel, and removing one leaves the rest where they were", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openDesigner(page);

    await clearRoof(page);
    const drawBox = await pickTool(page, "Draw array");
    await dragArray(page, drawBox);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBeGreaterThan(0);
    const drawn = await panelsOnRoof(page);

    // Drawing selects the new array, so its ghosts are already on screen. The
    // rightmost green pixel is in the ghost column past its right edge.
    expect(await clickCanvasColour(page, "ghost", "rightmost")).toBe(true);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBeGreaterThan(drawn);
    const afterGrow = await panelsOnRoof(page);

    // Take one back out. The array keeps its grid — the modules either side
    // stay exactly where they were — so the count drops by exactly one.
    await pickTool(page, "Remove panels");
    expect(await clickCanvasColour(page, "panel")).toBe(true);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBe(afterGrow - 1);

    // And the gap it left is a ghost now: clicking it puts the module back, in
    // the same place, without the array rearranging itself around it.
    //
    // No reselect first — removing a panel from a grid leaves that grid
    // selected, and clicking a panel to "make sure" would land on the hole
    // (it is the middle of the array, which is where the panel blob's centroid
    // is) and refill it early.
    await pickTool(page, "Move array");
    expect(await clickCanvasColour(page, "ghost", "smallest")).toBe(true);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBe(afterGrow);
  });

  test("which way the roof faces changes the production, and is asked for", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openDesigner(page);

    await clearRoof(page);
    const box = await pickTool(page, "Draw array");
    await dragArray(page, box);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBeGreaterThan(0);

    // An array nobody has described is chased for its orientation rather than
    // quietly priced as though it faced south.
    await expect(page.getByText(/no facing or pitch/)).toBeVisible();

    // South at a 6/12 pitch: as good as this site gets.
    await page.getByLabel("Facing (azimuth)").fill("180");
    await page.getByRole("button", { name: "Set tilt" }).click();
    await page.getByRole("button", { name: "6/12", exact: true }).click();
    await expect(page.getByTestId("orientation-factor")).toBeVisible();
    const south = parseInt((await page.getByTestId("orientation-factor").textContent())!, 10);

    // Turn the same array to face north and the number has to fall. This is
    // the whole point of the model: identical panels, different roof.
    await page.getByLabel("Facing (azimuth)").fill("0");
    await expect.poll(
      async () => parseInt((await page.getByTestId("orientation-factor").textContent())!, 10),
      { timeout: 10000 }
    ).toBeLessThan(south);
    const north = parseInt((await page.getByTestId("orientation-factor").textContent())!, 10);

    // And it survives the round trip through the database, because the
    // production the customer is quoted is computed server-side from it.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/panels? saved/)).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 15000 });
    // Reselect the array the reload deselected, then read its figure back.
    await pickTool(page, "Move array");
    expect(await clickCanvasColour(page, "panel")).toBe(true);
    await expect(page.getByTestId("orientation-factor")).toBeVisible({ timeout: 10000 });
    expect(parseInt((await page.getByTestId("orientation-factor").textContent())!, 10)).toBe(north);
  });

  /**
   * Shading is the other half of the production model, and the half a rep can
   * see out of the window. A tree over one bank has to take kWh off that bank
   * and no other.
   */
  test("shading an array drops its production without touching the panel count", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openDesigner(page);

    await clearRoof(page);
    const box = await pickTool(page, "Draw array");
    await dragArray(page, box);
    await expect.poll(() => panelsOnRoof(page), { timeout: 10000 }).toBeGreaterThan(0);
    const drawn = await panelsOnRoof(page);

    // Describe the plane first, so the figure being watched is a real one.
    await page.getByLabel("Facing (azimuth)").fill("180");
    await page.getByRole("button", { name: "Set tilt" }).click();
    await page.getByRole("button", { name: "6/12", exact: true }).click();
    const clear = parseInt((await page.getByTestId("orientation-factor").textContent())!, 10);

    await page.getByRole("button", { name: "Set shading" }).click();
    await page.getByRole("slider", { name: "Shading" }).fill("50");

    // Half the sun, half the output — and not one panel fewer, because a tree
    // does not remove a module.
    await expect.poll(
      async () => parseInt((await page.getByTestId("orientation-factor").textContent())!, 10),
      { timeout: 10000 }
    ).toBeLessThan(clear);
    expect(await panelsOnRoof(page)).toBe(drawn);
  });

  /**
   * A rep traces a setback by clicking round the eave — and then has to be able
   * to STOP. Finishing used to be a double-click or Enter and nothing else, so
   * clicking back onto the dot the trace started from just dropped another point
   * on top of it and the dashed line ran on forever.
   *
   * Clicking the first point closes the loop; clicking the last one ends an open
   * run, which is also what the second click of a double-click lands on.
   */
  test("a traced setback ends where the rep clicks back onto a point already down", async ({ page }) => {
    await login(page, "admin@anexahomes.com");

    /**
     * Wait for the imagery to resolve before aiming at the picture.
     *
     * The canvas is full-bleed while the tile is in flight and REFITS the moment
     * it lands — 1280 px wide down to 622 here. A trace started before that puts
     * its first point on one canvas and its closing click on another, and the
     * shape never shuts. Waiting for the box to stop moving is not enough: two
     * early samples are identical, and the refit comes after them.
     */
    const imagery = page.waitForResponse((r) => r.url().includes("/api/property/satellite"), {
      timeout: 30000,
    });
    await openDesigner(page);
    await imagery;
    await pickTool(page, "Draw setbacks");
    const box = await (async () => {
      let last = "";
      for (let i = 0; i < 40; i++) {
        const b = (await page.getByTestId("layout-canvas").boundingBox())!;
        const key = `${b.x},${b.y},${b.width},${b.height}`;
        if (key === last) return b;
        last = key;
        await page.waitForTimeout(120);
      }
      throw new Error("the designer canvas never stopped resizing");
    })();

    /**
     * A fraction of the part of the picture that is both ON SCREEN and clear of
     * the floating panels: the tool palette over the top-left, the totals over
     * the top-right, the hint pill along the bottom, and — because the picture
     * is square and the window is not — everything below the fold. A click on
     * any of those is a click the canvas never sees, which reads as "the tool
     * ignored me" while the tool is working perfectly.
     */
    const left = Math.max(box.x, 200);
    const right = Math.min(box.x + box.width, page.viewportSize()!.width - 40);
    const top = Math.max(box.y, 130);
    const bottom = Math.min(box.y + box.height, page.viewportSize()!.height - 90);
    const at = (fx: number, fy: number) => ({
      x: left + (right - left) * fx,
      y: top + (bottom - top) * fy,
    });
    const click = (fx: number, fy: number) => {
      const p = at(fx, fy);
      return page.mouse.click(p.x, p.y);
    };
    const tracing = page.getByText("Click along the edge");
    const footer = page.locator("footer").first();

    // Three corners of an eave, then back onto the first dot to close it.
    await click(0.1, 0.1);
    await click(0.6, 0.1);
    await click(0.6, 0.5);
    await expect(tracing).toBeVisible();

    await click(0.1, 0.1);
    await expect(tracing).toBeHidden();
    await expect(footer).toContainText("1 setback");

    // An open run ends on its own last point instead — no loop closed, and one
    // more setback on the roof.
    await click(0.25, 0.7);
    await click(0.75, 0.75);
    await expect(tracing).toBeVisible();
    await click(0.75, 0.75);
    await expect(tracing).toBeHidden();
    await expect(footer).toContainText("2 setbacks");

    // And the gesture the hint has always advertised still works.
    await click(0.9, 0.2);
    const dbl = at(0.9, 0.45);
    await page.mouse.dblclick(dbl.x, dbl.y);
    await expect(tracing).toBeHidden();
    await expect(footer).toContainText("3 setbacks");
  });

});
