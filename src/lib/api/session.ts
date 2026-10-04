import { ApiError, hasErrorCode, isApiError } from "./errors";
import {
  apiErrorFrom,
  buildUrl,
  parseJson,
  send,
  type Query,
  type RequestOptions,
  type Requester,
  type TransportConfig,
} from "./http";

const REFRESH_PATH = "/v1/admin/auth/refresh";

/** These calls carry no access token: a 401 from them is their own answer. */
const WITHOUT_SESSION = [
  "/v1/admin/auth/login",
  "/v1/admin/auth/mfa/",
  "/v1/admin/auth/refresh",
  "/v1/admin/auth/logout",
];

const REFRESH_LOCK = "rf.admin.refresh";
const REFRESH_STAMP = "rf.admin.refreshed-at";

export type SessionEndReason = "expired" | "revoked" | "disabled";

export interface UploadOptions {
  method?: "POST" | "PUT";
  formData: FormData;
  query?: Query;
  /** 0 to 1, while the file travels to the API. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface SessionTransport {
  /** JSON calls with refresh-and-retry. */
  request: Requester;
  /** The raw answer (for the invoice PDF), with the same session handling. */
  raw: (path: string, options?: RequestOptions) => Promise<Response>;
  /** A multipart upload that reports its progress. */
  upload: <T>(path: string, options: UploadOptions) => Promise<T>;
  /**
   * Asks for a new access cookie. Resolves `true` when the session lives on,
   * `false` when it is over. Calls made at the same time share one request.
   */
  refresh: () => Promise<boolean>;
  /** The session turned out to be over. */
  onSessionEnded: (listener: (reason: SessionEndReason) => void) => () => void;
  /** The API allows nothing but a password change (1.9). */
  onPasswordChangeRequired: (listener: () => void) => () => void;
  /** A call was refused for a missing permission: the role may have changed. */
  onPermissionDenied: (listener: () => void) => () => void;
}

interface SessionEnvironment {
  /** Runs `task` while no other tab of this browser runs one. */
  withLock: <T>(task: () => Promise<T>) => Promise<T>;
  /** When any tab last refreshed successfully, in ms since the epoch. */
  readStamp: () => number | null;
  writeStamp: (time: number) => void;
  now: () => number;
  createXhr: () => XMLHttpRequest;
}

