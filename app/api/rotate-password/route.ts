import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { setPasswordHash } from "@/lib/kv";
import { sendWeeklyPassword } from "@/lib/notify";

function generatePassword(length = 14): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

function isCronAuthorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return (
    authHeader === `Bearer ${cronSecret}` ||
    request.headers.get("x-cron-secret") === cronSecret
  );
}

export async function GET(request: Request) {
  return runRotation(request);
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runRotation(request);
}

async function runRotation(_request: Request) {
  const password = generatePassword();
  const hash = await hashPassword(password);

  await setPasswordHash(hash);
  await sendWeeklyPassword(password);

  return NextResponse.json({ ok: true, rotatedAt: new Date().toISOString() });
}
