"use client";

import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  FolderPlus,
  FolderTree,
  ImagePlus,
  Image as ImageIcon,
  ListOrdered,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
import { describeError } from "@/lib/api/error-text";
import type { Category, Id } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";
import { routes, withQuery } from "@/lib/routes";
import { CategoryDialog, type CategoryEdit } from "./category-dialog";
import {
  MAX_CATEGORY_LEVEL,
  buildTree,
  descendantIds,
  moveItem,
  siblingsOf,
  type CategoryNode,
} from "./category-tree";
import type { SizeReader } from "./image-rules";
import { ImportExportButton } from "./import-export-dialog";
import {
  useCategories,
  useDeleteCategory,
  useReorderCategories,
  useUpdateCategory,
} from "./queries";
import { DragHandle, SortableList, useSortableEntry } from "./sortable";

interface Actions {
  manage: boolean;
  edit: (category: Category) => void;
  /** The display order of the products directly in the category. */
  order: (category: Category) => void;
  addBelow: (category: Category) => void;
  setVisible: (category: Category, visible: boolean) => void;
  remove: (category: Category) => void;
  reorder: (parentId: Id | null, orderedIds: Id[]) => void;
}

const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_7rem_2rem]";

function Row({
  node,
  index,
  siblingIds,
  actions,
}: {
  node: CategoryNode;
  index: number;
  siblingIds: Id[];
  actions: Actions;
}) {
  const { category, children } = node;
  const { setNode, style, dragging, setHandle, handleProps } = useSortableEntry(
    category.id,
  );
  const { manage } = actions;
  const movable = manage && siblingIds.length > 1;
  const name = category.name.en;
  const german = category.name.de?.trim();
  const products = (
    <span className="tabular">{plural(category.productCount, "product")}</span>
  );
  const productsHref = withQuery(routes.products, { categoryId: category.id });

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
            label={`Move ${name}, place ${index + 1} of ${siblingIds.length}`}
            disabled={!movable}
          />
          {manage ? (
            <button
              type="button"
              onClick={() => actions.edit(category)}
              aria-label={
                category.image
                  ? `Picture of ${name}: edit the category`
                  : `Add a picture to ${name}: edit the category`
              }
              className="relative shrink-0 rounded-md"
            >
              <Thumb src={category.image?.sizes.small.url} size={36} />
              {category.image ? null : (
                <ImagePlus
                  aria-hidden="true"
                  className="absolute inset-0 m-auto size-4 text-ink-subtle"
                />
              )}
            </button>
          ) : (
            <Thumb
              src={category.image?.sizes.small.url}
              alt={category.image?.alt?.en ?? ""}
              size={36}
            />
          )}
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <button
                type="button"
                onClick={() => actions.edit(category)}
                className={cn(
                  "truncate rounded-xs text-left text-sm font-semibold hover:underline",
                  category.isVisible ? "text-accent-text" : "text-ink-muted",
                  category.level === 1 ? "" : "font-medium",
                )}
              >
                {name}
              </button>
              {category.isVisible ? null : <Badge tone="neutral">Hidden</Badge>}
              {german ? null : (
                <Badge tone="attention">German is missing</Badge>
              )}
            </span>
            <span className="truncate text-13 text-ink-subtle">
              {german ? <span lang="de">{german}</span> : null}
              <span className="sm:hidden">
                {german ? " · " : ""}
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
            aria-label={`${name} is visible in the shop`}
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
              <DropdownMenuItem onSelect={() => actions.edit(category)}>
                <PencilLine />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.edit(category)}>
                <ImageIcon />
                {category.image ? "Picture" : "Add a picture"}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={category.productCount === 0}
                onSelect={() => actions.order(category)}
              >
                <ListOrdered />
                Product order
              </DropdownMenuItem>
              {category.level < MAX_CATEGORY_LEVEL ? (
                <DropdownMenuItem onSelect={() => actions.addBelow(category)}>
                  <FolderPlus />
                  Add a sub-category
                </DropdownMenuItem>
              ) : null}
              {siblingIds.length > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() =>
                      actions.reorder(
                        category.parentId,
                        moveItem(siblingIds, index, index - 1),
                      )
                    }
                  >
                    <ArrowUp />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === siblingIds.length - 1}
                    onSelect={() =>
                      actions.reorder(
                        category.parentId,
                        moveItem(siblingIds, index, index + 1),
                      )
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

      {children.length > 0 ? (
        <Branch
          nodes={children}
          parentId={category.id}
          parentName={name}
          actions={actions}
        />
      ) : null}
    </li>
  );
}

