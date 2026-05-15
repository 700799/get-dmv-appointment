import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getStatus } from "@/lib/kv";

export async function GET(request: Request) {
  const authenticated = await getSessionFromRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getStatus();
  if (!status) {
    return NextResponse.json({
      lastChecked: null,
      available: false,
      slots: [],
      message: "No checks have run yet. The first check will run within 10 minutes.",
    });
  }

  return NextResponse.json(status);
}
