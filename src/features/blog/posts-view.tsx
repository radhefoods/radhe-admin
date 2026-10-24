"use client";

import { BookOpenText, Newspaper, Plus } from "lucide-react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
  SortSelect,
  type SortOption,
} from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Thumb, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/surface";
import {
  BLOG_POST_SORTS,
  BLOG_RULES,
  type BlogPostSort,
  type BlogPostStatus,
  type BlogPostSummary,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { translated } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { BLOG_VISIBILITY } from "@/lib/status";
import { useBlogCategories, useBlogPosts, useBlogTags } from "./queries";

const STATUSES: readonly BlogPostStatus[] = ["draft", "published"];

/** The orders of the list the API offers (23). */
const SORTS: readonly SortOption<BlogPostSort>[] = [
  { value: "updated", label: "Last changed first" },
  { value: "newest", label: "Newest first" },
  { value: "published", label: "By date of the article" },
  { value: "title", label: "Title A to Z" },
];

function PostTitle({ post }: { post: BlogPostSummary }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Thumb
        src={post.featuredImage?.sizes.small.url}
        size={40}
        className="aspect-[12/5] !w-16"
      />
      <TwoLine
        primary={
          <Link
            href={routes.blogPost(post.id)}
            className="font-semibold text-accent-text hover:underline"
          >
            {post.title.en}
          </Link>
        }
        secondary={
          post.title.de ? (
            <span lang="de">{post.title.de}</span>
          ) : (
            "No German title yet"
          )
        }
      />
    </span>
  );
}

// From `lg` on the table is not allowed to scroll sideways (its header
// sticks to the page), so the columns shown at each width must fit it.
const columns: Column<BlogPostSummary>[] = [
  {
    id: "post",
    header: "Post",
    cell: ({ row }) => <PostTitle post={row.original} />,
    meta: { skeleton: "w-56", className: "max-w-64 xl:max-w-sm" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge kind="blogPost" value={row.original.visibility} />
    ),
    meta: { skeleton: "w-20" },
  },
  {
    id: "category",
    header: "Category",
    cell: ({ row }) =>
      row.original.category ? (
        <span className="whitespace-nowrap">
          {translated(row.original.category.name)}
        </span>
      ) : (
        <span className="text-ink-subtle">None</span>
      ),
    meta: { from: "md", skeleton: "w-24" },
  },
  {
    id: "author",
    header: "Author",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{row.original.authorName}</span>
    ),
    meta: { from: "xl", skeleton: "w-24" },
  },
  {
    id: "date",
    header: "Date",
    cell: ({ row }) => <DateTime value={row.original.publishedAt} short />,
    meta: { from: "sm", skeleton: "w-24" },
  },
  {
    id: "updated",
    header: "Changed",
    cell: ({ row }) => <DateTime value={row.original.updatedAt} short />,
    meta: { from: "lg", skeleton: "w-24" },
  },
];

function PostCard({ post }: { post: BlogPostSummary }) {
  return (
    <Link
      href={routes.blogPost(post.id)}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 active:bg-sunken"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-base font-semibold text-ink">
          {post.title.en}
        </span>
        <StatusBadge kind="blogPost" value={post.visibility} />
      </span>
      {post.summary?.en ? (
        <span className="line-clamp-2 text-sm text-ink-muted">
          {post.summary.en}
        </span>
      ) : null}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-ink-subtle">
        <span>
          {post.category ? translated(post.category.name) : "No category"}
        </span>
        <span>{post.authorName}</span>
        <DateTime
          value={post.publishedAt ?? post.updatedAt}
          short
          className="ml-auto"
        />
      </span>
    </Link>
  );
}

/** The posts of the blog (23): a table with the API's filters and sort, by page. */
export function PostsView() {
  const can = useCan();
  const [state, setState, clear] = useUrlState({
    q: param.text(100),
    status: param.oneOf(STATUSES),
    categoryId: param.id(),
    tag: param.text(BLOG_RULES.tagMaxLength),
    sort: param.oneOfOr(BLOG_POST_SORTS, "updated"),
    page: param.page(),
  });
  const query = {
    q: state.q || undefined,
    status: state.status,
    categoryId: state.categoryId,
    tag: state.tag || undefined,
    sort: state.sort,
    page: state.page,
    limit: BLOG_RULES.pageLimit,
  };
  const posts = useBlogPosts(query);
  const categories = useBlogCategories();
  const tags = useBlogTags();
  const filtered = Boolean(
    state.q || state.status || state.categoryId || state.tag,
  );
  const data = posts.data;

  return (
    <RequirePermission permission="content.read">
      <PageHeader
        title="Blog"
        description="The articles of the shop, in English and German. A published post is shown from its date on; a date in the future schedules it."
        actions={
          <>
            <Button asChild>
              <Link href={routes.blogCategories}>
                <BookOpenText />
                Categories
              </Link>
            </Button>
            {can("content.manage") ? (
              <Button asChild variant="primary">
                <Link href={routes.blogPostNew}>
                  <Plus />
                  New post
                </Link>
              </Button>
            ) : (
              <ActionButton
                permission="content.manage"
                variant="primary"
                icon={<Plus />}
              >
                New post
              </ActionButton>
            )}
          </>
        }
      />
      <PageBody className="gap-3">
        <FilterBar active={filtered} onClear={clear}>
          <SearchField
            value={state.q}
            onChange={(q) => setState({ q })}
            label="Search posts"
            placeholder="Title, summary or tag"
          />
          <FilterSelect
            label="Status"
            value={state.status}
            options={STATUSES.map((value) => ({
              value,
              label: BLOG_VISIBILITY[value].label,
            }))}
            onChange={(status) => setState({ status })}
          />
          <FilterSelect
            label="Category"
            value={state.categoryId}
            options={
              categories.data?.items.map((category) => ({
                value: category.id,
                label: translated(category.name),
              })) ?? []
            }
            onChange={(categoryId) => setState({ categoryId })}
          />
          <FilterSelect
            label="Tag"
            value={state.tag || undefined}
            options={
              tags.data?.items.map((entry) => ({
                value: entry.tag,
                label: `${entry.tag} (${entry.count})`,
              })) ?? []
            }
            onChange={(tag) => setState({ tag: tag ?? "" })}
          />
          <SortSelect
            value={state.sort}
            options={SORTS}
            onChange={(sort) => setState({ sort: sort ?? "updated" })}
          />
        </FilterBar>

        <DataTable
          caption="Posts of the blog"
          columns={columns}
          data={data?.items}
          getRowId={(post) => post.id}
          refreshing={posts.isPlaceholderData}
          error={posts.error}
          onRetry={() => void posts.refetch()}
          rowHref={(post) => routes.blogPost(post.id)}
          card={(post) => <PostCard post={post} />}
          empty={
            <EmptyState
              icon={<Newspaper />}
              title={filtered ? "No post matches" : "No post yet"}
              action={
                filtered ? (
                  <Button onClick={clear}>Show all posts</Button>
                ) : can("content.manage") ? (
                  <Button asChild variant="primary">
                    <Link href={routes.blogPostNew}>Write the first post</Link>
                  </Button>
                ) : null
              }
            >
              {filtered
                ? "Remove a filter to see the others."
                : "Recipes, news from the shop, a closer look at an ingredient: the blog of the shop starts here."}
            </EmptyState>
          }
          footer={
            data ? (
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                totalPages={data.totalPages}
                onPage={(page) => setState({ page })}
                noun="post"
              />
            ) : null
          }
        />
      </PageBody>
    </RequirePermission>
  );
}