/** The categories of one parent: they can be put in a new order among themselves. */
function Branch({
  nodes,
  parentId,
  parentName,
  actions,
}: {
  nodes: CategoryNode[];
  parentId: Id | null;
  parentName: string | null;
  actions: Actions;
}) {
  const ids = nodes.map((node) => node.category.id);
  const names = new Map(
    nodes.map((node) => [node.category.id, node.category.name.en]),
  );
  return (
    <SortableList
      ids={ids}
      labelOf={(id) => names.get(id) ?? "the category"}
      layout="list"
      disabled={!actions.manage || ids.length < 2}
      onReorder={(ordered) => actions.reorder(parentId, ordered)}
    >
      <ul
        aria-label={
          parentName ? `Sub-categories of ${parentName}` : "Main categories"
        }
        className={cn(
          parentId !== null && "ml-5 border-t border-l border-line sm:ml-9",
        )}
      >
        {nodes.map((node, index) => (
          <Row
            key={node.category.id}
            node={node}
            index={index}
            siblingIds={ids}
            actions={actions}
          />
        ))}
      </ul>
    </SortableList>
  );
}

/** Why a category cannot be deleted yet, and what to do about it. */
function NotEmptyDialog({
  category,
  subCategories,
  manage,
  onClose,
  onHide,
}: {
  category: Category | null;
  subCategories: number;
  manage: boolean;
  onClose: () => void;
  onHide: (category: Category) => void;
}) {
  const [shown, setShown] = useState(category);
  if (category && category !== shown) setShown(category);
  const name = shown?.name.en ?? "";
  const hasChildren = subCategories > 0;
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
          description={
            hasChildren
              ? `Only an empty category can be deleted, and ${name} still has ${plural(subCategories, "sub-category", "sub-categories")}. Move them to another category (Edit, then Parent) or delete them first.`
              : `Only an empty category can be deleted, and ${name} still holds ${plural(shown?.productCount ?? 0, "product")}. Give them another category first. To take ${name} out of the shop without moving anything, hide it instead.`
          }
          className="pb-5"
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="lg">
              Close
            </Button>
          </DialogClose>
          {shown && !hasChildren ? (
            <Button asChild size="lg">
              <Link href={withQuery(routes.products, { categoryId: shown.id })}>
                Open the products
              </Link>
            </Button>
          ) : null}
          {shown && manage && shown.isVisible ? (
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                onClose();
                onHide(shown);
              }}
            >
              Hide it instead
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CategoriesView({
  readSize,
}: {
  /** How the size of a picture is read; tests have no decoder. */
  readSize?: SizeReader;
} = {}) {
  const manage = useCan()("catalog.manage");
  const router = useRouter();
  const categories = useCategories();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const reorder = useReorderCategories();

  const [edit, setEdit] = useState<CategoryEdit | null>(null);
  const [hiding, setHiding] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [notEmpty, setNotEmpty] = useState<Category | null>(null);

  const flat = categories.data?.items;
  const tree = useMemo(() => (flat ? buildTree(flat) : []), [flat]);
  const below = (category: Category | null) =>
    category && flat ? descendantIds(flat, category.id).size - 1 : 0;

  async function setVisible(
    category: Category,
    visible: boolean,
  ): Promise<void> {
    if (!visible) {
      setHiding(category);
      return;
    }
    try {
      await update.mutateAsync({ id: category.id, isVisible: true });
      notify.success(`${category.name.en} is visible in the shop again`);
    } catch (error) {
      notify.error(error);
    }
  }

  // The category as the list has it now: a picture uploaded in the form
  // shows in the form at once.
  const current = useMemo<CategoryEdit | null>(
    () =>
      edit?.mode === "edit"
        ? {
            mode: "edit",
            category:
              flat?.find((entry) => entry.id === edit.category.id) ??
              edit.category,
          }
        : edit,
    [edit, flat],
  );
  const actions: Actions = {
    manage,
    edit: (category) => setEdit({ mode: "edit", category }),
    order: (category) => router.push(routes.categoryProducts(category.id)),
    addBelow: (category) => setEdit({ mode: "create", parentId: category.id }),
    setVisible: (category, visible) => void setVisible(category, visible),
    remove: (category) => {
      const empty =
        category.productCount === 0 &&
        (flat ? siblingsOf(flat, category.id).length === 0 : true);
      if (empty) setDeleting(category);
      else setNotEmpty(category);
    },
    reorder: (parentId, orderedIds) => reorder.mutate({ parentId, orderedIds }),
  };

  const notice = categories.error ? describeError(categories.error) : null;

  return (
    <RequirePermission permission="catalog.read">
      <PageHeader
        title="Categories"
        description="The tree of the shop, at most three levels deep. A product belongs to one category; the listing of a category includes the products of the categories below it."
        actions={
          <>
            <ImportExportButton type="categories" />
            <ActionButton
              permission="catalog.manage"
              variant="primary"
              icon={<Plus />}
              onClick={() => setEdit({ mode: "create", parentId: null })}
            >
              New category
            </ActionButton>
          </>
        }
      />
      <PageBody className="gap-3">
        {notice && !flat ? (
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
            {notice.requestId ? (
              <span className="mt-1 block font-mono text-2xs">
                {notice.technical} · Request {notice.requestId}
              </span>
            ) : null}
          </Alert>
        ) : !flat ? (
          <div
            role="status"
            aria-label="Loading the categories"
            className="flex flex-col divide-y divide-line rounded-lg border border-line"
          >
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-3.5 py-3">
                <Skeleton
                  className={cn("size-9 rounded-md", index % 3 !== 0 && "ml-9")}
                />
                <Skeleton className="w-40" />
                <Skeleton className="ml-auto w-20" />
              </div>
            ))}
          </div>
        ) : flat.length === 0 ? (
          <div className="rounded-lg border border-line">
            <EmptyState
              icon={<FolderTree />}
              title="No category yet"
              action={
                manage ? (
                  <Button
                    variant="primary"
                    onClick={() => setEdit({ mode: "create", parentId: null })}
                  >
                    Create the first category
                  </Button>
                ) : null
              }
            >
              Every product belongs to a category, so the catalogue starts here:
              create the main categories first, then the ones below them.
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
                <span>In the shop</span>
                <span className="hidden text-right sm:block">Products</span>
                <span />
              </div>
              <Branch
                nodes={tree}
                parentId={null}
                parentName={null}
                actions={actions}
              />
            </div>
            <p className="text-13 text-ink-muted">
              {plural(flat.length, "category", "categories")}.{" "}
              {manage
                ? "Drag a category by its handle to change its place among the categories of the same parent, or focus the handle and use Space and the arrow keys. To move it to another parent, edit it."
                : "The product count of a category includes the categories below it."}
            </p>
          </>
        )}
      </PageBody>

      <CategoryDialog
        edit={current}
        categories={flat ?? []}
        onClose={() => setEdit(null)}
        readSize={readSize}
      />

      <ConfirmDialog
        open={hiding !== null}
        onOpenChange={(open) => {
          if (!open) setHiding(null);
        }}
        title={`Hide ${hiding?.name.en ?? "the category"} from the shop?`}
        description="A hidden category and its products disappear from the shop until it is shown again. Nothing is deleted, and orders that exist are not touched."
        facts={[
          {
            label: "Products in it and below",
            value: hiding?.productCount ?? 0,
            strong: true,
          },
          ...(below(hiding) > 0
            ? [{ label: "Sub-categories", value: below(hiding) }]
            : []),
        ]}
        confirmLabel="Hide the category"
        cancelLabel="Keep it visible"
        onConfirm={async () => {
          if (!hiding) return;
          await update.mutateAsync({ id: hiding.id, isVisible: false });
          notify.success(`${hiding.name.en} is hidden from the shop`);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete the category ${deleting?.name.en ?? ""}?`}
        description={`It is removed for good${deleting?.image ? ", with its picture" : ""}. It has no products and no sub-categories.`}
        confirmLabel="Delete the category"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync(deleting.id);
          notify.success(`${deleting.name.en} deleted`);
        }}
      />

      <NotEmptyDialog
        category={notEmpty}
        subCategories={
          notEmpty && flat ? siblingsOf(flat, notEmpty.id).length : 0
        }
        manage={manage}
        onClose={() => setNotEmpty(null)}
        onHide={(category) => setHiding(category)}
      />
    </RequirePermission>
  );
}
