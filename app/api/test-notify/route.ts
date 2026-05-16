import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { sendTestEmail } from "@/lib/notify";

export async function POST(request: Request) {
  const authenticated = await getSessionFromRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await sendTestEmail();
  return NextResponse.json({ ok: true });
}
