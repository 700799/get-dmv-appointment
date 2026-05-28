import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  getConfig,
  setConfig,
  validateConfig,
  personalInfoFromEnv,
} from "@/lib/config";

export async function GET(request: Request) {
  if (!(await getSessionFromRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getConfig();
  // Never leak stored personal info to the client; report only whether it's set.
  const { personal, ...rest } = config;
  return NextResponse.json({
    ...rest,
    personalConfigured: personal !== null,
    personalSource: personal !== null ? "config" : personalInfoFromEnv() ? "env" : "none",
  });
}

export async function PUT(request: Request) {
  if (!(await getSessionFromRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let validated;
  try {
    validated = validateConfig(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid config" },
      { status: 400 }
    );
  }

  // If the client didn't submit new personal info, preserve what's stored.
  if (validated.personal === null) {
    const existing = await getConfig();
    validated.personal = existing.personal;
  }

  await setConfig(validated);
  return NextResponse.json({ ok: true, updatedAt: validated.updatedAt });
}
