// Section 1: the admin sign-in with two-factor, sessions in cookies.

import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { AdminWithRole } from "../src/lib/api/types/index.ts";
import type { AdminRecord, Db, SessionRecord } from "./db.ts";
import { fail, json, newId, noContent } from "./http.ts";
import type { Router } from "./router.ts";
import { iso } from "./time.ts";

export const ACCESS_TTL_SECONDS = 900;
const REFRESH_TTL_MS = 12 * 3600_000;
const SESSION_MAX_MS = 72 * 3600_000;
const MFA_TTL_MS = 10 * 60_000;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;

/** The mock accepts this code for every admin, next to the real ones. */
export const MOCK_MFA_CODE = "000000";

export const ACCESS_COOKIE = "rf_admin_access";
export const REFRESH_COOKIE = "rf_admin_refresh";
const REFRESH_PATH = "/v1/admin/auth";

// --- TOTP (RFC 6238): 6 digits, 30 seconds, SHA-1 ---------------------------

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function randomBase32(length = 32): string {
  return Array.from(randomBytes(length), (byte) => BASE32[byte % 32]).join("");
}

function base32Decode(secret: string): Buffer {
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value === -1) continue;
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** The step a right code belongs to, or `null`. The step before and after count. */
function matchingStep(
  secret: string,
  code: string,
  now: number,
): number | null {
  const current = Math.floor(now / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    if (totpCode(secret, step) === code) return step;
  }
  return null;
}

// --- Views and cookies ------------------------------------------------------

