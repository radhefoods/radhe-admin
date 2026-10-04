// The mock of the Radhe Foods admin API: one function that answers a
// request, in the shapes and with the error codes of
// doc/ADMIN_API_DOCUMENTATION.md. The development server (server.ts), the
// browser tests and the component tests all use this same function.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticate, registerAuth, revokeSessions } from "./auth.ts";
import type { Db } from "./db.ts";
import { HttpError, fail, json, noContent } from "./http.ts";
import { placeholderSvg } from "./media.ts";
import { registerCargos, runCargoCheck } from "./modules/cargos.ts";
import { registerCatalog } from "./modules/catalog.ts";
import { registerCommunication } from "./modules/communication.ts";
import { registerOrders } from "./modules/orders.ts";
import { registerPayments, runPaymentJobs } from "./modules/payments.ts";
import { registerShop } from "./modules/shop.ts";
import { registerTeam } from "./modules/team.ts";
import { Router, bodyReader, checkIds } from "./router.ts";
import { seed } from "./seed.ts";

export interface MockApiOptions {
  /** The address the mock is reached at, for the URLs of pictures. */
  publicUrl?: string;
  /** Origins that may send requests with cookies (the API's CORS_ORIGINS). */
  allowedOrigins?: string[];
  stripe?: boolean;
  whatsapp?: boolean;
  /** A fixed clock, for tests. */
  now?: () => number;
}

export interface MockApi {
  handle: (request: Request) => Promise<Response>;
  /** The data, for tests that look behind the API. */
  db: () => Db;
  /** Back to the demo data. */
  reset: (overrides?: { stripe?: boolean; whatsapp?: boolean }) => void;
  /** What the scheduled jobs of the API do (section 17). */
  runJobs: () => void;
}

function hasPermission(granted: string[], required: string): boolean {
  if (granted.includes("*") || granted.includes(required)) return true;
  return granted.includes(`${required.split(".")[0]}.*`);
}

function isLocalOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function createMockApi(options: MockApiOptions = {}): MockApi {
  const publicUrl = options.publicUrl ?? "http://localhost:3000";
  const clock = options.now ?? Date.now;
  const config = {
    stripe: options.stripe ?? false,
    whatsapp: options.whatsapp ?? false,
  };
  const fresh = () => seed({ ...config, publicUrl, now: clock() });
  let db = fresh();

  const router = new Router();
  registerAuth(router);
  registerTeam(router);
  registerShop(router);
  registerCatalog(router);
  registerCargos(router);
  registerOrders(router);
  registerPayments(router);
  registerCommunication(router);

  const originAllowed = (origin: string) =>
    (options.allowedOrigins ?? []).includes(origin) ||
    (options.allowedOrigins === undefined && isLocalOrigin(origin));

  function withCors(
    response: Response,
    request: Request,
    requestId: string,
  ): Response {
    const origin = request.headers.get("origin");
    response.headers.set("x-request-id", requestId);
    if (origin && originAllowed(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
      response.headers.set("Access-Control-Expose-Headers", "X-Request-Id");
      response.headers.append("Vary", "Origin");
    }
    return response;
  }

  /** Switches of the mock itself. Not part of the API. */
  async function control(
    path: string,
    request: Request,
  ): Promise<Response | null> {
    if (!path.startsWith("/__mock/")) return null;
    if (request.method !== "POST") return json({ ok: false }, 405);
    if (path === "/__mock/reset") {
      const body = z
        .object({
          stripe: z.boolean().optional(),
          whatsapp: z.boolean().optional(),
        })
        .parse(await request.json().catch(() => ({})));
      if (body.stripe !== undefined) config.stripe = body.stripe;
      if (body.whatsapp !== undefined) config.whatsapp = body.whatsapp;
      db = fresh();
      return json({ ok: true });
    }
    if (path === "/__mock/config") {
      const body = z
        .object({
          stripe: z.boolean().optional(),
          whatsapp: z.boolean().optional(),
        })
        .parse(await request.json().catch(() => ({})));
      if (body.stripe !== undefined)
        config.stripe = db.config.stripe = body.stripe;
      if (body.whatsapp !== undefined)
        config.whatsapp = db.config.whatsapp = body.whatsapp;
      return json({ ok: true, config: db.config });
    }
    // The access token of every session is over: the next call must refresh.
    if (path === "/__mock/expire-access") {
      for (const session of db.sessions) session.accessExpiresAt = 0;
      return json({ ok: true });
    }
    // Every session is over, as after 12 hours without use.
    if (path === "/__mock/expire-sessions") {
      for (const session of db.sessions) {
        session.accessExpiresAt = 0;
        session.refreshExpiresAt = 0;
      }
      return json({ ok: true });
    }
    // Signed out everywhere, as after a role change.
    if (path === "/__mock/revoke-sessions") {
      for (const admin of db.admins) revokeSessions(db, admin.id);
      return json({ ok: true });
    }
    return json({ ok: false }, 404);
  }

  function media(path: string): Response | null {
    const placeholder = /^\/media\/placeholder\/(\d+)\/(\d+)\/(.+)\.svg$/.exec(
      path,
    );
    if (placeholder) {
      return new Response(
        placeholderSvg(
          Number(placeholder[1]),
          Number(placeholder[2]),
          decodeURIComponent(placeholder[3] ?? ""),
        ),
        {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        },
      );
    }
    const upload = /^\/media\/upload\/([0-9a-f]{24})$/.exec(path);
    const file = upload ? db.files.get(upload[1] ?? "") : undefined;
    if (file) {
      return new Response(file.bytes as unknown as BodyInit, {
        headers: {
          "Content-Type": file.type,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }
    return null;
  }

  async function answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const now = clock();

    if (path === "/health" || path === "/health/live") {
      return json(
        path === "/health"
          ? { status: "ok", database: "up", uptimeSeconds: 1 }
          : { status: "ok" },
      );
    }
    if (request.method === "GET" && path.startsWith("/media/")) {
      const file = media(path);
      if (file) return file;
    }
    const controlled = await control(path, request);
    if (controlled) return controlled;

    const match = router.match(request.method, path);
    if (!match)
      throw fail(404, "NOT_FOUND", `Cannot ${request.method} ${path}`);

    // A change must come from an origin the API knows (0.3).
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && origin && !originAllowed(origin)) {
      throw fail(
        403,
        "ORIGIN_NOT_ALLOWED",
        "Requests from this origin are not allowed.",
      );
    }

    const { route, params } = match;
    const base = {
      db,
      request,
      query: url.searchParams,
      params,
      body: bodyReader(request),
      now,
    };

    if (route.public) {
      checkIds(params);
      // Public routes never read `admin`.
      return route.handler({
        ...base,
        admin: undefined as never,
        session: null,
      });
    }

    const { admin, session } = authenticate(db, request, now);
    if (admin.mustChangePassword && !route.whilePasswordChange) {
      throw fail(
        403,
        "ADMIN_PASSWORD_CHANGE_REQUIRED",
        "Change your password first.",
      );
    }
    if (route.permission) {
      const granted =
        db.roles.find((role) => role.id === admin.roleId)?.permissions ?? [];
      if (!hasPermission(granted, route.permission)) {
        throw fail(
          403,
          "ADMIN_PERMISSION_DENIED",
          "You do not have permission to do this.",
          {
            required: [route.permission],
          },
        );
      }
    }
    checkIds(params);
    return route.handler({ ...base, admin, session });
  }

  async function handle(request: Request): Promise<Response> {
    const given = request.headers.get("x-request-id");
    const requestId =
      given && /^[A-Za-z0-9_-]{8,64}$/.test(given) ? given : randomUUID();

    if (request.method === "OPTIONS") {
      const response = noContent();
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      );
      response.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Request-Id",
      );
      response.headers.set("Access-Control-Max-Age", "600");
      return withCors(response, request, requestId);
    }

    try {
      return withCors(await answer(request), request, requestId);
    } catch (error) {
      if (error instanceof HttpError) {
        return withCors(
          json(
            {
              error: {
                code: error.code,
                message: error.message,
                ...(error.details === undefined
                  ? {}
                  : { details: error.details }),
              },
              requestId,
            },
            error.status,
          ),
          request,
          requestId,
        );
      }
      console.error("[mock] unexpected error", error);
      return withCors(
        json(
          {
            error: {
              code: "INTERNAL_ERROR",
              message: "The mock failed. See its log.",
            },
            requestId,
          },
          500,
        ),
        request,
        requestId,
      );
    }
  }

  return {
    handle,
    db: () => db,
    reset(overrides) {
      if (overrides?.stripe !== undefined) config.stripe = overrides.stripe;
      if (overrides?.whatsapp !== undefined)
        config.whatsapp = overrides.whatsapp;
      db = fresh();
    },
    runJobs() {
      runCargoCheck(db, clock());
      runPaymentJobs(db, clock());
    },
  };
}
