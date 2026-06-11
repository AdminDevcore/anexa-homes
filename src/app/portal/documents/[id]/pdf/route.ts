import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { generatePackagePdf } from "@/server/modules/esign/service";

// Generate a document package's PDF on demand — auto-filled from the CRM plus any
// signatures captured so far — so staff can view/download it, not only send it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "read", "Document")) return new NextResponse("Forbidden", { status: 403 });

  const result = await generatePackagePdf(user, id);
  if (!result) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${result.filename}"`,
    },
  });
}
