"use client";

import { Bell, Mail, MessageCircle, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { FilterBar, FilterSelect } from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { toneClass } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationChannel,
  type NotificationRunResult,
  type NotificationStatus,
  type NotificationSummary,
} from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format/dates";
import { plural, shortId } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { NOTIFICATION_STATUS, statusOptions } from "@/lib/status";
import { FilterChip } from "./filter-chip";
import {
  CHANNEL_LABEL,
  CHANNEL_OPTIONS,
  STATUS_MEANING,
  TYPE_OPTIONS,
  runDidSomething,
  runResultText,
  typeLabel,
} from "./labels";
import {
  useNotificationSummary,
  useNotifications,
  useRecordName,
  useRunQueue,
} from "./queries";
import { WhatsappState } from "./whatsapp-state";

/** The channel with its mark, so that it reads at a glance in a column. */
export function Channel({ channel }: { channel: NotificationChannel }) {
  const Icon = channel === "whatsapp" ? MessageCircle : Mail;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon aria-hidden="true" className="size-3.5 text-ink-subtle" />
      {CHANNEL_LABEL[channel] ?? channel}
    </span>
  );
}

/** What a message is about: its order, or the announcement it belongs to. */
function About({ message }: { message: Notification }) {
  if (message.orderNumber) {
    return message.orderId ? (
      <Link
        href={routes.order(message.orderId)}
        className="whitespace-nowrap tabular hover:underline"
      >
        {message.orderNumber}
      </Link>
    ) : (
      <span className="whitespace-nowrap tabular">{message.orderNumber}</span>
    );
  }
  if (message.announcementId) {
    return (
      <Link
        href={routes.announcement(message.announcementId)}
        className="whitespace-nowrap hover:underline"
      >
        Announcement
      </Link>
    );
  }
  return <span className="text-ink-subtle">—</span>;
}

// From `lg` on the table is not allowed to scroll sideways (its header
// sticks to the page), so the columns shown at each width must fit it: the
// two long texts are cut, and the columns that say least wait for `xl`.
const columns: Column<Notification>[] = [
  {
    id: "message",
    header: "Message",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <Link
            href={routes.notification(row.original.id)}
            className="font-semibold text-accent-text hover:underline"
          >
            {typeLabel(row.original.type)}
          </Link>
        }
        secondary={
          // Why it failed says more in the list than a subject that
          // repeats the type; the subject is on the message's page.
          row.original.status === "failed" && row.original.lastError ? (
            <span className="text-danger-fg">{row.original.lastError}</span>
          ) : (
            row.original.subject
          )
        }
      />
    ),
    meta: {
      skeleton: "w-44",
      className: "max-w-48 min-[1440px]:max-w-64 2xl:max-w-80",
    },
  },
  {
    id: "channel",
    header: "Channel",
    cell: ({ row }) => <Channel channel={row.original.channel} />,
    meta: { from: "xl", skeleton: "w-16" },
  },
  {
    id: "to",
    header: "Recipient",
    cell: ({ row }) => (
      <span className="block truncate">{row.original.to}</span>
    ),
    meta: {
      from: "md",
      skeleton: "w-36",
      className: "max-w-40 min-[1440px]:max-w-52 2xl:max-w-64",
    },
  },
  {
    id: "about",
    header: "About",
    cell: ({ row }) => <About message={row.original} />,
    meta: { from: "xl", skeleton: "w-16" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge kind="notification" value={row.original.status} />
    ),
  },
  {
    id: "attempts",
    header: "Attempts",
    cell: ({ row }) =>
      `${row.original.attempts} of ${row.original.maxAttempts}`,
    meta: { align: "right", from: "xl", skeleton: "w-10" },
  },
  {
    id: "when",
    header: "Created",
    cell: ({ row }) => <DateTime value={row.original.createdAt} short />,
    meta: { from: "sm", skeleton: "w-24" },
  },
];

