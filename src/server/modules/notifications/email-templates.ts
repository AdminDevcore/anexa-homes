// Branded, email-client-safe HTML templates (table layout + inline styles so they
// render in Gmail, Apple Mail, Outlook, etc.). Each builder returns { html, text }
// — always send both so plain-text clients still work.
//
// Theme: DARK to match the portal (near-black surfaces, warm light text, orange
// accent). The header logo is referenced as `cid:anexa-logo` — the delivery layer
// attaches public/anexa-lockup.png inline so it ALWAYS renders, even when the mail
// client blocks external images. White-label tenants with their own absolute
// `logoUrl` use that URL instead.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type EmailBrand = {
  companyName: string;
  accentColor: string; // hex
  logoUrl?: string | null; // absolute URL preferred; ignored if missing
  contact?: { phone?: string | null; email?: string | null; address?: string | null };
  appUrl?: string; // to absolutize a relative logo
};

// --- Dark palette -----------------------------------------------------------
// The CARD stays dark (the focal panel); the page FIELD behind it is a clearly
// lighter gray so the dark card lifts off it instead of merging into one block.
const C = {
  pageTop: "#2a2a30",
  pageBottom: "#1f1f24",
  card: "#17171b",
  cardBorder: "rgba(255,255,255,0.07)",
  hairline: "rgba(255,255,255,0.10)",
  heading: "#F7F3EC",
  body: "#C5BFB4",
  muted: "#8B867D",
  footerName: "#B9B3A8",
};

