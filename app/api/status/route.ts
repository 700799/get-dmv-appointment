import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getStatus, getRunLog, getLastReach } from "@/lib/kv";
import { getConfig, isWithinSchedule } from "@/lib/config";

export async function GET(request: Request) {
  const authenticated = await getSessionFromRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [status, runLog, config, lastReach] = await Promise.all([
    getStatus().catch(() => null),
    getRunLog().catch(() => []),
    getConfig(),
    getLastReach().catch(() => null),
  ]);

  const window = isWithinSchedule(config.schedule);
  const enabledOffices = config.offices.filter((o) => o.enabled);

  const base = {
    schedule: {
      enabled: config.schedule.enabled,
      active: window.ok,
      reason: window.reason ?? null,
      timezone: config.schedule.timezone,
      startHour: config.schedule.startHour,
      endHour: config.schedule.endHour,
      activeDays: config.schedule.activeDays,
      minIntervalMinutes: config.schedule.minIntervalMinutes,
    },
    offices: enabledOffices.map((o) => ({
      name: o.name,
      address: o.address ?? null,
    })),
    lastReach,
    runLog,
  };

  if (!status) {
    return NextResponse.json({
      ...base,
      lastChecked: null,
      available: false,
      slots: [],
      message: "No checks have run yet.",
    });
  }

  return NextResponse.json({ ...base, ...status });
}
