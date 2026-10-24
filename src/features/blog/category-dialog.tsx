"use client";

import { useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import { BilingualField } from "@/components/form/fields";
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
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { BLOG_RULES, type BlogCategory } from "@/lib/api/types";
import { translated } from "@/lib/format/names";
import {
  categoryDefaults,
  categorySchema,
  toCategoryInput,
  toCategoryPatch,
  type CategoryFormOutput,
} from "./post-schema";
import { useCreateBlogCategory, useUpdateBlogCategory } from "./queries";

export type CategoryEdit =
  { mode: "new" } | { mode: "edit"; category: BlogCategory };

function CategoryForm({
  edit,
  onClose,
}: {
  edit: CategoryEdit;
  onClose: () => void;
}) {
  const create = useCreateBlogCategory();
  const update = useUpdateBlogCategory();
  const category = edit.mode === "edit" ? edit.category : undefined;
  const form = useZodForm(categorySchema, {
    defaultValues: categoryDefaults(category),
  });
  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: CategoryFormOutput) => {
      try {
        if (category) {
          const patch = toCategoryPatch(values, category);
          if (Object.keys(patch).length === 0) {
            notify.info("Nothing changed");
            onClose();
            return;
          }
          const saved = await update.mutateAsync({ id: category.id, ...patch });
          notify.success(`${translated(saved.name)} saved`);
        } else {
          const saved = await create.mutateAsync(toCategoryInput(values));
          notify.success(
            `${translated(saved.name)} created`,
            "It stands last.",
          );
        }
        onClose();
      } catch (error) {
        if (!hasErrorCode(error, "BLOG_CATEGORY_SLUG_TAKEN")) throw error;
        const typed = (["en", "de"] as const).filter(
          (locale) => values.slug[locale],
        );
        for (const locale of typed.length > 0 ? typed : ["en" as const]) {
          form.setError(
            `slug.${locale}`,
            { type: "server", message: errorMessage(error) },
            { shouldFocus: locale === typed[0] },
          );
        }
      }
    },
    {
      aliases: { "seo.title": "seoTitle", "seo.description": "seoDescription" },
    },
  );

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
        title={category ? translated(category.name) : "New category"}
        description="A section of the blog: Recipes, Ingredients, News. The shop lists the categories as filters, in this order."
      />
      <DialogBody>
        <BilingualField
          form={form}
          name="name"
          label="Name"
          requiredEn
          maxLength={120}
        />
        <BilingualField
          form={form}
          name="slug"
          label="Address (slug)"
          mono
          maxLength={BLOG_RULES.slugMaxLength}
          hint={
            category
              ? "Part of the category's address in the shop. Changing it breaks links to the old address."
              : "Left empty, the API makes it from the name. Lower-case letters, digits and hyphens."
          }
        />
        <BilingualField
          form={form}
          name="description"
          label="Description"
          multiline
          rows={3}
          maxLength={BLOG_RULES.descriptionMaxLength}
          hint="Shown at the top of the category's page in the shop."
        />
        <BilingualField
          form={form}
          name="seoTitle"
          label="SEO title"
          maxLength={BLOG_RULES.seoTitleMaxLength}
          hint="The shop falls back to the name."
        />
        <BilingualField
          form={form}
          name="seoDescription"
          label="SEO description"
          multiline
          rows={2}
          maxLength={BLOG_RULES.seoDescriptionMaxLength}
          hint="The shop falls back to the description."
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
          {category ? "Save changes" : "Create category"}
        </ActionButton>
      </DialogFooter>
    </form>
  );
}

/** Creating or changing a category of the blog. */
export function CategoryDialog({
  edit,
  onClose,
}: {
  edit: CategoryEdit | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<CategoryEdit | null>(edit);
  if (edit && edit !== shown) setShown(edit);
  return (
    <Dialog
      open={edit !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="lg">
        {shown ? (
          <CategoryForm
            key={shown.mode === "edit" ? shown.category.id : "new"}
            edit={shown}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
