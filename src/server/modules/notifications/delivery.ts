// Channel delivery adapters. In-app is handled by the engine (DB rows).
// Email/SMS send through providers when configured, else log in dev so flows
// remain testable without external accounts.
//
// Email provider precedence:
//   1. SMTP   — set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (any mailbox: Gmail
//      app password, Google Workspace, Office365, your domain host). No domain
//      verification needed — works to any recipient immediately.
//   2. Resend — set RESEND_API_KEY (needs a verified sending domain).
//   3. Neither — logged to the server console (dev), not delivered.
import nodemailer from "nodemailer";

function buildFrom(fromName?: string): string {
  if (fromName?.trim()) {
    const addr = process.env.NOTIFY_EMAIL_FROM_ADDRESS ?? process.env.SMTP_FROM_ADDRESS ?? "notifications@anexahomes.com";
    return `${fromName.trim()} <${addr}>`;
  }
  return process.env.NOTIFY_EMAIL_FROM
    ?? `${process.env.NOTIFY_EMAIL_FROM_NAME ?? "Anexa Homes"} <${process.env.NOTIFY_EMAIL_FROM_ADDRESS ?? process.env.SMTP_FROM_ADDRESS ?? "notifications@anexahomes.com"}>`;
}

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let _transport: nodemailer.Transporter | null = null;
function smtpTransport(): nodemailer.Transporter {
  if (_transport) return _transport;
  const port = Number(process.env.SMTP_PORT ?? 587);
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465, // 465 = implicit TLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transport;
}

type Attachment = { filename: string; content: Buffer };

/** Core sender: SMTP → Resend → dev-log. Returns true only if actually handed to a provider. */
async function deliver(to: string, subject: string, body: string, fromName?: string, attachments?: Attachment[], html?: string): Promise<boolean> {
  const from = buildFrom(fromName);

  // 1) SMTP (any mailbox; no domain verification).
  if (smtpConfigured()) {
    try {
      await smtpTransport().sendMail({ from, to, subject, text: body, ...(html ? { html } : {}), attachments });
      return true;
    } catch (err) {
      console.error("[email:smtp] send failed", err);
      return false;
    }
  }

  // 2) Resend (needs a verified domain).
  const key = process.env.RESEND_API_KEY;
  if (key) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from, to, subject, text: body,
          ...(html ? { html } : {}),
          ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) } : {}),
        }),
      });
      if (!res.ok) {
        console.error("[email:resend] provider rejected", res.status, await res.text().catch(() => ""));
        return false;
      }
      return true;
    } catch (err) {
      console.error("[email:resend] send failed", err);
      return false;
    }
  }

  // 3) Nothing configured — log, don't send.
  console.log(`[email:dev — NOT SENT, no SMTP_* or RESEND_API_KEY] to=${to} subject="${subject}"${attachments?.length ? ` attachments=[${attachments.map((a) => a.filename).join(", ")}]` : ""}\n${body}`);
  return false;
}

/** Returns true only if the email was actually handed to a provider (not dev-logged). */
export async function sendEmail(to: string, subject: string, body: string, opts?: { fromName?: string; html?: string }): Promise<boolean> {
  return deliver(to, subject, body, opts?.fromName, undefined, opts?.html);
}

/** Send an email with file attachments (e.g. a pay stub PDF). */
export async function sendEmailWithAttachments(
  to: string,
  subject: string,
  body: string,
  attachments: { filename: string; content: Buffer }[],
  opts?: { fromName?: string; html?: string }
): Promise<void> {
  await deliver(to, subject, body, opts?.fromName, attachments, opts?.html);
}

export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    console.log(`[sms:dev] to=${to}\n${body}`);
    return;
  }
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
  } catch (err) {
    console.error("[sms] send failed", err);
  }
}
