"use client";

import { useQuery } from "@tanstack/react-query";
import { Ellipsis, ExternalLink, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Timeline, type TimelineEntry } from "@/components/domain/timeline";
import {
  CopyButton,
  DateTime,
  useAdminNames,
} from "@/components/domain/values";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  OrderDetail,
  OrderHistoryEntry,
  SettableOrderStatus,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatDate, formatDayRange } from "@/lib/format/dates";
import {
  DELIVERY_METHOD_LABEL,
  LOCALE_LABEL,
  addressLines,
  personName,
} from "@/lib/format/names";
import { routes, withQuery } from "@/lib/routes";
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  humanize,
  statusMeta,
  type Tone,
} from "@/lib/status";
import {
  ORDER_CHANGEABLE_IN,
  ORDER_PATH,
  orderActionLabel,
  sortTransitions,
} from "@/lib/status/transitions";
import {
  OrderCancelDialog,
  OrderDeliveryDialog,
  OrderMoveDialog,
  OrderStatusDialog,
} from "./order-dialogs";
import { OrderItemsCard } from "./order-items";
import { OrderPaymentCard } from "./order-payment";
import { useOrder, useOrderActions, type OrderActions } from "./queries";

const PAYMENT_EVENT: Record<string, { label: string; tone: Tone }> = {
  credited: { label: "Credit note issued", tone: "planned" },
  reminders_paused: { label: "Reminders paused", tone: "neutral" },
  reminders_resumed: { label: "Reminders resumed", tone: "neutral" },
  reminder_sent: { label: "Reminder sent", tone: "attention" },
  payment_failed: { label: "Online payment failed", tone: "danger" },
};

/** One line of the order's history, in words. */
function describe(entry: OrderHistoryEntry): { title: string; tone: Tone } {
  if (entry.field === "order") {
    const meta = statusMeta("order", entry.to);
    return { title: meta.label, tone: meta.tone };
  }
  if (entry.field === "payment") {
    const event = PAYMENT_EVENT[entry.to];
    if (event) return { title: event.label, tone: event.tone };
    const meta = PAYMENT_STATUS[entry.to as keyof typeof PAYMENT_STATUS];
    return meta
      ? { title: `Payment ${meta.label.toLowerCase()}`, tone: meta.tone }
      : { title: `Payment: ${humanize(entry.to)}`, tone: "neutral" };
  }
  if (entry.field === "cargo") {
    return {
      title: `Moved from ${entry.from ?? "?"} to ${entry.to}`,
      tone: "planned",
    };
  }
  const method =
    DELIVERY_METHOD_LABEL[entry.to as keyof typeof DELIVERY_METHOD_LABEL];
  return {
    title: method ? `Delivery method: ${method}` : `Delivery: ${entry.to}`,
    tone: "neutral",
  };
}

/**
 * The history of an order, newest first. The daily reminders of an unpaid
 * order would bury everything else, so a run of them becomes one line.
 */
export function orderTimeline(
  entries: OrderHistoryEntry[],
  adminName: (id: string | null) => string,
): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  let run: { count: number; first: string } | null = null;
  const newestFirst = [...entries].reverse();
  newestFirst.forEach((entry, index) => {
    const { title, tone } = describe(entry);
    const reminder = entry.field === "payment" && entry.to === "reminder_sent";
    const last = result[result.length - 1];
    if (reminder && run && last) {
      run.count += 1;
      run.first = entry.at;
      last.title = `${run.count} reminders sent`;
      last.note = undefined;
      last.by = `daily since ${formatDate(run.first)}`;
      return;
    }
    run = reminder ? { count: 1, first: entry.at } : null;
    result.push({
      key: `${entry.at}-${index}`,
      at: entry.at,
      title,
      tone,
      by:
        entry.by === "admin"
          ? adminName(entry.adminId)
          : entry.by === "customer"
            ? "The customer"
            : "The system",
      note: entry.note,
    });
  });
  return result;
}

