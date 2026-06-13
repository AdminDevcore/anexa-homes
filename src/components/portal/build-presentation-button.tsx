import Link from "next/link";
import { Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Header CTA on the deal page — opens the customer-facing presentation builder. */
export function BuildPresentationButton({ leadId }: { leadId: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={`/portal/leads/${leadId}/presentation`}>
        <Presentation className="size-4" /> Build Presentation
      </Link>
    </Button>
  );
}
