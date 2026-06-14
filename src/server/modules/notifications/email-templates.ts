// Branded, email-client-safe HTML templates (table layout + inline styles so they
// render in Gmail, Apple Mail, Outlook, etc.). Each builder returns { html, text }
// — always send both so plain-text clients still work.

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

/** Resolve an absolute URL for an asset path given the brand's appUrl. */
function absUrl(appUrl: string | undefined, pathOrUrl: string): string | null {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  if (!appUrl) return null;
  const base = appUrl.replace(/\/$/, "");
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** Wrap content in the branded shell: gradient header w/ logo, white card, footer. */
function layout(brand: EmailBrand, opts: { preheader: string; contentHtml: string }): string {
  const accent = brand.accentColor || "#F4631E";
  // Header gradient mirrors the website's brand orange (light → brand → deep).
  const headerBg = `background:${accent};background-image:linear-gradient(135deg,#FF8A4C 0%,${accent} 52%,#C64A12 100%);`;

  // The email header sits on a colored bar, so it needs a LIGHT (white) logo —
  // distinct from branding.logoUrl, which is the dark logo used on light surfaces.
  // Use a tenant-provided logo if present, else fall back to the white wordmark.
  const customLogo = brand.logoUrl ? absUrl(brand.appUrl, brand.logoUrl) : null;
  const headerLogo = customLogo ?? absUrl(brand.appUrl, "/anexa-lockup.png");
  const usingDefaultBrand = !customLogo;
  const markUrl = usingDefaultBrand ? absUrl(brand.appUrl, "/anexa-mark.png") : null;

  const header = headerLogo
    ? `<img src="${esc(headerLogo)}" alt="${esc(brand.companyName)}" height="30" style="height:30px;width:auto;display:block;border:0;" />`
    : `<span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${esc(brand.companyName)}</span>`;

  // Small "letterhead" mark above the card fills the otherwise-blank top margin.
  const letterhead = markUrl
    ? `<tr><td align="center" style="padding:0 0 20px;"><img src="${esc(markUrl)}" alt="" width="42" height="45" style="width:42px;height:auto;display:block;border:0;" /></td></tr>`
    : "";

  const c = brand.contact ?? {};
  const footerBits = [
    c.address ? esc(c.address) : null,
    c.phone ? esc(c.phone) : null,
    c.email ? `<a href="mailto:${esc(c.email)}" style="color:#9ca3af;text-decoration:underline;">${esc(c.email)}</a>` : null,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#ece6db;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ece6db;background-image:linear-gradient(180deg,#f4efe6 0%,#e7e0d3 100%);padding:36px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      ${letterhead}
      <tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(40,30,15,0.10);border:1px solid rgba(0,0,0,0.04);">
          <tr><td style="${headerBg}padding:24px 34px;">${header}</td></tr>
          <tr><td style="padding:36px 34px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
            ${opts.contentHtml}
          </td></tr>
          <tr><td style="padding:22px 34px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <hr style="border:none;border-top:1px solid #efece6;margin:0 0 16px;" />
            <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
              <strong style="color:#6b7280;">${esc(brand.companyName)}</strong>${footerBits ? `<br/>${footerBits}` : ""}
            </p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:18px 0 0;">
        <p style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#b0a999;">This message was sent by ${esc(brand.companyName)}.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** A pill CTA button (bulletproof for Outlook via padding on the anchor). */
function button(href: string, label: string, accent: string): string {
  // Gradient matches the header; Outlook ignores the image and uses the solid bg.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="border-radius:12px;background:${accent};background-image:linear-gradient(135deg,#FF8A4C 0%,${accent} 55%,#C64A12 100%);box-shadow:0 4px 12px rgba(244,99,30,0.30);">
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
  note?: string; // small gray footer note (e.g. "This link is private to you")
}): { subject: string; html: string; text: string } {
  const { brand, subject, heading, paragraphs, cta, note } = args;
  const accent = brand.accentColor || "#F4631E";
  const paras = paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;">${esc(p)}</p>`)
    .join("");
  const ctaHtml = cta ? `<div style="margin:20px 0;">${button(cta.url, cta.label, accent)}</div>` : "";
  const noteHtml = note ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">${esc(note)}</p>` : "";
  const linkFallback = cta
    ? `<p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">Button not working? Copy this link:<br/><a href="${esc(cta.url)}" style="color:#6b7280;word-break:break-all;">${esc(cta.url)}</a></p>`
    : "";

  const contentHtml = `
    <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25;font-weight:700;color:#111827;">${esc(heading)}</h1>
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
    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:#111827;">
      ${reminder ? "Your invite is waiting" : `You're invited to join<br/>${esc(brand.companyName)}`}
    </h1>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#374151;">
      You've been added to the <strong>${esc(brand.companyName)}</strong> team portal as a <strong>${esc(roleLabel)}</strong>.
      Set your password to get started — it takes about a minute.
    </p>
    <div style="margin:20px 0;">${button(inviteLink, "Set up my account", accent)}</div>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
      After you sign in, you'll complete a quick onboarding (your details for payroll &amp; tax). This link expires in <strong>7 days</strong>.
    </p>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">
      Button not working? Copy and paste this link:<br/>
      <a href="${esc(inviteLink)}" style="color:#6b7280;word-break:break-all;">${esc(inviteLink)}</a>
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
