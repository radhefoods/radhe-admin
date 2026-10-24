"use client";

import { Newspaper, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { PageHeader, gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import type { SizeReader } from "@/features/catalogue/image-rules";
import { PostForm, visibilityText } from "./post-form";
import { useBlogCategories, useBlogPost, useDeleteBlogPost } from "./queries";

/** One post of the blog: its form, its publishing and its pictures. */
export function PostView({ readSize }: { readSize?: SizeReader }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const post = useBlogPost(id);
  const categories = useBlogCategories();
  const remove = useDeleteBlogPost();
  const [deleting, setDeleting] = useState(false);
  const back = { href: routes.blog, label: "Blog" };

  if (post.isError && !post.isFetching) {
    const gone = hasErrorCode(
      post.error,
      "BLOG_POST_NOT_FOUND",
      "VALIDATION_FAILED",
    );
    if (gone || !post.data) {
      return (
        <RequirePermission permission="content.read">
          <PageHeader title="Post" back={back} />
          <div className={gutter}>
            {gone ? (
              <div className="rounded-lg border border-line">
                <EmptyState
                  icon={<Newspaper />}
                  title="This post does not exist"
                >
                  It may have been deleted in the meantime.
                </EmptyState>
              </div>
            ) : (
              <Alert
                tone="danger"
                title="The post could not be loaded"
                actions={
                  <Button onClick={() => void post.refetch()}>Try again</Button>
                }
              >
                {errorMessage(post.error)}
              </Alert>
            )}
          </div>
        </RequirePermission>
      );
    }
  }

  if (!post.data) {
    return (
      <RequirePermission permission="content.read">
        <PageHeader title={<Skeleton className="h-9 w-72" />} back={back} />
        <div className={cn(gutter, "flex flex-col gap-4")} aria-busy="true">
          <span className="sr-only" role="status">
            Loading the post
          </span>
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </RequirePermission>
    );
  }

  const current = post.data;
  return (
    <RequirePermission permission="content.read">
      <PageHeader
        title={translated(current.title)}
        back={back}
        badges={<StatusBadge kind="blogPost" value={current.visibility} />}
        description={visibilityText(current)}
        actions={
          can("content.manage") ? (
            <Button
              variant="danger-outline"
              icon={<Trash2 />}
              onClick={() => setDeleting(true)}
            >
              Delete the post
            </Button>
          ) : null
        }
      />
      <PostForm
        key={current.id}
        post={current}
        categories={categories.data?.items ?? []}
        readSize={readSize}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${translated(current.title)}”?`}
        description="The post is removed for good, with its text in both languages and its pictures: the featured picture and the pictures for the text go with it. The shop stops showing it within five minutes."
        facts={[
          {
            label: "Status",
            value: visibilityText(current).split(":")[0] ?? current.visibility,
          },
          {
            label: "Pictures",
            value: `${current.featuredImage ? "Featured picture and " : ""}${plural(current.images.length, "picture")} for the text`,
          },
        ]}
        confirmLabel="Delete the post"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync(current.id);
          notify.success("Post deleted", "Its pictures were deleted with it.");
          router.replace(routes.blog);
        }}
      />
    </RequirePermission>
  );
}
