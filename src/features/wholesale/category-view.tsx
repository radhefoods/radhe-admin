"use client";

import { ListOrdered, Warehouse } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Thumb } from "@/components/domain/values";
import {
  BilingualField,
  SwitchField,
  UnsavedGuard,
} from "@/components/form/fields";
import { FormError, useSubmit, useZodForm } from "@/components/form/form";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { CategoryPicture } from "@/features/catalogue/category-picture";
import { moveItem } from "@/features/catalogue/category-tree";
import type { SizeReader } from "@/features/catalogue/image-rules";
import {
  DragHandle,
  SortableList,
  useSortableEntry,
} from "@/features/catalogue/sortable";
import { describeError, errorMessage } from "@/lib/api/error-text";
import { hasErrorCode, isSessionError } from "@/lib/api/errors";
import type {
  Id,
  WholesaleCategory,
  WholesaleProductSummary,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
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
  useCreateWholesaleCategory,
  usePatchWholesaleCategoryImage,
  usePutWholesaleCategoryImage,
  useRemoveWholesaleCategoryImage,
  useReorderWholesaleCategoryProducts,
  useUpdateWholesaleCategory,
  useWholesaleCategories,
  useWholesaleCategoryProducts,
} from "./queries";
import { cartonsText } from "./rules";

const back = {
  href: routes.wholesaleCategories,
  label: "Wholesale categories",
};

// --- The form ----------------------------------------------------------------------

function CategoryForm({
  category,
  onCreated,
  readSize,
}: {
  /** Set when an existing category is changed. */
  category?: WholesaleCategory;
  onCreated?: (category: WholesaleCategory) => void;
  readSize?: SizeReader;
}) {
  const manage = useCan()("wholesale.manage");
  const create = useCreateWholesaleCategory();
  const update = useUpdateWholesaleCategory();
  const putImage = usePutWholesaleCategoryImage(category?.id ?? "");
  const patchImage = usePatchWholesaleCategoryImage(category?.id ?? "");
  const removeImage = useRemoveWholesaleCategoryImage(category?.id ?? "");
  // For a new category: the picture chosen for it, uploaded after the creation.
  const [file, setFile] = useState<File | null>(null);
  const form = useZodForm(categorySchema, {
    defaultValues: categoryDefaults(category),
  });
  const dirty = form.formState.isDirty || file !== null;

  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: CategoryFormValues) => {
      try {
        if (category) {
          const patch = toCategoryPatch(values, category);
          const describe = category.image && altChanged(values, category);
          let saved = category;
          if (Object.keys(patch).length > 0) {
            saved = await update.mutateAsync({ id: category.id, ...patch });
          }
          if (describe) await patchImage.mutateAsync(altOf(values));
          if (Object.keys(patch).length === 0 && !describe) {
            notify.info(
              "Nothing to save",
              "The category already has these values.",
            );
          } else {
            notify.success(`${saved.name.en} saved`);
          }
          form.reset(categoryDefaults(saved));
          return;
        }
        const created = await create.mutateAsync(toCategoryInput(values));
        if (file) {
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
              "With its picture. It is the last in the list.",
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
            "It is the last in the list; drag it where it belongs.",
          );
        }
        form.reset(categoryDefaults(created));
        onCreated?.(created);
      } catch (error) {
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

  const visible = form.watch("isVisible");
  const hasPicture = Boolean(category?.image) || file !== null;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex min-w-0 flex-col gap-6"
    >
      <UnsavedGuard when={dirty && !form.formState.isSubmitSuccessful} />
      <Card aria-label="Category">
        <CardHeader
          title={category ? "Category" : "New category"}
          description={
            category
              ? "Only what you change is saved. A new picture is uploaded at once."
              : "A new category is placed last; drag it where it belongs afterwards."
          }
        />
        <CardBody className="flex flex-col gap-4">
          <fieldset disabled={!manage} className="flex min-w-0 flex-col gap-4">
            <legend className="sr-only">Category</legend>
            <BilingualField
              form={form}
              name="name"
              label="Name"
              requiredEn
              maxLength={160}
            />
            <SwitchField
              form={form}
              name="isVisible"
              label={
                visible
                  ? "Visible on the wholesale site"
                  : "Hidden from the wholesale site"
              }
              disabled={!manage}
              hint="A hidden category and its products are not on the wholesale site. Nothing is deleted."
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
              name="slug"
              label="Address on the wholesale site (slug)"
              maxLength={120}
              hint={
                category
                  ? "Changing it breaks links that point to the old address. Lower-case letters, digits and single hyphens."
                  : "Generated from the names when left empty. Lower-case letters, digits and single hyphens."
              }
            />
          </fieldset>

          <section
            aria-label="Picture"
            className="flex flex-col gap-3 rounded-lg border border-line p-3.5"
          >
            <h3 className="text-13 font-semibold text-ink">Picture</h3>
            <CategoryPicture
              subject={
                category
                  ? {
                      name: category.name.en,
                      image: category.image,
                      put: (input) => putImage.mutateAsync(input),
                      remove: () => removeImage.mutateAsync(),
                    }
                  : undefined
              }
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
                  hint="Read out by screen readers and shown when the picture cannot load. Saved with the category."
                />
              </fieldset>
            ) : null}
          </section>
          <FormError state={state} />
        </CardBody>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {category ? (
          <Button
            variant="ghost"
            size="lg"
            disabled={!dirty || pending}
            onClick={() => form.reset(categoryDefaults(category))}
          >
            Discard changes
          </Button>
        ) : (
          <Button asChild variant="ghost" size="lg">
            <Link href={routes.wholesaleCategories}>Cancel</Link>
          </Button>
        )}
        <ActionButton
          type="submit"
          permission="wholesale.manage"
          variant="primary"
          size="lg"
          loading={pending}
          disabled={Boolean(category) && !dirty}
        >
          {category ? "Save changes" : "Create category"}
        </ActionButton>
      </div>
    </form>
  );
}

