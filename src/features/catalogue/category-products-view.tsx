"use client";

import { ListOrdered } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Thumb } from "@/components/domain/values";
import { UnsavedGuard } from "@/components/form/fields";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { describeError } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { Category, Id, ProductSummary } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { moveItem } from "./category-tree";
import {
  useCategories,
  useCategoryProducts,
  useReorderCategoryProducts,
} from "./queries";
import { DragHandle, SortableList, useSortableEntry } from "./sortable";

const COLUMNS =
  "grid grid-cols-[3.25rem_minmax(0,1fr)_2rem] items-center gap-x-3 sm:grid-cols-[3.25rem_minmax(0,1fr)_6.5rem_minmax(8rem,14rem)_2rem]";

/** The place of a row, 1 first, typed: Enter or leaving the field moves the row. */
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
  // The field follows the row when it is moved by other means.
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

function Row({
  product,
  index,
  count,
  manage,
  busy,
  onMove,
}: {
  product: ProductSummary;
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
  const german = product.name.de?.trim();
  const sizes = product.variants.map((variant) => variant.packSize.label);
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
                href={routes.product(product.id)}
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
            <span className="truncate text-13 text-ink-subtle">
              {german ? <span lang="de">{german}</span> : null}
              <span className="sm:hidden">
                {german ? " · " : ""}
                {sizes.join(", ")}
              </span>
            </span>
          </div>
        </div>
        <span className="hidden sm:block">
          <StatusBadge kind="product" value={product.status} />
        </span>
        <span className="hidden truncate text-13 text-ink-muted sm:block">
          {sizes.join(", ")}
        </span>
        <span />
      </div>
    </li>
  );
}

const sameOrder = (a: readonly Id[], b: readonly Id[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * The display order of the products directly in a category (7): dragged
 * by the handle, moved with the keyboard, or placed by a typed position;
 * saved as the whole list, which the API answers in its new order.
 */
export function CategoryProductsView() {
  const { id } = useParams<{ id: string }>();
  const manage = useCan()("catalog.manage");
  const categories = useCategories();
  const products = useCategoryProducts(id);
  const reorder = useReorderCategoryProducts(id);
  const [draft, setDraft] = useState<Id[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const flat = categories.data?.items;
  const category = flat?.find((entry) => entry.id === id) ?? null;
  const children = flat?.filter((entry) => entry.parentId === id) ?? [];
  const name = category ? translated(category.name) : "the category";
  const back = { href: routes.categories, label: "Categories" };

  const server = products.data;
  const serverIds = server?.map((product) => product.id) ?? [];
  // The draft keeps its order; a product that appeared meanwhile joins at the end.
  const ids = draft
    ? [
        ...draft.filter((entry) => serverIds.includes(entry)),
        ...serverIds.filter((entry) => !draft.includes(entry)),
      ]
    : serverIds;
  const byId = new Map(server?.map((product) => [product.id, product]));
  const rows = ids
    .map((entry) => byId.get(entry))
    .filter((product): product is ProductSummary => product !== undefined);
  const dirty = draft !== null && !sameOrder(ids, serverIds);
  const busy = reorder.isPending;

  async function save(): Promise<void> {
    setRefused(null);
    try {
      await reorder.mutateAsync(ids);
      setDraft(null);
      notify.success(
        "Order saved",
        "The shop shows the new order within five minutes.",
      );
    } catch (error) {
      if (hasErrorCode(error, "CATEGORY_PRODUCT_ORDER_INVALID")) {
        const unknown = error.details?.unknown ?? [];
        const names = unknown.map((entry) =>
          byId.has(entry) ? translated(byId.get(entry)!.name) : "a product",
        );
        setRefused(
          names.length > 0
            ? `${names.join(", ")} ${names.length === 1 ? "is" : "are"} no longer in ${name}: moved or deleted in the meantime. The list was loaded again; check it and save once more.`
            : "The products of the category changed in the meantime. The list was loaded again; check it and save once more.",
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
    <RequirePermission permission="catalog.read">
      <UnsavedGuard when={dirty} />
      <PageHeader
        title={
          category ? (
            `Product order: ${name}`
          ) : categories.isPending ? (
            <Skeleton className="h-9 w-64" />
          ) : (
            "Product order"
          )
        }
        back={back}
        description="The order in which the shop lists the products of this category: on its page, in the home-page rows and in lists that span several categories. Drafts and archived products have a place too, so a product can be placed before it goes live."
        actions={
          manage && rows.length > 1 ? (
            <>
              <Button
                variant="ghost"
                disabled={!dirty || busy}
                onClick={() => setDraft(null)}
              >
                Discard changes
              </Button>
              <ActionButton
                permission="catalog.manage"
                variant="primary"
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
      <PageBody className="gap-3">
        {children.length > 0 ? (
          <Alert tone="info" title="Sub-categories have an order of their own">
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {children.map((child: Category) => (
                <Link
                  key={child.id}
                  href={routes.categoryProducts(child.id)}
                  className="font-medium text-accent-text hover:underline"
                >
                  {translated(child.name)}
                </Link>
              ))}
            </span>
          </Alert>
        ) : null}

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
            className="flex flex-col divide-y divide-line rounded-lg border border-line"
          >
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-3.5 py-3">
                <Skeleton className="h-8 w-13" />
                <Skeleton className="size-9 rounded-md" />
                <Skeleton className="w-48" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-line">
            <EmptyState
              icon={<ListOrdered />}
              title={`No products directly in ${name}`}
              action={
                <Button asChild>
                  <Link href={routes.categories}>Back to the categories</Link>
                </Button>
              }
            >
              {children.length > 0
                ? "Its products are in the sub-categories above, each with an order of its own."
                : "A product gets its place here as soon as it is put in this category."}
            </EmptyState>
          </div>
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
                <span className="hidden sm:block">Pack sizes</span>
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
                    <Row
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
              {plural(rows.length, "product")} directly in {name}.{" "}
              {manage
                ? dirty
                  ? "The new order is not saved yet."
                  : "Drag a product by its handle, focus the handle and use Space and the arrow keys, or type its place and press Enter. Then save."
                : "The order is set by an admin with the catalogue permission."}
            </p>
          </>
        )}
      </PageBody>
    </RequirePermission>
  );
}
