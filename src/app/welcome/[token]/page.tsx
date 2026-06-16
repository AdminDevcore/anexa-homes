import { CheckCircle2, XCircle } from "lucide-react";
import { getWelcomeCallByToken } from "@/server/modules/welcome-call/service";
import { WelcomeCallExperience } from "@/components/welcome-call/welcome-call-experience";
import { Logo } from "@/components/marketing/logo";

export const metadata = { title: "Welcome — confirm your details" };
export const dynamic = "force-dynamic";

export default async function WelcomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getWelcomeCallByToken(token);

  if (view.state === "invalid")
    return <Status icon={XCircle} title="Link not found" body="This welcome-call link isn't valid. Please request a new one." />;
  if (view.state === "voided")
    return <Status icon={XCircle} title="Link no longer active" body="This welcome-call link has been turned off. Please contact us for a new one." />;
  if (view.state === "completed")
    return (
      <Status
        icon={CheckCircle2}
        title="All set — thank you!"
        body={view.snapshot.closing || "You've confirmed your project details. We'll be in touch shortly."}
      />
    );

  return (
    <WelcomeCallExperience
      token={token}
      customerName={view.customerName}
      snapshot={view.snapshot}
      initialAcked={view.acknowledged}
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