function Actions({
  order,
  actions,
}: {
  order: OrderDetail;
  actions: OrderActions;
}) {
  const can = useCan();
  const [target, setTarget] = useState<SettableOrderStatus | null>(null);
  const [dialog, setDialog] = useState<"move" | "cancel" | null>(null);
  const steps = sortTransitions<SettableOrderStatus>(
    ORDER_PATH as readonly SettableOrderStatus[],
    order.status as SettableOrderStatus,
    order.allowedStatuses,
  );
  const [next, ...alternatives] = steps.forward;
  const manage = can("orders.manage");
  const menu =
    manage && (steps.back.length > 0 || order.canMove || order.canCancel);

  return (
    <>
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" aria-label="More actions for this order">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {steps.back.map((status) => (
              <DropdownMenuItem key={status} onSelect={() => setTarget(status)}>
                {orderActionLabel(order.status, status)}
              </DropdownMenuItem>
            ))}
            {order.canMove ? (
              <DropdownMenuItem onSelect={() => setDialog("move")}>
                Move to another cargo
              </DropdownMenuItem>
            ) : null}
            {order.canCancel ? (
              <DropdownMenuItem danger onSelect={() => setDialog("cancel")}>
                Cancel the order
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {[...steps.aside, ...alternatives].map((status) => (
        <ActionButton
          key={status}
          permission="orders.manage"
          variant={
            status === "delivery_failed" ? "danger-outline" : "secondary"
          }
          className="max-sm:h-12 max-sm:flex-1 max-sm:text-base"
          onClick={() => setTarget(status)}
        >
          {orderActionLabel(order.status, status)}
        </ActionButton>
      ))}
      {next ? (
        <ActionButton
          permission="orders.manage"
          variant="primary"
          className="max-sm:h-12 max-sm:flex-1 max-sm:text-base"
          onClick={() => setTarget(next)}
        >
          {orderActionLabel(order.status, next)}
        </ActionButton>
      ) : null}

      <OrderStatusDialog
        order={order}
        to={target}
        actions={actions}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
      <OrderMoveDialog
        order={order}
        open={dialog === "move"}
        actions={actions}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <OrderCancelDialog
        order={order}
        open={dialog === "cancel"}
        actions={actions}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </>
  );
}

