// Links made from what somebody outside typed: a customer's email and
// phone, the contact of a wholesale request. The text is shown as it is;
// the address behind it carries only what it should.

/**
 * A `mailto:` address for one email address. Anything more than an address
 * (`a@b.de?bcc=…&body=…` would prefill other recipients and a text) gives
 * no link: the text is still shown and can be copied.
 */
export function mailtoHref(
  email: string | null | undefined,
): string | undefined {
  const text = email?.trim();
  if (!text) return undefined;
  return /^[^\s?&#%<>"',;:]+@[^\s?&#%<>"',;:@]+$/.test(text)
    ? `mailto:${text}`
    : undefined;
}

/** A `tel:` address: the digits of the number, with its leading plus. */
export function telHref(phone: string | null | undefined): string | undefined {
  const text = phone?.trim();
  if (!text) return undefined;
  const digits = text.replace(/\D/g, "");
  if (digits === "") return undefined;
  return `tel:${text.startsWith("+") ? "+" : ""}${digits}`;
}
