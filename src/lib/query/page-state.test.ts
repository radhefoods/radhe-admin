import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { pageFailed } from "./page-state";

const error = (status: number, code: string) =>
  new ApiError({ status, code, message: code });

describe("whether a record page has nothing to show", () => {
  it("is fine while it loads and once it has its record", () => {
    expect(pageFailed({ isError: false, data: undefined, error: null })).toBe(
      false,
    );
    expect(pageFailed({ isError: false, data: { id: "1" }, error: null })).toBe(
      false,
    );
  });

  it("fails when the first request failed", () => {
    expect(
      pageFailed({
        isError: true,
        data: undefined,
        error: error(0, "NETWORK_ERROR"),
      }),
    ).toBe(true);
  });

  it("keeps the record, and the form on it, when a later request fails", () => {
    for (const failure of [
      error(0, "NETWORK_ERROR"),
      error(429, "RATE_LIMITED"),
      error(500, "INTERNAL_ERROR"),
      error(401, "AUTH_TOKEN_INVALID"),
    ]) {
      expect(
        pageFailed({ isError: true, data: { id: "1" }, error: failure }),
      ).toBe(false);
    }
  });

  it("ends the page when the API says the record is gone", () => {
    expect(
      pageFailed({
        isError: true,
        data: { id: "1" },
        error: error(404, "ORDER_NOT_FOUND"),
      }),
    ).toBe(true);
  });
});
