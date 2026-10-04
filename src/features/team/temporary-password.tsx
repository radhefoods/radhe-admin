"use client";

import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/domain/values";
import { Field, useControlProps } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/surface";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  generateTemporaryPassword,
  temporaryPasswordSchema,
} from "@/features/auth/schemas";
import { firstName } from "./team";

/** What is wrong with a temporary password, or `null` when the API takes it. */
export function temporaryPasswordProblem(value: string): string | null {
  const result = temporaryPasswordSchema.safeParse(value);
  return result.success
    ? null
    : (result.error.issues[0]?.message ?? "Not a valid password.");
}

function Control({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const control = useControlProps();
  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Input
          {...control}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          maxLength={PASSWORD_MAX}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="pr-9 font-mono"
        />
        <CopyButton
          value={value}
          label="Copy the temporary password"
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
        />
      </div>
      <Button
        icon={<RefreshCw />}
        onClick={() => onChange(generateTemporaryPassword())}
      >
        Generate
      </Button>
    </div>
  );
}

/**
 * The temporary password an admin sets for someone else. It is shown as
 * text, because it has to be read and handed over; "Generate" makes one
 * that is long and has no look-alike characters.
 */
export function TemporaryPasswordField({
  value,
  onChange,
  onBlur,
  error,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  hint?: ReactNode;
}) {
  return (
    <Field
      label="Temporary password"
      required
      error={error}
      hint={
        hint ??
        `${PASSWORD_MIN} to ${PASSWORD_MAX} characters. It works for the first sign-in only: it must be changed there.`
      }
    >
      <Control value={value} onChange={onChange} onBlur={onBlur} />
    </Field>
  );
}

export interface Handover {
  name: string;
  email: string;
  temporaryPassword: string;
  /** Why there is a password to hand over. */
  reason: "invited" | "reset";
}

function Line({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <dt className="shrink-0 text-13 text-ink-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 font-mono text-sm font-semibold break-all text-ink">
          {value}
        </span>
        <CopyButton value={value} label={copyLabel} />
      </dd>
    </div>
  );
}

/**
 * After an invitation or a password reset: the API sends no email, so the
 * admin who did it hands the password over. This is the last time the
 * panel shows it.
 */
export function HandoverDialog({
  handover,
  open,
  onOpenChange,
}: {
  handover: Handover | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!handover) return null;
  const first = firstName(handover.name);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={
            handover.reason === "invited"
              ? `${handover.name} is invited`
              : `New password for ${handover.name}`
          }
          description={`No email is sent. Hand these over to ${first} yourself: in person, by phone, or through a password manager.`}
        />
        <DialogBody>
          <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            <Line
              label="Email"
              value={handover.email}
              copyLabel="Copy the email"
            />
            <Line
              label="Temporary password"
              value={handover.temporaryPassword}
              copyLabel="Copy the temporary password"
            />
          </dl>
          <Alert
            tone="time"
            title="This is the last time the password is shown"
          >
            {handover.reason === "invited"
              ? `At the first sign-in ${first} sets up the authenticator app and must then choose an own password.`
              : `${first} is signed out everywhere and must choose an own password at the next sign-in.`}{" "}
            If the password gets lost, reset it again.
          </Alert>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="primary"
            size="lg"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