/** Convert a hex color to an rgba() string (for subtle orange glows/tints). */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Resolve an absolute URL for an asset path given the brand's appUrl. */
function absUrl(appUrl: string | undefined, pathOrUrl: string): string | null {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  if (!appUrl) return null;
  const base = appUrl.replace(/\/$/, "");
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** Wrap content in the branded dark shell: orange accent + logo header, footer. */
function layout(brand: EmailBrand, opts: { preheader: string; contentHtml: string }): string {
  const accent = brand.accentColor || "#F4631E";
  // Tenants with their own absolute logo use it; otherwise the inline cid image
  // (public/anexa-lockup.png — the white wordmark, perfect on dark/orange).
  const customLogo = brand.logoUrl ? absUrl(brand.appUrl, brand.logoUrl) : null;
  const logoSrc = customLogo ?? "cid:anexa-logo";
  const header = `<img src="${esc(logoSrc)}" alt="${esc(brand.companyName)}" height="30" style="height:30px;width:auto;display:block;border:0;outline:none;text-decoration:none;" />`;

  const c = brand.contact ?? {};
  const footerBits = [
    c.address ? esc(c.address) : null,
    c.phone ? esc(c.phone) : null,
    c.email ? `<a href="mailto:${esc(c.email)}" style="color:${accent};text-decoration:none;">${esc(c.email)}</a>` : null,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"></head>
<body style="margin:0;padding:0;background:${C.pageBottom};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pageBottom};background-image:linear-gradient(180deg,${C.pageTop} 0%,${C.pageBottom} 100%);padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;background:${C.card};border-radius:20px;overflow:hidden;border:1px solid ${C.cardBorder};box-shadow:0 20px 56px rgba(0,0,0,0.55);">
      <!-- orange accent strip -->
      <tr><td style="height:6px;line-height:6px;font-size:0;background:${accent};background-image:linear-gradient(90deg,#FF8A4C 0%,${accent} 55%,#C64A12 100%);">&nbsp;</td></tr>
      <!-- logo header on dark, with a faint orange glow under the strip -->
      <tr><td style="padding:32px 46px 26px;border-bottom:1px solid ${C.hairline};background-image:linear-gradient(180deg,${hexToRgba(accent, 0.14)} 0%,${hexToRgba(accent, 0)} 88%);">${header}</td></tr>
      <tr><td style="padding:42px 46px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.body};">
        ${opts.contentHtml}
      </td></tr>
      <tr><td style="padding:26px 46px 38px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <hr style="border:none;border-top:1px solid ${C.hairline};margin:0 0 16px;" />
        <p style="margin:0;font-size:12px;line-height:1.6;color:${C.muted};">
          <strong style="color:${C.footerName};">${esc(brand.companyName)}</strong>${footerBits ? `<br/>${footerBits}` : ""}
        </p>
      </td></tr>
    </table>
    <p style="margin:18px 0 0;font-family:-apple-system,sans-serif;font-size:11px;color:#5f5b53;">This message was sent by ${esc(brand.companyName)}.</p>
  </td></tr>
</table>
</body></html>`;
}

/** A pill CTA button (bulletproof for Outlook via padding on the anchor). */
function button(href: string, label: string, accent: string): string {
  // Gradient matches the accent strip; Outlook ignores the image and uses the solid bg.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="border-radius:12px;background:${accent};background-image:linear-gradient(135deg,#FF8A4C 0%,${accent} 55%,#C64A12 100%);box-shadow:0 6px 18px rgba(244,99,30,0.40);">
    <a href="${esc(href)}" style="display:inline-block;padding:15px 30px;font-family:-apple-system,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(label)} &rarr;</a>
  </td></tr></table>`;
}

/**
 * Generic branded transactional email: heading, paragraphs, optional CTA button.
 * Used for notifications, e-sign requests, paystubs, etc. so everything matches.
 */
export function brandedEmailTemplate(args: {
  brand: EmailBrand;
  subject: string;
  preheader?: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  note?: string; // small muted footer note (e.g. "This link is private to you")
}): { subject: string; html: string; text: string } {
  const { brand, subject, heading, paragraphs, cta, note } = args;
  const accent = brand.accentColor || "#F4631E";
  const paras = paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${C.body};">${esc(p)}</p>`)
    .join("");
  const ctaHtml = cta ? `<div style="margin:22px 0 6px;">${button(cta.url, cta.label, accent)}</div>` : "";
  const noteHtml = note ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${C.muted};">${esc(note)}</p>` : "";
  const linkFallback = cta
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${C.muted};">Button not working? Copy this link:<br/><a href="${esc(cta.url)}" style="color:${accent};word-break:break-all;">${esc(cta.url)}</a></p>`
    : "";

  const contentHtml = `
    <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25;font-weight:700;color:${C.heading};">${esc(heading)}</h1>
    ${paras}${ctaHtml}${linkFallback}${noteHtml}`;

  const html = layout(brand, { preheader: args.preheader ?? heading, contentHtml });
  const text =
    `${heading}\n\n${paragraphs.join("\n\n")}` +
    (cta ? `\n\n${cta.label}: ${cta.url}` : "") +
    (note ? `\n\n${note}` : "") +
    `\n\n— ${brand.companyName}`;

  return { subject, html, text };
}

/** Team-member invitation email. */
export function inviteEmailTemplate(args: {
  brand: EmailBrand;
  roleLabel: string;
  inviteLink: string;
  reminder?: boolean;
}): { subject: string; html: string; text: string } {
  const { brand, roleLabel, inviteLink, reminder } = args;
  const accent = brand.accentColor || "#F4631E";
  const subject = reminder
    ? `Reminder: set up your ${brand.companyName} account`
    : `You're invited to join ${brand.companyName}`;

  const contentHtml = `
    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:${C.heading};">
      ${reminder ? "Your invite is waiting" : `You're invited to join<br/>${esc(brand.companyName)}`}
    </h1>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.65;color:${C.body};">
      You've been added to the <strong style="color:${C.heading};">${esc(brand.companyName)}</strong> team portal as a <strong style="color:${C.heading};">${esc(roleLabel)}</strong>.
      Set your password to get started — it takes about a minute.
    </p>
    <div style="margin:22px 0 6px;">${button(inviteLink, "Set up my account", accent)}</div>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:${C.muted};">
      After you sign in, you'll complete a quick onboarding (your details for payroll &amp; tax). This link expires in <strong style="color:${C.body};">7 days</strong>.
    </p>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${C.muted};">
      Button not working? Copy and paste this link:<br/>
      <a href="${esc(inviteLink)}" style="color:${accent};word-break:break-all;">${esc(inviteLink)}</a>
    </p>`;

  const html = layout(brand, {
    preheader: `Set your password and join ${brand.companyName} as a ${roleLabel}.`,
    contentHtml,
  });

  const text =
    `You've been invited to join ${brand.companyName} on the team portal as a ${roleLabel}.\n\n` +
    `Set your password and get started:\n${inviteLink}\n\n` +
    `After signing in you'll complete a quick onboarding (payroll/tax details). This link expires in 7 days.\n\n— ${brand.companyName}`;

  return { subject, html, text };
}
