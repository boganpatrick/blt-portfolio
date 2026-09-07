// Signed session cookie for logged-in users. Uses jose (not bcrypt) because
// this file is imported from middleware.ts, which runs on Vercel's Edge
// runtime — no Node crypto/native modules there. Password *hashing*
// (bcryptjs) stays server-side in the login route, which runs on Node.

import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "blt_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET env var is not set — required to sign/verify session cookies.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: string, username: string): Promise<string> {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<{ userId: string; username: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return { userId: payload.sub, username: payload.username as string };
  } catch {
    return null;
  }
}

export { COOKIE_NAME, SESSION_DURATION_SECONDS };
