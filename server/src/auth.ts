import { createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { CookieOptions, RequestHandler } from 'express';
import { jwtVerify, SignJWT } from 'jose';

export interface AuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: Uint8Array;
  secureCookies: boolean;
}

export const SESSION_COOKIE = 'parishmap_session';
export const SESSION_SECONDS = 12 * 60 * 60;

const MIN_SECRET_LENGTH = 32;
const AUDIENCE = 'parishmap-admin';

/**
 * Reads admin settings from the environment. Returns null if none are set, which leaves the
 * admin site unavailable. Throws if they're incomplete, or if production has none, so a
 * misconfigured server stops at startup rather than running with weak or missing security.
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const { ADMIN_USERNAME, ADMIN_PASSWORD_HASH, SESSION_SECRET, NODE_ENV } = env;
  const isProduction = NODE_ENV === 'production';

  if (!ADMIN_USERNAME && !ADMIN_PASSWORD_HASH && !SESSION_SECRET) {
    if (isProduction) throw new Error('Admin login settings are required in production.');
    return null;
  }
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH || !SESSION_SECRET) {
    throw new Error('Set all of ADMIN_USERNAME, ADMIN_PASSWORD_HASH, and SESSION_SECRET.');
  }
  if (SESSION_SECRET.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must have at least ${MIN_SECRET_LENGTH} characters.`);
  }
  if (!/^\$2[aby]\$/.test(ADMIN_PASSWORD_HASH)) {
    throw new Error('ADMIN_PASSWORD_HASH must be a bcrypt hash. See scripts/create-admin.ts.');
  }

  return {
    username: ADMIN_USERNAME,
    passwordHash: ADMIN_PASSWORD_HASH,
    sessionSecret: new TextEncoder().encode(SESSION_SECRET),
    secureCookies: isProduction,
  };
}

function sameText(a: string, b: string): boolean {
  // Hashing gives equal lengths, which timingSafeEqual requires.
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

export async function checkCredentials(
  config: AuthConfig,
  username: string,
  password: string,
): Promise<boolean> {
  // Always runs the slow password check, so response time doesn't reveal valid usernames.
  const passwordMatches = await bcrypt.compare(password, config.passwordHash);
  return sameText(username, config.username) && passwordMatches;
}

export function createSessionToken(
  config: AuthConfig,
  expiresInSeconds: number = SESSION_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(config.username)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(config.sessionSecret);
}

async function isValidSession(config: AuthConfig, token: string): Promise<boolean> {
  try {
    await jwtVerify(token, config.sessionSecret, {
      algorithms: ['HS256'],
      audience: AUDIENCE,
      subject: config.username,
    });
    return true;
  } catch {
    return false;
  }
}

export function sessionCookieOptions(config: AuthConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookies,
    path: '/',
    maxAge: SESSION_SECONDS * 1000,
  };
}

export function requireAdmin(config: AuthConfig): RequestHandler {
  return async (req, res, next) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (typeof token === 'string' && (await isValidSession(config, token))) {
      next();
      return;
    }
    res.status(401).json({ error: 'unauthorized' });
  };
}
