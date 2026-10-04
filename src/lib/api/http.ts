import { ApiError } from "./errors";

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as `multipart/form-data` (image uploads). */
  formData?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Calls the API and returns the parsed answer (`undefined` for 204). */
export type Requester = <T>(
  path: string,
  options?: RequestOptions,
) => Promise<T>;

export interface TransportConfig {
  /** Without a trailing slash and without `/v1`. */
  baseUrl: string;
  fetch?: typeof fetch;
}

/** Empty values are left out: the API counts an empty string as not given. */
export function buildUrl(
  baseUrl: string,
  path: string,
  query: Query = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `${baseUrl}${path}${search ? `?${search}` : ""}`;
}

/** Reads the API's error format (0.3) from a parsed body. */
export function apiErrorFrom(
  status: number,
  payload: unknown,
  headerRequestId: string | null,
): ApiError {
  const body = payload as
    | {
        error?: { code?: unknown; message?: unknown; details?: unknown };
        requestId?: unknown;
      }
    | null
    | undefined;
  if (body?.error && typeof body.error.code === "string") {
    return new ApiError({
      status,
      code: body.error.code,
      message:
        typeof body.error.message === "string"
          ? body.error.message
          : body.error.code,
      details: body.error.details,
      requestId:
        typeof body.requestId === "string" ? body.requestId : headerRequestId,
    });
  }
  return new ApiError({
    status,
    code: "UNEXPECTED_RESPONSE",
    message: `The API answered ${status} without an error body.`,
    requestId: headerRequestId,
  });
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  return apiErrorFrom(
    response.status,
    payload,
    response.headers.get("x-request-id"),
  );
}

/**
 * One HTTP call to the API, with the session cookies (0.4). Returns the raw
 * `Response` when it is 2xx and throws an `ApiError` otherwise, also when
 * the API cannot be reached.
 */
export async function send(
  config: TransportConfig,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    credentials: "include",
    signal: options.signal,
    cache: "no-store",
  };
  if (options.formData) {
    // The browser sets the content type with its boundary.
    init.body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(
      buildUrl(config.baseUrl, path, options.query),
      init,
    );
  } catch (cause) {
    // A cancelled request is not an error of the API: let the caller see it.
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw cause;
    }
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "The API could not be reached.",
    });
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function parseJson<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({
      status: response.status,
      code: "UNEXPECTED_RESPONSE",
      message: "The API answered with something that is not JSON.",
      requestId: response.headers.get("x-request-id"),
    });
  }
}
