import type {
  DeliveryAddress,
  DeliveryMethod,
  Locale,
  PackUnit,
  Translated,
  TranslatedOptional,
} from "@/lib/api/types";

export const DELETED_ACCOUNT = "Deleted account";

/** A customer, or a reference to one, as every record of the API names them (0.9, 4). */
export interface PersonLike {
  firstName?: string | null;
  lastName?: string | null;
  /** The full name a reference carries instead of the parts. */
  name?: string | null;
  email?: string | null;
  /** On a reference: the account was closed. */
  deleted?: boolean;
  /** On the customer object itself. */
  status?: string;
}

/** Whether the customer closed the account (4): no personal fields are left. */
export function isDeletedAccount(
  person: PersonLike | null | undefined,
): boolean {
  return Boolean(person && (person.deleted || person.status === "deleted"));
}

/**
 * `Priya Shah`, the email when the customer gave no name, or "Deleted
 * account" once the account was closed.
 */
export function personName(person: PersonLike | null | undefined): string {
  if (!person) return "—";
  if (isDeletedAccount(person)) return DELETED_ACCOUNT;
  const name = [person.firstName, person.lastName]
    .filter((part) => part && part.trim() !== "")
    .join(" ");
  return name || person.name?.trim() || person.email || "—";
}

/** The email to write to, or `null` once the account was closed. */
export function personEmail(
  person: PersonLike | null | undefined,
): string | null {
  if (!person || isDeletedAccount(person)) return null;
  return person.email || null;
}

/** `VV` for the avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** The text of a translated field in one language, English as the fallback. */
export function translated(
  value: Translated | TranslatedOptional | null | undefined,
  locale: Locale = "en",
): string {
  if (!value) return "";
  return (value[locale] || value.en || value.de || "").trim();
}

/** Which languages of a translated field are still empty. */
export function missingLocales(
  value: TranslatedOptional | null | undefined,
): Locale[] {
  const missing: Locale[] = [];
  if (!value?.en?.trim()) missing.push("en");
  if (!value?.de?.trim()) missing.push("de");
  return missing;
}

export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  de: "German",
};

export const DELIVERY_METHOD_LABEL: Record<DeliveryMethod, string> = {
  radhe_delivery: "Radhe delivery",
  dhl: "DHL",
  hermes: "Hermes",
};

export const PACK_UNIT_LABEL: Record<PackUnit, string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  l: "l",
  pcs: "pieces",
};

/** The lines of a delivery address, as they are written on a parcel. */
export function addressLines(address: DeliveryAddress): string[] {
  return [
    address.company,
    `${address.firstName} ${address.lastName}`.trim(),
    `${address.street} ${address.houseNumber}`.trim(),
    address.additionalLine,
    `${address.postalCode} ${address.city}`.trim(),
    address.countryCode === "DE" ? undefined : address.countryCode,
  ].filter((line): line is string => Boolean(line && line.trim()));
}

/** `1 order`, `3 orders`. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
}

/** The last characters of an id, when nothing better is known. */
export function shortId(id: string | null | undefined): string {
  return id ? `…${id.slice(-6)}` : "—";
}
