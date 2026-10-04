// The routes of the mock and what guards them, in the order of the API
// (0.3): authentication, the pending password change, the permission, and
// only then validation.

import type { z } from "zod";
import type { AdminRecord, Db, SessionRecord } from "./db.ts";
import { OBJECT_ID, fail, parse, readJson, validationFailed } from "./http.ts";

export interface Ctx {
  db: Db;
  request: Request;
  query: URLSearchParams;
  params: Record<string, string>;
  /** The signed-in admin. Unset on public routes. */
  admin: AdminRecord;
  session: SessionRecord | null;
  /** The JSON body, checked strictly: unknown fields are refused. */
  body: <S extends z.ZodType>(schema: S) => Promise<z.output<S>>;
  now: number;
}

export type Handler = (ctx: Ctx) => Response | Promise<Response>;

export interface RouteOptions {
  /** `orders.manage`. Without it, any signed-in admin may call the route. */
  permission?: string;
  /** No session needed (login, refresh, logout). */
  public?: boolean;
  /** Allowed while the admin must change the password (1.9). */
  whilePasswordChange?: boolean;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Route extends RouteOptions {
  method: Method;
  segments: string[];
  handler: Handler;
}

export interface Match {
  route: Route;
  params: Record<string, string>;
}

export class Router {
  private readonly routes: Route[] = [];

  private add(
    method: Method,
    pattern: string,
    options: RouteOptions,
    handler: Handler,
  ): void {
    this.routes.push({
      method,
      segments: pattern.split("/").filter(Boolean),
      handler,
      ...options,
    });
  }

  get(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("GET", pattern, options, handler);
  }
  post(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("POST", pattern, options, handler);
  }
  put(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("PUT", pattern, options, handler);
  }
  patch(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("PATCH", pattern, options, handler);
  }
  delete(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("DELETE", pattern, options, handler);
  }

  /** A fixed segment wins over a parameter (`/cargos/overview` before `/cargos/:id`). */
  match(method: string, path: string): Match | null {
    const parts = path.split("/").filter(Boolean);
    let best: { match: Match; fixed: number } | null = null;
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let fixed = 0;
      let fits = true;
      for (let index = 0; index < parts.length; index += 1) {
        const segment = route.segments[index] ?? "";
        const part = parts[index] ?? "";
        if (segment.startsWith(":")) params[segment.slice(1)] = part;
        else if (segment === part) fixed += 1;
        else {
          fits = false;
          break;
        }
      }
      if (fits && (!best || fixed > best.fixed)) {
        best = { match: { route, params }, fixed };
      }
    }
    return best?.match ?? null;
  }
}

/** A malformed `:id` in the address (0.3). */
export function checkIds(params: Record<string, string>): void {
  for (const [name, value] of Object.entries(params)) {
    const isId = name === "id" || name.endsWith("Id");
    if (isId && !OBJECT_ID.test(value)) {
      throw fail(400, "VALIDATION_FAILED", "The id in the URL is not valid.", [
        { field: name, problems: ["The id in the URL is not valid."] },
      ]);
    }
  }
}

export function bodyReader(request: Request): Ctx["body"] {
  let cached: Promise<unknown> | null = null;
  return async (schema) => {
    cached ??= readJson(request);
    const raw = await cached;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw validationFailed([
        { field: "body", problems: ["The body must be an object."] },
      ]);
    }
    return parse(schema, raw);
  };
}
