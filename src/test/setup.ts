import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, vi } from "vitest";

// Component tests have no Next.js router: the address is a value of the
// test (src/test/navigation.ts), and a link is a plain anchor.
vi.mock(
  "next/navigation",
  async () => (await import("./navigation")).navigationMock,
);
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...props
  }: {
    href: string | { pathname: string };
    children: ReactNode;
    prefetch?: boolean;
  }) =>
    createElement(
      "a",
      { href: typeof href === "string" ? href : href.pathname, ...props },
      children,
    ),
}));

// Every test starts with an empty page and the real `fetch` put back.
afterEach(() => {
  if (typeof document !== "undefined") cleanup();
  vi.unstubAllGlobals();
});

// jsdom has no layout: what Radix asks for is answered with "nothing".
if (typeof window !== "undefined") {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.setPointerCapture ??= () => undefined;
}
