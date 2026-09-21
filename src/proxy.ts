import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

// Everything requires a valid session except the login page itself and the
// login API route it calls. Static assets (_next/*, favicon, etc.) are
// excluded via the matcher below rather than here.
const PUBLIC_PATHS = ["/login", "/api/login"];

// Reachable by a logged-in user who still has mustChangePassword set, so
// they can actually get to the form that clears it (and log out if they'd
// rather not right now).
const CHANGE_PASSWORD_PATHS = ["/change-password", "/api/change-password", "/api/logout"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  const onChangePasswordPath = CHANGE_PASSWORD_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (session.mustChangePassword && !onChangePasswordPath) {
    const changePasswordUrl = new URL("/change-password", req.url);
    return NextResponse.redirect(changePasswordUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
