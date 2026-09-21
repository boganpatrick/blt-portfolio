import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createSessionToken, verifySessionToken, COOKIE_NAME, SESSION_DURATION_SECONDS } from "@/lib/session";

const MIN_PASSWORD_LENGTH = 10;

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { currentPassword, newPassword } = await req.json().catch(() => ({ currentPassword: "", newPassword: "" }));
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password are both required." }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "New password must be different from the current one." }, { status: 400 });
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db.update(users).set({ passwordHash: newHash, mustChangePassword: false }).where(eq(users.id, user.id));

  // Re-issue the session cookie so it reflects mustChangePassword: false —
  // otherwise the still-flagged old token would keep bouncing the user back
  // to this page until it expires or they log in again.
  const newToken = await createSessionToken(user.id, user.username, false);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, newToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
  return res;
}
