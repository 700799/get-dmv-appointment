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
