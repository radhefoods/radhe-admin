// Sections 14 (notifications) and 15 (announcements).

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  Announcement,
  AnnouncementInput,
  AnnouncementPreview,
  AnnouncementQuery,
  AnnouncementWithProgress,
  CursorResult,
  Id,
  Notification,
  NotificationDetail,
  NotificationQuery,
  NotificationRunResult,
  NotificationSummary,
} from "../types";

export function notificationsApi({ request }: SessionTransport) {
  const base = "/v1/admin/notifications";
  return {
    list: (query: NotificationQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<Notification>>(base, {
        query: query as Query,
        signal,
      }),
    summary: (signal?: AbortSignal) =>
      request<NotificationSummary>(`${base}/summary`, { signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ notification: NotificationDetail }>(`${base}/${id}`, {
        signal,
      }),
    /** Sends a `failed`, `skipped` or `cancelled` message again. */
    retry: (id: Id) =>
      request<{ notification: Notification }>(`${base}/${id}/retry`, {
        method: "POST",
      }),
    /** Withdraws a `queued` message. */
    cancel: (id: Id, reason?: string) =>
      request<{ notification: Notification }>(`${base}/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
    /** Works the queue now. */
    run: () =>
      request<NotificationRunResult>(`${base}/run`, { method: "POST" }),
  };
}

export function announcementsApi({ request }: SessionTransport) {
  const base = "/v1/admin/announcements";
  return {
    list: (query: AnnouncementQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<Announcement>>(base, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<AnnouncementWithProgress>(`${base}/${id}`, { signal }),
    /** Who would get it and how it reads. Nothing is sent. */
    preview: (input: AnnouncementInput, signal?: AbortSignal) =>
      request<AnnouncementPreview>(`${base}/preview`, {
        method: "POST",
        body: input,
        signal,
      }),
    send: (input: AnnouncementInput) =>
      request<AnnouncementWithProgress>(base, { method: "POST", body: input }),
    /** Withdraws the messages that have not gone out yet. */
    cancel: (id: Id) =>
      request<AnnouncementWithProgress>(`${base}/${id}/cancel`, {
        method: "POST",
      }),
  };
}
