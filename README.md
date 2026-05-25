# DMV Appointment Monitor

Checks CA DMV behind-the-wheel test availability at two Pleasanton offices every 10 minutes and emails you the moment a slot opens. Login is protected by a weekly rotating password emailed to you every Monday.

## Monitored locations
- Pleasanton — Los Positas (6300 W Las Positas Blvd)
- Pleasanton — Stoneridge (2621 Stoneridge Mall)

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
- **Every 10 min**: Vercel cron hits `/api/check` → ScraperAPI routes through a US residential IP → scrapes DMV → emails you if slots appear
- **Every Monday 8 AM UTC**: `/api/rotate-password` → new password → email to you
- **Blocked alert**: If the DMV hasn't been reachable for 4+ hours, you get an email so you can book manually
- **CAPTCHA alert**: If reCAPTCHA is detected, you get an email to book manually (once per 12h)
- The dashboard at `/dashboard` shows live status and polls every 5 minutes

---

## Troubleshooting

### Checker says "BLOCKED" or `hoursSinceLastRealReach` keeps growing
1. Confirm `SCRAPER_API_KEY` is set correctly in Vercel env vars
2. Check your ScraperAPI dashboard — you may have hit the monthly request limit
3. Check Vercel function logs for the `/api/check` route

### No slots found even when the DMV might have availability
The Stoneridge office ID (`640`) is a best-guess. After logging in, call:
```
GET https://your-app.vercel.app/api/discover-offices
```
Compare the returned IDs against `640` and update the `OFFICES` array in `lib/dmv.ts` if needed.

### CAPTCHA wall
ScraperAPI usually handles reCAPTCHA automatically via residential IPs. If CAPTCHA alerts persist for days, consider upgrading to ScraperAPI's premium residential proxy tier.
