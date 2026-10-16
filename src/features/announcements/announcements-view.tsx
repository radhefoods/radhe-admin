"use client";

import { Megaphone, Plus } from "lucide-react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data/data-table";
import { FilterBar } from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { DateTime, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/surface";
import { FilterChip } from "@/features/notifications/filter-chip";
import { CHANNEL_LABEL } from "@/features/notifications/labels";
import { useRecordName } from "@/features/notifications/queries";
import { errorMessage } from "@/lib/api/error-text";
import type { Announcement } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { plural, shortId } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { useAnnouncements } from "./queries";

/** The product the news is about, leading to its page. */
export function AnnouncementAbout({
  announcement,
  compact = false,
}: {
  announcement: Announcement;
  /** In a table: on one line, cut when it is long. */
  compact?: boolean;
}) {
  const { productId, productName } = announcement;
  if (!productId) {
    return (
      <span className="whitespace-nowrap text-ink-subtle">General news</span>
    );
  }
  return (
    <span
      className={
        compact
          ? "block truncate [&>*+*]:ml-2"
          : "flex flex-wrap items-center gap-x-2 gap-y-0.5"
      }
    >
      {productId ? (
        <Link href={routes.product(productId)} className="hover:underline">
          {productName ?? `Product ${shortId(productId)}`}
        </Link>
      ) : null}
    </span>
  );
}

function channelsText(announcement: Announcement): string {
  return announcement.channels
    .map((channel) => CHANNEL_LABEL[channel] ?? channel)
    .join(", ");
}

// From `lg` on the table is not allowed to scroll sideways (its header
// sticks to the page), so the columns shown at each width must fit it.
/**
 * How far an announcement is, from the counts the list carries (15):
 * "12 sent, 1 failed"; without counts, how many messages were queued.
 */
export function progressText(announcement: Announcement): string {
  const progress = announcement.progress;
  if (!progress) return plural(announcement.queued, "message");
  const sum = (status: "sent" | "failed" | "queued" | "sending") =>
    progress.email[status] + progress.whatsapp[status];
  const parts = [`${sum("sent").toLocaleString("en")} sent`];
  const open = sum("queued") + sum("sending");
  if (open > 0) parts.push(`${open.toLocaleString("en")} waiting`);
  if (sum("failed") > 0)
    parts.push(`${sum("failed").toLocaleString("en")} failed`);
  return parts.join(", ");
}

const columns: Column<Announcement>[] = [
  {
    id: "announcement",
    header: "Announcement",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <span className="flex min-w-0 items-center gap-2">
            <Link
              href={routes.announcement(row.original.id)}
              className="min-w-0 truncate font-semibold text-accent-text hover:underline"
            >
              {row.original.subject.en}
            </Link>
            {row.original.cancelledAt ? <Badge>Cancelled</Badge> : null}
          </span>
        }
        secondary={row.original.message.en}
      />
    ),
    meta: {
      skeleton: "w-56",
      className: "max-w-56 xl:max-w-72 min-[1440px]:max-w-md",
    },
  },
  {
    id: "about",
    header: "About",
    cell: ({ row }) => (
      <AnnouncementAbout announcement={row.original} compact />
    ),
    meta: { from: "md", skeleton: "w-28", className: "max-w-44" },
  },
  {
    id: "channels",
    header: "Channels",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{channelsText(row.original)}</span>
    ),
    meta: { from: "xl", skeleton: "w-24" },
  },
  {
    id: "recipients",
    header: "Recipients",
    cell: ({ row }) => (
      <span className="flex flex-col items-end">
        <span className="font-medium">
          {row.original.recipients.toLocaleString("en")}
        </span>
        <span className="text-13 whitespace-nowrap text-ink-subtle">
          {progressText(row.original)}
        </span>
      </span>
    ),
    meta: { align: "right", skeleton: "w-10" },
  },
  {
    id: "sent",
    header: "Sent",
    cell: ({ row }) => <DateTime value={row.original.createdAt} short />,
    meta: { from: "sm", skeleton: "w-24" },
  },
];

function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  return (
    <Link
      href={routes.announcement(announcement.id)}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 active:bg-sunken"
    >
      <span className="text-base font-semibold text-ink">
        {announcement.subject.en}
      </span>
      <span className="line-clamp-2 text-sm text-ink-muted">
        {announcement.message.en}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-ink-subtle">
        {announcement.cancelledAt ? <Badge>Cancelled</Badge> : null}
        <span>{plural(announcement.recipients, "recipient")}</span>
        <span>{channelsText(announcement)}</span>
        <DateTime value={announcement.createdAt} short className="ml-auto" />
      </span>
    </Link>
  );
}

export function AnnouncementsView() {
  const can = useCan();
  const [state, setState, clear] = useUrlState({
    productId: param.id(),
  });
  const announcements = useAnnouncements({ productId: state.productId });
  const productName = useRecordName("product", state.productId);
  const rows = announcements.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(state.productId);

  return (
    <RequirePermission permission="notifications.read">
      <PageHeader
        title="Announcements"
        description="News about a product or an offer, written by you and sent to the customers who opted in to news. Nothing here goes out by itself: a new product sends nothing."
        actions={
          can("notifications.manage") ? (
            <Button asChild variant="primary">
              <Link href={routes.announcementNew}>
                <Plus />
                New announcement
              </Link>
            </Button>
          ) : (
            <ActionButton
              permission="notifications.manage"
              variant="primary"
              icon={<Plus />}
            >
              New announcement
            </ActionButton>
          )
        }
      />
      <PageBody className="gap-3">
        {filtered ? (
          <FilterBar active onClear={clear}>
            {state.productId ? (
              <FilterChip
                label="Product"
                value={productName ?? shortId(state.productId)}
                onRemove={() => setState({ productId: undefined })}
              />
            ) : null}
          </FilterBar>
        ) : null}

        <DataTable
          caption="Announcements, newest first"
          columns={columns}
          data={rows}
          getRowId={(announcement) => announcement.id}
          refreshing={announcements.isPlaceholderData}
          error={announcements.error}
          onRetry={() => void announcements.refetch()}
          rowHref={(announcement) => routes.announcement(announcement.id)}
          card={(announcement) => (
            <AnnouncementCard announcement={announcement} />
          )}
          empty={
            <EmptyState
              icon={<Megaphone />}
              title={
                filtered
                  ? "No announcement was sent about this"
                  : "No announcement yet"
              }
              action={
                filtered ? (
                  <Button onClick={clear}>Show all announcements</Button>
                ) : can("notifications.manage") ? (
                  <Button asChild variant="primary">
                    <Link href={routes.announcementNew}>
                      Write the first announcement
                    </Link>
                  </Button>
                ) : null
              }
            >
              {filtered
                ? "The list is narrowed to one product. Remove the filter to see the others."
                : "Tell the customers who opted in to news about a new product or an offer. You see who gets it before anything is sent."}
            </EmptyState>
          }
          footer={
            <>
              {announcements.isFetchNextPageError ? (
                <Alert
                  tone="danger"
                  title="More announcements could not be loaded"
                  actions={
                    <Button onClick={() => void announcements.fetchNextPage()}>
                      Try again
                    </Button>
                  }
                >
                  {errorMessage(announcements.error)}
                </Alert>
              ) : null}
              <LoadMore
                shown={rows?.length ?? 0}
                noun="announcement"
                hasMore={announcements.hasNextPage}
                loading={announcements.isFetchingNextPage}
                onLoadMore={() => void announcements.fetchNextPage()}
              />
            </>
          }
        />
      </PageBody>
    </RequirePermission>
  );
}