function browserEnvironment(): SessionEnvironment {
  return {
    withLock: async <T>(task: () => Promise<T>): Promise<T> => {
      const locks =
        typeof navigator !== "undefined" ? navigator.locks : undefined;
      if (!locks) return task();
      return (await locks.request(REFRESH_LOCK, task)) as T;
    },
    readStamp: () => {
      try {
        const value = Number(window.localStorage.getItem(REFRESH_STAMP));
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch {
        return null;
      }
    },
    writeStamp: (time) => {
      try {
        window.localStorage.setItem(REFRESH_STAMP, String(time));
      } catch {
        // Storage is blocked: the tabs refresh one after another anyway.
      }
    },
    now: () => Date.now(),
    createXhr: () => new XMLHttpRequest(),
  };
}

function needsSession(path: string): boolean {
  return !WITHOUT_SESSION.some((prefix) => path.startsWith(prefix));
}

/**
 * The browser's way to the API (0.4): cookies travel with every call; on
 * `401 AUTH_TOKEN_INVALID` the refresh endpoint is asked once and the call
 * is repeated; a refused refresh, a revoked session or a disabled account
 * end the session.
 *
 * Refresh tokens rotate, and a refresh that loses the rotation is answered
 * with cleared cookies. So refreshes are never run side by side: calls of
 * one tab share one refresh, and tabs of one browser take turns (Web
 * Locks). A tab that waited for another tab's refresh does not refresh
 * again: the new cookies are its own as well.
 */
export function createSessionTransport(
  config: TransportConfig,
  environment: Partial<SessionEnvironment> = {},
): SessionTransport {
  const env = { ...browserEnvironment(), ...environment };
  const ended = new Set<(reason: SessionEndReason) => void>();
  const passwordChange = new Set<() => void>();
  const denied = new Set<() => void>();
  let refreshing: Promise<boolean> | null = null;

  function end(reason: SessionEndReason): void {
    for (const listener of ended) listener(reason);
  }

  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      const askedAt = env.now();
      try {
        return await env.withLock(async () => {
          const stamp = env.readStamp();
          if (stamp !== null && stamp >= askedAt) return true;
          try {
            await send(config, REFRESH_PATH, { method: "POST" });
            env.writeStamp(env.now());
            return true;
          } catch (error) {
            if (hasErrorCode(error, "AUTH_REFRESH_INVALID")) {
              end("expired");
              return false;
            }
            if (hasErrorCode(error, "ADMIN_ACCOUNT_DISABLED")) {
              end("disabled");
              return false;
            }
            // The network failed or the API is down: the session may well
            // be alive. Report the failure of this call, keep the session.
            throw error;
          }
        });
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /** What an error means for the session, apart from the call itself. */
  function watch(error: unknown, path: string): void {
    if (!isApiError(error) || !needsSession(path)) return;
    if (error.code === "AUTH_SESSION_REVOKED") end("revoked");
    else if (error.code === "ADMIN_ACCOUNT_DISABLED") end("disabled");
    else if (error.code === "ADMIN_PASSWORD_CHANGE_REQUIRED") {
      for (const listener of passwordChange) listener();
    } else if (error.code === "ADMIN_PERMISSION_DENIED") {
      for (const listener of denied) listener();
    }
  }

  async function withSession<T>(
    path: string,
    attempt: () => Promise<T>,
  ): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      const expired =
        hasErrorCode(error, "AUTH_TOKEN_INVALID") && needsSession(path);
      if (!expired) {
        watch(error, path);
        throw error;
      }
      const alive = await refresh();
      if (!alive) throw error;
      try {
        return await attempt();
      } catch (second) {
        watch(second, path);
        throw second;
      }
    }
  }

  function raw(path: string, options?: RequestOptions): Promise<Response> {
    return withSession(path, () => send(config, path, options));
  }

  function uploadOnce<T>(path: string, options: UploadOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = env.createXhr();
      xhr.open(
        options.method ?? "POST",
        buildUrl(config.baseUrl, path, options.query),
      );
      xhr.withCredentials = true;
      xhr.responseType = "text";
      xhr.setRequestHeader("Accept", "application/json");

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          options.onProgress?.(event.loaded / event.total);
        }
      };
      xhr.onerror = () =>
        reject(
          new ApiError({
            status: 0,
            code: "NETWORK_ERROR",
            message: "The API could not be reached.",
          }),
        );
      xhr.onabort = () =>
        reject(
          new ApiError({
            status: 0,
            code: "UPLOAD_ABORTED",
            message: "The upload was stopped.",
          }),
        );
      xhr.onload = () => {
        let payload: unknown;
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
        } catch {
          payload = undefined;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          options.onProgress?.(1);
          resolve(payload as T);
          return;
        }
        reject(
          apiErrorFrom(
            xhr.status,
            payload,
            xhr.getResponseHeader("x-request-id"),
          ),
        );
      };

      if (options.signal) {
        if (options.signal.aborted) {
          reject(
            new ApiError({
              status: 0,
              code: "UPLOAD_ABORTED",
              message: "The upload was stopped.",
            }),
          );
          return;
        }
        options.signal.addEventListener("abort", () => xhr.abort(), {
          once: true,
        });
      }
      xhr.send(options.formData);
    });
  }

  return {
    raw,
    refresh,
    request: async <T>(path: string, options?: RequestOptions) =>
      parseJson<T>(await raw(path, options)),
    upload: <T>(path: string, options: UploadOptions) =>
      withSession(path, () => uploadOnce<T>(path, options)),
    onSessionEnded(listener) {
      ended.add(listener);
      return () => ended.delete(listener);
    },
    onPasswordChangeRequired(listener) {
      passwordChange.add(listener);
      return () => passwordChange.delete(listener);
    },
    onPermissionDenied(listener) {
      denied.add(listener);
      return () => denied.delete(listener);
    },
  };
}
