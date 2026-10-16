"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import { BilingualField, SwitchField } from "@/components/form/fields";
import {
  FormError,
  SelectField,
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
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { isSessionError } from "@/lib/api/errors";
import type { Category } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { CategoryPicture } from "./category-picture";
import {
  altChanged,
  altOf,
  categoryDefaults,
  categoryErrorField,
  categorySchema,
  toCategoryInput,
  toCategoryPatch,
  type CategoryFormValues,
} from "./category-schema";
import {
  MAX_CATEGORY_LEVEL,
  indentedName,
  parentChoices,
} from "./category-tree";
import type { SizeReader } from "./image-rules";
import {
  useCreateCategory,
  usePatchCategoryImage,
  usePutCategoryImage,
  useUpdateCategory,
} from "./queries";

/** What the dialog is open for: a new category (under a parent), or one to change. */
export type CategoryEdit =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; category: Category };

function CategoryForm({
  edit,
  categories,
  onClose,
  onDirty,
  readSize,
}: {
  edit: CategoryEdit;
  categories: Category[];
  onClose: () => void;
  /** Tells the dialog whether something was typed that is not saved yet. */
  onDirty: (dirty: boolean) => void;
  readSize?: SizeReader;
}) {
  const manage = useCan()("catalog.manage");
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const putImage = usePutCategoryImage(
    edit.mode === "edit" ? edit.category.id : "",
  );
  const patchImage = usePatchCategoryImage(
    edit.mode === "edit" ? edit.category.id : "",
  );
  const category = edit.mode === "edit" ? edit.category : undefined;
  // For a new category: the picture chosen for it, uploaded after the creation.
  const [file, setFile] = useState<File | null>(null);
  const form = useZodForm(categorySchema, {
    defaultValues: categoryDefaults(
      category,
      edit.mode === "create" ? edit.parentId : null,
    ),
  });
  const dirty = form.formState.isDirty || file !== null;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: CategoryFormValues) => {
      try {
        if (category) {
          const patch = toCategoryPatch(values, category);
          const describe = category.image && altChanged(values, category);
          if (Object.keys(patch).length > 0) {
            const saved = await update.mutateAsync({
              id: category.id,
              ...patch,
            });
            notify.success(
              `${saved.name.en} saved`,
              "parentId" in patch
                ? "It moved with everything below it, to the last place there."
                : undefined,
            );
          }
          // The description of the picture has an endpoint of its own (7).
          if (describe) {
            await patchImage.mutateAsync(altOf(values));
            if (Object.keys(patch).length === 0) {
              notify.success("Picture description saved");
            }
          }
        } else {
          const created = await create.mutateAsync(toCategoryInput(values));
          if (file) {
            // The API takes the picture only for a category that exists (7):
            // it follows right after the creation.
            try {
              const withPicture = await putImage.mutateAsync({
                file,
                id: created.id,
              });
              const alt = altOf(values);
              if ((alt.en || alt.de) && withPicture.image) {
                await patchImage.mutateAsync({ ...alt, id: created.id });
              }
              notify.success(
                `${created.name.en} created`,
                "With its picture. It is the last of its level.",
              );
            } catch (error) {
              if (isSessionError(error)) return;
              notify.error(
                error,
                `${created.name.en} created without its picture`,
              );
            }
          } else {
            notify.success(
              `${created.name.en} created`,
              "It is the last of its level. A picture can be added by editing it.",
            );
          }
        }
        onClose();
      } catch (error) {
        // A documented refusal that belongs to one field is shown there.
        const field = categoryErrorField(error);
        if (!field) throw error;
        form.setError(
          field,
          { type: "server", message: errorMessage(error) },
          { shouldFocus: true },
        );
      }
    },
  );

  const parents = parentChoices(categories, category);
  const visible = form.watch("isVisible");
  const hasPicture = Boolean(category?.image) || file !== null;

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
        title={category ? `Edit ${category.name.en}` : "New category"}
        description={
          category
            ? "Only what you change is saved. A new picture is uploaded at once."
            : "Categories go three levels deep. A new one is placed last; drag it where it belongs afterwards."
        }
      />
      <DialogBody>
        <fieldset disabled={!manage} className="flex min-w-0 flex-col gap-4">
          <legend className="sr-only">Category</legend>
          <BilingualField
            form={form}
            name="name"
            label="Name"
            requiredEn
            maxLength={160}
          />
          <SelectField
            form={form}
            name="parentId"
            label="Parent"
            hint={
              category
                ? `Changing it moves the category with everything below it. Only parents that keep the tree within ${MAX_CATEGORY_LEVEL} levels are offered.`
                : "The category it belongs to."
            }
          >
            <option value="">None: a main category</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {indentedName(parent)}
              </option>
            ))}
          </SelectField>
          <SwitchField
            form={form}
            name="isVisible"
            label={visible ? "Visible in the shop" : "Hidden from the shop"}
            disabled={!manage}
            hint="A hidden category and its products disappear from the shop until it is shown again. Nothing is deleted."
          />
        </fieldset>

        <section
          aria-label="Picture"
          className="flex flex-col gap-3 rounded-lg border border-line p-3.5"
        >
          <h3 className="text-13 font-semibold text-ink">Picture</h3>
          <CategoryPicture
            category={category}
            file={file}
            onFile={setFile}
            disabled={!manage || pending}
            readSize={readSize}
          />
          {hasPicture ? (
            <fieldset disabled={!manage} className="flex min-w-0 flex-col">
              <legend className="sr-only">Picture description</legend>
              <BilingualField
                form={form}
                name="alt"
                label="Picture description (alt text)"
                multiline
                rows={2}
                maxLength={300}
                hint="Read out by screen readers and shown when the picture cannot load. At most 300 characters each; saved with the category."
              />
            </fieldset>
          ) : null}
        </section>

        <fieldset disabled={!manage} className="flex min-w-0 flex-col gap-4">
          <legend className="sr-only">Texts</legend>
          <BilingualField
            form={form}
            name="tagline"
            label="Tagline"
            maxLength={300}
            hint="A short line under the name. Optional."
          />
          <BilingualField
            form={form}
            name="description"
            label="Description"
            multiline
            rows={3}
            maxLength={20000}
          />
          <BilingualField
            form={form}
            name="seo.title"
            label="SEO title"
            maxLength={300}
            hint="The title search engines show. Optional."
          />
          <BilingualField
            form={form}
            name="seo.description"
            label="SEO description"
            multiline
            rows={2}
            maxLength={300}
          />
          <BilingualField
            form={form}
            name="slug"
            label="Address in the shop (slug)"
            maxLength={120}
            hint={
              category
                ? "Changing it breaks links that point to the old address. Lower-case letters, digits and single hyphens."
                : "Generated from the name when left empty. Lower-case letters, digits and single hyphens."
            }
          />
        </fieldset>
        <FormError state={state} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          {manage ? "Cancel" : "Close"}
        </Button>
        <ActionButton
          type="submit"
          permission="catalog.manage"
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

/** Creating and changing a category, with its picture, in a dialog. */
export function CategoryDialog({
  edit,
  categories,
  onClose,
  readSize,
}: {
  /** `null` closes the dialog. */
  edit: CategoryEdit | null;
  categories: Category[];
  onClose: () => void;
  /** How the size of a picture is read; tests have no decoder. */
  readSize?: SizeReader;
}) {
  // What was typed is not lost to a click next to the dialog.
  const dirty = useRef(false);
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  // The form stays while the dialog fades out.
  const [shown, setShown] = useState(edit);
  if (edit && edit !== shown) setShown(edit);

  return (
    <Dialog
      open={edit !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        onInteractOutside={(event) => {
          if (dirty.current) event.preventDefault();
        }}
      >
        {shown ? (
          <CategoryForm
            key={
              shown.mode === "edit"
                ? shown.category.id
                : `new-${shown.parentId}`
            }
            edit={shown}
            categories={categories}
            onClose={onClose}
            onDirty={onDirty}
            readSize={readSize}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