export function adminView(db: Db, admin: AdminRecord, withRole = true) {
  const role = db.roles.find((entry) => entry.id === admin.roleId);
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    status: admin.status,
    roleId: admin.roleId,
    ...(withRole && role
      ? {
          role: {
            key: role.key,
            name: role.name,
            permissions: role.permissions,
          },
        }
      : {}),
    mfaEnabled: admin.totpSecret !== null,
    mustChangePassword: admin.mustChangePassword,
    lastLoginAt: admin.lastLoginAt,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

function cookie(
  name: string,
  value: string,
  path: string,
  maxAgeSeconds: number,
) {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`;
}

function withSessionCookies(
  response: Response,
  session: SessionRecord,
  now: number,
) {
  response.headers.append(
    "Set-Cookie",
    cookie(ACCESS_COOKIE, session.accessToken, "/", ACCESS_TTL_SECONDS),
  );
  response.headers.append(
    "Set-Cookie",
    cookie(
      REFRESH_COOKIE,
      session.refreshToken,
      REFRESH_PATH,
      Math.max(0, Math.floor((session.refreshExpiresAt - now) / 1000)),
    ),
  );
  return response;
}

export function withClearedCookies(response: Response) {
  response.headers.append("Set-Cookie", cookie(ACCESS_COOKIE, "", "/", 0));
  response.headers.append(
    "Set-Cookie",
    cookie(REFRESH_COOKIE, "", REFRESH_PATH, 0),
  );
  return response;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

// --- Sessions ---------------------------------------------------------------

const token = () => randomBytes(24).toString("hex");

function startSession(db: Db, admin: AdminRecord, now: number): SessionRecord {
  const session: SessionRecord = {
    id: newId(now),
    adminId: admin.id,
    accessToken: token(),
    accessExpiresAt: now + ACCESS_TTL_SECONDS * 1000,
    refreshToken: token(),
    refreshExpiresAt: now + REFRESH_TTL_MS,
    absoluteExpiresAt: now + SESSION_MAX_MS,
    revoked: false,
  };
  db.sessions.push(session);
  return session;
}

export function revokeSessions(
  db: Db,
  adminId: string,
  exceptId?: string,
): void {
  for (const session of db.sessions) {
    if (session.adminId === adminId && session.id !== exceptId) {
      session.revoked = true;
    }
  }
}

/**
 * Who calls, by the access cookie (or a bearer token). The admin guard
 * looks at the session on every request, so a sign-out or a role change
 * takes effect at once (0.4).
 */
export function authenticate(
  db: Db,
  request: Request,
  now: number,
): { admin: AdminRecord; session: SessionRecord } {
  const bearer = /^Bearer (.+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  const accessToken = bearer?.[1] ?? readCookie(request, ACCESS_COOKIE);
  const session = accessToken
    ? db.sessions.find((entry) => entry.accessToken === accessToken)
    : undefined;
  if (!session || session.accessExpiresAt <= now) {
    throw fail(
      401,
      "AUTH_TOKEN_INVALID",
      "The access token is missing or expired.",
    );
  }
  if (
    session.revoked ||
    session.refreshExpiresAt <= now ||
    session.absoluteExpiresAt <= now
  ) {
    throw fail(401, "AUTH_SESSION_REVOKED", "The session has ended.");
  }
  const admin = db.admins.find((entry) => entry.id === session.adminId);
  if (!admin) throw fail(401, "AUTH_SESSION_REVOKED", "The session has ended.");
  if (admin.status === "disabled") {
    throw fail(403, "ADMIN_ACCOUNT_DISABLED", "The account is disabled.");
  }
  return { admin, session };
}

function lockedFor(admin: AdminRecord, now: number): number {
  return admin.lockedUntil && admin.lockedUntil > now
    ? Math.ceil((admin.lockedUntil - now) / 1000)
    : 0;
}

function countFailure(admin: AdminRecord, now: number): void {
  admin.failedLogins += 1;
  if (admin.failedLogins >= MAX_FAILED_LOGINS) {
    admin.lockedUntil = now + LOCKOUT_MS;
    admin.failedLogins = 0;
  }
}

function ticketOf(db: Db, mfaToken: string, now: number) {
  const ticket = db.mfaTickets.find((entry) => entry.token === mfaToken);
  const admin = ticket
    ? db.admins.find((entry) => entry.id === ticket.adminId)
    : undefined;
  if (!ticket || !admin || ticket.expiresAt <= now) {
    throw fail(
      401,
      "ADMIN_MFA_TOKEN_INVALID",
      "The sign-in has expired. Start again.",
    );
  }
  return { ticket, admin };
}

// --- Routes -----------------------------------------------------------------

const loginBody = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});
const tokenBody = z.strictObject({ mfaToken: z.string().min(1) });
const verifyBody = z.strictObject({
  mfaToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
});
const changePasswordBody = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
});

export function registerAuth(router: Router): void {
  const base = "/v1/admin/auth";

  router.post(`${base}/login`, { public: true }, async (ctx) => {
    const input = await ctx.body(loginBody);
    const admin = ctx.db.admins.find(
      (entry) => entry.email === input.email.toLowerCase(),
    );
    if (admin) {
      const seconds = lockedFor(admin, ctx.now);
      if (seconds > 0) {
        throw fail(429, "ADMIN_ACCOUNT_LOCKED", "The account is locked.", {
          retryAfterSeconds: seconds,
        });
      }
    }
    if (!admin || admin.password !== input.password) {
      if (admin) countFailure(admin, ctx.now);
      throw fail(
        401,
        "ADMIN_CREDENTIALS_INVALID",
        "Email or password is wrong.",
      );
    }
    if (admin.status === "disabled") {
      throw fail(403, "ADMIN_ACCOUNT_DISABLED", "The account is disabled.");
    }
    const ticket = {
      token: token(),
      adminId: admin.id,
      expiresAt: ctx.now + MFA_TTL_MS,
    };
    ctx.db.mfaTickets.push(ticket);
    return json({
      status: admin.totpSecret ? "mfa_required" : "mfa_setup_required",
      mfaToken: ticket.token,
    });
  });

  router.post(`${base}/mfa/setup`, { public: true }, async (ctx) => {
    const { mfaToken } = await ctx.body(tokenBody);
    const { admin } = ticketOf(ctx.db, mfaToken, ctx.now);
    if (admin.totpSecret) {
      throw fail(
        401,
        "ADMIN_MFA_TOKEN_INVALID",
        "Two-factor is already set up.",
      );
    }
    admin.pendingTotpSecret ??= randomBase32();
    const label = encodeURIComponent(`Radhe Foods Admin:${admin.email}`);
    return json({
      secret: admin.pendingTotpSecret,
      otpauthUrl: `otpauth://totp/${label}?secret=${admin.pendingTotpSecret}&issuer=Radhe+Foods+Admin&algorithm=SHA1&digits=6&period=30`,
    });
  });

  router.post(`${base}/mfa/verify`, { public: true }, async (ctx) => {
    const input = await ctx.body(verifyBody);
    const { ticket, admin } = ticketOf(ctx.db, input.mfaToken, ctx.now);
    const seconds = lockedFor(admin, ctx.now);
    if (seconds > 0) {
      throw fail(429, "ADMIN_ACCOUNT_LOCKED", "The account is locked.", {
        retryAfterSeconds: seconds,
      });
    }
    if (admin.status === "disabled") {
      throw fail(403, "ADMIN_ACCOUNT_DISABLED", "The account is disabled.");
    }
    const secret = admin.totpSecret ?? admin.pendingTotpSecret;
    if (!secret) {
      throw fail(400, "ADMIN_MFA_SETUP_REQUIRED", "Call mfa/setup first.");
    }
    const step = matchingStep(secret, input.code, ctx.now);
    const reused = step !== null && step === admin.lastTotpStep;
    if (input.code !== MOCK_MFA_CODE && (step === null || reused)) {
      countFailure(admin, ctx.now);
      throw fail(
        401,
        "ADMIN_MFA_CODE_INVALID",
        "The code is wrong or was used already.",
      );
    }
    admin.totpSecret = secret;
    admin.pendingTotpSecret = null;
    admin.lastTotpStep = step;
    admin.failedLogins = 0;
    admin.lockedUntil = null;
    admin.lastLoginAt = iso(ctx.now);
    ctx.db.mfaTickets = ctx.db.mfaTickets.filter((entry) => entry !== ticket);
    const session = startSession(ctx.db, admin, ctx.now);
    return withSessionCookies(
      json({
        status: "authenticated",
        admin: adminView(ctx.db, admin) as AdminWithRole,
        accessTokenExpiresInSeconds: ACCESS_TTL_SECONDS,
      }),
      session,
      ctx.now,
    );
  });

  router.post(`${base}/refresh`, { public: true }, (ctx) => {
    const refreshToken = readCookie(ctx.request, REFRESH_COOKIE);
    const session = refreshToken
      ? ctx.db.sessions.find((entry) => entry.refreshToken === refreshToken)
      : undefined;
    const alive =
      session &&
      !session.revoked &&
      session.refreshExpiresAt > ctx.now &&
      session.absoluteExpiresAt > ctx.now;
    const admin = alive
      ? ctx.db.admins.find((entry) => entry.id === session.adminId)
      : undefined;
    if (!session || !alive || !admin) {
      return withClearedCookies(
        json(
          {
            error: {
              code: "AUTH_REFRESH_INVALID",
              message:
                "The refresh token is missing, expired or was used already.",
            },
          },
          401,
        ),
      );
    }
    if (admin.status === "disabled") {
      session.revoked = true;
      return withClearedCookies(
        json(
          {
            error: {
              code: "ADMIN_ACCOUNT_DISABLED",
              message: "The account is disabled.",
            },
          },
          403,
        ),
      );
    }
    // Rotation: both tokens are new, the old refresh token is dead.
    session.accessToken = token();
    session.accessExpiresAt = ctx.now + ACCESS_TTL_SECONDS * 1000;
    session.refreshToken = token();
    session.refreshExpiresAt = Math.min(
      ctx.now + REFRESH_TTL_MS,
      session.absoluteExpiresAt,
    );
    return withSessionCookies(
      json({
        admin: adminView(ctx.db, admin),
        accessTokenExpiresInSeconds: ACCESS_TTL_SECONDS,
      }),
      session,
      ctx.now,
    );
  });

  router.post(`${base}/logout`, { public: true }, (ctx) => {
    const access = readCookie(ctx.request, ACCESS_COOKIE);
    const refresh = readCookie(ctx.request, REFRESH_COOKIE);
    for (const session of ctx.db.sessions) {
      if (
        (access && session.accessToken === access) ||
        (refresh && session.refreshToken === refresh)
      ) {
        session.revoked = true;
      }
    }
    return withClearedCookies(noContent());
  });

  router.post(`${base}/logout-all`, { whilePasswordChange: true }, (ctx) => {
    revokeSessions(ctx.db, ctx.admin.id);
    return withClearedCookies(noContent());
  });

  router.get(`${base}/me`, { whilePasswordChange: true }, (ctx) =>
    json({ admin: adminView(ctx.db, ctx.admin) }),
  );

  router.post(
    `${base}/change-password`,
    { whilePasswordChange: true },
    async (ctx) => {
      const input = await ctx.body(changePasswordBody);
      if (ctx.admin.password !== input.currentPassword) {
        countFailure(ctx.admin, ctx.now);
        throw fail(
          401,
          "ADMIN_CREDENTIALS_INVALID",
          "The current password is wrong.",
        );
      }
      if (input.newPassword === input.currentPassword) {
        throw fail(
          400,
          "VALIDATION_FAILED",
          "The request contains invalid data.",
          [
            {
              field: "newPassword",
              problems: ["newPassword must differ from the current password"],
            },
          ],
        );
      }
      ctx.admin.password = input.newPassword;
      ctx.admin.mustChangePassword = false;
      ctx.admin.updatedAt = iso(ctx.now);
      revokeSessions(ctx.db, ctx.admin.id, ctx.session?.id);
      return noContent();
    },
  );
}
