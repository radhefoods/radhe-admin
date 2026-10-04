// A stand-in for `next/navigation` in component tests: the address is a
// value the test can read and set, and the hooks follow it.

import { useSyncExternalStore } from "react";

let url = new URL("http://localhost:3002/");
let params: Record<string, string> = {};
const listeners = new Set<() => void>();
const history: string[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const testNavigation = {
  /** Sets the address before a component renders: `"/orders?status=delivered"`. */
  go(path: string, routeParams: Record<string, string> = {}) {
    url = new URL(path, "http://localhost:3002");
    params = routeParams;
    history.length = 0;
    emit();
  },
  /** The current address with its query. */
  get location() {
    return `${url.pathname}${url.search}`;
  },
  /** Where the component navigated to, in order. */
  get history(): readonly string[] {
    return history;
  },
};

function navigate(path: string) {
  url = new URL(path, url);
  history.push(`${url.pathname}${url.search}`);
  emit();
}

const router = {
  push: navigate,
  replace: navigate,
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  prefetch: () => undefined,
};

export const navigationMock = {
  useRouter: () => router,
  usePathname: () =>
    useSyncExternalStore(
      subscribe,
      () => url.pathname,
      () => url.pathname,
    ),
  useSearchParams: () => {
    const search = useSyncExternalStore(
      subscribe,
      () => url.search,
      () => url.search,
    );
    return new URLSearchParams(search);
  },
  useParams: () => params,
  redirect: (path: string) => navigate(path),
  notFound: () => {
    throw new Error("notFound() was called");
  },
};
