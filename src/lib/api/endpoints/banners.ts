// Section 20: homepage banners.

import type { SessionTransport } from "../session";
import type {
  Banner,
  BannerOrderInput,
  BannerPatch,
  Id,
  ListResult,
} from "../types";

type Progress = (fraction: number) => void;

function oneFile(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

export function bannersApi({ request, upload }: SessionTransport) {
  const base = "/v1/admin/banners";
  return {
    /** All banners in display order. */
    list: (signal?: AbortSignal) =>
      request<ListResult<Banner>>(base, { signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ banner: Banner }>(`${base}/${id}`, { signal }),
    /** Creates a banner from its picture; it starts switched off and last. */
    create: (file: File, onProgress?: Progress, signal?: AbortSignal) =>
      upload<{ banner: Banner }>(base, {
        method: "POST",
        formData: oneFile(file),
        onProgress,
        signal,
      }),
    update: (id: Id, input: BannerPatch) =>
      request<{ banner: Banner }>(`${base}/${id}`, {
        method: "PATCH",
        body: input,
      }),
    /** Replaces the picture; the description stays. */
    putImage: (
      id: Id,
      file: File,
      onProgress?: Progress,
      signal?: AbortSignal,
    ) =>
      upload<{ banner: Banner }>(`${base}/${id}/image`, {
        method: "PUT",
        formData: oneFile(file),
        onProgress,
        signal,
      }),
    reorder: (input: BannerOrderInput) =>
      request<void>(`${base}/order`, { method: "PUT", body: input }),
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
  };
}
