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

/** Wrap content in the branded shell: accent header, white card, footer. */
function layout(brand: EmailBrand, opts: { preheader: string; contentHtml: string }): string {
  const accent = brand.accentColor || "#F4631E";
  const logo =
    brand.logoUrl && brand.logoUrl.startsWith("http")
      ? brand.logoUrl
      : brand.logoUrl && brand.appUrl
        ? `${brand.appUrl.replace(/\/$/, "")}${brand.logoUrl.startsWith("/") ? "" : "/"}${brand.logoUrl}`
        : null;
  const header = logo
    ? `<img src="${esc(logo)}" alt="${esc(brand.companyName)}" height="34" style="height:34px;display:block;border:0;" />`
    : `<span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${esc(brand.companyName)}</span>`;

  const c = brand.contact ?? {};
  const footerBits = [
    c.address ? esc(c.address) : null,
    c.phone ? esc(c.phone) : null,
    c.email ? `<a href="mailto:${esc(c.email)}" style="color:#9ca3af;text-decoration:underline;">${esc(c.email)}</a>` : null,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f3f0ea;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0ea;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <tr><td style="background:${accent};padding:22px 32px;">${header}</td></tr>
      <tr><td style="padding:36px 32px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
        ${opts.contentHtml}
      </td></tr>
      <tr><td style="padding:24px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <hr style="border:none;border-top:1px solid #ececec;margin:0 0 16px;" />
        <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
          <strong style="color:#6b7280;">${esc(brand.companyName)}</strong>${footerBits ? `<br/>${footerBits}` : ""}
        </p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-family:-apple-system,sans-serif;font-size:11px;color:#b0aaa0;">This message was sent by ${esc(brand.companyName)}.</p>
  </td></tr>
</table>
</body></html>`;
}

/** A pill CTA button (bulletproof for Outlook via padding on the anchor). */
function button(href: string, label: string, accent: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="border-radius:10px;background:${accent};">
    <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-family:-apple-system,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(label)} &rarr;</a>
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
