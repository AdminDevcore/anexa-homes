import { CheckCircle2, XCircle, Clock, FileSignature } from "lucide-react";
import { getViewByToken } from "@/server/modules/esign/service";
import { SigningExperience } from "@/components/esign/signing-experience";
import { Logo } from "@/components/marketing/logo";

export const metadata = { title: "Sign Document" };

export default async function SignPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ inperson?: string }>;
}) {
  const { token } = await params;
  const { inperson } = await searchParams;
  const inPerson = inperson === "1";
  const view = await getViewByToken(token);

  if (!view) return <Status icon={XCircle} title="Invalid signing link" body="This link is not valid. Please request a new one from Anexa Homes." />;
  if (view.state === "voided") return <Status icon={XCircle} title="Document voided" body="This document is no longer available for signature." />;
  if (view.state === "expired") return <Status icon={Clock} title="Link expired" body="This signing link has expired. Please contact Anexa Homes for a new one." />;
  if (view.state === "completed" || view.state === "already_signed")
    return <Status icon={CheckCircle2} title="Already signed" body="This document has already been signed. Thank you!" />;
  if (view.state === "waiting")
    return <Status icon={Clock} title="Waiting on another signer" body="Another party needs to sign before you. We'll notify you when it's your turn." />;
  if (!view.ctx)
    return <Status icon={XCircle} title="Unavailable" body="This document is missing required information." />;

  return (
    <SigningExperience
      token={token}
      title={view.title}
      signerName={view.signerName}
      snapshot={view.snapshot}
      ctx={view.ctx}
      signerFields={view.signerFields}
      inPerson={inPerson}
    />
  );
}

function Status({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border px-6 py-4">
        <Logo />
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <Icon className="size-14 text-gold" />
          <h1 className="font-display text-2xl font-semibold">{title}</h1>
          <p className="text-muted-foreground">{body}</p>
        </div>
      </div>
    </div>
  );
}
