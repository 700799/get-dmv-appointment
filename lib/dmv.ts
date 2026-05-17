import * as cheerio from "cheerio";

export interface Slot {
  date: string;
  time: string;
  officeName: string;
  officeId: number;
}

export interface CheckResult {
  officeName: string;
  officeId: number;
  slots: Slot[];
  error?: string;
}

const OFFICES = [
  { id: 631, name: "Pleasanton (Los Positas)" },
  // Stoneridge ID is a guess — run /api/discover-offices once to confirm
  { id: 640, name: "Pleasanton Stoneridge" },
];

const DMV_BASE = "https://www.dmv.ca.gov/wasapp/foa";

// ─── Browser fingerprint pool ─────────────────────────────────────────────────

const FINGERPRINTS = [
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    lang: "en-US,en;q=0.9",
    extra: {
      "Sec-CH-UA": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"macOS"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
    },
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    lang: "en-US,en;q=0.9",
    extra: {
      "Sec-CH-UA": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
    },
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    lang: "en-US,en;q=0.5",
    extra: {
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
      "Sec-GPC": "1",
    },
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    lang: "en-US,en;q=0.5",
    extra: {
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
      "Sec-GPC": "1",
    },
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    lang: "en-US,en;q=0.9",
    extra: {},
  },
] as const;

function randomFingerprint() {
  return FINGERPRINTS[Math.floor(Math.random() * FINGERPRINTS.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Random delay in [minMs, maxMs] to mimic human timing. */
function jitter(minMs: number, maxMs: number): Promise<void> {
  return sleep(Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs);
}

function buildHeaders(
  fp: (typeof FINGERPRINTS)[number],
  referer?: string
): Record<string, string> {
  return {
    "User-Agent": fp.ua,
    Accept: fp.accept,
    "Accept-Language": fp.lang,
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    ...(referer ? { Referer: referer } : {}),
    ...(referer
      ? { "Sec-Fetch-Site": "same-origin" }
      : { "Sec-Fetch-Site": "none" }),
    ...fp.extra,
  };
}

// ─── Retry with exponential backoff + full jitter ────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 3,
    baseMs = 3000,
    capMs = 30_000,
  }: { maxAttempts?: number; baseMs?: number; capMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        // Full jitter: pick uniformly from [0, min(cap, base * 2^attempt)]
        const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
        await sleep(Math.random() * ceiling);
      }
    }
  }
  throw lastErr;
}

// ─── Session acquisition ──────────────────────────────────────────────────────

interface Session {
  cookies: string;
  fp: (typeof FINGERPRINTS)[number];
}

async function getSession(): Promise<Session> {
  const fp = randomFingerprint();
  const resp = await fetch(`${DMV_BASE}/driveTest.do`, {
    headers: buildHeaders(fp),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new Error(`Session HTTP ${resp.status}`);

  // Prefer getSetCookie() (Node 18+) then fall back to the raw header
  let cookies: string;
  if (typeof resp.headers.getSetCookie === "function") {
    cookies = resp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0].trim())
      .join("; ");
  } else {
    cookies = (resp.headers.get("set-cookie") ?? "")
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .join("; ");
  }

  return { cookies, fp };
}

// ─── HTML parsing (multiple fallback strategies) ─────────────────────────────

