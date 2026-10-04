// Everything the panel is configured with. All values are public
// (NEXT_PUBLIC_): the panel has no secrets.

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const env = {
  /** The API, without a trailing slash and without `/v1`. */
  apiUrl: withoutTrailingSlash(
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
  ),
  /** The customer shop, for "open in the shop" links. */
  shopUrl: withoutTrailingSlash(
    process.env.NEXT_PUBLIC_SHOP_URL ?? "http://localhost:3001",
  ),
} as const;
