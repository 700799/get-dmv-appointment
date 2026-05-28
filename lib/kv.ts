import { Redis } from "@upstash/redis";

export interface AppStatus {
  lastChecked: string;
  available: boolean;
  slots: Array<{ date: string; time: string; officeName: string }>;
  lastNotified?: string;
  errors?: string[];
}

export interface RunLogEntry {
  at: string;
  scanned: boolean;
  skippedReason?: string;
  available: boolean;
  slotsFound: number;
  errors: string[];
  durationMs: number;
}

const KEYS = {
  STATUS: "dmv:status",
  PASSWORD_HASH: "dmv:password_hash",
  LAST_NOTIFIED: "dmv:last_notified",
  LAST_REACH: "dmv:last_reach",         // last time DMV returned a real page
  BLOCK_ALERT_SENT: "dmv:block_alert",  // dedup key for "been blocked" alert (TTL 20h)
  CAPTCHA_ALERT_SENT: "dmv:captcha_alert", // dedup key for CAPTCHA alert (TTL 12h)
  RUN_LOG: "dmv:runlog",                // recent run history (capped list)
} as const;

const RUN_LOG_MAX = 30;

function redis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

export async function getStatus(): Promise<AppStatus | null> {
  return redis().get<AppStatus>(KEYS.STATUS);
}

export async function setStatus(status: AppStatus): Promise<void> {
  await redis().set(KEYS.STATUS, status);
}

export async function getPasswordHash(): Promise<string | null> {
  return redis().get<string>(KEYS.PASSWORD_HASH);
}

export async function setPasswordHash(hash: string): Promise<void> {
  await redis().set(KEYS.PASSWORD_HASH, hash);
}

export async function getLastNotified(): Promise<string | null> {
  return redis().get<string>(KEYS.LAST_NOTIFIED);
}

export async function setLastNotified(
  timestamp: string,
  cooldownSeconds = 7200
): Promise<void> {
  // Re-notify only after the cooldown window elapses.
  await redis().set(KEYS.LAST_NOTIFIED, timestamp, { ex: cooldownSeconds });
}

// ─── Run history ──────────────────────────────────────────────────────────────

export async function pushRunLog(entry: RunLogEntry): Promise<void> {
  const r = redis();
  await r.lpush(KEYS.RUN_LOG, entry);
  await r.ltrim(KEYS.RUN_LOG, 0, RUN_LOG_MAX - 1);
}

export async function getRunLog(): Promise<RunLogEntry[]> {
  const items = await redis().lrange<RunLogEntry>(KEYS.RUN_LOG, 0, RUN_LOG_MAX - 1);
  return items ?? [];
}

// ─── Heartbeat / blocked-alert helpers ───────────────────────────────────────

/** ISO timestamp of the last run that got a real response from the DMV. */
export async function getLastReach(): Promise<string | null> {
  return redis().get<string>(KEYS.LAST_REACH);
}

export async function setLastReach(timestamp: string): Promise<void> {
  await redis().set(KEYS.LAST_REACH, timestamp);
}

/** Returns true if a "been blocked for hours" alert was already sent recently. */
export async function wasBlockAlertSent(): Promise<boolean> {
  return (await redis().get<string>(KEYS.BLOCK_ALERT_SENT)) !== null;
}

export async function setBlockAlertSent(): Promise<void> {
  await redis().set(KEYS.BLOCK_ALERT_SENT, "1", { ex: 72_000 }); // 20 hours
}

/** Returns true if a CAPTCHA alert was already sent recently. */
export async function wasCaptchaAlertSent(): Promise<boolean> {
  return (await redis().get<string>(KEYS.CAPTCHA_ALERT_SENT)) !== null;
}

export async function setCaptchaAlertSent(): Promise<void> {
  await redis().set(KEYS.CAPTCHA_ALERT_SENT, "1", { ex: 43_200 }); // 12 hours
}