function parseSlots(
  html: string,
  officeName: string,
  officeId: number
): Slot[] {
  const $ = cheerio.load(html);
  const bodyText = $("body").text();
  const bodyLower = bodyText.toLowerCase();

  const noAppts =
    bodyLower.includes("no appointment") ||
    bodyLower.includes("no available") ||
    bodyLower.includes("fully booked") ||
    bodyLower.includes("not available") ||
    bodyLower.includes("currently no") ||
    bodyLower.includes("there are no");

  const slots: Slot[] = [];

  const pushIfDate = (raw: string) => {
    const dateMatch = raw.match(/([A-Za-z]+ \d{1,2},?\s*\d{4})/);
    if (!dateMatch) return;
    const timeMatch = raw.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    slots.push({
      date: dateMatch[1].trim(),
      time: timeMatch?.[1] ?? "",
      officeName,
      officeId,
    });
  };

  // Strategy 1: radio inputs labeled with dates
  $("input[type=radio]").each((_, el) => {
    const id = $(el).attr("id") ?? "";
    const val = $(el).attr("value") ?? "";
    const label = $(`label[for="${id}"]`).text().trim() || val;
    pushIfDate(label);
  });

  // Strategy 2: table rows / list items
  if (slots.length === 0) {
    $("tr, li").each((_, el) => {
      pushIfDate($(el).text().trim());
    });
  }

  // Strategy 3: any element with a recognizable date string
  if (slots.length === 0) {
    $("[class*=slot], [class*=appt], [class*=date], [class*=avail]").each(
      (_, el) => {
        pushIfDate($(el).text().trim());
      }
    );
  }

  // Strategy 4: plain regex over body text as last resort (only if not "no appts")
  if (slots.length === 0 && !noAppts) {
    const pattern = /([A-Za-z]+ \d{1,2},?\s*\d{4})/g;
    for (const m of bodyText.matchAll(pattern)) {
      const timeMatch = bodyText
        .slice(m.index ?? 0, (m.index ?? 0) + 40)
        .match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      slots.push({
        date: m[1].trim(),
        time: timeMatch?.[1] ?? "",
        officeName,
        officeId,
      });
    }
  }

  return slots;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function checkOffice(
  officeId: number,
  officeName: string
): Promise<CheckResult> {
  try {
    return await withRetry(
      async () => {
        // Human-like pre-request pause
        await jitter(600, 2_500);

        const session = await getSession();

        // Pause between landing page and form submit, like a human filling it out
        await jitter(1_000, 3_000);

        const body = new URLSearchParams({
          officeId: String(officeId),
          taskRationaleCode: "DT",
          numberItems: "5",
          resetCheckFields: "true",
        });

        const resp = await fetch(`${DMV_BASE}/findOfficeVisit.do`, {
          method: "POST",
          headers: {
            ...buildHeaders(session.fp, `${DMV_BASE}/driveTest.do`),
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: session.cookies,
          },
          body: body.toString(),
          signal: AbortSignal.timeout(20_000),
        });

        if (resp.status === 429) throw new Error("RATE_LIMITED");
        if (!resp.ok) throw new Error(`HTTP_${resp.status}`);

        const html = await resp.text();

        if (html.toLowerCase().includes("captcha")) {
          // Don't retry CAPTCHA — return immediately so the outer catch isn't triggered
          return { officeName, officeId, slots: [], error: "CAPTCHA_REQUIRED" };
        }

        const slots = parseSlots(html, officeName, officeId);
        return { officeName, officeId, slots };
      },
      { maxAttempts: 3, baseMs: 4_000, capMs: 30_000 }
    );
  } catch (err) {
    return {
      officeName,
      officeId,
      slots: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Check all offices sequentially with a random delay between them to avoid
 *  looking like a bot hammering the DMV from the same session. */
export async function checkAllOffices(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (let i = 0; i < OFFICES.length; i++) {
    results.push(await checkOffice(OFFICES[i].id, OFFICES[i].name));
    if (i < OFFICES.length - 1) {
      // Pause between offices like a user would pause between tasks
      await jitter(2_500, 6_000);
    }
  }
  return results;
}

export async function discoverOfficeIds(): Promise<
  Array<{ id: string; name: string }>
> {
  await jitter(400, 1_200);
  const fp = randomFingerprint();
  const resp = await fetch(`${DMV_BASE}/driveTest.do`, {
    headers: buildHeaders(fp),
    signal: AbortSignal.timeout(15_000),
  });
  const html = await resp.text();
  const $ = cheerio.load(html);
  const offices: Array<{ id: string; name: string }> = [];

  $(
    "select[name=officeId] option, select[name=branchCode] option"
  ).each((_, el) => {
    const id = $(el).attr("value") ?? "";
    const name = $(el).text().trim();
    if (id && name && name.toLowerCase().includes("pleasanton")) {
      offices.push({ id, name });
    }
  });

  return offices;
}