function DeliveryCard({
  order,
  actions,
}: {
  order: OrderDetail;
  actions: OrderActions;
}) {
  const [editing, setEditing] = useState(false);
  const { delivery } = order;
  const changeable = ORDER_CHANGEABLE_IN.includes(order.status);
  return (
    <Card>
      <CardHeader
        title="Delivery"
        actions={
          changeable ? (
            <ActionButton
              permission="orders.manage"
              size="sm"
              onClick={() => setEditing(true)}
            >
              Change
            </ActionButton>
          ) : null
        }
      />
      <CardBody>
        <dl className="grid gap-4">
          <Fact label="Address">
            <address className="not-italic">
              {addressLines(order.deliveryAddress).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              {order.deliveryAddress.phone ? (
                <a
                  href={`tel:${order.deliveryAddress.phone}`}
                  className="mt-1 block text-accent-text hover:underline"
                >
                  {order.deliveryAddress.phone}
                </a>
              ) : null}
            </address>
          </Fact>
          <Fact label="Method">
            {DELIVERY_METHOD_LABEL[delivery.method]}
            {delivery.trackingNumber ? (
              <span className="mt-0.5 flex items-center gap-1 text-13 text-ink-muted">
                <span className="tabular">{delivery.trackingNumber}</span>
                <CopyButton
                  value={delivery.trackingNumber}
                  label="Copy the tracking number"
                />
                {delivery.trackingUrl ? (
                  <a
                    href={delivery.trackingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
                  >
                    Track
                    <ExternalLink aria-hidden="true" className="size-3" />
                  </a>
                ) : null}
              </span>
            ) : null}
          </Fact>
          <Fact label="Promised">
            {formatDayRange(delivery.promisedStart, delivery.promisedEnd)}
          </Fact>
          {delivery.dispatchedAt ? (
            <Fact label="Dispatched">
              <DateTime value={delivery.dispatchedAt} />
            </Fact>
          ) : null}
          {delivery.deliveredAt ? (
            <Fact label="Delivered">
              <DateTime value={delivery.deliveredAt} />
            </Fact>
          ) : null}
          {order.note ? (
            <Fact label="Note of the customer">
              <span className="whitespace-pre-line">“{order.note}”</span>
            </Fact>
          ) : null}
        </dl>
      </CardBody>
      <OrderDeliveryDialog
        order={order}
        open={editing}
        actions={actions}
        onOpenChange={setEditing}
      />
    </Card>
  );
}

/** Returns and messages that belong to the order. */
function Related({ order }: { order: OrderDetail }) {
  const can = useCan();
  const returns = useQuery({
    queryKey: queryKeys.returns.list({ orderNumber: order.orderNumber }),
    queryFn: ({ signal }) =>
      api.returns.list({ orderNumber: order.orderNumber }, signal),
  }).data;
  const messages = useQuery({
    queryKey: queryKeys.notifications.list({ orderId: order.id, limit: 8 }),
    queryFn: ({ signal }) =>
      api.notifications.list({ orderId: order.id, limit: 8 }, signal),
    enabled: can("notifications.read"),
  }).data;

  return (
    <>
      {returns && returns.items.length > 0 ? (
        <Card>
          <CardHeader title="Returns" />
          <ul className="divide-y divide-line">
            {returns.items.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={routes.return(entry.id)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sunken/70 sm:px-5"
                >
                  <span className="font-semibold text-accent-text">
                    {entry.returnNumber}
                  </span>
                  <StatusBadge kind="return" value={entry.status} />
                  <DateTime
                    value={entry.requestedAt}
                    short
                    className="ml-auto text-13 text-ink-muted"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {messages ? (
        <Card>
          <CardHeader
            title="Messages to the customer"
            actions={
              <Link
                href={withQuery(routes.notifications, { orderId: order.id })}
                className="text-13 font-medium text-accent-text hover:underline"
              >
                All
              </Link>
            }
          />
          {messages.items.length === 0 ? (
            <CardBody>
              <p className="text-13 text-ink-muted">
                No message was sent for this order.
              </p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {messages.items.map((message) => (
                <li key={message.id}>
                  <Link
                    href={routes.notification(message.id)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sunken/70 sm:px-5"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-ink">
                        {humanize(message.type)}
                      </span>
                      <span className="text-13 text-ink-subtle">
                        {message.channel === "whatsapp" ? "WhatsApp" : "Email"}{" "}
                        · <DateTime value={message.createdAt} short />
                      </span>
                    </span>
                    <StatusBadge
                      kind="notification"
                      value={message.status}
                      className="ml-auto"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}

export function OrderView() {
  const { id } = useParams<{ id: string }>();
  const order = useOrder(id);
  const actions = useOrderActions(id);
  const can = useCan();
  const adminName = useAdminNames();
  const back = { href: routes.orders, label: "Orders" };

  if (order.isError) {
    return (
      <RequirePermission permission="orders.read">
        <PageHeader title="Order" back={back} />
        <div className={gutter}>
          {hasErrorCode(order.error, "ORDER_NOT_FOUND", "VALIDATION_FAILED") ? (
            <EmptyState
              icon={<ShoppingBag />}
              title="This order does not exist"
            >
              Check the address, or find the order by its number in the list.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title="The order could not be loaded"
              actions={
                <Button onClick={() => void order.refetch()}>Try again</Button>
              }
            >
              {errorMessage(order.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }

  const data = order.data;
  if (!data) {
    return (
      <RequirePermission permission="orders.read">
        <PageHeader title={<Skeleton className="h-9 w-36" />} back={back} />
        <PageBody>
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </PageBody>
      </RequirePermission>
    );
  }

  const history = orderTimeline(data.statusHistory, adminName);

  return (
    <RequirePermission permission="orders.read">
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-1.5">
            {data.orderNumber}
            <CopyButton
              value={data.orderNumber}
              label="Copy the order number"
            />
          </span>
        }
        badges={
          <>
            <StatusBadge kind="order" value={data.status} />
            <StatusBadge kind="payment" value={data.paymentStatus} />
          </>
        }
        description={
          <>
            {personName(data.customer)} ·{" "}
            <Link
              href={routes.cargo(data.cargo.id)}
              className="font-medium text-accent-text hover:underline"
            >
              {data.cargo.code}
            </Link>{" "}
            · placed <DateTime value={data.placedAt} />
          </>
        }
        actions={<Actions order={data} actions={actions} />}
      />
      <PageBody>
        {data.cancellation ? (
          <Alert
            tone="info"
            title={`Cancelled: ${humanize(data.cancellation.reason).toLowerCase()}`}
          >
            {data.cancellation.by === "admin"
              ? `By ${adminName(data.cancellation.adminId)}`
              : data.cancellation.by === "customer"
                ? "By the customer"
                : "By the system"}{" "}
            on <DateTime value={data.cancellation.at} />.
            {data.cancellation.text ? ` “${data.cancellation.text}”` : ""}
          </Alert>
        ) : null}
        {data.status === "delivery_failed" ? (
          <Alert tone="danger" title="The delivery failed">
            Dispatch the order again, mark it delivered, or move it to the next
            cargo (More actions): there it is confirmed again and delivered with
            that cargo.
          </Alert>
        ) : null}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <OrderItemsCard order={data} actions={actions} />
            <OrderPaymentCard order={data} actions={actions} />
            <Related order={data} />
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader title="Customer" />
              <CardBody>
                <dl className="grid gap-4">
                  <Fact label="Name">
                    {can("customers.read") ? (
                      <Link
                        href={routes.customer(data.customer.id)}
                        className="font-medium text-accent-text hover:underline"
                      >
                        {personName(data.customer)}
                      </Link>
                    ) : (
                      personName(data.customer)
                    )}
                  </Fact>
                  <Fact label="Email">
                    <span className="flex items-center gap-1">
                      <a
                        href={`mailto:${data.customer.email}`}
                        className="truncate hover:underline"
                      >
                        {data.customer.email}
                      </a>
                      <CopyButton
                        value={data.customer.email}
                        label="Copy the email address"
                      />
                    </span>
                  </Fact>
                  {data.customer.phone ? (
                    <Fact label="Phone">
                      <a
                        href={`tel:${data.customer.phone}`}
                        className="hover:underline"
                      >
                        {data.customer.phone}
                      </a>
                    </Fact>
                  ) : null}
                  <Fact label="Language">{LOCALE_LABEL[data.language]}</Fact>
                </dl>
              </CardBody>
            </Card>

            <DeliveryCard order={data} actions={actions} />

            <Card>
              <CardHeader title="History" />
              <CardBody>
                <Timeline entries={history} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="What the customer accepted"
                description="Recorded when the order was confirmed."
              />
              <CardBody>
                <dl className="grid gap-4">
                  <Fact label="Accepted">
                    <DateTime value={data.consent.acceptedAt} />
                  </Fact>
                  <Fact label="Legal texts">
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {data.consent.documents.map((document) =>
                        can("legal.read") ? (
                          <Link
                            key={document.documentId}
                            href={routes.legalDocument(document.documentId)}
                            className="font-medium text-accent-text hover:underline"
                          >
                            {humanize(document.type)} v{document.version}
                          </Link>
                        ) : (
                          <span key={document.documentId}>
                            {humanize(document.type)} v{document.version}
                          </span>
                        ),
                      )}
                    </span>
                  </Fact>
                  {data.consent.ip ? (
                    <Fact label="From">
                      <span className={cn("font-mono text-xs text-ink-muted")}>
                        {data.consent.ip}
                        {data.consent.userAgent
                          ? ` · ${data.consent.userAgent}`
                          : ""}
                      </span>
                    </Fact>
                  ) : null}
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>
        <p className="text-13 text-ink-subtle">
          Status: {ORDER_STATUS[data.status].label}. Last change{" "}
          <DateTime value={data.updatedAt} />.
        </p>
      </PageBody>
    </RequirePermission>
  );
}
