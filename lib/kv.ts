import { kv } from "@vercel/kv";

export interface AppStatus {
  lastChecked: string;
  available: boolean;
  slots: Array<{ date: string; time: string; officeName: string }>;
  lastNotified?: string;
  errors?: string[];
}

const KEYS = {
  STATUS: "dmv:status",
  PASSWORD_HASH: "dmv:password_hash",
  LAST_NOTIFIED: "dmv:last_notified",
} as const;

export async function getStatus(): Promise<AppStatus | null> {
  return kv.get<AppStatus>(KEYS.STATUS);
}

export async function setStatus(status: AppStatus): Promise<void> {
  await kv.set(KEYS.STATUS, status);
}

export async function getPasswordHash(): Promise<string | null> {
  return kv.get<string>(KEYS.PASSWORD_HASH);
}

export async function setPasswordHash(hash: string): Promise<void> {
  await kv.set(KEYS.PASSWORD_HASH, hash);
}

export async function getLastNotified(): Promise<string | null> {
  return kv.get<string>(KEYS.LAST_NOTIFIED);
}

export async function setLastNotified(timestamp: string): Promise<void> {
  // Auto-expire after 2 hours so we re-notify if slot disappears and reappears
  await kv.set(KEYS.LAST_NOTIFIED, timestamp, { ex: 7200 });
}
