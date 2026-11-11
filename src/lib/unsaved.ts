// A form with unsaved changes asks before the admin leaves its page
// (`UnsavedGuard`). A click on a link is seen by the guard itself; a
// navigation made by code (the search, a row of a table) asks here first.
// Kept apart from the form components so that a list does not load them.

type Ask = (href: string) => void;

let current: Ask | null = null;

/** The page has unsaved changes: `ask` opens its question for an address. */
export function registerUnsavedGuard(ask: Ask): () => void {
  current = ask;
  return () => {
    if (current === ask) current = null;
  };
}

/**
 * Whether the unsaved-changes question took a navigation over. `false`
 * means: go. An address on the same page (other filters) leaves no form
 * behind and is never held.
 */
export function heldByUnsavedChanges(href: string): boolean {
  if (!current || typeof window === "undefined") return false;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  if (url.pathname === window.location.pathname) return false;
  current(`${url.pathname}${url.search}${url.hash}`);
  return true;
}
