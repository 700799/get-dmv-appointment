# DMV Appointment Monitor

Checks CA DMV behind-the-wheel test availability at two Pleasanton offices every 10 minutes and sends an email when a slot opens. Login is protected by a weekly rotating password that gets emailed to you every Monday.

## Monitored locations
- Pleasanton — Los Positas (6300 W Las Positas Blvd)
- Pleasanton — Stoneridge (2621 Stoneridge Mall)

## One-time setup

### 1. Deploy to Vercel
Connect this repo to Vercel and add these environment variables:

| Variable | Value |
|----------|-------|
| `GMAIL_USER` | Gmail address used to send alerts |
| `GMAIL_APP_PASSWORD` | Gmail [App Password](https://myaccount.google.com/apppasswords) (requires 2FA) |
| `NOTIFY_EMAIL` | Where to send alerts and the weekly password |
| `CRON_SECRET` | A random secret (e.g. `openssl rand -hex 32`) |
| `SESSION_SECRET` | Another random secret |

### 2. Add Upstash Redis storage
In the Vercel Marketplace, install the **Upstash Redis** integration and link it to this project. Vercel auto-injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

### 3. Generate your first password
```
curl -X POST https://your-app.vercel.app/api/rotate-password \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
Check your email for the password, then log in at your Vercel URL.

### 4. Verify the checker works
```
curl -X POST https://your-app.vercel.app/api/check \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## How it works
- **Every 10 min**: Vercel cron hits `/api/check` → scrapes DMV → emails you if slots appear.
- **Every Monday 8 AM UTC**: `/api/rotate-password` → new password → email to you.
- The dashboard at `/dashboard` polls `/api/status` every 5 minutes.

## Troubleshooting CAPTCHA
If the scraper hits a CAPTCHA it skips silently (no false alarms). Extend `lib/dmv.ts` with a 2captcha key if this becomes persistent.

## Fixing the Stoneridge office ID
The Stoneridge office ID is currently `640` (a guess). If no slots ever appear, call:
```
GET https://your-app.vercel.app/api/discover-offices
```
Then update the `OFFICES` array in `lib/dmv.ts` with the correct ID.
