export interface CspInput {
  nonce: string;
  /** `NEXT_PUBLIC_API_URL`: the only address the browser may talk to. */
  apiUrl: string | undefined;
  development: boolean;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The content security policy of the panel.
 *
 * - Scripts: the panel's own, by nonce. Nothing inline without it, nothing
 *   from another host.
 * - Connections: the panel itself and the API.
 * - Pictures: the API answers with absolute addresses of its CDN (or of
 *   itself in development), so https pictures and the API's origin are
 *   allowed. `blob:` is for the preview of a picture before its upload.
 * - Styles: inline styles are allowed, because the positioning of menus and
 *   dialogs (Radix) sets style attributes.
 * - Frames: only the panel's own (the preview of an announcement is shown
 *   in a sandboxed frame without scripts), and invoices as PDF (`blob:`).
 */
export function buildContentSecurityPolicy(input: CspInput): string {
  const api = originOf(input.apiUrl);
  const connect = ["'self'", api, input.development ? "ws:" : null];
  const img = ["'self'", "data:", "blob:", "https:", api];

  const directives: Record<string, (string | null)[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${input.nonce}'`,
      "'strict-dynamic'",
      // React needs eval for its debugging helpers in development only.
      input.development ? "'unsafe-eval'" : null,
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": img,
    "font-src": ["'self'"],
    "connect-src": connect,
    "frame-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  return Object.entries(directives)
    .map(
      ([name, values]) =>
        `${name} ${[...new Set(values.filter((value): value is string => Boolean(value)))].join(" ")}`,
    )
    .join("; ");
}