// --- The products of the category, in order -------------------------------------------

const COLUMNS =
  "grid grid-cols-[3.25rem_minmax(0,1fr)_2rem] items-center gap-x-3 sm:grid-cols-[3.25rem_minmax(0,1fr)_6.5rem_minmax(8rem,14rem)_2rem]";

function PositionInput({
  position,
  count,
  label,
  disabled,
  onMove,
}: {
  position: number;
  count: number;
  label: string;
  disabled: boolean;
  onMove: (to: number) => void;
}) {
  const [text, setText] = useState(String(position));
  const [known, setKnown] = useState(position);
  if (known !== position) {
    setKnown(position);
    setText(String(position));
  }
  function commit(): void {
    const wanted = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > count) {
      setText(String(position));
      return;
    }
    if (wanted !== position) onMove(wanted - 1);
  }
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      className="h-8 w-13 px-1 text-center tabular"
    />
  );
}

function ProductRow({
  product,
  index,
  count,
  manage,
  busy,
  onMove,
}: {
  product: WholesaleProductSummary;
  index: number;
  count: number;
  manage: boolean;
  busy: boolean;
  onMove: (to: number) => void;
}) {
  const { setNode, style, dragging, setHandle, handleProps } = useSortableEntry(
    product.id,
  );
  const name = translated(product.name);
  return (
    <li
      ref={setNode}
      style={style}
      className={cn(
        "border-t border-line first:border-t-0",
        dragging && "relative z-10 rounded-md bg-surface shadow-pop",
      )}
    >
      <div className={cn(COLUMNS, "py-2 pr-3 pl-1.5")}>
        <div className="flex items-center gap-1">
          <DragHandle
            setHandle={setHandle}
            handleProps={handleProps}
            label={`Move ${name}, place ${index + 1} of ${count}`}
            disabled={!manage || count < 2 || busy}
          />
          {manage ? (
            <PositionInput
              position={index + 1}
              count={count}
              label={`Position of ${name}`}
              disabled={busy || count < 2}
              onMove={onMove}
            />
          ) : (
            <span className="w-13 text-center text-sm text-ink tabular">
              {index + 1}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <Thumb src={product.image?.sizes.small.url} size={36} />
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <Link
                href={routes.wholesaleProduct(product.id)}
                className="truncate text-sm font-semibold text-accent-text hover:underline"
              >
                {name}
              </Link>
              <StatusBadge
                kind="product"
                value={product.status}
                className="sm:hidden"
              />
            </span>
            <span className="truncate text-13 text-ink-subtle sm:hidden">
              {cartonsText(product.skus)}
            </span>
          </div>
        </div>
        <span className="hidden sm:block">
          <StatusBadge kind="product" value={product.status} />
        </span>
        <span className="hidden truncate text-13 text-ink-muted sm:block">
          {cartonsText(product.skus)}
        </span>
        <span />
      </div>
    </li>
  );
}

const sameOrder = (a: readonly Id[], b: readonly Id[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

function ProductsCard({ category }: { category: WholesaleCategory }) {
  const manage = useCan()("wholesale.manage");
  const products = useWholesaleCategoryProducts(category.id);
  const reorder = useReorderWholesaleCategoryProducts(category.id);
  const [draft, setDraft] = useState<Id[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const name = category.name.en;

  const server = products.data;
  const serverIds = server?.map((product) => product.id) ?? [];
  const ids = draft
    ? [
        ...draft.filter((entry) => serverIds.includes(entry)),
        ...serverIds.filter((entry) => !draft.includes(entry)),
      ]
    : serverIds;
  const byId = new Map(server?.map((product) => [product.id, product]));
  const rows = ids
    .map((entry) => byId.get(entry))
    .filter(
      (product): product is WholesaleProductSummary => product !== undefined,
    );
  const dirty = draft !== null && !sameOrder(ids, serverIds);
  const busy = reorder.isPending;

  async function save(): Promise<void> {
    setRefused(null);
    try {
      await reorder.mutateAsync(ids);
      setDraft(null);
      notify.success(
        "Order saved",
        "The wholesale site shows the new order within a minute.",
      );
    } catch (error) {
      if (hasErrorCode(error, "WHOLESALE_PRODUCT_ORDER_INVALID")) {
        setRefused(
          "The products of the category changed in the meantime. The list was loaded again; check it and save once more.",
        );
        setDraft(null);
        void products.refetch();
        return;
      }
      notify.error(error, "The order could not be saved");
    }
  }

  const notice = products.error ? describeError(products.error) : null;

  return (
    <Card
      id="products"
      aria-label="Products in this category"
      className="scroll-mt-20"
    >
      <UnsavedGuard when={dirty} />
      <CardHeader
        title="Products in this category"
        description="The order in which the wholesale site lists them. Drafts and archived products have a place too."
        actions={
          manage && rows.length > 1 ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={!dirty || busy}
                onClick={() => setDraft(null)}
              >
                Discard
              </Button>
              <ActionButton
                permission="wholesale.manage"
                variant="primary"
                size="sm"
                disabled={!dirty}
                loading={busy}
                onClick={() => void save()}
              >
                Save order
              </ActionButton>
            </>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-3">
        {refused ? (
          <Alert
            tone="danger"
            title="The order was not saved"
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRefused(null)}
              >
                Dismiss
              </Button>
            }
          >
            {refused}
          </Alert>
        ) : null}
        {notice && !server ? (
          <Alert
            tone="danger"
            title="The products could not be loaded"
            actions={
              <Button onClick={() => void products.refetch()}>Try again</Button>
            }
          >
            {notice.message}
          </Alert>
        ) : !server ? (
          <div
            role="status"
            aria-label="Loading the products"
            className="flex flex-col gap-3"
          >
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ListOrdered />}
            title={`No products in ${name} yet`}
          >
            A product gets its place here as soon as it is put in this category.
          </EmptyState>
        ) : (
          <>
            <div className="rounded-lg border border-line">
              <div
                aria-hidden="true"
                className={cn(
                  COLUMNS,
                  "rounded-t-lg border-b border-line bg-sunken py-2 pr-3 pl-3.5 text-xs font-semibold text-ink-muted",
                )}
              >
                <span>Place</span>
                <span>Product</span>
                <span className="hidden sm:block">Status</span>
                <span className="hidden sm:block">Cartons</span>
                <span />
              </div>
              <SortableList
                ids={ids}
                labelOf={(entry) => {
                  const product = byId.get(entry);
                  return product ? translated(product.name) : "the product";
                }}
                layout="list"
                disabled={!manage || ids.length < 2 || busy}
                onReorder={setDraft}
              >
                <ul aria-label={`Products of ${name} in display order`}>
                  {rows.map((product, index) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      index={index}
                      count={rows.length}
                      manage={manage}
                      busy={busy}
                      onMove={(to) => setDraft(moveItem(ids, index, to))}
                    />
                  ))}
                </ul>
              </SortableList>
            </div>
            <p className="text-13 text-ink-muted">
              {plural(rows.length, "product")}.{" "}
              {manage
                ? dirty
                  ? "The new order is not saved yet."
                  : "Drag a product by its handle, or type its place and press Enter. Then save."
                : ""}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// --- The pages --------------------------------------------------------------------------

/** The page of a wholesale category: its form with the picture, and its products in order. */
export function CategoryView({ readSize }: { readSize?: SizeReader }) {
  const { id } = useParams<{ id: string }>();
  const categories = useWholesaleCategories();
  const category = categories.data?.items.find((entry) => entry.id === id);

  if (categories.isError) {
    return (
      <RequirePermission permission="wholesale.read">
        <PageHeader title="Wholesale category" back={back} />
        <div className={gutter}>
          <Alert
            tone="danger"
            title="The category could not be loaded"
            actions={
              <Button onClick={() => void categories.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(categories.error)}
          </Alert>
        </div>
      </RequirePermission>
    );
  }
  if (!categories.data) {
    return (
      <RequirePermission permission="wholesale.read">
        <PageHeader title={<Skeleton className="h-9 w-64" />} back={back} />
        <PageBody>
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </PageBody>
      </RequirePermission>
    );
  }
  if (!category) {
    return (
      <RequirePermission permission="wholesale.read">
        <PageHeader title="Wholesale category" back={back} />
        <div className={gutter}>
          <EmptyState icon={<Warehouse />} title="This category does not exist">
            It may have been deleted. The list has every wholesale category.
          </EmptyState>
        </div>
      </RequirePermission>
    );
  }

  return (
    <RequirePermission permission="wholesale.read">
      <PageHeader
        back={back}
        title={category.name.en}
        badges={
          category.isVisible ? null : (
            <span className="rounded-full bg-neutral-bg px-2 text-xs font-semibold text-neutral-fg">
              Hidden
            </span>
          )
        }
        description={
          <>
            {plural(category.productCount, "product")} · /{category.slug.en}
          </>
        }
      />
      <PageBody>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <CategoryForm
            key={category.id}
            category={category}
            readSize={readSize}
          />
          <ProductsCard category={category} />
        </div>
      </PageBody>
    </RequirePermission>
  );
}

/** A new wholesale category: the form alone; its page opens once it exists. */
export function CategoryNewView({ readSize }: { readSize?: SizeReader }) {
  const router = useRouter();
  return (
    <RequirePermission permission="wholesale.manage">
      <PageHeader
        back={back}
        title="New wholesale category"
        description="A group of the wholesale site. Its products are put in order on its page once it exists."
      />
      <PageBody className="max-w-3xl">
        <CategoryForm
          readSize={readSize}
          onCreated={(created) =>
            router.push(routes.wholesaleCategory(created.id))
          }
        />
      </PageBody>
    </RequirePermission>
  );
}
