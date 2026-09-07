import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createSessionToken, COOKIE_NAME, SESSION_DURATION_SECONDS } from "@/lib/session";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({ username: "", password: "" }));

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  const [user] = await db.select().from(users).where(eq(users.username, username.toLowerCase().trim()));

  // Same generic error whether the username doesn't exist or the password
  // is wrong, so a login attempt can't be used to enumerate valid usernames.
  const genericError = NextResponse.json({ error: "Invalid username or password." }, { status: 401 });

  if (!user) return genericError;

  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.` },
      { status: 429 }
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    const newFailedAttempts = user.failedAttempts + 1;
    const lockedUntil =
      newFailedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;
    await db
      .update(users)
      .set({ failedAttempts: newFailedAttempts, lockedUntil })
      .where(eq(users.id, user.id));
    return genericError;
  }

  // Successful login: reset lockout counters and issue a session cookie.
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));

  const token = await createSessionToken(user.id, user.username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
  return res;
}
