import { isApiError } from "@/lib/api/errors";

/**
 * Whether a page has nothing to show for its record: the request failed
 * and there is no answer from before, or the API says the record is gone.
 *
 * A request that fails while the page is open (the window got the focus
 * back during a network drop, the API was busy) keeps the answer it had:
 * `isError` alone would replace the page, and a form half filled in on it,
 * with an error. The next refetch brings it up to date.
 */
export function pageFailed(query: {
  isError: boolean;
  data: unknown;
  error: unknown;
}): boolean {
  if (!query.isError) return false;
  if (query.data === undefined) return true;
  return isApiError(query.error) && query.error.status === 404;
}
