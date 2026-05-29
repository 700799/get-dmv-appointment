import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { getPasswordHash, setPasswordHash } from "@/lib/kv";
import { sendWeeklyPassword } from "@/lib/notify";

/**
 * POST /api/setup
 * First-run helper: generates and emails the first login password if no
 * password has been set yet. Protected by CRON_SECRET so it can't be called
 * by random visitors. After the first password exists, this becomes a no-op
 * (use /api/rotate-password to force a rotation).
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await getPasswordHash().catch(() => null);
  if (existing) {
    return NextResponse.json({ ok: true, message: "Password already configured — use /api/rotate-password to rotate." });
  }

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  const password = Array.from(bytes).map((b) => chars[b % chars.length]).join("");
  const hash = await hashPassword(password);

  await setPasswordHash(hash);
  await sendWeeklyPassword(password);

  return NextResponse.json({ ok: true, message: "Password created and emailed." });
}
