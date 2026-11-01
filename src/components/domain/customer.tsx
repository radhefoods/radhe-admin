"use client";

import Link from "next/link";
import { TwoLine } from "@/components/domain/values";
import { Badge } from "@/components/ui/badge";
import type { CustomerKind, CustomerRef, Id } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import {
  isDeletedAccount,
  personEmail,
  personName,
  type PersonLike,
} from "@/lib/format/names";
import { routes } from "@/lib/routes";

/** A customer next to the id a record carries (0.9), whether or not the API named them. */
export function customerOf(
  id: Id,
  ref: CustomerRef | null | undefined,
): PersonLike & { id: Id } {
  return {
    id,
    name: ref?.name ?? null,
    email: ref?.email ?? null,
    ...(ref?.deleted ? { deleted: true } : {}),
  };
}

export const CUSTOMER_KIND_LABEL: Record<CustomerKind, string> = {
  registered: "Registered",
  guest: "Guest",
};

/** Whether the customer has an account or ordered as a guest (4). */
export function KindBadge({ kind }: { kind: CustomerKind }) {
  return (
    <Badge
      dot={false}
      title={
        kind === "guest"
          ? "Ordered without an account, with an email and a link"
          : "Has an account with a password"
      }
    >
      {CUSTOMER_KIND_LABEL[kind]}
    </Badge>
  );
}

/** The mark of an order made without an account (9). Nothing for the others. */
export function GuestBadge({ isGuest }: { isGuest: boolean | undefined }) {
  if (!isGuest) return null;
  return (
    <Badge dot={false} title="Ordered without an account">
      Guest
    </Badge>
  );
}

/**
 * The name of a customer, as a link to their page for an admin who may
 * read customers. A closed account reads "Deleted account" (4); it still
 * links, since the record stays for the books.
 */
export function CustomerName({
  customer,
  className = "font-medium text-accent-text hover:underline",
}: {
  customer: (PersonLike & { id: Id }) | null | undefined;
  className?: string;
}) {
  const can = useCan();
  const name = personName(customer);
  if (!customer || !can("customers.read")) return <>{name}</>;
  return (
    <Link href={routes.customer(customer.id)} className={className}>
      {name}
    </Link>
  );
}

/** A table cell with the customer's name over their email; no email once the account was closed. */
export function CustomerCell({
  customer,
  secondary,
}: {
  customer: (PersonLike & { id: Id }) | null | undefined;
  /** What to show under the name instead of the email. */
  secondary?: string | null;
}) {
  const email = personEmail(customer);
  return (
    <TwoLine
      primary={<CustomerName customer={customer} />}
      secondary={
        secondary !== undefined
          ? secondary
          : customer &&
              !isDeletedAccount(customer) &&
              personName(customer) !== email
            ? email
            : null
      }
    />
  );
}
