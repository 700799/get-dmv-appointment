import { NextResponse } from "next/server";
import { checkAllOffices } from "@/lib/dmv";
import {
  sendAppointmentAlert,
  sendCaptchaAlert,
  sendBlockageAlert,
} from "@/lib/notify";
import {
  setStatus,
  getStatus,
  getLastNotified,
  setLastNotified,
  getLastReach,
  setLastReach,
  wasBlockAlertSent,
  setBlockAlertSent,
  wasCaptchaAlertSent,
  setCaptchaAlertSent,
  pushRunLog,
} from "@/lib/kv";
import { getConfig, isWithinSchedule, resolvePersonalInfo } from "@/lib/config";
import { getSessionFromRequest } from "@/lib/auth";

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
  // A logged-in user OR the cron secret may trigger a manual check.
  const authed =
    (await getSessionFromRequest(request)) || isCronAuthorized(request);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCheck(request);
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCheck(request);
}

async function runCheck(request: Request) {
  const startedAt = Date.now();
  const now = new Date().toISOString();
  const force = new URL(request.url).searchParams.get("force") === "1";

  const config = await getConfig();

  // ── Schedule gating ──────────────────────────────────────────────────────
  // A forced (manual) check bypasses the window; cron-triggered checks respect it.
  if (!force) {
    const window = isWithinSchedule(config.schedule);
    if (!window.ok) {
      await recordRun({
        at: now,
        scanned: false,
        skippedReason: window.reason,
        available: false,
        slotsFound: 0,
        errors: [],
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ ok: true, scanned: false, reason: window.reason });
    }

    // Min-interval gate: avoid double-scanning if the cron fires faster than configured.
    const prev = await getStatus().catch(() => null);
    if (prev?.lastChecked) {
      const minsSince = (Date.now() - Date.parse(prev.lastChecked)) / 60000;
      if (minsSince < config.schedule.minIntervalMinutes) {
        return NextResponse.json({
          ok: true,
          scanned: false,
          reason: `last scan ${Math.round(minsSince)}m ago (min ${config.schedule.minIntervalMinutes}m)`,
        });
      }
    }
  }

  // ── Resolve inputs ─────────────────────────────────────────────────────────
  const offices = config.offices.filter((o) => o.enabled);
  if (offices.length === 0) {
    return NextResponse.json({ ok: true, scanned: false, reason: "no offices enabled" });
  }

  const personal = resolvePersonalInfo(config);
  if (!personal) {
    const reason =
      "missing_info: set personal info in the admin page or DMV_* env vars";
    await setStatus({
      lastChecked: now,
      available: false,
      slots: [],
      errors: [reason],
    }).catch(() => {});
    return NextResponse.json({ ok: false, scanned: false, reason });
  }

  // ── Scan ─────────────────────────────────────────────────────────────────
  const results = await checkAllOffices(offices, personal, config.scan);

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

  const allErrors = [
    ...otherErrors,
    ...captchaResults.map((r) => `${r.officeName}: CAPTCHA`),
    ...blockedResults.map((r) => `${r.officeName}: ${r.error}`),
  ];

  await setStatus({
    lastChecked: now,
    available,
    slots: allSlots,
    ...(allErrors.length ? { errors: allErrors } : {}),
  }).catch(() => {});

  // ── Appointment alert ──────────────────────────────────────────────────────
  if (available) {
    const lastNotified = await getLastNotified().catch(() => null);
    if (!lastNotified) {
      await sendAppointmentAlert(allSlots).catch(console.error);
      await setLastNotified(now, config.scan.notifyCooldownMinutes * 60).catch(
        () => {}
      );
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

  await recordRun({
    at: now,
    scanned: true,
    available,
    slotsFound: allSlots.length,
    errors: allErrors,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    ok: true,
    scanned: true,
    available,
    slotsFound: allSlots.length,
    captchaBlocked: captchaResults.length > 0,
    blocked: blockedResults.length > 0,
    errors: allErrors,
    hoursSinceLastRealReach: Math.round(hoursSinceReach * 10) / 10,
    checkedAt: now,
  });
}

async function recordRun(entry: Parameters<typeof pushRunLog>[0]) {
  await pushRunLog(entry).catch(() => {});
}
