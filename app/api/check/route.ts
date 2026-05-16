import { NextResponse } from "next/server";
import { checkAllOffices } from "@/lib/dmv";
import { sendAppointmentAlert } from "@/lib/notify";
import { setStatus, getLastNotified, setLastNotified } from "@/lib/kv";

function isCronAuthorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  // Vercel sends the secret as a Bearer token for cron jobs
  return (
    authHeader === `Bearer ${cronSecret}` ||
    request.headers.get("x-cron-secret") === cronSecret
  );
}

export async function GET(request: Request) {
  // Vercel cron jobs use GET
  return runCheck(request);
}

export async function POST(request: Request) {
  // Allow manual trigger via POST with cron secret
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCheck(request);
}

async function runCheck(_request: Request) {
  const now = new Date().toISOString();
  const results = await checkAllOffices();

  const allSlots = results.flatMap((r) => r.slots);
  const errors = results
    .filter((r) => r.error && r.error !== "CAPTCHA_REQUIRED")
    .map((r) => `${r.officeName}: ${r.error}`);

  const captchaBlocked = results.some((r) => r.error === "CAPTCHA_REQUIRED");
  const available = allSlots.length > 0;

  await setStatus({
    lastChecked: now,
    available,
    slots: allSlots,
    ...(errors.length ? { errors } : {}),
  });

  if (available) {
    const lastNotified = await getLastNotified();
    if (!lastNotified) {
      // No recent notification — send alert
      try {
        await sendAppointmentAlert(allSlots);
        await setLastNotified(now);
      } catch (err) {
        console.error("Failed to send notification:", err);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    available,
    slotsFound: allSlots.length,
    captchaBlocked,
    errors,
    checkedAt: now,
  });
}
