import { Redis } from "@upstash/redis";

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

export async function setLastNotified(timestamp: string): Promise<void> {
  // Expire after 2 hours so we re-notify if slots vanish and reappear
  await redis().set(KEYS.LAST_NOTIFIED, timestamp, { ex: 7200 });
}
