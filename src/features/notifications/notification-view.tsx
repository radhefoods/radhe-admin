"use client";

import { BellOff, Paperclip } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Timeline } from "@/components/domain/timeline";
import { CopyButton, DateTime, Money } from "@/components/domain/values";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menu";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { NotificationDetail } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import {
  formatDateTime,
  formatDay,
  formatDeadline,
  formatRelative,
} from "@/lib/format/dates";
import { LOCALE_LABEL, shortId } from "@/lib/format/names";
import { useNow } from "@/lib/hooks/use-now";
import { routes, withQuery } from "@/lib/routes";
import {
  CHANNEL_LABEL,
  STATUS_MEANING,
  dataRows,
  humanizeKey,
  typeLabel,
  type DataValue,
} from "./labels";
import { NotificationActions } from "./notification-actions";
import { Channel } from "./notifications-view";
import { useNotification, useRecordName, useWhatsappEnabled } from "./queries";

const back = { href: routes.notifications, label: "Notifications" };

function Dash() {
  return <span className="text-ink-subtle">—</span>;
}

/** What happened to the message, said first and plainly. */
function Outcome({ message }: { message: NotificationDetail }) {
  const now = useNow();
  const whatsappEnabled = useWhatsappEnabled();
  const tries = `${message.attempts} of ${message.maxAttempts}`;

  if (message.status === "failed") {
    return (
      <Alert tone="danger" title={`Given up after ${tries} attempts`}>
        <p>What the provider answered to the last attempt:</p>
        <p className="mt-1 rounded-md border border-danger-dot/30 bg-surface px-2.5 py-1.5 font-mono text-13 break-words text-ink">
          {message.lastError ?? "The provider gave no reason."}
        </p>
        <p className="mt-1.5">
          Once the cause is fixed, send it again: a new round of attempts
          begins.
        </p>
      </Alert>
    );
  }
  if (message.status === "skipped") {
    return (
      <Alert title="Not sent on purpose">
        <p className="text-ink">
          {message.reason ?? "No reason was recorded."}
        </p>
        {message.channel === "whatsapp" && whatsappEnabled === false ? (
          <p className="mt-1">
            WhatsApp is built but not configured yet. Messages for customers who
            opted in are stored like this one, and can be sent again once
            WhatsApp is on.
          </p>
        ) : null}
      </Alert>
    );
  }
  if (message.status === "cancelled") {
    return (
      <Alert title="Withdrawn before it went out">
        <p className="text-ink">
          {message.reason ?? "No reason was recorded."}
        </p>
        <p className="mt-1">It can still be sent again.</p>
      </Alert>
    );
  }
  if (message.status === "queued") {
    return (
      <Alert tone="time" title="Waiting in the queue">
        {message.nextAttemptAt ? (
          <p>
            {Date.parse(message.nextAttemptAt) > now.getTime()
              ? "Next attempt "
              : "Due since "}
            <span className="font-medium text-gold">
              {formatDeadline(message.nextAttemptAt)}
            </span>{" "}
            ({formatRelative(message.nextAttemptAt, now)}). The queue is worked
            every minute.
          </p>
        ) : (
          <p>The queue is worked every minute.</p>
        )}
        {message.lastError ? (
          <p className="mt-1">
            The last attempt failed:{" "}
            <span className="font-mono text-13 text-ink">
              {message.lastError}
            </span>
          </p>
        ) : null}
      </Alert>
    );
  }
  if (message.status === "sending") {
    return <Alert title="Being handed to the provider right now" />;
  }
  return null;
}

