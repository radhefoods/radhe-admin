"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  BlogCategory,
  BlogCategoryInput,
  BlogCategoryList,
  BlogCategoryPatch,
  BlogImageAltInput,
  BlogPost,
  BlogPostInput,
  BlogPostPatch,
  BlogPostQuery,
  BlogPublishInput,
  Id,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

type Progress = (fraction: number) => void;
interface Upload {
  onProgress?: Progress;
  signal?: AbortSignal;
}

const META = { invalidates: [queryKeys.blog.all], silent: true } as const;

// --- Posts ------------------------------------------------------------------

/** One page of post summaries (23); the old page stays while the next loads. */
export function useBlogPosts(query: BlogPostQuery) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.blog.posts(query),
    queryFn: ({ signal }) => api.blogPosts.list(query, signal),
    enabled: can("content.read"),
    placeholderData: keepPreviousData,
  });
}

/** Every tag over every post, for the filter. */
export function useBlogTags() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.blog.tags(),
    queryFn: ({ signal }) => api.blogPosts.tags(signal),
    enabled: can("content.read"),
    staleTime: 60_000,
  });
}

export function useBlogPost(id: Id | undefined) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.blog.post(id ?? ""),
    queryFn: async ({ signal }) =>
      (await api.blogPosts.get(id as Id, signal)).post,
    enabled: Boolean(id) && can("content.read"),
  });
}

/** The answer of every change is the post as it is now: the page shows it at once. */
function keepPost(client: QueryClient, post: BlogPost): void {
  client.setQueryData(queryKeys.blog.post(post.id), post);
}

export function useCreateBlogPost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: BlogPostInput) =>
      (await api.blogPosts.create(input)).post,
    onSuccess: (post) => keepPost(client, post),
    meta: META,
  });
}

export function useUpdateBlogPost(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: BlogPostPatch) =>
      (await api.blogPosts.update(id, input)).post,
    onSuccess: (post) => keepPost(client, post),
    meta: META,
  });
}

/** `status` becomes `published`; a date in the future schedules the post. */
export function usePublishBlogPost(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: BlogPublishInput) =>
      (await api.blogPosts.publish(id, input)).post,
    onSuccess: (post) => keepPost(client, post),
    meta: META,
  });
}

export function useUnpublishBlogPost(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.blogPosts.unpublish(id)).post,
    onSuccess: (post) => keepPost(client, post),
    meta: META,
  });
}

/** Deletes a post with its pictures. Only the lists are fetched again: the page of the post is still open. */
export function useDeleteBlogPost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => api.blogPosts.remove(id),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: queryKeys.blog.all,
        predicate: (query) => query.queryKey[1] !== "post",
      });
    },
    meta: { silent: true },
  });
}

export function usePutFeaturedImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, onProgress, signal }: Upload & { file: File }) =>
      (await api.blogPosts.putFeaturedImage(id, file, onProgress, signal)).post,
    onSuccess: (post) => keepPost(client, post),
    meta: META,
  });
}

export function usePatchFeaturedImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: BlogImageAltInput) =>
      (await api.blogPosts.patchFeaturedImage(id, input)).post,
    onSuccess: (post) => keepPost(client, post),
    meta: META,
  });
}

export function useRemoveFeaturedImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.blogPosts.removeFeaturedImage(id)).post,
    onSuccess: (post) => keepPost(client, post),
    meta: META,
  });
}

/** Up to 10 pictures for the text at once; all or nothing. */
export function useUploadPostImages(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      files,
      onProgress,
      signal,
    }: Upload & { files: File[] }) =>
      (await api.blogPosts.uploadImages(id, files, onProgress, signal)).post,
    onSuccess: (post) => keepPost(client, post),
    meta: META,
  });
}

export function useRemovePostImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: Id) =>
      (await api.blogPosts.removeImage(id, imageId)).post,
    onSuccess: (post) => keepPost(client, post),
    meta: META,
  });
}

// --- Categories -------------------------------------------------------------

/** Every category in display order, with its post counts. */
export function useBlogCategories() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.blog.categories(),
    queryFn: ({ signal }) => api.blogCategories.list(signal),
    enabled: can("content.read"),
  });
}

function keepCategory(client: QueryClient, category: BlogCategory): void {
  client.setQueryData<BlogCategoryList>(queryKeys.blog.categories(), (list) =>
    list
      ? {
          ...list,
          items: list.items.map((entry) =>
            entry.id === category.id ? { ...entry, ...category } : entry,
          ),
        }
      : list,
  );
}

export function useCreateBlogCategory() {
  return useMutation({
    mutationFn: async (input: BlogCategoryInput) =>
      (await api.blogCategories.create(input)).category,
    meta: META,
  });
}

export function useUpdateBlogCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: BlogCategoryPatch & { id: Id }) =>
      (await api.blogCategories.update(id, input)).category,
    onSuccess: (category) => keepCategory(client, category),
    meta: META,
  });
}

export function useDeleteBlogCategory() {
  return useMutation({
    mutationFn: (id: Id) => api.blogCategories.remove(id),
    meta: META,
  });
}

/** The new order of all categories, every one exactly once; the list follows at once. */
export function useReorderBlogCategories() {
  const client = useQueryClient();
  const key = queryKeys.blog.categories();
  return useMutation({
    mutationFn: (orderedIds: Id[]) =>
      api.blogCategories.reorder({ orderedIds }),
    onMutate: async (orderedIds) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<BlogCategoryList>(key);
      if (before) {
        const byId = new Map(before.items.map((entry) => [entry.id, entry]));
        client.setQueryData<BlogCategoryList>(key, {
          ...before,
          items: orderedIds
            .map((id, index) => {
              const entry = byId.get(id);
              return entry ? { ...entry, sortOrder: index } : null;
            })
            .filter((entry): entry is BlogCategory => entry !== null),
        });
      }
      return { before };
    },
    onError: (error, _input, context) => {
      if (
        context?.before &&
        !hasErrorCode(error, "BLOG_CATEGORY_ORDER_INVALID")
      ) {
        client.setQueryData(key, context.before);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.blog.all });
    },
  });
}
