"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { PageHeader, gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { cn } from "@/lib/cn";
import { translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { PostForm } from "./post-form";
import { useBlogCategories, useCreateBlogPost } from "./queries";

/** A new post: saved as a draft, then opened on its page for pictures and publishing. */
export function PostNewView() {
  const router = useRouter();
  const create = useCreateBlogPost();
  const categories = useBlogCategories();
  // Created, and on the way to its page: the form must not create it again.
  const [created, setCreated] = useState(false);
  return (
    <RequirePermission permission="content.manage">
      <PageHeader
        title="New post"
        back={{ href: routes.blog, label: "Blog" }}
        description="Written in English, with German when it is ready. The post is saved as a draft; its pictures and its publication follow on its page."
      />
      {categories.data ? (
        <PostForm
          categories={categories.data.items}
          onCancel={() => router.push(routes.blog)}
          onCreate={async (input) => {
            if (created) return;
            const post = await create.mutateAsync(input);
            setCreated(true);
            notify.success(
              `${translated(post.title)} created`,
              "A draft. Add its pictures, then publish or schedule it.",
            );
            router.push(routes.blogPost(post.id));
          }}
        />
      ) : (
        // The form needs the categories before it opens: its select would
        // otherwise settle on "No category" whatever is chosen later.
        <div className={cn(gutter, "flex flex-col gap-4")}>
          {categories.isError ? (
            <Alert
              tone="danger"
              title="The categories of the blog could not be loaded"
              actions={
                <Button onClick={() => void categories.refetch()}>
                  Try again
                </Button>
              }
            >
              {errorMessage(categories.error)}
            </Alert>
          ) : (
            <div aria-busy="true">
              <span className="sr-only" role="status">
                Loading the form
              </span>
              <Skeleton className="h-96 rounded-lg" />
            </div>
          )}
        </div>
      )}
    </RequirePermission>
  );
}
