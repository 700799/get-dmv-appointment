import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { discoverOfficeIds } from "@/lib/dmv";

export async function GET(request: Request) {
  const authenticated = await getSessionFromRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const offices = await discoverOfficeIds();
  return NextResponse.json({ offices });
}
