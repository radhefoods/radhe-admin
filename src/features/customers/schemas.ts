import { z } from "zod";
import type { CustomerStatusInput } from "@/lib/api/types";

// The rule of the API for the one thing the panel can change about a
// customer (documentation, 4): the account status, with an optional reason
// that is stored when blocking. A closed account cannot be changed at all.

export const BLOCK_REASON_MAX = 500;

/** The reason stored with a block: optional, at most 500 characters. */
export const blockReasonSchema = z
  .string()
  .trim()
  .max(BLOCK_REASON_MAX, `At most ${BLOCK_REASON_MAX} characters.`);

/** What `PATCH /customers/{id}/status` gets. A reason is only stored when blocking. */
export function toStatusInput(
  status: CustomerStatusInput["status"],
  reason = "",
): CustomerStatusInput {
  const text = reason.trim();
  return status === "blocked" && text !== ""
    ? { status, reason: text }
    : { status };
}
