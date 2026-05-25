import { NextResponse } from "next/server";
import { checkAllOffices } from "@/lib/dmv";
import {
  sendAppointmentAlert,
  sendCaptchaAlert,
  sendBlockageAlert,
} from "@/lib/notify";
import {
  setStatus,
  getLastNotified,
  setLastNotified,
  getLastReach,
  setLastReach,
  wasBlockAlertSent,
  setBlockAlertSent,
  wasCaptchaAlertSent,
  setCaptchaAlertSent,
} from "@/lib/kv";

// Allow up to 5 minutes — ScraperAPI + sequential offices + retries can be slow
export const maxDuration = 300;

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
  return runCheck(request);
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCheck(request);
}

async function runCheck(_request: Request) {
  const now = new Date().toISOString();
  const results = await checkAllOffices();

  const allSlots = results.flatMap((r) => r.slots);
  const available = allSlots.length > 0;

  const captchaResults = results.filter((r) => r.error === "CAPTCHA_REQUIRED");
  const blockedResults = results.filter(
    (r) => r.error === "BLOCKED" || r.error === "RATE_LIMITED"
  );
  const otherErrors = results
    .filter(
      (r) =>
        r.error &&
        r.error !== "CAPTCHA_REQUIRED" &&
        r.error !== "BLOCKED" &&
        r.error !== "RATE_LIMITED"
    )
    .map((r) => `${r.officeName}: ${r.error}`);

  // A "real reach" means we got a genuine response — not a block or CAPTCHA
  const gotRealResponse = results.some(
    (r) => !r.error || r.error === "CAPTCHA_REQUIRED"
  );
  if (gotRealResponse) {
    await setLastReach(now).catch(() => {});
  }

  await setStatus({
    lastChecked: now,
    available,
    slots: allSlots,
    ...(otherErrors.length ? { errors: otherErrors } : {}),
  }).catch(() => {});

  // ── Appointment alert ──────────────────────────────────────────────────────
  if (available) {
    const lastNotified = await getLastNotified().catch(() => null);
    if (!lastNotified) {
      await sendAppointmentAlert(allSlots).catch(console.error);
      await setLastNotified(now).catch(() => {});
    }
  }

  // ── CAPTCHA alert (once per 12h) ───────────────────────────────────────────
  if (captchaResults.length > 0) {
    const alreadySent = await wasCaptchaAlertSent().catch(() => false);
    if (!alreadySent) {
      await sendCaptchaAlert().catch(console.error);
      await setCaptchaAlertSent().catch(() => {});
    }
  }

  // ── Blocked/offline alert (once per 20h) ──────────────────────────────────
  const lastReach = await getLastReach().catch(() => null);
  const hoursSinceReach = lastReach
    ? (Date.now() - new Date(lastReach).getTime()) / 3_600_000
    : Infinity;

  if (hoursSinceReach > 4) {
    const alreadySent = await wasBlockAlertSent().catch(() => false);
    if (!alreadySent) {
      await sendBlockageAlert(lastReach).catch(console.error);
      await setBlockAlertSent().catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    available,
    slotsFound: allSlots.length,
    captchaBlocked: captchaResults.length > 0,
    blocked: blockedResults.length > 0,
    errors: otherErrors,
    hoursSinceLastRealReach: Math.round(hoursSinceReach * 10) / 10,
    checkedAt: now,
  });
}
