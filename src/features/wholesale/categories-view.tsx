"use client";

import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  PencilLine,
  Plus,
  Trash2,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { Thumb } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/controls";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { moveItem } from "@/features/catalogue/category-tree";
import { ImportExportButton } from "@/features/catalogue/import-export-dialog";
import {
  DragHandle,
  SortableList,
  useSortableEntry,
} from "@/features/catalogue/sortable";
import { describeError } from "@/lib/api/error-text";
import type { Id, WholesaleCategory } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";
import { routes, withQuery } from "@/lib/routes";
import {
  useDeleteWholesaleCategory,
  useReorderWholesaleCategories,
  useUpdateWholesaleCategory,
  useWholesaleCategories,
} from "./queries";
import { WHOLESALE_SHEETS } from "./sheets";

interface Actions {
  manage: boolean;
  setVisible: (category: WholesaleCategory, visible: boolean) => void;
  remove: (category: WholesaleCategory) => void;
  reorder: (orderedIds: Id[]) => void;
}

const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_7rem_2rem]";

function Row({
  category,
  index,
  ids,
  actions,
}: {
  category: WholesaleCategory;
  index: number;
  ids: Id[];
  actions: Actions;
}) {
  const { setNode, style, dragging, setHandle, handleProps } = useSortableEntry(
    category.id,
  );
  const { manage } = actions;
  const name = category.name.en;
  const german = category.name.de?.trim();
  const products = (
    <span className="tabular">{plural(category.productCount, "product")}</span>
  );
  const productsHref = withQuery(routes.wholesaleProducts, {
    categoryId: category.id,
  });

  return (
    <li
      ref={setNode}
      style={style}
      className={cn(
        "border-t border-line first:border-t-0",
        dragging && "relative z-10 rounded-md bg-surface shadow-pop",
      )}
    >
      <div className={cn(COLUMNS, "py-2 pr-2 pl-1.5")}>
        <div className="flex min-w-0 items-center gap-2">
          <DragHandle
            setHandle={setHandle}
            handleProps={handleProps}
            label={`Move ${name}, place ${index + 1} of ${ids.length}`}
            disabled={!manage || ids.length < 2}
          />
          <Thumb
            src={category.image?.sizes.small.url}
            alt={category.image?.alt?.en ?? ""}
            size={36}
          />
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <Link
                href={routes.wholesaleCategory(category.id)}
                className={cn(
                  "truncate rounded-xs text-sm font-semibold hover:underline",
                  category.isVisible ? "text-accent-text" : "text-ink-muted",
                )}
              >
                {name}
              </Link>
              {category.isVisible ? null : <Badge tone="neutral">Hidden</Badge>}
              {german ? null : (
                <Badge tone="attention">German is missing</Badge>
              )}
            </span>
            <span className="truncate text-13 text-ink-subtle">
              {german ? <span lang="de">{german}</span> : null}
              {german ? " · " : ""}
              <span className="tabular">/{category.slug.en}</span>
              <span className="sm:hidden">
                {" · "}
                {category.productCount > 0 ? (
                  <Link
                    href={productsHref}
                    className="text-accent-text hover:underline"
                  >
                    {products}
                  </Link>
                ) : (
                  "No products"
                )}
              </span>
            </span>
          </div>
        </div>

        <label className="flex items-center gap-2 text-13 text-ink-muted">
          <Switch
            checked={category.isVisible}
            disabled={!manage}
            aria-label={`${name} is visible on the wholesale site`}
            onCheckedChange={(visible) => actions.setVisible(category, visible)}
          />
          <span className="hidden sm:inline" aria-hidden="true">
            {category.isVisible ? "Visible" : "Hidden"}
          </span>
        </label>

        <span className="hidden text-right text-13 sm:block">
          {category.productCount > 0 ? (
            <Link
              href={productsHref}
              className="font-medium text-accent-text hover:underline"
              aria-label={`${plural(category.productCount, "product")} in ${name}: open the list`}
            >
              {products}
            </Link>
          ) : (
            <span className="text-ink-subtle">No products</span>
          )}
        </span>

        {manage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${name}`}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem asChild>
                <Link href={routes.wholesaleCategory(category.id)}>
                  <PencilLine />
                  Edit
                </Link>
              </DropdownMenuItem>
              {ids.length > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() =>
                      actions.reorder(moveItem(ids, index, index - 1))
                    }
                  >
                    <ArrowUp />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === ids.length - 1}
                    onSelect={() =>
                      actions.reorder(moveItem(ids, index, index + 1))
                    }
                  >
                    <ArrowDown />
                    Move down
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                danger
                onSelect={() => actions.remove(category)}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span />
        )}
      </div>
    </li>
  );
}

/** Why a category cannot be deleted yet, and what to do about it. */
function NotEmptyDialog({
  category,
  onClose,
}: {
  category: WholesaleCategory | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(category);
  if (category && category !== shown) setShown(category);
  const name = shown?.name.en ?? "";
  return (
    <Dialog
      open={category !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm" hideClose>
        <DialogHeader
          title={`${name} cannot be deleted yet`}
          description={`Only an empty category can be deleted, and ${name} still holds ${plural(shown?.productCount ?? 0, "product")}. Give them another wholesale category first. To take ${name} off the wholesale site without moving anything, hide it instead.`}
          className="pb-5"
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="lg">
              Close
            </Button>
          </DialogClose>
          {shown ? (
            <Button asChild size="lg" variant="primary">
              <Link
                href={withQuery(routes.wholesaleProducts, {
                  categoryId: shown.id,
                })}
              >
                Open the products
              </Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The wholesale categories (25, section 3): a flat list in display order, dragged into place. */
export function CategoriesView() {
  const manage = useCan()("wholesale.manage");
  const categories = useWholesaleCategories();
  const update = useUpdateWholesaleCategory();
  const remove = useDeleteWholesaleCategory();
  const reorder = useReorderWholesaleCategories();
  const [hiding, setHiding] = useState<WholesaleCategory | null>(null);
  const [deleting, setDeleting] = useState<WholesaleCategory | null>(null);
  const [notEmpty, setNotEmpty] = useState<WholesaleCategory | null>(null);

  const items = categories.data?.items;
  const ids = items?.map((entry) => entry.id) ?? [];
  const names = new Map(items?.map((entry) => [entry.id, entry.name.en]));

  async function setVisible(category: WholesaleCategory, visible: boolean) {
    if (!visible) {
      setHiding(category);
      return;
    }
    try {
      await update.mutateAsync({ id: category.id, isVisible: true });
      notify.success(
        `${category.name.en} is visible on the wholesale site again`,
      );
    } catch (error) {
      notify.error(error);
    }
  }

  const actions: Actions = {
    manage,
    setVisible: (category, visible) => void setVisible(category, visible),
    remove: (category) => {
      if (category.productCount === 0) setDeleting(category);
      else setNotEmpty(category);
    },
    reorder: (orderedIds) => reorder.mutate(orderedIds),
  };
  const notice = categories.error ? describeError(categories.error) : null;

  return (
    <RequirePermission permission="wholesale.read">
      <PageHeader
        title="Wholesale categories"
        description="The groups of the wholesale site, in this order. A product belongs to one category; a hidden category and its products are not on the site."
        actions={
          <>
            <ImportExportButton
              type="categories"
              catalogue={WHOLESALE_SHEETS}
            />
            {manage ? (
              <Button asChild variant="primary">
                <Link href={routes.wholesaleCategoryNew}>
                  <Plus />
                  New category
                </Link>
              </Button>
            ) : (
              <ActionButton
                permission="wholesale.manage"
                variant="primary"
                icon={<Plus />}
              >
                New category
              </ActionButton>
            )}
          </>
        }
      />
      <PageBody className="gap-3">
        {notice && !items ? (
          <Alert
            tone="danger"
            title="The categories could not be loaded"
            actions={
              <Button onClick={() => void categories.refetch()}>
                Try again
              </Button>
            }
          >
            {notice.message}
          </Alert>
        ) : !items ? (
          <div
            role="status"
            aria-label="Loading the categories"
            className="flex flex-col divide-y divide-line rounded-lg border border-line"
          >
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-3.5 py-3">
                <Skeleton className="size-9 rounded-md" />
                <Skeleton className="w-40" />
                <Skeleton className="ml-auto w-20" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-line">
            <EmptyState
              icon={<Warehouse />}
              title="No wholesale category yet"
              action={
                manage ? (
                  <Button asChild variant="primary">
                    <Link href={routes.wholesaleCategoryNew}>
                      Create the first category
                    </Link>
                  </Button>
                ) : null
              }
            >
              Every wholesale product belongs to a category, so the wholesale
              catalogue starts here.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-line">
              <div
                aria-hidden="true"
                className={cn(
                  COLUMNS,
                  "rounded-t-lg border-b border-line bg-sunken py-2 pr-2 pl-3.5 text-xs font-semibold text-ink-muted",
                )}
              >
                <span>Category</span>
                <span>On the site</span>
                <span className="hidden text-right sm:block">Products</span>
                <span />
              </div>
              <SortableList
                ids={ids}
                labelOf={(id) => names.get(id) ?? "the category"}
                layout="list"
                disabled={!manage || ids.length < 2}
                onReorder={(ordered) => reorder.mutate(ordered)}
              >
                <ul aria-label="Wholesale categories in display order">
                  {items.map((category, index) => (
                    <Row
                      key={category.id}
                      category={category}
                      index={index}
                      ids={ids}
                      actions={actions}
                    />
                  ))}
                </ul>
              </SortableList>
            </div>
            <p className="text-13 text-ink-muted">
              {plural(items.length, "category", "categories")}.{" "}
              {manage
                ? "Drag a category by its handle to change its place, or focus the handle and use Space and the arrow keys. The order is saved at once."
                : "The order is set by an admin with the wholesale permission."}
            </p>
          </>
        )}
      </PageBody>

      <ConfirmDialog
        open={hiding !== null}
        onOpenChange={(open) => {
          if (!open) setHiding(null);
        }}
        title={`Hide ${hiding?.name.en ?? "the category"} from the wholesale site?`}
        description="A hidden category and its products disappear from the wholesale site until it is shown again. Nothing is deleted, and quotations are not touched."
        facts={[
          {
            label: "Products in it",
            value: hiding?.productCount ?? 0,
            strong: true,
          },
        ]}
        confirmLabel="Hide the category"
        cancelLabel="Keep it visible"
        onConfirm={async () => {
          if (!hiding) return;
          await update.mutateAsync({ id: hiding.id, isVisible: false });
          notify.success(`${hiding.name.en} is hidden from the wholesale site`);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete the category ${deleting?.name.en ?? ""}?`}
        description={`It is removed for good${deleting?.image ? ", with its picture" : ""}. It has no products.`}
        confirmLabel="Delete the category"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync(deleting.id);
          notify.success(`${deleting.name.en} deleted`);
        }}
      />

      <NotEmptyDialog category={notEmpty} onClose={() => setNotEmpty(null)} />
    </RequirePermission>
  );
}
