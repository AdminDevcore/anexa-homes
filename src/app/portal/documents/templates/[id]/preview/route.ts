import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { generateTemplatePreviewPdf } from "@/server/modules/esign/service";

// Filled-PDF preview of a template, using sample CRM data — so staff can see how
// the finished, auto-filled contract will look before sending it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "read", "Document")) return new NextResponse("Forbidden", { status: 403 });

  const result = await generateTemplatePreviewPdf(user, id);
  if (!result) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      // inline → opens in a new tab to view
      "Content-Disposition": `inline; filename="${result.filename}"`,
    },
  });
}
