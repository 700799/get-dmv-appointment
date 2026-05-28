import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { discoverOffices } from "@/lib/dmv";

// Discovery hits the live DMV page through ScraperAPI — give it room.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!(await getSessionFromRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filter = new URL(request.url).searchParams.get("q") ?? undefined;
  try {
    const offices = await discoverOffices(filter);
    return NextResponse.json({ offices });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Discovery failed", offices: [] },
      { status: 502 }
    );
  }
}
