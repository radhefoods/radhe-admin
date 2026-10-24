"use client";

import { useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import { BilingualField, SwitchField } from "@/components/form/fields";
import { FormError, useSubmit, useZodForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { FAQ_RULES, type FaqGroup } from "@/lib/api/types";
import { translated } from "@/lib/format/names";
import {
  groupDefaults,
  groupSchema,
  toGroupInput,
  toGroupPatch,
  type GroupFormOutput,
} from "./faq-schema";
import { useCreateFaqGroup, useUpdateFaqGroup } from "./queries";

export type GroupEdit = { mode: "new" } | { mode: "edit"; group: FaqGroup };

function GroupForm({
  edit,
  onClose,
}: {
  edit: GroupEdit;
  onClose: () => void;
}) {
  const create = useCreateFaqGroup();
  const update = useUpdateFaqGroup();
  const group = edit.mode === "edit" ? edit.group : undefined;
  const form = useZodForm(groupSchema, { defaultValues: groupDefaults(group) });
  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: GroupFormOutput) => {
      if (group) {
        const patch = toGroupPatch(values, group);
        if (Object.keys(patch).length === 0) {
          notify.info("Nothing changed");
          onClose();
          return;
        }
        const saved = await update.mutateAsync({ id: group.id, ...patch });
        notify.success(
          `${translated(saved.name)} saved`,
          saved.isVisible
            ? "The shop shows it with its published questions."
            : "The shop hides it and its questions.",
        );
      } else {
        const saved = await create.mutateAsync(toGroupInput(values));
        notify.success(
          `${translated(saved.name)} created`,
          "It stands last. Add its questions, or move questions into it.",
        );
      }
      onClose();
    },
  );
  const visible = form.watch("isVisible");

  return (
    <form
      onSubmit={(event) => {
        event.stopPropagation();
        void onSubmit(event);
      }}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader
        title={group ? translated(group.name) : "New group"}
        description="A heading the questions stand under in the shop: Orders, Delivery, Returns."
      />
      <DialogBody>
        <BilingualField
          form={form}
          name="name"
          label="Name"
          requiredEn
          maxLength={FAQ_RULES.groupNameMaxLength}
          hint="English is required; the shop falls back to it until the German name is filled in."
        />
        <SwitchField
          form={form}
          name="isVisible"
          label={visible ? "Shown in the shop" : "Hidden in the shop"}
          hint="A hidden group hides its questions in the shop; they stay here, published or not."
        />
        <FormError state={state} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <ActionButton
          type="submit"
          permission="content.manage"
          variant="primary"
          size="lg"
          loading={pending}
        >
          {group ? "Save changes" : "Create group"}
        </ActionButton>
      </DialogFooter>
    </form>
  );
}

/** Creating or renaming a group of the FAQ. */
export function GroupDialog({
  edit,
  onClose,
}: {
  /** `null` closes the dialog. */
  edit: GroupEdit | null;
  onClose: () => void;
}) {
  // The form stays while the dialog fades out.
  const [shown, setShown] = useState<GroupEdit | null>(edit);
  if (edit && edit !== shown) setShown(edit);
  return (
    <Dialog
      open={edit !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm">
        {shown ? (
          <GroupForm
            key={shown.mode === "edit" ? shown.group.id : "new"}
            edit={shown}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
