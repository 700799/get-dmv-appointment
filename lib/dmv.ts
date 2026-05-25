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
  /** CAPTCHA_REQUIRED | BLOCKED | RATE_LIMITED | HTTP_xxx | missing_env | string */
  error?: string;
}

const OFFICES = [
  { id: 631, name: "Pleasanton (Los Positas)" },
  // Stoneridge ID is a best-guess — run /api/discover-offices once to confirm
  { id: 640, name: "Pleasanton Stoneridge" },
];

const DMV_BASE = "https://www.dmv.ca.gov/wasapp/foa";
const SCRAPER_API_BASE = "https://api.scraperapi.com";

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

type Fingerprint = (typeof FINGERPRINTS)[number];

function randomFingerprint(): Fingerprint {
  return FINGERPRINTS[Math.floor(Math.random() * FINGERPRINTS.length)];
}

function randomSessionId(): number {
  return Math.floor(Math.random() * 100_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(minMs: number, maxMs: number): Promise<void> {
  return sleep(Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs);
}

function buildHeaders(
  fp: Fingerprint,
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
    baseMs = 4_000,
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
        const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
        await sleep(Math.random() * ceiling);
      }
    }
  }
  throw lastErr;
}

// ─── ScraperAPI proxy — routes through US residential IPs ─────────────────────
//
// If SCRAPER_API_KEY is not set, falls back to direct fetch (useful for local
// testing, but will likely get 403'd by the DMV in production).

async function dmvGet(targetUrl: string, sessionId: number): Promise<Response> {
  const key = process.env.SCRAPER_API_KEY;

  if (!key) {
    return fetch(targetUrl, {
      headers: buildHeaders(randomFingerprint()),
      signal: AbortSignal.timeout(15_000),
    });
  }

  const params = new URLSearchParams({
    api_key: key,
    url: targetUrl,
    country_code: "us",
    session_number: String(sessionId),
  });

  return fetch(`${SCRAPER_API_BASE}/?${params}`, {
    signal: AbortSignal.timeout(60_000),
  });
}

