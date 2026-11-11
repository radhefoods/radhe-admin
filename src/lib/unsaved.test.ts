// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { heldByUnsavedChanges, registerUnsavedGuard } from "./unsaved";

describe("navigation by code and a form with unsaved changes", () => {
  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it("goes when no form has unsaved changes", () => {
    expect(heldByUnsavedChanges("/orders")).toBe(false);
  });

  it("hands the address to the question of the page", () => {
    const ask = vi.fn();
    unregister = registerUnsavedGuard(ask);
    expect(heldByUnsavedChanges("/orders?status=confirmed")).toBe(true);
    expect(ask).toHaveBeenCalledWith("/orders?status=confirmed");
  });

  it("never holds an address on the same page: no form is left behind", () => {
    const ask = vi.fn();
    unregister = registerUnsavedGuard(ask);
    expect(heldByUnsavedChanges(`${window.location.pathname}?page=2`)).toBe(
      false,
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it("stops asking once the form is saved or gone", () => {
    const ask = vi.fn();
    registerUnsavedGuard(ask)();
    expect(heldByUnsavedChanges("/orders")).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
});
