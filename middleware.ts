import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Protected UI routes — anyone who hits these without a valid session
// is redirected to the login page. API routes do their own auth checks.
const PROTECTED = ["/dashboard", "/admin"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const needsAuth = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (!needsAuth) return NextResponse.next();

  const token = request.cookies.get("dmv_session")?.value;
  if (!token) return redirectToLogin(request);

  const secret = process.env.SESSION_SECRET;
  if (!secret) return redirectToLogin(request);

  // jwtVerify in middleware (Edge-compatible via jose).
  // We can't use async/await at module level but middleware itself is async.
  return verifyAndProceed(token, secret, request);
}

async function verifyAndProceed(
  token: string,
  secret: string,
  request: NextRequest
): Promise<NextResponse> {
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return NextResponse.next();
  } catch {
    return redirectToLogin(request);
  }
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
