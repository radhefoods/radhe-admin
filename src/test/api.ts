// The mock API, running inside the test: `fetch` goes to the same function
// that answers the development server, with a cookie jar in between. A
// component test therefore exercises the real client, the real session
// handling and the documented answers of the API.

import { vi } from "vitest";
import {
  createMockApi,
  type MockApi,
  type MockApiOptions,
} from "../../mocks/app.ts";
import { DEMO_ADMINS } from "../../mocks/seed.ts";

export const API_URL = "http://localhost:3000";
const ORIGIN = "http://localhost:3002";

export interface TestApi {
  mock: MockApi;
  /** Every request the panel made: `"POST /v1/admin/cargos/…/close"`. */
  calls: { method: string; path: string; body: unknown }[];
  /** Signs in as one of the demo admins, so that the next calls carry a session. */
  signIn: (who?: keyof typeof DEMO_ADMINS) => Promise<void>;
  /** A call to the API as the signed-in admin, for arranging and checking. */
  request: <T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<T>;
}

/** Installs the mock API behind `fetch`. Call it in `beforeEach`. */
export function installTestApi(options: MockApiOptions = {}): TestApi {
  const mock = createMockApi({ publicUrl: API_URL, ...options });
  const cookies = new Map<string, string>();
  const calls: TestApi["calls"] = [];

  async function fetchMock(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (cookies.size > 0) {
      headers.set(
        "cookie",
        [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    headers.set("origin", ORIGIN);
    const request = new Request(input, { ...init, headers });
    const url = new URL(request.url);
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      body,
    });
    const response = await mock.handle(request);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = cookie.split(";");
      const [name = "", value = ""] = pair.trim().split("=");
      const expired = attributes.some(
        (part) => part.trim().toLowerCase() === "max-age=0",
      );
      if (expired || value === "") cookies.delete(name);
      else cookies.set(name, value);
    }
    return response;
  }

  vi.stubGlobal("fetch", vi.fn(fetchMock));

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetchMock(`${API_URL}${path}`, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!response.ok) {
      throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
    }
    return data as T;
  }

  return {
    mock,
    calls,
    request,
    async signIn(who = "owner") {
      const { email, password } = DEMO_ADMINS[who];
      const login = await request<{ mfaToken: string }>(
        "POST",
        "/v1/admin/auth/login",
        {
          email,
          password,
        },
      );
      await request("POST", "/v1/admin/auth/mfa/verify", {
        mfaToken: login.mfaToken,
        code: "000000",
      });
      calls.length = 0;
    },
  };
}
