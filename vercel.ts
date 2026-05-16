import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    // Check DMV availability every 10 minutes
    { path: "/api/check", schedule: "*/10 * * * *" },
    // Rotate password every Monday at 8 AM UTC
    { path: "/api/rotate-password", schedule: "0 8 * * 1" },
  ],
};
