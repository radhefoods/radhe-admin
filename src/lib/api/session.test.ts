import { describe, expect, it, vi } from "vitest";
import { ERROR_TEXT, describeError, errorMessage } from "./error-text";
import {
  API_ERROR_CODES,
  ApiError,
  fieldProblems,
  hasErrorCode,
  isRetryable,
  isSessionError,
  isUnexpectedError,
} from "./errors";
import { buildUrl } from "./http";
import { createSessionTransport, type SessionEndReason } from "./session";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "req-12345678",
    },
  });
}

/** The error a call fails with. */
const failure = (call: Promise<unknown>): Promise<ApiError> =>
  call.then(
    () => {
      throw new Error("The call was expected to fail.");
    },
    (error: unknown) => error as ApiError,
  );

const apiError = (status: number, code: string, details?: unknown) =>
  json(status, {
    error: { code, message: `${code} happened`, details },
    requestId: "req-12345678",
  });

/** A transport whose `fetch` answers from a list, in order. */
function transportWith(
  answers: (Response | (() => Response))[],
  environment: Parameters<typeof createSessionTransport>[1] = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...answers];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error(`No answer left for ${String(url)}`);
    return typeof next === "function" ? next() : next;
  });
  let stamp: number | null = null;
  const transport = createSessionTransport(
    { baseUrl: "http://api.test", fetch: fetch as typeof globalThis.fetch },
    {
      withLock: (task) => task(),
      readStamp: () => stamp,
      writeStamp: (time) => {
        stamp = time;
      },
      ...environment,
    },
  );
  return { transport, calls, fetch };
}

