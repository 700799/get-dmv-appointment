import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    // Check DMV availability every 30 minutes (fits within ScraperAPI free tier)
    { path: "/api/check", schedule: "*/30 * * * *" },
    // Rotate password every Monday at 8 AM UTC
    { path: "/api/rotate-password", schedule: "0 8 * * 1" },
  ],
};
