import { Redis } from "@upstash/redis";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Office {
  /** CA DMV FOA office id (numeric, as used by driveTest.do) */
  id: number;
  name: string;
  address?: string;
  enabled: boolean;
}

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  dlNumber: string;
  birthMonth: string;
  birthDay: string;
  birthYear: string;
}

export interface ScheduleConfig {
  /** Master on/off switch for all monitoring. */
  enabled: boolean;
  /** IANA timezone the active window is evaluated in. */
  timezone: string;
  /** Days of week the monitor runs. 0 = Sunday … 6 = Saturday. */
  activeDays: number[];
  /** Local hour (0–23) the active window opens (inclusive). */
  startHour: number;
  /** Local hour (0–23) the active window closes (exclusive). */
  endHour: number;
  /** Don't scan again until this many minutes have passed since the last scan. */
  minIntervalMinutes: number;
}

export interface ScanConfig {
  /** Max retry attempts per office before giving up. */
  maxAttempts: number;
  /** Don't re-send an "available" email until this many minutes pass. */
  notifyCooldownMinutes: number;
  /** Random delay between offices (lower bound, ms). */
  perOfficeDelayMinMs: number;
  /** Random delay between offices (upper bound, ms). */
  perOfficeDelayMaxMs: number;
}

export interface AppConfig {
  offices: Office[];
  /** When null, personal info falls back to DMV_* env vars. */
  personal: PersonalInfo | null;
  schedule: ScheduleConfig;
  scan: ScanConfig;
  updatedAt: string;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: AppConfig = {
  offices: [
    {
      id: 631,
      name: "Pleasanton — Las Positas",
      address: "6300 W Las Positas Blvd, Pleasanton",
      enabled: true,
    },
    {
      id: 640,
      name: "Pleasanton — Stoneridge",
      address: "2621 Stoneridge Mall Rd, Pleasanton",
      enabled: true,
    },
  ],
  personal: null,
  schedule: {
    enabled: true,
    timezone: "America/Los_Angeles",
    // CA DMV is closed Sundays; default to Mon–Sat.
    activeDays: [1, 2, 3, 4, 5, 6],
    startHour: 7,
    endHour: 18,
    minIntervalMinutes: 25,
  },
  scan: {
    maxAttempts: 3,
    notifyCooldownMinutes: 120,
    perOfficeDelayMinMs: 2500,
    perOfficeDelayMaxMs: 6000,
  },
  updatedAt: new Date(0).toISOString(),
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const CONFIG_KEY = "dmv:config";

function redis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

/** Deep-merge a stored (possibly partial / older-schema) config onto defaults. */
function mergeConfig(stored: Partial<AppConfig> | null): AppConfig {
  if (!stored) return { ...DEFAULT_CONFIG };
  return {
    offices:
      Array.isArray(stored.offices) && stored.offices.length > 0
        ? stored.offices.map((o) => ({
            id: Number(o.id),
            name: String(o.name ?? ""),
            address: o.address ? String(o.address) : undefined,
            enabled: o.enabled !== false,
          }))
        : DEFAULT_CONFIG.offices,
    personal: stored.personal ?? null,
    schedule: { ...DEFAULT_CONFIG.schedule, ...(stored.schedule ?? {}) },
    scan: { ...DEFAULT_CONFIG.scan, ...(stored.scan ?? {}) },
    updatedAt: stored.updatedAt ?? DEFAULT_CONFIG.updatedAt,
  };
}

export async function getConfig(): Promise<AppConfig> {
  try {
    const stored = await redis().get<Partial<AppConfig>>(CONFIG_KEY);
    return mergeConfig(stored);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function setConfig(config: AppConfig): Promise<void> {
  await redis().set(CONFIG_KEY, config);
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate and normalize an incoming (untrusted) config payload from the admin
 * page. Returns a clean AppConfig or throws with a human-readable message.
 */
export function validateConfig(input: unknown): AppConfig {
  if (typeof input !== "object" || input === null) {
    throw new Error("Config must be an object");
  }
  const c = input as Record<string, unknown>;

  // Offices
  if (!Array.isArray(c.offices)) throw new Error("offices must be an array");
  const offices: Office[] = c.offices.map((raw, i) => {
    const o = raw as Record<string, unknown>;
    const id = Number(o.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Office #${i + 1}: id must be a positive integer`);
    }
    const name = String(o.name ?? "").trim();
    if (!name) throw new Error(`Office #${i + 1}: name is required`);
    return {
      id,
      name,
      address: o.address ? String(o.address).trim() : undefined,
      enabled: o.enabled !== false,
    };
  });
  if (offices.length === 0) throw new Error("At least one office is required");
  if (offices.length > 25) throw new Error("Too many offices (max 25)");

  // Schedule
  const s = (c.schedule ?? {}) as Record<string, unknown>;
  const activeDays = Array.isArray(s.activeDays)
    ? s.activeDays.map(Number).filter((d) => d >= 0 && d <= 6)
    : DEFAULT_CONFIG.schedule.activeDays;
  const startHour = clampInt(s.startHour, 0, 23, DEFAULT_CONFIG.schedule.startHour);
  const endHour = clampInt(s.endHour, 1, 24, DEFAULT_CONFIG.schedule.endHour);
  if (endHour <= startHour) {
    throw new Error("Schedule end hour must be after start hour");
  }
  const schedule: ScheduleConfig = {
    enabled: s.enabled !== false,
    timezone:
      typeof s.timezone === "string" && s.timezone
        ? s.timezone
        : DEFAULT_CONFIG.schedule.timezone,
    activeDays: activeDays.length ? activeDays : DEFAULT_CONFIG.schedule.activeDays,
    startHour,
    endHour,
    minIntervalMinutes: clampInt(
      s.minIntervalMinutes,
      1,
      1440,
      DEFAULT_CONFIG.schedule.minIntervalMinutes
    ),
  };

  // Scan
  const sc = (c.scan ?? {}) as Record<string, unknown>;
  const perOfficeDelayMinMs = clampInt(sc.perOfficeDelayMinMs, 0, 60000, DEFAULT_CONFIG.scan.perOfficeDelayMinMs);
  const perOfficeDelayMaxMs = clampInt(sc.perOfficeDelayMaxMs, perOfficeDelayMinMs, 120000, DEFAULT_CONFIG.scan.perOfficeDelayMaxMs);
  const scan: ScanConfig = {
    maxAttempts: clampInt(sc.maxAttempts, 1, 6, DEFAULT_CONFIG.scan.maxAttempts),
    notifyCooldownMinutes: clampInt(sc.notifyCooldownMinutes, 1, 1440, DEFAULT_CONFIG.scan.notifyCooldownMinutes),
    perOfficeDelayMinMs,
    perOfficeDelayMaxMs,
  };

  // Personal (optional)
  let personal: PersonalInfo | null = null;
  if (c.personal && typeof c.personal === "object") {
    const p = c.personal as Record<string, unknown>;
    const anyFilled = ["firstName", "lastName", "dlNumber", "birthMonth", "birthDay", "birthYear"].some(
      (k) => String(p[k] ?? "").trim()
    );
    if (anyFilled) {
      personal = {
        firstName: String(p.firstName ?? "").trim(),
        lastName: String(p.lastName ?? "").trim(),
        dlNumber: String(p.dlNumber ?? "").trim().toUpperCase(),
        birthMonth: pad2(p.birthMonth),
        birthDay: pad2(p.birthDay),
        birthYear: String(p.birthYear ?? "").trim(),
      };
      for (const [k, v] of Object.entries(personal)) {
        if (!v) throw new Error(`Personal info: ${k} is required when any personal field is set`);
      }
    }
  }

  return {
    offices,
    personal,
    schedule,
    scan,
    updatedAt: new Date().toISOString(),
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pad2(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length === 1 ? `0${s}` : s;
}

// ─── Schedule evaluation ──────────────────────────────────────────────────────

/** Resolve the local hour (0–23) and day-of-week (0–6) for a timezone. */
export function zonedHourAndDay(
  timezone: string,
  date: Date = new Date()
): { hour: number; day: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      hour: "numeric",
      weekday: "short",
    }).formatToParts(date);
  } catch {
    // Invalid tz — fall back to UTC
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour12: false,
      hour: "numeric",
      weekday: "short",
    }).formatToParts(date);
  }
  let hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  if (hour === 24) hour = 0; // hour12:false can report "24"
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return { hour, day: dayMap[weekday] ?? 0 };
}

/** Is the monitor allowed to scan right now per the schedule config? */
export function isWithinSchedule(
  s: ScheduleConfig,
  now: Date = new Date()
): { ok: boolean; reason?: string } {
  if (!s.enabled) return { ok: false, reason: "monitoring is paused" };
  const { hour, day } = zonedHourAndDay(s.timezone, now);
  if (!s.activeDays.includes(day)) {
    return { ok: false, reason: "outside active days" };
  }
  if (hour < s.startHour || hour >= s.endHour) {
    return { ok: false, reason: "outside active hours" };
  }
  return { ok: true };
}

/** Read personal info from env vars (fallback when config.personal is null). */
export function personalInfoFromEnv(): PersonalInfo | null {
  const {
    DMV_FIRST_NAME,
    DMV_LAST_NAME,
    DMV_DL_NUMBER,
    DMV_BIRTH_MONTH,
    DMV_BIRTH_DAY,
    DMV_BIRTH_YEAR,
  } = process.env;
  if (
    !DMV_FIRST_NAME ||
    !DMV_LAST_NAME ||
    !DMV_DL_NUMBER ||
    !DMV_BIRTH_MONTH ||
    !DMV_BIRTH_DAY ||
    !DMV_BIRTH_YEAR
  ) {
    return null;
  }
  return {
    firstName: DMV_FIRST_NAME,
    lastName: DMV_LAST_NAME,
    dlNumber: DMV_DL_NUMBER,
    birthMonth: DMV_BIRTH_MONTH,
    birthDay: DMV_BIRTH_DAY,
    birthYear: DMV_BIRTH_YEAR,
  };
}

/** Resolve the effective personal info: config first, then env fallback. */
export function resolvePersonalInfo(config: AppConfig): PersonalInfo | null {
  return config.personal ?? personalInfoFromEnv();
}
