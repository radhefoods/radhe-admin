"use client";

import { useRouter } from "next/navigation";
import { RequirePermission } from "@/components/domain/permission";
import { PageHeader } from "@/components/shell/page";
import { notify } from "@/components/ui/toast";
import { translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { PostForm } from "./post-form";
import { useBlogCategories, useCreateBlogPost } from "./queries";

/** A new post: saved as a draft, then opened on its page for pictures and publishing. */
export function PostNewView() {
  const router = useRouter();
  const create = useCreateBlogPost();
  const categories = useBlogCategories();
  return (
    <RequirePermission permission="content.manage">
      <PageHeader
        title="New post"
        back={{ href: routes.blog, label: "Blog" }}
        description="Written in English, with German when it is ready. The post is saved as a draft; its pictures and its publication follow on its page."
      />
      <PostForm
        categories={categories.data?.items ?? []}
        onCancel={() => router.push(routes.blog)}
        onCreate={async (input) => {
          const post = await create.mutateAsync(input);
          notify.success(
            `${translated(post.title)} created`,
            "A draft. Add its pictures, then publish or schedule it.",
          );
          router.push(routes.blogPost(post.id));
        }}
      />
    </RequirePermission>
  );
}
