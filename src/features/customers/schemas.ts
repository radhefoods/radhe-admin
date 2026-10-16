import { z } from "zod";
import type {
  CustomerStatus,
  CustomerStatusInput,
  SignupMethod,
} from "@/lib/api/types";

// The rule of the API for the one thing the panel can change about a
// customer (documentation, 4): the account status, with an optional reason
// that is stored when blocking.

export const BLOCK_REASON_MAX = 500;

/** The reason stored with a block: optional, at most 500 characters. */
export const blockReasonSchema = z
  .string()
  .trim()
  .max(BLOCK_REASON_MAX, `At most ${BLOCK_REASON_MAX} characters.`);

/** What `PATCH /customers/{id}/status` gets. A reason is only stored when blocking. */
export function toStatusInput(
  status: CustomerStatus,
  reason = "",
): CustomerStatusInput {
  const text = reason.trim();
  return status === "blocked" && text !== ""
    ? { status, reason: text }
    : { status };
}

// --- Words -------------------------------------------------------------------

export const SIGNUP_METHOD_LABEL: Record<SignupMethod, string> = {
  email_otp: "Email code",
  google: "Google",
};
