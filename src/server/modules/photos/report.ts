import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import sharp from "sharp";
import { getObject } from "@/server/storage";

// --- Page geometry (US Letter portrait) ----------------------------------
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 48;
const FOOTER_ZONE = 30;
const CONTENT_TOP = PAGE_H - HEADER_H - 20;
const CONTENT_BOTTOM = MARGIN + FOOTER_ZONE;

const COL_GAP = 16;
const ROW_GAP = 16;
const CELL_W = (CONTENT_W - COL_GAP) / 2;
const CELL_IMG_H = 164;
const WIDE_IMG_H = 250;
const CAP_GAP = 6;
const CAP_SIZE = 9;
const CAP_H = CAP_SIZE + 3;
const WIDE_RATIO = 2.0;

const ORANGE = rgb(0.957, 0.388, 0.118);
const DARK = rgb(0.09, 0.09, 0.11);
const INK = rgb(0.13, 0.13, 0.16);
const GRAY = rgb(0.42, 0.42, 0.47);
const FAINT = rgb(0.6, 0.6, 0.65);
const CARD_BG = rgb(0.949, 0.949, 0.96);
const CARD_BORDER = rgb(0.87, 0.87, 0.9);
const WHITE = rgb(1, 1, 1);

function safe(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function ellipsize(text: string, font: PDFFont, size: number, maxW: number): string {
  let s = safe(text);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

type Prepared = { caption: string; img: PDFImage | null; w: number; h: number; wide: boolean };
type Section = { title: string; items: Prepared[] };

export type ReportPhoto = { storageKey: string; label: string; caption?: string };
export type ReportMeta = { reference: string; customer: string; address: string; setLabel: string };

/**
 * Render a branded photo report PDF from a flat list of photos (grouped by their
 * `label` into sections). Shared by the project (slot-based) and deal (group-based)
 * compile routes so both produce identical, professional output.
 */
export async function renderPhotoReport(photos: ReportPhoto[], meta: ReportMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let logo: PDFImage | null = null;
  try {
    logo = await doc.embedPng(await readFile(path.join(process.cwd(), "public", "anexa-mark.png")));
  } catch {
    logo = null;
  }

  async function prep(storageKey: string, caption: string): Promise<Prepared> {
    try {
      const raw = await getObject(storageKey);
      const { data, info } = await sharp(raw)
        .rotate()
        .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer({ resolveWithObject: true });
      const img = await doc.embedJpg(data);
      return { caption, img, w: info.width, h: info.height, wide: info.width / info.height > WIDE_RATIO };
    } catch {
      return { caption, img: null, w: 4, h: 3, wide: false };
    }
  }

  // Group photos under their label (section heading), preserving first-seen order.
  const order: string[] = [];
  const byLabel = new Map<string, ReportPhoto[]>();
  for (const p of photos) {
    const label = p.label || "Photos";
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)!.push(p);
  }
  const sections: Section[] = [];
  for (const label of order) {
    const items = await Promise.all(byLabel.get(label)!.map((p) => prep(p.storageKey, p.caption ?? label)));
    sections.push({ title: label, items });
  }

  const total = photos.length;
  const customer = safe(meta.customer);
  const addr = safe(meta.address);
  const setLabel = meta.setLabel;
  const generatedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const ref = safe(meta.reference);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  function drawBand(p: PDFPage) {
    p.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: DARK });
    let tx = MARGIN;
    if (logo) {
      const lh = 24;
      const lw = (logo.width / logo.height) * lh;
      p.drawImage(logo, { x: MARGIN, y: PAGE_H - HEADER_H + (HEADER_H - lh) / 2, width: lw, height: lh });
      tx = MARGIN + lw + 8;
    }
    p.drawText("Anexa Homes", { x: tx, y: PAGE_H - 31, size: 13, font: bold, color: WHITE });
    const right = `Photo Report  -  ${ref}`;
    p.drawText(right, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(right, 9), y: PAGE_H - 30, size: 9, font, color: ORANGE });
  }

  function startPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    drawBand(page);
    y = CONTENT_TOP;
  }

  function ensure(h: number) {
    if (y - h < CONTENT_BOTTOM) startPage();
  }

  function drawCard(p: PDFPage, x: number, yTop: number, boxW: number, imgH: number, item: Prepared) {
    p.drawRectangle({ x, y: yTop - imgH, width: boxW, height: imgH, color: CARD_BG, borderColor: CARD_BORDER, borderWidth: 0.5 });
    if (item.img) {
      const scale = Math.min(boxW / item.w, imgH / item.h);
      const w = item.w * scale;
      const h = item.h * scale;
      p.drawImage(item.img, { x: x + (boxW - w) / 2, y: yTop - imgH + (imgH - h) / 2, width: w, height: h });
    } else {
      const msg = "No photo provided";
      p.drawText(msg, { x: x + (boxW - font.widthOfTextAtSize(msg, 10)) / 2, y: yTop - imgH / 2 - 4, size: 10, font, color: FAINT });
    }
    const cap = ellipsize(item.caption, bold, CAP_SIZE, boxW);
    p.drawText(cap, { x, y: yTop - imgH - CAP_GAP - CAP_SIZE, size: CAP_SIZE, font: bold, color: INK });
  }

  function sectionHeader(title: string, count: number) {
    ensure(34 + CELL_IMG_H * 0.4);
    page.drawRectangle({ x: MARGIN, y: y - 16, width: 3, height: 15, color: ORANGE });
    page.drawText(ellipsize(title, bold, 12, CONTENT_W - 90), { x: MARGIN + 9, y: y - 14, size: 12, font: bold, color: INK });
    const m = `${count} photo${count === 1 ? "" : "s"}`;
    page.drawText(m, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(m, 9), y: y - 13, size: 9, font, color: GRAY });
    page.drawLine({ start: { x: MARGIN, y: y - 22 }, end: { x: PAGE_W - MARGIN, y: y - 22 }, thickness: 0.5, color: CARD_BORDER });
    y -= 32;
  }

  function drawCover(hero: Prepared | null) {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(p);
    const bandH = 168;
    p.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: bandH, color: DARK });
    let tx = MARGIN;
    if (logo) {
      const lh = 40;
      const lw = (logo.width / logo.height) * lh;
      p.drawImage(logo, { x: MARGIN, y: PAGE_H - 78, width: lw, height: lh });
      tx = MARGIN + lw + 12;
    }
    p.drawText("Anexa Homes", { x: tx, y: PAGE_H - 64, size: 28, font: bold, color: WHITE });
    p.drawText("PHOTO REPORT", { x: tx, y: PAGE_H - 92, size: 12, font: bold, color: ORANGE });
    p.drawText(`${setLabel}  -  ${total} photo${total === 1 ? "" : "s"}  -  Generated ${generatedOn}`, {
      x: tx, y: PAGE_H - 112, size: 9, font, color: rgb(0.75, 0.75, 0.8),
    });

    const metaTop = PAGE_H - bandH - 28;
    const col2 = MARGIN + CONTENT_W / 2;
    const metaCell = (label: string, value: string, x: number, yy: number) => {
      p.drawText(label.toUpperCase(), { x, y: yy, size: 8, font, color: GRAY });
      p.drawText(ellipsize(value || "-", bold, 13, CONTENT_W / 2 - 12), { x, y: yy - 16, size: 13, font: bold, color: INK });
    };
    metaCell("Reference", ref, MARGIN, metaTop);
    metaCell("Customer", customer, col2, metaTop);
    metaCell("Property", addr || "-", MARGIN, metaTop - 44);
    metaCell("Photo set", setLabel, col2, metaTop - 44);

    const heroTop = metaTop - 44 - 34;
    const heroBottom = MARGIN + 12;
    const heroH = heroTop - heroBottom;
    p.drawRectangle({ x: MARGIN, y: heroBottom, width: CONTENT_W, height: heroH, color: CARD_BG, borderColor: CARD_BORDER, borderWidth: 0.5 });
    if (hero?.img) {
      const scale = Math.min(CONTENT_W / hero.w, heroH / hero.h);
      const w = hero.w * scale, h = hero.h * scale;
      p.drawImage(hero.img, { x: MARGIN + (CONTENT_W - w) / 2, y: heroBottom + (heroH - h) / 2, width: w, height: h });
    }
  }

  const heroItem = sections.flatMap((s) => s.items).find((i) => i.img) ?? null;
  const useCover = total > 6;

  if (useCover) {
    drawCover(heroItem);
    startPage();
  } else {
    startPage();
    page.drawText(`Photo Report  -  ${ref}  -  ${customer}`, { x: MARGIN, y: y - 16, size: 14, font: bold, color: INK });
    const sub = [setLabel, `${total} photo${total === 1 ? "" : "s"}`, `Generated ${generatedOn}`, addr]
      .filter(Boolean).join("   -   ");
    page.drawText(ellipsize(sub, font, 9, CONTENT_W), { x: MARGIN, y: y - 30, size: 9, font, color: GRAY });
    page.drawLine({ start: { x: MARGIN, y: y - 40 }, end: { x: PAGE_W - MARGIN, y: y - 40 }, thickness: 0.5, color: CARD_BORDER });
    y -= 52;
  }

  if (total === 0) {
    page.drawText("No photos in this set yet.", { x: MARGIN, y: y - 20, size: 12, font, color: GRAY });
  }

  let pending: Prepared | null = null;
  const flushPending = () => {
    if (!pending) return;
    const cardH = CELL_IMG_H + CAP_GAP + CAP_H;
    ensure(cardH);
    drawCard(page, MARGIN, y, CELL_W, CELL_IMG_H, pending);
    y -= cardH + ROW_GAP;
    pending = null;
  };
  const placeCell = (item: Prepared) => {
    if (item.wide) {
      flushPending();
      const cardH = WIDE_IMG_H + CAP_GAP + CAP_H;
      ensure(cardH);
      drawCard(page, MARGIN, y, CONTENT_W, WIDE_IMG_H, item);
      y -= cardH + ROW_GAP;
    } else if (!pending) {
      pending = item;
    } else {
      const cardH = CELL_IMG_H + CAP_GAP + CAP_H;
      ensure(cardH);
      drawCard(page, MARGIN, y, CELL_W, CELL_IMG_H, pending);
      drawCard(page, MARGIN + CELL_W + COL_GAP, y, CELL_W, CELL_IMG_H, item);
      y -= cardH + ROW_GAP;
      pending = null;
    }
  };

  for (const section of sections) {
    if (section.items.length >= 2) {
      flushPending();
      sectionHeader(section.title, section.items.length);
      for (const item of section.items) placeCell(item);
      flushPending();
      y -= 6;
    } else {
      placeCell(section.items[0]);
    }
  }
  flushPending();

  const totalPages = pages.length;
  pages.forEach((p, i) => {
    const fy = MARGIN - 4;
    p.drawLine({ start: { x: MARGIN, y: fy + 14 }, end: { x: PAGE_W - MARGIN, y: fy + 14 }, thickness: 0.5, color: CARD_BORDER });
    p.drawText(ref, { x: MARGIN, y: fy, size: 8, font, color: GRAY });
    const mid = `Generated ${generatedOn}`;
    p.drawText(mid, { x: (PAGE_W - font.widthOfTextAtSize(mid, 8)) / 2, y: fy, size: 8, font, color: GRAY });
    const pg = `Page ${i + 1} of ${totalPages}`;
    p.drawText(pg, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(pg, 8), y: fy, size: 8, font, color: GRAY });
  });

  const bytes = await doc.save();
  return new Uint8Array(bytes);
}