async function dmvPost(
  targetUrl: string,
  formBody: URLSearchParams,
  sessionId: number,
  fallbackCookies: string,
  fp: Fingerprint
): Promise<Response> {
  const key = process.env.SCRAPER_API_KEY;

  if (!key) {
    // Direct fetch fallback (uses manually managed cookies)
    return fetch(targetUrl, {
      method: "POST",
      headers: {
        ...buildHeaders(fp, `${DMV_BASE}/driveTest.do`),
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: fallbackCookies,
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(20_000),
    });
  }

  // ScraperAPI handles session cookies internally via session_number
  const scraperBody = new URLSearchParams({
    api_key: key,
    url: targetUrl,
    method: "POST",
    body: formBody.toString(),
    country_code: "us",
    session_number: String(sessionId),
  });

  return fetch(`${SCRAPER_API_BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: scraperBody.toString(),
    signal: AbortSignal.timeout(60_000),
  });
}

// ─── Session management ────────────────────────────────────────────────────────

interface Session {
  sessionId: number;
  cookies: string; // only relevant for direct-fetch fallback
  fp: Fingerprint;
}

async function getSession(): Promise<Session> {
  const sessionId = randomSessionId();
  const fp = randomFingerprint();

  // GET the landing page to establish session cookies.
  // With ScraperAPI: this lets ScraperAPI store the JSESSIONID for the session.
  // Without ScraperAPI: we extract Set-Cookie manually for the fallback path.
  const resp = await dmvGet(`${DMV_BASE}/driveTest.do`, sessionId);
  if (!resp.ok) throw new Error(`Session HTTP ${resp.status}`);

  let cookies = "";
  if (!process.env.SCRAPER_API_KEY) {
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
  }

  return { sessionId, cookies, fp };
}

// ─── Personal info (from env vars) ────────────────────────────────────────────

interface PersonalInfo {
  firstName: string;
  lastName: string;
  dlNumber: string;
  birthMonth: string;
  birthDay: string;
  birthYear: string;
}

function getPersonalInfo(): PersonalInfo | null {
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

// ─── HTML parser ──────────────────────────────────────────────────────────────

function parseSlots(
  html: string,
  officeName: string,
  officeId: number
): Slot[] {
  const $ = cheerio.load(html);
  const slots: Slot[] = [];

  const pushIfDate = (raw: string) => {
    // Matches "Wednesday, May 14, 2026" or "May 14, 2026"
    const dateMatch = raw.match(
      /([A-Za-z]+,\s+)?([A-Za-z]+ \d{1,2},?\s*\d{4})/
    );
    if (!dateMatch) return;
    const timeMatch = raw.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    const noAppts =
      raw.toLowerCase().includes("no appointment") ||
      raw.toLowerCase().includes("no available") ||
      raw.toLowerCase().includes("not available");
    if (noAppts) return;
    slots.push({
      date: (dateMatch[1] ?? "" + dateMatch[2]).trim(),
      time: timeMatch?.[1] ?? "",
      officeName,
      officeId,
    });
  };

  // Strategy 1: <p class="alert"> — the real CA DMV BTW response
  // "Wednesday, May 14, 2026 at 2:20 PM" or "There are no appointments available"
  $("p.alert, .alert, p[class*=alert], div[class*=alert]").each((_, el) => {
    pushIfDate($(el).text().trim());
  });

  // Strategy 2: radio inputs labeled with dates
  if (slots.length === 0) {
    $("input[type=radio]").each((_, el) => {
      const id = $(el).attr("id") ?? "";
      const val = $(el).attr("value") ?? "";
      const label = $(`label[for="${id}"]`).text().trim() || val;
      pushIfDate(label);
    });
  }

  // Strategy 3: table rows / list items
  if (slots.length === 0) {
    $("tr, li").each((_, el) => {
      pushIfDate($(el).text().trim());
    });
  }

  // Strategy 4: class-matched elements
  if (slots.length === 0) {
    $("[class*=slot], [class*=appt], [class*=date], [class*=avail]").each(
      (_, el) => {
        pushIfDate($(el).text().trim());
      }
    );
  }

  const bodyLower = $("body").text().toLowerCase();
  const definitivelyNone =
    bodyLower.includes("no appointment") ||
    bodyLower.includes("no available") ||
    bodyLower.includes("not available") ||
    bodyLower.includes("there are no");

  // Strategy 5: body text regex — only if page doesn't say "no appointments"
  if (slots.length === 0 && !definitivelyNone) {
    const bodyText = $("body").text();
    for (const m of bodyText.matchAll(/([A-Za-z]+ \d{1,2},?\s*\d{4})/g)) {
      const after = bodyText.slice(m.index ?? 0, (m.index ?? 0) + 40);
      const timeMatch = after.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
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
  const personalInfo = getPersonalInfo();
  if (!personalInfo) {
    return {
      officeName,
      officeId,
      slots: [],
      error:
        "missing_env: DMV_FIRST_NAME, DMV_LAST_NAME, DMV_DL_NUMBER, DMV_BIRTH_MONTH/DAY/YEAR not set",
    };
  }

  try {
    return await withRetry(
      async () => {
        await jitter(600, 2_500);

        const session = await getSession();

        await jitter(1_000, 3_000);

        const formBody = new URLSearchParams({
          mode: "DriveTest",
          officeId: String(officeId),
          firstName: personalInfo.firstName,
          lastName: personalInfo.lastName,
          dlNumber: personalInfo.dlNumber,
          birthMonth: personalInfo.birthMonth,
          birthDay: personalInfo.birthDay,
          birthYear: personalInfo.birthYear,
          resetCheckFields: "true",
        });

        const resp = await dmvPost(
          `${DMV_BASE}/findDriveTest.do`,
          formBody,
          session.sessionId,
          session.cookies,
          session.fp
        );

        if (resp.status === 429) throw new Error("RATE_LIMITED");
        if (resp.status === 403) throw new Error("BLOCKED");
        if (!resp.ok) throw new Error(`HTTP_${resp.status}`);

        const html = await resp.text();

        if (
          html.toLowerCase().includes("recaptcha") ||
          html.toLowerCase().includes("g-recaptcha")
        ) {
          // CAPTCHA is not a transient error — return immediately, don't retry
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

/** Check all offices sequentially with random gaps to avoid looking like a bot. */
export async function checkAllOffices(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (let i = 0; i < OFFICES.length; i++) {
    results.push(await checkOffice(OFFICES[i].id, OFFICES[i].name));
    if (i < OFFICES.length - 1) {
      await jitter(2_500, 6_000);
    }
  }
  return results;
}

export async function discoverOfficeIds(): Promise<
  Array<{ id: string; name: string }>
> {
  await jitter(400, 1_200);
  const sessionId = randomSessionId();
  const resp = await dmvGet(`${DMV_BASE}/driveTest.do`, sessionId);
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
