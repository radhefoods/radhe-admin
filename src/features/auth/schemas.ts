import { z } from "zod";

// The rules of the API for signing in (documentation, section 1).

export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(254, "At most 254 characters.")
    .pipe(z.email("This is not an email address.")),
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(128, "At most 128 characters."),
});

/** Exactly six digits; spaces a person types between them are ignored. */
export const codeSchema = z.object({
  code: z
    .string()
    .transform((value) => value.replace(/\s/g, ""))
    .pipe(z.string().regex(/^\d{6}$/, "The code has six digits.")),
});

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Enter your current password.")
      .max(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters.`),
    newPassword: z
      .string()
      .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters.`)
      .max(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters.`),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ["newPassword"],
    message: "The new password must differ from the current one.",
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords are not the same.",
  });

/** A temporary password an admin sets for someone else (sections 2). */
export const temporaryPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters.`);

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/**
 * A temporary password to hand over: 16 characters without look-alikes
 * (no 0/O, 1/l/I), in groups of four, from the browser's secure generator.
 */
export function generateTemporaryPassword(
  random: (values: Uint32Array) => Uint32Array = (values) =>
    crypto.getRandomValues(values),
): string {
  const picks = random(new Uint32Array(16));
  const characters = Array.from(
    picks,
    (value) => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length],
  );
  return [0, 4, 8, 12]
    .map((start) => characters.slice(start, start + 4).join(""))
    .join("-");
}