function NotificationCard({ message }: { message: Notification }) {
  return (
    <Link
      href={routes.notification(message.id)}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 active:bg-sunken"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-base font-semibold text-ink">
          {typeLabel(message.type)}
        </span>
        <StatusBadge kind="notification" value={message.status} />
      </span>
      <span className="truncate text-sm text-ink-muted">{message.to}</span>
      {message.status === "failed" && message.lastError ? (
        <span className="line-clamp-2 text-13 text-danger-fg">
          {message.lastError}
        </span>
      ) : null}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-ink-subtle">
        <Channel channel={message.channel} />
        {message.orderNumber ? (
          <span className="tabular">{message.orderNumber}</span>
        ) : null}
        <DateTime value={message.createdAt} short className="ml-auto" />
      </span>
    </Link>
  );
}

/**
 * How many messages are in each status (`GET /notifications/summary`). A
 * count is also the quickest way to that part of the log.
 */
function StatusCounts({
  summary,
  selected,
  onSelect,
}: {
  summary: NotificationSummary | undefined;
  selected: NotificationStatus | undefined;
  onSelect: (status: NotificationStatus | undefined) => void;
}) {
  return (
    <ul
      aria-label="Messages by status"
      className="grid grid-cols-3 overflow-hidden rounded-lg border border-line bg-surface md:grid-cols-6"
    >
      {NOTIFICATION_STATUSES.map((status) => {
        const count = summary?.counts[status];
        const meta = NOTIFICATION_STATUS[status];
        const active = selected === status;
        return (
          <li
            key={status}
            className="-mb-px -ml-px border-b border-l border-line"
          >
            <button
              type="button"
              aria-pressed={active}
              aria-label={
                count === undefined
                  ? meta.label
                  : `${meta.label}: ${plural(count, "message")}`
              }
              title={STATUS_MEANING[status]}
              onClick={() => onSelect(active ? undefined : status)}
              className={cn(
                "flex h-full w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors",
                active ? "bg-accent-soft" : "hover:bg-sunken/70",
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 text-13 font-medium",
                  active ? "text-accent-text" : "text-ink-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    toneClass[count ? meta.tone : "neutral"].dot,
                  )}
                />
                {meta.label}
              </span>
              {count === undefined ? (
                <Skeleton className="mt-1 h-7 w-12" />
              ) : (
                <span
                  className={cn(
                    "font-display text-2xl leading-none tabular",
                    count > 0 ? "text-ink" : "text-ink-subtle",
                  )}
                >
                  {count.toLocaleString("en")}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function NotificationsView() {
  const [state, setState, clear] = useUrlState({
    status: param.oneOf(NOTIFICATION_STATUSES),
    type: param.oneOf(NOTIFICATION_TYPES),
    channel: param.oneOf(NOTIFICATION_CHANNELS),
    customerId: param.id(),
    orderId: param.id(),
    orderNumber: param.text(20),
    announcementId: param.id(),
  });
  const orderNumber = state.orderNumber.toUpperCase() || undefined;
  const messages = useNotifications({
    status: state.status,
    type: state.type,
    channel: state.channel,
    customerId: state.customerId,
    orderId: state.orderId,
    orderNumber,
    announcementId: state.announcementId,
  });
  const summary = useNotificationSummary();
  const run = useRunQueue();
  const [lastRun, setLastRun] = useState<{
    result: NotificationRunResult;
    at: Date;
  } | null>(null);

  const customerName = useRecordName("customer", state.customerId);
  const orderName = useRecordName("order", state.orderId);
  const announcementName = useRecordName("announcement", state.announcementId);

  const rows = messages.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(
    state.status ||
    state.type ||
    state.channel ||
    state.customerId ||
    state.orderId ||
    orderNumber ||
    state.announcementId,
  );

  return (
    <RequirePermission permission="notifications.read">
      <PageHeader
        title="Notifications"
        description="Every email and WhatsApp message to a customer: what was sent, to whom, about what, and how it went. They are sent and retried without you; the failed ones wait here."
        actions={
          <ActionButton
            permission="notifications.manage"
            icon={<Play />}
            loading={run.isPending}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: (result) => {
                  setLastRun({ result, at: new Date() });
                  notify.success(
                    runDidSomething(result)
                      ? "The queue was worked"
                      : "Nothing was waiting",
                    runResultText(result),
                  );
                },
              })
            }
          >
            Run the queue now
          </ActionButton>
        }
      />
      <PageBody className="gap-4">
        {summary.isError ? (
          <Alert
            tone="danger"
            title="The counts could not be loaded"
            actions={
              <Button onClick={() => void summary.refetch()}>Try again</Button>
            }
          >
            {errorMessage(summary.error)}
          </Alert>
        ) : (
          <StatusCounts
            summary={summary.data}
            selected={state.status}
            onSelect={(status) => setState({ status })}
          />
        )}

        {lastRun ? (
          <p role="status" className="text-13 text-ink-muted">
            <span className="font-medium text-ink">
              Queue worked at {formatTime(lastRun.at)}:
            </span>{" "}
            <span className="tabular">{runResultText(lastRun.result)}</span>. It
            also runs by itself every minute.
          </p>
        ) : null}

        <WhatsappState enabled={summary.data?.whatsappEnabled}>
          {summary.data?.whatsappEnabled === false ? (
            <>
              Emails go out as usual. Messages for customers who opted in to
              WhatsApp are stored as skipped until WhatsApp is configured in the
              API; they can be sent again then.{" "}
              <button
                type="button"
                onClick={() =>
                  setState({ status: "skipped", channel: "whatsapp" })
                }
                className="font-medium text-accent-text underline-offset-2 hover:underline"
              >
                Show the skipped WhatsApp messages
              </button>
            </>
          ) : undefined}
        </WhatsappState>

        <div className="flex flex-col gap-3">
          <FilterBar active={filtered} onClear={clear}>
            <FilterSelect
              label="Status"
              value={state.status}
              options={statusOptions(NOTIFICATION_STATUS)}
              onChange={(status) => setState({ status })}
            />
            <FilterSelect
              label="Type"
              value={state.type}
              options={TYPE_OPTIONS}
              onChange={(type) => setState({ type })}
            />
            <FilterSelect
              label="Channel"
              value={state.channel}
              options={CHANNEL_OPTIONS}
              onChange={(channel) => setState({ channel })}
            />
            {state.customerId ? (
              <FilterChip
                label="Customer"
                value={customerName ?? shortId(state.customerId)}
                onRemove={() => setState({ customerId: undefined })}
              />
            ) : null}
            {state.orderId ? (
              <FilterChip
                label="Order"
                value={orderName ?? shortId(state.orderId)}
                onRemove={() => setState({ orderId: undefined })}
              />
            ) : null}
            {orderNumber ? (
              <FilterChip
                label="Order"
                value={orderNumber}
                onRemove={() => setState({ orderNumber: "" })}
              />
            ) : null}
            {state.announcementId ? (
              <FilterChip
                label="Announcement"
                value={announcementName ?? shortId(state.announcementId)}
                onRemove={() => setState({ announcementId: undefined })}
              />
            ) : null}
          </FilterBar>

          <DataTable
            caption="Messages to customers, newest first"
            columns={columns}
            data={rows}
            getRowId={(message) => message.id}
            refreshing={messages.isPlaceholderData}
            error={messages.error}
            onRetry={() => void messages.refetch()}
            rowHref={(message) => routes.notification(message.id)}
            card={(message) => <NotificationCard message={message} />}
            empty={
              <EmptyState
                icon={<Bell />}
                title={
                  filtered
                    ? "No message matches these filters"
                    : "No message yet"
                }
                action={
                  filtered ? (
                    <Button onClick={clear}>Clear the filters</Button>
                  ) : null
                }
              >
                {filtered
                  ? "Remove a filter, or clear them all."
                  : "Messages appear here as the shop sends them: order confirmations, dispatch notes, payment requests, reminders and news."}
              </EmptyState>
            }
            footer={
              <>
                {messages.isFetchNextPageError ? (
                  <Alert
                    tone="danger"
                    title="More messages could not be loaded"
                    actions={
                      <Button onClick={() => void messages.fetchNextPage()}>
                        Try again
                      </Button>
                    }
                  >
                    {errorMessage(messages.error)}
                  </Alert>
                ) : null}
                <LoadMore
                  shown={rows?.length ?? 0}
                  noun="message"
                  hasMore={messages.hasNextPage}
                  loading={messages.isFetchingNextPage}
                  onLoadMore={() => void messages.fetchNextPage()}
                />
              </>
            }
          />
        </div>
      </PageBody>
    </RequirePermission>
  );
}