function Value({ value }: { value: DataValue }) {
  switch (value.kind) {
    case "empty":
      return <Dash />;
    case "money":
      return <Money cents={value.cents} />;
    case "moment":
      return <span className="tabular">{formatDateTime(value.iso)}</span>;
    case "day":
      return <span className="tabular">{formatDay(value.day)}</span>;
    case "link":
      return (
        <a
          href={value.url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-accent-text underline-offset-2 hover:underline"
        >
          {value.url}
        </a>
      );
    case "text":
      return <span className="whitespace-pre-line">{value.text}</span>;
  }
}

function RenderedFrom({ message }: { message: NotificationDetail }) {
  const rows = dataRows(message.data);
  return (
    <Card>
      <CardHeader
        title="Rendered from"
        description="The values the message was built from. The wording comes from the template in the customer's language."
      />
      {rows.length > 0 ? (
        <dl className="divide-y divide-line">
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:px-5"
            >
              <dt className="text-13 text-ink-muted">{row.label}</dt>
              <dd className="min-w-0 text-sm break-words text-ink">
                <Value value={row.value} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <CardBody>
          <p className="text-13 text-ink-muted">
            No values were stored with this message.
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function Attachments({ message }: { message: NotificationDetail }) {
  if (message.attachments.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Attachments" />
      <ul className="divide-y divide-line">
        {message.attachments.map((attachment, index) => (
          <li
            key={`${attachment.kind}-${attachment.id}-${index}`}
            className="flex items-center gap-3 px-4 py-3 text-sm sm:px-5"
          >
            <Paperclip
              aria-hidden="true"
              className="size-4 shrink-0 text-ink-subtle"
            />
            {attachment.kind === "invoice_pdf" ? (
              <>
                <span className="text-ink">Invoice as PDF</span>
                <Link
                  href={routes.invoice(attachment.id)}
                  className="ml-auto font-medium text-accent-text hover:underline"
                >
                  Open the invoice
                </Link>
              </>
            ) : (
              <>
                <span className="text-ink">{humanizeKey(attachment.kind)}</span>
                <span className="ml-auto font-mono text-13 text-ink-subtle">
                  {shortId(attachment.id)}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RelatedRow({
  label,
  href,
  children,
}: {
  label: string;
  href: Route;
  children: ReactNode;
}) {
  return (
    <Fact label={label}>
      <Link
        href={href}
        className="font-medium text-accent-text hover:underline"
      >
        {children}
      </Link>
    </Fact>
  );
}

function Related({ message }: { message: NotificationDetail }) {
  const customer = useRecordName("customer", message.customerId);
  const announcement = useRecordName("announcement", message.announcementId);
  const product = useRecordName("product", message.productId);
  const cargo = useRecordName("cargo", message.cargoId);
  const nothing =
    !message.customerId &&
    !message.orderId &&
    !message.returnId &&
    !message.refundId &&
    !message.announcementId &&
    !message.productId &&
    !message.cargoId;

  return (
    <Card>
      <CardHeader
        title="About"
        description="The records this message belongs to."
      />
      <CardBody>
        {nothing ? (
          <p className="text-13 text-ink-muted">
            The message is tied to no record.
          </p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {message.customerId ? (
              <RelatedRow
                label="Customer"
                href={routes.customer(message.customerId)}
              >
                {customer ?? `Customer ${shortId(message.customerId)}`}
              </RelatedRow>
            ) : null}
            {message.orderId ? (
              <RelatedRow label="Order" href={routes.order(message.orderId)}>
                {message.orderNumber ?? `Order ${shortId(message.orderId)}`}
              </RelatedRow>
            ) : null}
            {message.returnId ? (
              <RelatedRow label="Return" href={routes.return(message.returnId)}>
                Open the return
              </RelatedRow>
            ) : null}
            {message.refundId ? (
              <RelatedRow label="Refund" href={routes.refund(message.refundId)}>
                Open the refund
              </RelatedRow>
            ) : null}
            {message.announcementId ? (
              <RelatedRow
                label="Announcement"
                href={routes.announcement(message.announcementId)}
              >
                {announcement ?? "Open the announcement"}
              </RelatedRow>
            ) : null}
            {message.cargoId ? (
              <RelatedRow label="Cargo" href={routes.cargo(message.cargoId)}>
                {cargo ?? `Cargo ${shortId(message.cargoId)}`}
              </RelatedRow>
            ) : null}
            {message.productId ? (
              <RelatedRow
                label="Product"
                href={routes.product(message.productId)}
              >
                {product ?? `Product ${shortId(message.productId)}`}
              </RelatedRow>
            ) : null}
          </dl>
        )}
        {message.customerId ? (
          <p className="mt-4 border-t border-line pt-3 text-13">
            <Link
              href={withQuery(routes.notifications, {
                customerId: message.customerId,
              })}
              className="font-medium text-accent-text hover:underline"
            >
              All messages to this customer
            </Link>
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Attempts({ message }: { message: NotificationDetail }) {
  return (
    <Card>
      <CardHeader
        title="Attempts"
        description={`${message.attempts} of ${message.maxAttempts} used. After a failure that can be retried, the next attempts follow after 1 min, 5 min, 30 min, 2 h and 12 h.`}
      />
      <CardBody>
        {message.history.length > 0 ? (
          <Timeline
            entries={[...message.history].reverse().map((entry, index) => ({
              key: `${entry.at}-${index}`,
              at: entry.at,
              title: entry.ok ? "Accepted by the provider" : "Attempt failed",
              tone: entry.ok ? ("success" as const) : ("danger" as const),
              note: entry.error,
            }))}
          />
        ) : (
          <p className="text-13 text-ink-muted">No attempt was made yet.</p>
        )}
      </CardBody>
    </Card>
  );
}

function Details({ message }: { message: NotificationDetail }) {
  return (
    <Card>
      <CardHeader title="Message" />
      <CardBody>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Recipient" className="sm:col-span-3">
            <span className="flex items-center gap-1">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {message.to}
              </span>
              <CopyButton value={message.to} label="Copy the recipient" />
            </span>
          </Fact>
          <Fact label="Subject" className="sm:col-span-3">
            {message.subject ?? (
              <span className="text-ink-subtle">
                None: only emails have a subject.
              </span>
            )}
          </Fact>
          <Fact label="Type">{typeLabel(message.type)}</Fact>
          <Fact label="Channel">
            <Channel channel={message.channel} />
          </Fact>
          <Fact label="Language">
            {LOCALE_LABEL[message.locale] ?? message.locale}
          </Fact>
          <Fact label="Status">
            <Tooltip content={STATUS_MEANING[message.status]}>
              <span tabIndex={0} className="inline-flex rounded-full">
                <StatusBadge kind="notification" value={message.status} />
              </span>
            </Tooltip>
          </Fact>
          <Fact label="Attempts">
            <span className="tabular">
              {message.attempts} of {message.maxAttempts}
            </span>
          </Fact>
          <Fact label="Next attempt">
            {message.nextAttemptAt ? (
              <DateTime value={message.nextAttemptAt} className="text-gold" />
            ) : (
              <Dash />
            )}
          </Fact>
          <Fact label="Created">
            <DateTime value={message.createdAt} />
          </Fact>
          <Fact label="Sent">
            <DateTime value={message.sentAt} />
          </Fact>
          <Fact label="Last change">
            <DateTime value={message.updatedAt} />
          </Fact>
          <Fact label="Provider's message id" className="sm:col-span-3">
            {message.providerMessageId ? (
              <span className="flex items-center gap-1">
                <span className="min-w-0 font-mono text-13 [overflow-wrap:anywhere]">
                  {message.providerMessageId}
                </span>
                <CopyButton
                  value={message.providerMessageId}
                  label="Copy the provider's message id"
                />
              </span>
            ) : (
              <Dash />
            )}
          </Fact>
          <Fact label="Last error" className="sm:col-span-3">
            {message.lastError ? (
              <span className="font-mono text-13 [overflow-wrap:anywhere]">
                {message.lastError}
              </span>
            ) : (
              <Dash />
            )}
          </Fact>
          <Fact
            label="Reason (when skipped or cancelled)"
            className="sm:col-span-3"
          >
            {message.reason ?? <Dash />}
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

export function NotificationView() {
  const { id } = useParams<{ id: string }>();
  const message = useNotification(id);

  if (message.isError) {
    return (
      <RequirePermission permission="notifications.read">
        <PageHeader title="Message" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            message.error,
            "NOTIFICATION_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState icon={<BellOff />} title="This message does not exist">
              The link may be old, or the address was mistyped.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title="The message could not be loaded"
              actions={
                <Button onClick={() => void message.refetch()}>
                  Try again
                </Button>
              }
            >
              {errorMessage(message.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }

  const data = message.data;
  if (!data) {
    return (
      <RequirePermission permission="notifications.read">
        <PageHeader title={<Skeleton className="h-9 w-56" />} back={back} />
        <div
          className={cn(
            gutter,
            "grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]",
          )}
        >
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      </RequirePermission>
    );
  }

  return (
    <RequirePermission permission="notifications.read">
      <PageHeader
        back={back}
        title={typeLabel(data.type)}
        badges={
          <>
            <StatusBadge kind="notification" value={data.status} />
            <Badge dot={false}>
              {CHANNEL_LABEL[data.channel] ?? data.channel}
            </Badge>
          </>
        }
        description={
          <>
            To {data.to}
            {data.orderNumber ? <> · Order {data.orderNumber}</> : null} ·
            Created {formatDateTime(data.createdAt)}
          </>
        }
        actions={<NotificationActions message={data} />}
      />
      <PageBody>
        <Outcome message={data} />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Details message={data} />
            <RenderedFrom message={data} />
            <Attachments message={data} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <Related message={data} />
            <Attempts message={data} />
          </div>
        </div>
      </PageBody>
    </RequirePermission>
  );
}
