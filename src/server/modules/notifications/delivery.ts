// Channel delivery adapters. In-app is handled by the engine (DB rows).
// Email/SMS send through providers when configured, else log in dev so flows
// remain testable without external accounts.

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM ?? "Anexa Homes <notifications@anexahomes.com>";
  if (!key) {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${body}`);
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text: body }),
    });
  } catch (err) {
    console.error("[email] send failed", err);
  }
}

/** Send an email with file attachments (e.g. a pay stub PDF). Logs in dev when no key. */
export async function sendEmailWithAttachments(
  to: string,
  subject: string,
  body: string,
  attachments: { filename: string; content: Buffer }[]
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM ?? "Anexa Homes <notifications@anexahomes.com>";
  if (!key) {
    console.log(`[email:dev] to=${to} subject="${subject}" attachments=[${attachments.map((a) => `${a.filename} (${a.content.length}b)`).join(", ")}]\n${body}`);
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject,
        text: body,
        attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
      }),
    });
  } catch (err) {
    console.error("[email] send with attachment failed", err);
  }
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
