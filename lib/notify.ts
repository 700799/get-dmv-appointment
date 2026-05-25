import nodemailer from "nodemailer";
import type { Slot } from "./dmv";

function createTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

export async function sendAppointmentAlert(slots: Slot[]): Promise<void> {
  const transport = createTransport();
  const grouped = slots.reduce<Record<string, Slot[]>>((acc, s) => {
    (acc[s.officeName] ??= []).push(s);
    return acc;
  }, {});

  const body = Object.entries(grouped)
    .map(([office, officeSlots]) => {
      const slotList = officeSlots
        .map((s) => `  • ${s.date}${s.time ? " at " + s.time : ""}`)
        .join("\n");
      return `${office}:\n${slotList}`;
    })
    .join("\n\n");

  await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NOTIFY_EMAIL,
    subject: "🚗 DMV Behind-the-Wheel Appointment Available!",
    text: `Appointment slots are open at:\n\n${body}\n\nBook now at https://www.dmv.ca.gov/wasapp/foa/driveTest.do`,
  });
}

export async function sendWeeklyPassword(password: string): Promise<void> {
  const transport = createTransport();
  await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NOTIFY_EMAIL,
    subject: "DMV Monitor — Your Weekly Login Password",
    text: `Your DMV appointment monitor password for this week:\n\n  ${password}\n\nThis password expires next Monday at 8 AM UTC.\n\nTo log in, visit your Vercel app URL.`,
  });
}

export async function sendTestEmail(): Promise<void> {
  const transport = createTransport();
  await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NOTIFY_EMAIL,
    subject: "DMV Monitor — Test Notification",
    text: "This is a test email from your DMV appointment monitor. Notifications are working correctly.",
  });
}

export async function sendCaptchaAlert(): Promise<void> {
  const transport = createTransport();
  await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NOTIFY_EMAIL,
    subject: "⚠️ DMV Monitor — reCAPTCHA Detected",
    text: [
      "The DMV appointment checker hit a reCAPTCHA wall.",
      "",
      "Automated checks cannot get through CAPTCHA. To find an appointment:",
      "  1. Visit https://www.dmv.ca.gov/wasapp/foa/driveTest.do in your browser",
      "  2. Book manually",
      "",
      "Checks will resume automatically — you will receive another alert if",
      "CAPTCHA is still present in 12 hours.",
    ].join("\n"),
  });
}

export async function sendBlockageAlert(lastReach: string | null): Promise<void> {
  const transport = createTransport();
  const since = lastReach
    ? `Last successful check: ${new Date(lastReach).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT`
    : "No successful check has ever been recorded.";

  await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NOTIFY_EMAIL,
    subject: "⚠️ DMV Monitor — Checks Blocked for 4+ Hours",
    text: [
      "The DMV appointment checker has been blocked or erroring for over 4 hours.",
      "",
      since,
      "",
      "Possible causes:",
      "  • SCRAPER_API_KEY is missing or invalid — check Vercel env vars",
      "  • ScraperAPI account has hit its monthly request limit",
      "  • The DMV changed its bot-detection rules",
      "",
      "Check the Vercel function logs for details.",
      "Slots may be opening without you being notified.",
    ].join("\n"),
  });
}
