"use client";

import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  Ellipsis,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import type { BlogCategory, Id } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural, translated } from "@/lib/format/names";
import { routes, withQuery } from "@/lib/routes";
import { moveItem } from "@/features/catalogue/category-tree";
import {
  DragHandle,
  SortableList,
  useSortableEntry,
} from "@/features/catalogue/sortable";
import { CategoryDialog, type CategoryEdit } from "./category-dialog";
import {
  useBlogCategories,
  useDeleteBlogCategory,
  useReorderBlogCategories,
} from "./queries";

interface Actions {
  manage: boolean;
  busy: boolean;
  edit: (category: BlogCategory) => void;
  remove: (category: BlogCategory) => void;
  reorder: (orderedIds: Id[]) => void;
}

const COLUMNS =
  "grid grid-cols-[auto_minmax(0,1fr)_2rem] items-center gap-x-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(8rem,12rem)_7rem_2rem]";

function Row({
  category,
  index,
  ids,
  actions,
}: {
  category: BlogCategory;
  index: number;
  ids: Id[];
  actions: Actions;
}) {
  const { setNode, style, dragging, setHandle, handleProps } = useSortableEntry(
    category.id,
  );
  const { manage, busy } = actions;
  const name = translated(category.name);
  const german = category.name.de?.trim();
  const posts = category.postCount ?? 0;
  return (
    <li
      ref={setNode}
      style={style}
      className={cn(
        "border-t border-line first:border-t-0",
        dragging && "relative z-10 rounded-md bg-surface shadow-pop",
      )}
    >
      <div className={cn(COLUMNS, "py-2.5 pr-2 pl-1.5")}>
        <DragHandle
          setHandle={setHandle}
          handleProps={handleProps}
          label={`Move ${name}, place ${index + 1} of ${ids.length}`}
          disabled={!manage || ids.length < 2 || busy}
        />
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            onClick={() => actions.edit(category)}
            className="truncate rounded-xs text-left text-sm font-semibold text-accent-text hover:underline"
          >
            {name}
          </button>
          <span className="truncate text-13 text-ink-subtle">
            {german ? (
              <>
                <span lang="de">{german}</span> ·{" "}
              </>
            ) : null}
            <span className="font-mono text-xs">/{category.slug.en}</span>
            <span className="sm:hidden">
              {" "}
              · {plural(posts, "post")}, {category.publishedCount ?? 0}{" "}
              published
            </span>
          </span>
        </div>
        <span className="hidden text-13 text-ink-muted sm:block">
          <Link
            href={withQuery(routes.blog, { categoryId: category.id })}
            className="hover:underline"
          >
            {plural(posts, "post")}
          </Link>
          , {category.publishedCount ?? 0} published
        </span>
        <span className="hidden truncate font-mono text-xs text-ink-subtle sm:block">
          /{category.slug.de}
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
                disabled={posts > 0}
                onSelect={() => actions.remove(category)}
              >
                <Trash2 />
                <span className="flex flex-col">
                  Delete
                  {posts > 0 ? (
                    <span className="text-xs font-normal text-ink-subtle">
                      Move its posts to another category first
                    </span>
                  ) : null}
                </span>
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

/** The categories of the blog (23), in the order the shop lists them. */
export function BlogCategoriesView() {
  const manage = useCan()("content.manage");
  const categories = useBlogCategories();
  const remove = useDeleteBlogCategory();
  const reorder = useReorderBlogCategories();
  const [edit, setEdit] = useState<CategoryEdit | null>(null);
  const [deleting, setDeleting] = useState<BlogCategory | null>(null);

  const items = categories.data?.items;
  const loose = categories.data?.uncategorized ?? { total: 0, published: 0 };
  const ids = useMemo(
    () => items?.map((category) => category.id) ?? [],
    [items],
  );
  const actions: Actions = {
    manage,
    busy: reorder.isPending,
    edit: (category) => setEdit({ mode: "edit", category }),
    remove: (category) => setDeleting(category),
    reorder: (orderedIds) =>
      reorder.mutate(orderedIds, { onError: (error) => notify.error(error) }),
  };
  const notice = categories.error ? describeError(categories.error) : null;

  return (
    <RequirePermission permission="content.read">
      <PageHeader
        title="Blog categories"
        back={{ href: routes.blog, label: "Blog" }}
        description="The sections of the blog, as the shop lists them: in this order, each with its address, description and SEO fields. A category with posts cannot be deleted."
        actions={
          <ActionButton
            permission="content.manage"
            variant="primary"
            icon={<Plus />}
            onClick={() => setEdit({ mode: "new" })}
          >
            New category
          </ActionButton>
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
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-3.5 py-3">
                <Skeleton className="w-40" />
                <Skeleton className="ml-auto w-20" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-line">
            <EmptyState
              icon={<BookOpenText />}
              title="No category yet"
              action={
                manage ? (
                  <Button
                    variant="primary"
                    onClick={() => setEdit({ mode: "new" })}
                  >
                    Create the first category
                  </Button>
                ) : null
              }
            >
              Posts need no category; categories group them for the readers of
              the shop.
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
                <span />
                <span>Category</span>
                <span className="hidden sm:block">Posts</span>
                <span className="hidden sm:block">German address</span>
                <span />
              </div>
              <SortableList
                ids={ids}
                labelOf={(id) => {
                  const category = items.find((entry) => entry.id === id);
                  return category ? translated(category.name) : "the category";
                }}
                layout="list"
                disabled={!manage || ids.length < 2 || reorder.isPending}
                onReorder={actions.reorder}
              >
                <ul aria-label="Blog categories in display order">
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
              {plural(loose.total, "post")} without a category,{" "}
              {loose.published} of them published.{" "}
              {manage
                ? "Drag a category by its handle, or focus the handle and use Space and the arrow keys. The order is saved at once."
                : "The order here is the order of the shop."}
            </p>
          </>
        )}
      </PageBody>

      <CategoryDialog edit={edit} onClose={() => setEdit(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting ? translated(deleting.name) : "the category"}?`}
        description="The category is removed for good. It has no posts, so nothing else changes."
        confirmLabel="Delete the category"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync(deleting.id);
          notify.success(`${translated(deleting.name)} deleted`);
        }}
      />
    </RequirePermission>
  );
}
