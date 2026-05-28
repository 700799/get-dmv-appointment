# DMV Appointment Monitor

Checks CA DMV behind-the-wheel test availability and emails you the moment a slot opens. Login is protected by a weekly rotating password emailed to you every Monday.

Everything that used to be hardcoded — **which offices to watch, the days/hours to run, scan timing, and your DMV form details** — is now editable from a password-protected **Admin page** at `/admin`. No redeploys needed to change them.

## Default monitored locations
- Pleasanton — Las Positas (6300 W Las Positas Blvd)
- Pleasanton — Stoneridge (2621 Stoneridge Mall Rd)

Add, remove, or disable any CA DMV office from the Admin page — use the built-in "Search DMV" lookup to pull live office IDs straight from the DMV.

## Admin page (`/admin`)
After logging in, click **⚙️ Admin** to configure:
- **Schedule** — master on/off, active days, active hours, timezone, and the minimum minutes between scans. Scans only run inside this window.
- **Scan behavior** — retry attempts, re-notify cooldown, and randomized delays between offices (to look less bot-like).
- **DMV locations** — add/remove/enable offices; search the live DMV office list by city.
- **DMV form details** — first/last name, DL or permit number, and date of birth (required by the DMV to return availability). Stored securely in Redis; takes precedence over the `DMV_*` env vars.

The cron fires on a fixed schedule (`vercel.json`), but the app decides whether to actually scan based on your Admin schedule settings — so you control cadence without touching code.

---

## One-time setup

### 1. Get a ScraperAPI key
Sign up at [scraperapi.com](https://scraperapi.com). The free tier gives 5,000 requests/month — enough if you limit checks to business hours. Copy your API key.

> **Why this is required:** The CA DMV blocks requests from datacenter IPs (which Vercel uses). ScraperAPI routes requests through residential IPs so the DMV sees a regular home user.

### 2. Deploy to Vercel
Import this repo at [vercel.com/new](https://vercel.com/new) and add these environment variables before clicking Deploy:

| Variable | Value |
|----------|-------|
| `GMAIL_USER` | Gmail address used to send alerts |
| `GMAIL_APP_PASSWORD` | Gmail [App Password](https://myaccount.google.com/apppasswords) (requires 2FA) |
| `NOTIFY_EMAIL` | Where to receive alerts and the weekly password |
| `CRON_SECRET` | Long random string (`openssl rand -hex 32`) |
| `SESSION_SECRET` | Another long random string |
| `SCRAPER_API_KEY` | Your ScraperAPI key |
| `DMV_FIRST_NAME` | Your first name |
| `DMV_LAST_NAME` | Your last name |
| `DMV_DL_NUMBER` | Your CA driver's license or learner's permit number (format: `B1234567`) |
| `DMV_BIRTH_MONTH` | Your birth month — two digits, e.g. `06` |
| `DMV_BIRTH_DAY` | Your birth day — two digits, e.g. `15` |
| `DMV_BIRTH_YEAR` | Your birth year — four digits, e.g. `2004` |

### 3. Add Upstash Redis storage
In the Vercel dashboard → **Storage** tab (or [Vercel Marketplace](https://vercel.com/marketplace)) → search **Upstash Redis** → Install → link to this project. Vercel auto-injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

Redeploy after linking so the new env vars are picked up.

### 4. Generate your first login password
```bash
curl -X POST https://your-app.vercel.app/api/rotate-password \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
Check your email for the password, then log in at your Vercel URL.

### 5. Trigger a manual check to verify everything works
```bash
curl -X POST https://your-app.vercel.app/api/check \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
The response JSON includes `hoursSinceLastRealReach` — if it's `0`, the scraper reached the DMV successfully. If it stays high after multiple checks, see Troubleshooting below.

---

## How it works
- **On each cron tick** (`vercel.json`): Vercel hits `/api/check`. The app first checks your Admin **schedule** (enabled? active day/hour? past the min-interval?). If the window is open, it scrapes via ScraperAPI (US residential IP) and emails you if slots appear; otherwise it records a "skipped" entry and does nothing.
- **Every Monday 8 AM UTC**: `/api/rotate-password` → new password → email to you
- **Blocked alert**: If the DMV hasn't been reachable for 4+ hours, you get an email so you can book manually
- **CAPTCHA alert**: If reCAPTCHA is detected, you get an email to book manually (once per 12h)
- The dashboard at `/dashboard` shows live status, the schedule window, monitored offices, and a recent-activity log; it polls every 5 minutes. A **Check now** button forces an immediate scan (bypassing the schedule window).

### Config & state in Redis
- `dmv:config` — the full editable config (offices, schedule, scan, form details)
- `dmv:status` — last check result
- `dmv:runlog` — last 30 runs (shown on the dashboard)
- `dmv:last_reach`, `dmv:last_notified`, alert dedup keys — heartbeat & notification throttling

---

## Troubleshooting

### Checker says "BLOCKED" or `hoursSinceLastRealReach` keeps growing
1. Confirm `SCRAPER_API_KEY` is set correctly in Vercel env vars
2. Check your ScraperAPI dashboard — you may have hit the monthly request limit
3. Check Vercel function logs for the `/api/check` route

### No slots found even when the DMV might have availability
The Stoneridge office ID (`640`) is a best-guess. Open **/admin → DMV locations → Search DMV**, type a city (e.g. `Pleasanton`), and add the office straight from the live DMV list — the correct numeric ID is filled in for you. Then disable or remove the guessed entry. (Under the hood this calls `GET /api/discover-offices?q=Pleasanton`.)

### CAPTCHA wall
ScraperAPI usually handles reCAPTCHA automatically via residential IPs. If CAPTCHA alerts persist for days, consider upgrading to ScraperAPI's premium residential proxy tier.
