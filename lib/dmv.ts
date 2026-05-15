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
  // Stoneridge office — verified ID needed; update after running discoverOfficeIds()
  { id: 640, name: "Pleasanton Stoneridge" },
];

const DMV_BASE = "https://www.dmv.ca.gov/wasapp/foa";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchWithSession(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...options.headers,
    },
  });
}

async function getSessionCookies(): Promise<string> {
  const resp = await fetchWithSession(`${DMV_BASE}/driveTest.do`);
  const setCookie = resp.headers.get("set-cookie") ?? "";
  // Extract JSESSIONID and any other session cookies
  return setCookie
    .split(",")
    .map((c) => c.split(";")[0].trim())
    .join("; ");
}

function parseAvailableSlots(
  html: string,
  officeName: string,
  officeId: number
): Slot[] {
  const $ = cheerio.load(html);
  const slots: Slot[] = [];

  // The DMV page shows available dates in a table or list
  // Pattern 1: table rows with date/time data
  $("table.appt-table tr, .appointment-slot, .available-slot").each((_, el) => {
    const text = $(el).text().trim();
    const dateMatch = text.match(/(\w+ \d{1,2},?\s*\d{4})/);
    const timeMatch = text.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (dateMatch && timeMatch) {
      slots.push({
        date: dateMatch[1],
        time: timeMatch[1],
        officeName,
        officeId,
      });
    }
  });

  // Pattern 2: "no appointments available" check
  const bodyText = $("body").text().toLowerCase();
  const noAppts =
    bodyText.includes("no appointment") ||
    bodyText.includes("no available") ||
    bodyText.includes("fully booked");

  // Pattern 3: any input[type=radio] for date selection indicates availability
  if (slots.length === 0 && !noAppts) {
    $("input[type=radio][name*=date], input[type=radio][name*=appt]").each(
      (_, el) => {
        const val = $(el).attr("value") ?? "";
        const label = $(`label[for="${$(el).attr("id")}"]`).text().trim();
        if (val) {
          const dateMatch = (label || val).match(/(\w+ \d{1,2},?\s*\d{4})/);
          const timeMatch = (label || val).match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
          slots.push({
            date: dateMatch?.[1] ?? val,
            time: timeMatch?.[1] ?? "",
            officeName,
            officeId,
          });
        }
      }
    );
  }

  return slots;
}

export async function checkOffice(
  officeId: number,
  officeName: string
): Promise<CheckResult> {
  try {
    const cookies = await getSessionCookies();

    const body = new URLSearchParams({
      officeId: String(officeId),
      taskRationaleCode: "DT", // Drive Test
      numberItems: "5",
      resetCheckFields: "true",
    });

    const resp = await fetchWithSession(`${DMV_BASE}/findOfficeVisit.do`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
        Referer: `${DMV_BASE}/driveTest.do`,
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      return { officeName, officeId, slots: [], error: `HTTP ${resp.status}` };
    }

    const html = await resp.text();

    // Detect CAPTCHA page
    if (
      html.toLowerCase().includes("recaptcha") ||
      html.toLowerCase().includes("captcha")
    ) {
      return {
        officeName,
        officeId,
        slots: [],
        error: "CAPTCHA_REQUIRED",
      };
    }

    const slots = parseAvailableSlots(html, officeName, officeId);
    return { officeName, officeId, slots };
  } catch (err) {
    return {
      officeName,
      officeId,
      slots: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function checkAllOffices(): Promise<CheckResult[]> {
  return Promise.all(
    OFFICES.map((o) => checkOffice(o.id, o.name))
  );
}

// Call once to discover the real office IDs for Pleasanton locations
export async function discoverOfficeIds(): Promise<
  Array<{ id: string; name: string }>
> {
  const resp = await fetchWithSession(`${DMV_BASE}/driveTest.do`);
  const html = await resp.text();
  const $ = cheerio.load(html);
  const offices: Array<{ id: string; name: string }> = [];

  $("select[name=officeId] option, select[name=branchCode] option").each(
    (_, el) => {
      const id = $(el).attr("value") ?? "";
      const name = $(el).text().trim();
      if (id && name && name.toLowerCase().includes("pleasanton")) {
        offices.push({ id, name });
      }
    }
  );

  return offices;
}
