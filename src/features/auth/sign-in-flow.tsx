"use client";

import { ArrowLeft, Check, Copy, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import {
  Field,
  TextField,
  useControlProps,
  useZodForm,
} from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/surface";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { AdminWithRole, MfaSetup } from "@/lib/api/types";
import { codeSchema, credentialsSchema } from "./schemas";

type Step =
  | { name: "credentials" }
  /** `setup` is set at the first sign-in: the authenticator is enrolled. */
  | { name: "code"; mfaToken: string; setup: MfaSetup | null };

export interface SignInFlowProps {
  /** Signing in again after the session ended: the email is fixed. */
  lockedEmail?: string;
  onAuthenticated: (admin: AdminWithRole) => void;
}

/**
 * The sign-in of the API (documentation, 1.10): email and password, then
 * the six digits of the authenticator app. An admin without an
 * authenticator is shown the QR code first.
 */
export function SignInFlow({ lockedEmail, onAuthenticated }: SignInFlowProps) {
  const [step, setStep] = useState<Step>({ name: "credentials" });
  const [notice, setNotice] = useState<string | null>(null);

  if (step.name === "credentials") {
    return (
      <CredentialsStep
        lockedEmail={lockedEmail}
        notice={notice}
        onAuthenticated={onAuthenticated}
        onNext={(next) => {
          setNotice(null);
          setStep(next);
        }}
      />
    );
  }
  return (
    <CodeStep
      step={step}
      onAuthenticated={onAuthenticated}
      onSetup={(setup) => setStep({ ...step, setup })}
      onRestart={(message) => {
        setNotice(message);
        setStep({ name: "credentials" });
      }}
    />
  );
}

function CredentialsStep({
  lockedEmail,
  notice,
  onNext,
  onAuthenticated,
}: {
  lockedEmail?: string;
  notice: string | null;
  onNext: (step: Step) => void;
  onAuthenticated: (admin: AdminWithRole) => void;
}) {
  const form = useZodForm(credentialsSchema, {
    defaultValues: { email: lockedEmail ?? "", password: "" },
  });
  const [failure, setFailure] = useState<string | null>(null);

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const result = await api.auth.login(values);
      if (result.status === "authenticated") {
        onAuthenticated(result.admin);
        return;
      }
      if (result.status === "mfa_setup_required") {
        const setup = await api.auth.mfaSetup(result.mfaToken);
        onNext({ name: "code", mfaToken: result.mfaToken, setup });
        return;
      }
      onNext({ name: "code", mfaToken: result.mfaToken, setup: null });
    } catch (error) {
      setFailure(errorMessage(error));
      form.resetField("password");
      form.setFocus("password");
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {notice ? <Alert tone="time" title={notice} /> : null}
      <TextField
        form={form}
        name="email"
        label="Email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        readOnly={Boolean(lockedEmail)}
        autoFocus={!lockedEmail}
      />
      <TextField
        form={form}
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        autoFocus={Boolean(lockedEmail)}
      />
      {failure ? <Alert tone="danger" title={failure} /> : null}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={form.formState.isSubmitting}
      >
        Continue
      </Button>
    </form>
  );
}

function CodeStep({
  step,
  onAuthenticated,
  onSetup,
  onRestart,
}: {
  step: Extract<Step, { name: "code" }>;
  onAuthenticated: (admin: AdminWithRole) => void;
  onSetup: (setup: MfaSetup) => void;
  onRestart: (message: string | null) => void;
}) {
  const form = useZodForm(codeSchema, { defaultValues: { code: "" } });
  const [failure, setFailure] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const code = form.watch("code");
  const submitting = form.formState.isSubmitting;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const result = await api.auth.mfaVerify({
        mfaToken: step.mfaToken,
        code: values.code,
      });
      onAuthenticated(result.admin);
    } catch (error) {
      if (hasErrorCode(error, "ADMIN_MFA_TOKEN_INVALID")) {
        onRestart(errorMessage(error));
        return;
      }
      if (hasErrorCode(error, "ADMIN_MFA_SETUP_REQUIRED")) {
        try {
          onSetup(await api.auth.mfaSetup(step.mfaToken));
        } catch (setupError) {
          onRestart(errorMessage(setupError));
        }
        return;
      }
      if (
        hasErrorCode(error, "ADMIN_ACCOUNT_LOCKED", "ADMIN_ACCOUNT_DISABLED")
      ) {
        onRestart(errorMessage(error));
        return;
      }
      setFailure(errorMessage(error));
      form.reset({ code: "" });
      form.setFocus("code");
    }
  });

  // Six digits are a complete code: no button press needed.
  useEffect(() => {
    if (/^\d{6}$/.test(code.replace(/\s/g, "")) && !submitting) {
      formRef.current?.requestSubmit();
    }
    // Submitting again when `submitting` changes would send a refused code twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
    >
      {step.setup ? <SetupGuide setup={step.setup} /> : null}
      <Field
        label={step.setup ? "First code from the app" : "Authenticator code"}
        hint={
          step.setup
            ? "Enter the six digits the app shows now. This activates the authenticator."
            : "The six digits your authenticator app shows for Radhe Foods Admin."
        }
        error={form.formState.errors.code?.message ?? null}
      >
        <CodeInput form={form} />
      </Field>
      {failure ? <Alert tone="danger" title={failure} /> : null}
      <Button type="submit" variant="primary" size="lg" loading={submitting}>
        {step.setup ? "Activate and sign in" : "Sign in"}
      </Button>
      <Button
        variant="ghost"
        onClick={() => onRestart(null)}
        icon={<ArrowLeft />}
        className="self-center"
      >
        Start again
      </Button>
    </form>
  );
}

function CodeInput({
  form,
}: {
  form: ReturnType<typeof useZodForm<typeof codeSchema>>;
}) {
  const control = useControlProps();
  return (
    <Input
      {...control}
      {...form.register("code")}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]*"
      maxLength={7}
      autoFocus
      placeholder="000000"
      className="h-12 text-center font-mono text-xl tracking-[0.4em] tabular"
    />
  );
}

/** First sign-in: the QR code, the secret as text, and what to do if the phone is lost. */
function SetupGuide({ setup }: { setup: MfaSetup }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The clipboard is blocked: the secret can be selected by hand.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 text-sm">
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-success-fg"
        />
        <p className="text-ink-muted">
          Every admin signs in with a second step. Scan the code with an
          authenticator app (Google Authenticator, Microsoft Authenticator,
          1Password, Authy), then enter the six digits it shows.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-sunken p-4 sm:flex-row sm:items-start">
        {/* A QR code is read against white, in the dark theme too. */}
        <div className="shrink-0 rounded-md bg-paper p-2.5">
          <QRCodeSVG
            value={setup.otpauthUrl}
            size={148}
            level="M"
            title="QR code for the authenticator app"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2 text-13">
          <p className="font-medium text-ink">Cannot scan? Enter this key:</p>
          <code className="font-mono text-sm break-all text-ink select-all">
            {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
          <Button
            size="sm"
            onClick={copy}
            icon={copied ? <Check /> : <Copy />}
            className="self-start"
          >
            {copied ? "Copied" : "Copy the key"}
          </Button>
        </div>
      </div>
      <Alert tone="time" title="Keep a way back in">
        There are no recovery codes. If the phone is lost, another admin with
        the Team permission removes your authenticator (Settings, Team), and you
        enrol again at the next sign-in. Add this key to a second device or a
        password manager now, so you are never the only way in.
      </Alert>
    </div>
  );
}
