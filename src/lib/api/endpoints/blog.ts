// Section 23: the blog, posts and categories.

import type { SessionTransport } from "../session";
import type { Query } from "../http";
import type {
  BlogCategory,
  BlogCategoryInput,
  BlogCategoryList,
  BlogCategoryOrderInput,
  BlogCategoryPatch,
  BlogImageAltInput,
  BlogPost,
  BlogPostInput,
  BlogPostPatch,
  BlogPostQuery,
  BlogPostSummary,
  BlogPublishInput,
  BlogTag,
  Id,
  ListResult,
  PageResult,
} from "../types";

type Progress = (fraction: number) => void;

function oneFile(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

export function blogPostsApi({ request, upload }: SessionTransport) {
  const base = "/v1/admin/blog-posts";
  type Answer = { post: BlogPost };
  return {
    list: (query: BlogPostQuery, signal?: AbortSignal) =>
      request<PageResult<BlogPostSummary>>(base, {
        query: query as Query,
        signal,
      }),
    /** Every tag over every post, with its count. */
    tags: (signal?: AbortSignal) =>
      request<ListResult<BlogTag>>(`${base}/tags`, { signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<Answer>(`${base}/${id}`, { signal }),
    create: (input: BlogPostInput) =>
      request<Answer>(base, { method: "POST", body: input }),
    update: (id: Id, input: BlogPostPatch) =>
      request<Answer>(`${base}/${id}`, { method: "PATCH", body: input }),
    /** `status` becomes `published`; a date in the future schedules the post. */
    publish: (id: Id, input: BlogPublishInput = {}) =>
      request<Answer>(`${base}/${id}/publish`, { method: "POST", body: input }),
    /** A draft again; the date is kept. */
    unpublish: (id: Id) =>
      request<Answer>(`${base}/${id}/unpublish`, { method: "POST" }),
    /** The pictures go with it. */
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
    /** Replaces the featured picture; its description is kept. */
    putFeaturedImage: (
      id: Id,
      file: File,
      onProgress?: Progress,
      signal?: AbortSignal,
    ) =>
      upload<Answer>(`${base}/${id}/featured-image`, {
        method: "PUT",
        formData: oneFile(file),
        onProgress,
        signal,
      }),
    patchFeaturedImage: (id: Id, input: BlogImageAltInput) =>
      request<Answer>(`${base}/${id}/featured-image`, {
        method: "PATCH",
        body: input,
      }),
    removeFeaturedImage: (id: Id) =>
      request<Answer>(`${base}/${id}/featured-image`, { method: "DELETE" }),
    /** Up to 10 pictures for the text at once, 20 per post; all or nothing. */
    uploadImages: (
      id: Id,
      files: File[],
      onProgress?: Progress,
      signal?: AbortSignal,
    ) => {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      return upload<Answer>(`${base}/${id}/images`, {
        method: "POST",
        formData: form,
        onProgress,
        signal,
      });
    },
    removeImage: (id: Id, imageId: Id) =>
      request<Answer>(`${base}/${id}/images/${imageId}`, { method: "DELETE" }),
  };
}

export function blogCategoriesApi({ request }: SessionTransport) {
  const base = "/v1/admin/blog-categories";
  type Answer = { category: BlogCategory };
  return {
    /** In display order, each with its post counts. */
    list: (signal?: AbortSignal) => request<BlogCategoryList>(base, { signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<Answer>(`${base}/${id}`, { signal }),
    /** A new category goes last. */
    create: (input: BlogCategoryInput) =>
      request<Answer>(base, { method: "POST", body: input }),
    /** The slug changes only when sent. */
    update: (id: Id, input: BlogCategoryPatch) =>
      request<Answer>(`${base}/${id}`, { method: "PATCH", body: input }),
    /** Every category exactly once. */
    reorder: (input: BlogCategoryOrderInput) =>
      request<ListResult<BlogCategory>>(`${base}/order`, {
        method: "PUT",
        body: input,
      }),
    /** `409 BLOG_CATEGORY_HAS_POSTS` while it has posts. */
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
  };
}