describe("every call", () => {
  it("travels with the session cookies and without a cache", async () => {
    const { transport, calls } = transportWith([json(200, { ok: true })]);
    await transport.request("/v1/admin/orders", {
      query: { status: "delivered", limit: 25 },
    });
    expect(calls[0]?.url).toBe(
      "http://api.test/v1/admin/orders?status=delivered&limit=25",
    );
    expect(calls[0]?.init.credentials).toBe("include");
    expect(calls[0]?.init.cache).toBe("no-store");
  });

  it("sends JSON bodies as JSON and leaves empty query values out", async () => {
    const { transport, calls } = transportWith([json(200, {})]);
    await transport.request("/v1/admin/x", {
      method: "POST",
      body: { amount: 1999 },
      query: { a: "", b: undefined, c: null, d: false },
    });
    expect(calls[0]?.url).toBe("http://api.test/v1/admin/x?d=false");
    expect(calls[0]?.init.body).toBe('{"amount":1999}');
    expect(
      (calls[0]?.init.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/json");
  });

  it("answers `undefined` for 204", async () => {
    const { transport } = transportWith([new Response(null, { status: 204 })]);
    await expect(
      transport.request("/v1/admin/x", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });

  it("turns the API's error format into an ApiError", async () => {
    const { transport } = transportWith([
      apiError(409, "CARGO_ANOTHER_TAKING_ORDERS", {
        cargo: "RF-C027",
        id: "x",
      }),
    ]);
    const error = await failure(transport.request("/v1/admin/cargos/1/open"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("CARGO_ANOTHER_TAKING_ORDERS");
    expect(error.details).toEqual({ cargo: "RF-C027", id: "x" });
    expect(error.requestId).toBe("req-12345678");
  });

  it("reports an unreachable API as NETWORK_ERROR", async () => {
    const { transport } = transportWith([
      () => {
        throw new TypeError("Failed to fetch");
      },
    ]);
    const error = await failure(transport.request("/v1/admin/orders"));
    expect(hasErrorCode(error, "NETWORK_ERROR")).toBe(true);
    expect(error.status).toBe(0);
  });

  it("keeps a code it does not know and reports it as unexpected", async () => {
    const { transport } = transportWith([apiError(418, "TEAPOT_BREWING")]);
    const error = await failure(transport.request("/v1/admin/x"));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.rawCode).toBe("TEAPOT_BREWING");
    expect(isUnexpectedError(error)).toBe(true);
  });
});

describe("refresh and retry (documentation, 0.4)", () => {
  it("refreshes once on an expired access token and repeats the call", async () => {
    const { transport, calls } = transportWith([
      apiError(401, "AUTH_TOKEN_INVALID"),
      json(200, { admin: {} }),
      json(200, { items: [1] }),
    ]);
    await expect(transport.request("/v1/admin/orders")).resolves.toEqual({
      items: [1],
    });
    expect(
      calls.map((call) => call.url.replace("http://api.test", "")),
    ).toEqual([
      "/v1/admin/orders",
      "/v1/admin/auth/refresh",
      "/v1/admin/orders",
    ]);
    expect(calls[1]?.init.method).toBe("POST");
  });

  it("refreshes for `me` as well, which lives under /auth", async () => {
    const { transport, calls } = transportWith([
      apiError(401, "AUTH_TOKEN_INVALID"),
      json(200, { admin: {} }),
      json(200, { admin: { id: "1" } }),
    ]);
    await transport.request("/v1/admin/auth/me");
    expect(calls).toHaveLength(3);
  });

  it("ends the session when the refresh is refused", async () => {
    const { transport, calls } = transportWith([
      apiError(401, "AUTH_TOKEN_INVALID"),
      apiError(401, "AUTH_REFRESH_INVALID"),
    ]);
    const ended: SessionEndReason[] = [];
    transport.onSessionEnded((reason) => ended.push(reason));
    const error = await failure(transport.request("/v1/admin/orders"));
    expect(hasErrorCode(error, "AUTH_TOKEN_INVALID")).toBe(true);
    expect(ended).toEqual(["expired"]);
    expect(calls).toHaveLength(2);
  });

  it("does not refresh for a revoked session: no refresh will help", async () => {
    const { transport, calls } = transportWith([
      apiError(401, "AUTH_SESSION_REVOKED"),
    ]);
    const ended: SessionEndReason[] = [];
    transport.onSessionEnded((reason) => ended.push(reason));
    await transport.request("/v1/admin/orders").catch(() => undefined);
    expect(calls).toHaveLength(1);
    expect(ended).toEqual(["revoked"]);
  });

  it("never refreshes for the sign-in itself", async () => {
    const { transport, calls } = transportWith([
      apiError(401, "ADMIN_CREDENTIALS_INVALID"),
    ]);
    const ended: SessionEndReason[] = [];
    transport.onSessionEnded((reason) => ended.push(reason));
    const error = await failure(
      transport.request("/v1/admin/auth/login", { method: "POST", body: {} }),
    );
    expect(hasErrorCode(error, "ADMIN_CREDENTIALS_INVALID")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(ended).toEqual([]);
  });

  it("keeps the session when the refresh fails for another reason", async () => {
    const { transport } = transportWith([
      apiError(401, "AUTH_TOKEN_INVALID"),
      apiError(503, "SERVICE_UNAVAILABLE"),
    ]);
    const ended: SessionEndReason[] = [];
    transport.onSessionEnded((reason) => ended.push(reason));
    const error = await failure(transport.request("/v1/admin/orders"));
    expect(hasErrorCode(error, "SERVICE_UNAVAILABLE")).toBe(true);
    expect(ended).toEqual([]);
  });

  it("shares one refresh between calls that fail at the same time", async () => {
    // Refresh tokens rotate: a second refresh would lose and clear the cookies.
    let refreshes = 0;
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url).replace("http://api.test", "");
      if (path === "/v1/admin/auth/refresh") {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return json(200, { admin: {} });
      }
      return refreshes === 0
        ? apiError(401, "AUTH_TOKEN_INVALID")
        : json(200, { path });
    });
    const transport = createSessionTransport(
      { baseUrl: "http://api.test", fetch: fetch as typeof globalThis.fetch },
      {
        withLock: (task) => task(),
        readStamp: () => null,
        writeStamp: () => undefined,
      },
    );
    const results = await Promise.all([
      transport.request("/v1/admin/a"),
      transport.request("/v1/admin/b"),
      transport.request("/v1/admin/c"),
    ]);
    expect(refreshes).toBe(1);
    expect(results).toEqual([
      { path: "/v1/admin/a" },
      { path: "/v1/admin/b" },
      { path: "/v1/admin/c" },
    ]);
  });

  it("does not refresh again when another tab did so while this one waited", async () => {
    let time = 1000;
    const { transport, calls } = transportWith(
      [apiError(401, "AUTH_TOKEN_INVALID"), json(200, { items: [] })],
      {
        now: () => time,
        // While this tab waits for the lock, another tab refreshes at 1500.
        withLock: async (task) => {
          time = 1600;
          return task();
        },
        readStamp: () => 1500,
        writeStamp: () => undefined,
      },
    );
    await transport.request("/v1/admin/orders");
    expect(calls.map((call) => call.url)).toEqual([
      "http://api.test/v1/admin/orders",
      "http://api.test/v1/admin/orders",
    ]);
  });

  it("refreshes when the last refresh of any tab is older than the failure", async () => {
    const { transport, calls } = transportWith(
      [apiError(401, "AUTH_TOKEN_INVALID"), json(200, {}), json(200, {})],
      { now: () => 5000, readStamp: () => 1500, writeStamp: () => undefined },
    );
    await transport.request("/v1/admin/orders");
    expect(calls).toHaveLength(3);
  });
});

describe("what an error means for the session", () => {
  it("tells that a password change is required (1.9)", async () => {
    const { transport } = transportWith([
      apiError(403, "ADMIN_PASSWORD_CHANGE_REQUIRED"),
    ]);
    const listener = vi.fn();
    transport.onPasswordChangeRequired(listener);
    await transport.request("/v1/admin/orders").catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("tells that a permission was missing, so the role is read again", async () => {
    const { transport } = transportWith([
      apiError(403, "ADMIN_PERMISSION_DENIED", { required: ["orders.manage"] }),
    ]);
    const listener = vi.fn();
    transport.onPermissionDenied(listener);
    const error = await failure(transport.request("/v1/admin/orders"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(errorMessage(error)).toBe(
      "Your role does not allow this. It needs: orders.manage.",
    );
  });

  it("ends the session of a disabled account", async () => {
    const { transport } = transportWith([
      apiError(403, "ADMIN_ACCOUNT_DISABLED"),
    ]);
    const ended: SessionEndReason[] = [];
    transport.onSessionEnded((reason) => ended.push(reason));
    await transport.request("/v1/admin/orders").catch(() => undefined);
    expect(ended).toEqual(["disabled"]);
  });

  it("stops listening when asked", async () => {
    const { transport } = transportWith([
      apiError(401, "AUTH_SESSION_REVOKED"),
    ]);
    const listener = vi.fn();
    const off = transport.onSessionEnded(listener);
    off();
    await transport.request("/v1/admin/orders").catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it("has a sentence for every documented code", () => {
    for (const code of API_ERROR_CODES) {
      expect(ERROR_TEXT[code], code).toBeTruthy();
      expect(ERROR_TEXT[code].length, code).toBeGreaterThan(10);
    }
  });

  it("sorts validation problems by field", () => {
    const error = new ApiError({
      status: 400,
      code: "VALIDATION_FAILED",
      message: "invalid",
      details: [
        { field: "tiers.0.fee", problems: ["fee must not be less than 0"] },
        {
          field: "name.en",
          problems: ["en should not be empty", "en must be a string"],
        },
        { nonsense: true },
      ],
    });
    expect(fieldProblems(error)).toEqual({
      "tiers.0.fee": ["fee must not be less than 0"],
      "name.en": ["en should not be empty", "en must be a string"],
    });
    expect(fieldProblems(new Error("other"))).toEqual({});
  });

  it("shows the request id only for errors nobody expected", () => {
    const expected = new ApiError({
      status: 409,
      code: "ORDER_CHANGED_MEANWHILE",
      message: "changed",
      requestId: "req-1",
    });
    expect(describeError(expected)).toEqual({
      message: ERROR_TEXT.ORDER_CHANGED_MEANWHILE,
      technical: null,
      requestId: null,
    });
    const unexpected = new ApiError({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Cannot read properties of undefined",
      requestId: "req-2",
    });
    expect(describeError(unexpected)).toEqual({
      message: ERROR_TEXT.INTERNAL_ERROR,
      technical: "INTERNAL_ERROR: Cannot read properties of undefined",
      requestId: "req-2",
    });
  });

  it("puts the numbers of the details into the sentence", () => {
    const withDetails = (code: string, details: unknown, status = 409) =>
      errorMessage(new ApiError({ status, code, message: code, details }));
    expect(
      withDetails("ADMIN_ACCOUNT_LOCKED", { retryAfterSeconds: 840 }, 429),
    ).toContain("about 14 minutes");
    expect(
      withDetails(
        "PAYMENT_AMOUNT_MISMATCH",
        { amountDue: 3193, amount: 3000 },
        400,
      ),
    ).toContain("€31.93");
    expect(
      withDetails("COMPANY_DETAILS_MISSING", {
        missing: ["email", "vatId or taxNumber"],
      }),
    ).toContain("email, vatId or taxNumber");
    expect(
      withDetails("ORDER_TRANSITION_NOT_ALLOWED", {
        from: "delivered",
        to: "preparing",
        allowed: ["dispatched"],
      }),
    ).toBe('From "delivered" this step is not possible. Possible: dispatched.');
    expect(
      withDetails("CARGO_ANOTHER_TAKING_ORDERS", { cargo: "RF-C027", id: "1" }),
    ).toContain("RF-C027");
    expect(withDetails("REFUND_AMOUNT_INVALID", { maximum: 499 }, 400)).toBe(
      "At most €4.99 can be refunded.",
    );
  });

  it("knows which errors are worth another try", () => {
    const of = (status: number, code: string) =>
      new ApiError({ status, code, message: code });
    expect(isRetryable(of(0, "NETWORK_ERROR"))).toBe(true);
    expect(isRetryable(of(429, "RATE_LIMITED"))).toBe(true);
    expect(isRetryable(of(503, "SERVICE_UNAVAILABLE"))).toBe(true);
    expect(isRetryable(of(404, "ORDER_NOT_FOUND"))).toBe(false);
    expect(isRetryable(of(500, "INTERNAL_ERROR"))).toBe(false);
  });

  it("knows which errors belong to the session, not to a toast", () => {
    const of = (code: string) =>
      new ApiError({ status: 401, code, message: code });
    expect(isSessionError(of("AUTH_TOKEN_INVALID"))).toBe(true);
    expect(isSessionError(of("AUTH_SESSION_REVOKED"))).toBe(true);
    expect(isSessionError(of("ADMIN_CREDENTIALS_INVALID"))).toBe(false);
  });

  it("builds addresses without empty values", () => {
    expect(
      buildUrl("http://api.test", "/v1/x", {
        q: "atta 5",
        page: 2,
        on: true,
        off: "",
      }),
    ).toBe("http://api.test/v1/x?q=atta+5&page=2&on=true");
  });
});
