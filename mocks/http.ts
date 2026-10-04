// The HTTP vocabulary of the mock: errors in the API's format (0.3),
// ids, and the strict validation of request bodies (0.2).

import { z } from "zod";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): HttpError {
  return new HttpError(status, code, message, details);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export const OBJECT_ID = /^[0-9a-f]{24}$/;

let counter = 0;

/**
 * A 24-hex id that sorts by its time, like an ObjectId: lists are "newest
 * first" by id, and a cursor is the id of the last row of a page.
 */
export function newId(at: Date | number = Date.now()): string {
  const seconds = Math.floor((at instanceof Date ? at.getTime() : at) / 1000);
  counter = (counter + 1) % 0xffffff;
  return (
    seconds.toString(16).padStart(8, "0") +
    "a1b2c3d4e5" +
    counter.toString(16).padStart(6, "0")
  );
}

/** Trims strings; an empty optional string counts as not provided (0.2). */
function clean(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = clean(entry);
      if (cleaned === "") continue;
      result[key] = cleaned;
    }
    return result;
  }
  return value;
}

export function validationFailed(
  problems: { field: string; problems: string[] }[],
): HttpError {
  return fail(
    400,
    "VALIDATION_FAILED",
    "The request contains invalid data.",
    problems,
  );
}

/** Parses with a zod schema and answers `VALIDATION_FAILED` like the API. */
export function parse<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.output<S> {
  const result = schema.safeParse(clean(input));
  if (result.success) return result.data;
  const byField = new Map<string, string[]>();
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const field = [...issue.path, key].join(".");
        byField.set(field, [`property ${key} should not exist`]);
      }
      continue;
    }
    const field = issue.path.join(".") || "body";
    byField.set(field, [...(byField.get(field) ?? []), issue.message]);
  }
  throw validationFailed(
    [...byField].map(([field, problems]) => ({ field, problems })),
  );
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw fail(400, "BAD_REQUEST", "The body is not valid JSON.");
  }
}

// --- Schema pieces shared by the modules -----------------------------------

export const zId = z.string().regex(OBJECT_ID, "must be a mongodb id");
export const zCents = (min: number, max = 10_000_000) =>
  z.number().int().min(min).max(max);
export const zNote = (max: number) => z.string().max(max).optional();
export const zIds = (max: number) => z.array(zId).max(max).optional();

export const zTranslated = (max: number) =>
  z.strictObject({
    en: z.string().min(1).max(max),
    de: z.string().max(max).nullish(),
  });
export const zTranslatedOptional = (max: number) =>
  z.strictObject({
    en: z.string().max(max).nullish(),
    de: z.string().max(max).nullish(),
  });

/** Query values: `?limit=25&cursor=…` (0.8). */
export function cursorQuery(query: URLSearchParams): {
  limit: number;
  cursor: string | null;
} {
  const limit = intParam(query, "limit", 25, 1, 100);
  const cursor = query.get("cursor");
  if (cursor !== null && !OBJECT_ID.test(cursor)) {
    throw validationFailed([
      { field: "cursor", problems: ["cursor must be a mongodb id"] },
    ]);
  }
  return { limit, cursor };
}

export function pageQuery(
  query: URLSearchParams,
  defaultLimit = 24,
): { page: number; limit: number } {
  return {
    page: intParam(query, "page", 1, 1, 500),
    limit: intParam(query, "limit", defaultLimit, 1, 100),
  };
}

export function intParam(
  query: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = query.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw validationFailed([
      {
        field: name,
        problems: [`${name} must be an integer from ${min} to ${max}`],
      },
    ]);
  }
  return value;
}

export function enumParam<T extends string>(
  query: URLSearchParams,
  name: string,
  values: readonly T[],
): T | undefined {
  const raw = query.get(name);
  if (raw === null || raw === "") return undefined;
  if (!(values as readonly string[]).includes(raw)) {
    throw validationFailed([
      {
        field: name,
        problems: [
          `${name} must be one of the following values: ${values.join(", ")}`,
        ],
      },
    ]);
  }
  return raw as T;
}

export function boolParam(
  query: URLSearchParams,
  name: string,
): boolean | undefined {
  const raw = query.get(name);
  if (raw === null || raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw validationFailed([
    { field: name, problems: [`${name} must be a boolean value`] },
  ]);
}

export function idParam(
  query: URLSearchParams,
  name: string,
): string | undefined {
  const raw = query.get(name);
  if (raw === null || raw === "") return undefined;
  if (!OBJECT_ID.test(raw)) {
    throw validationFailed([
      { field: name, problems: [`${name} must be a mongodb id`] },
    ]);
  }
  return raw;
}

/** One page of a list that is sorted newest first by id (0.8). */
export function cursorPage<T extends { id: string }>(
  rows: T[],
  query: URLSearchParams,
): { items: T[]; nextCursor: string | null } {
  const { limit, cursor } = cursorQuery(query);
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1));
  const rest = cursor ? sorted.filter((row) => row.id < cursor) : sorted;
  const items = rest.slice(0, limit);
  return {
    items,
    nextCursor:
      rest.length > limit ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export function page<T>(
  rows: T[],
  query: URLSearchParams,
  defaultLimit = 24,
): {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
} {
  const { page: number, limit } = pageQuery(query, defaultLimit);
  const total = rows.length;
  return {
    items: rows.slice((number - 1) * limit, number * limit),
    page: number,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
