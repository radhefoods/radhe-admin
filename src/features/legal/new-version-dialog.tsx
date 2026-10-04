"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  FormError,
  TextareaField,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Alert, FactRows } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import type { LegalDocumentSummary, LegalType } from "@/lib/api/types";
import { formatDate } from "@/lib/format/dates";
import { routes } from "@/lib/routes";
import { LEGAL_TYPE, NOTE_MAX } from "./legal";
import { useCreateLegalVersion } from "./queries";

const schema = z.object({
  note: z.string().trim().max(NOTE_MAX, `At most ${NOTE_MAX} characters.`),
});

function NewVersionForm({
  type,
  versions,
  onClose,
}: {
  type: LegalType;
  versions: readonly LegalDocumentSummary[];
  onClose: () => void;
}) {
  const router = useRouter();
  const create = useCreateLegalVersion();
  const latest = versions[0] ?? null;
  const form = useZodForm(schema, { defaultValues: { note: "" } });
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const document = await create.mutateAsync({
      type,
      from: latest,
      note: values.note,
    });
    notify.success(
      `Version ${document.version} created as a draft`,
      "Customers see nothing of it until it is published.",
    );
    onClose();
    router.push(routes.legalDocument(document.id));
  });
  const next = (latest?.version ?? 0) + 1;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogBody>
        {latest?.status === "draft" ? (
          <Alert
            tone="warning"
            title={`Version ${latest.version} is still a draft`}
          >
            You may want to{" "}
            <Link href={routes.legalDocument(latest.id)} onClick={onClose}>
              continue with version {latest.version}
            </Link>{" "}
            instead of starting another one.
          </Alert>
        ) : null}
        <FactRows
          rows={[
            { label: "New version", value: `Version ${next}, as a draft` },
            {
              label: "Starts from the text of",
              value: latest
                ? `Version ${latest.version} (${
                    latest.status === "published"
                      ? `published ${formatDate(latest.publishedAt)}`
                      : "draft"
                  })`
                : "Nothing: the first version",
            },
          ]}
        />
        <TextareaField
          form={form}
          name="note"
          label="What changes in this version?"
          hint="A note for the team. Customers never see it. It can be written later."
          optional
          rows={2}
          maxLength={NOTE_MAX}
        />
        <FormError state={state} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Create the draft of version {next}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Starts the next version of a type. Nothing changes for customers: the
 * new version is a draft with the text of the latest one, ready to edit.
 */
export function NewVersionDialog({
  type,
  versions,
  open,
  onOpenChange,
}: {
  type: LegalType;
  /** The versions of that type, newest first. */
  versions: readonly LegalDocumentSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`New version of the ${LEGAL_TYPE[type].short}`}
          description="The published version stays what customers accept until you publish the new one."
        />
        <NewVersionForm
          type={type}
          versions={versions}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
