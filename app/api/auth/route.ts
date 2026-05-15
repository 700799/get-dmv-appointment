import { NextResponse } from "next/server";
import {
  hashPassword,
  createSessionToken,
  setSessionCookie,
} from "@/lib/auth";
import { getPasswordHash } from "@/lib/kv";

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: "" }));

  if (!password) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  const storedHash = await getPasswordHash();
  if (!storedHash) {
    return NextResponse.json(
      { error: "No password configured. Run the rotate-password cron first." },
      { status: 500 }
    );
  }

  const inputHash = await hashPassword(password);
  if (inputHash !== storedHash) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await createSessionToken();
  await setSessionCookie(token);

  return NextResponse.json({ ok: true });
}
