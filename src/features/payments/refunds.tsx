"use client";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { HandCoins } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
} from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Timeline } from "@/components/domain/timeline";
import {
  AdminName,
  DateTime,
  Money,
  TwoLine,
  useAdminNames,
} from "@/components/domain/values";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { Labelled, NoteField } from "@/features/orders/order-dialogs";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import { REFUND_STATUSES, type Id, type Refund } from "@/lib/api/types";
import { berlinToDate, toLocalInput } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { useNow } from "@/lib/hooks/use-now";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { REFUND_STATUS, humanize, statusOptions } from "@/lib/status";
import { refundActions } from "@/lib/status/transitions";

const ORDER_NUMBER = /^(?:rf[\s-]?|#)?(\d{3,9})(?:-rf\d+)?$/i;

function how(refund: Refund): string {
  return refund.method === "stripe"
    ? "Through Stripe"
    : `By hand, ${humanize(refund.manual?.way ?? "other").toLowerCase()}`;
}

const columns: Column<Refund>[] = [
  {
    id: "refund",
    header: "Refund",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <Link
            href={routes.refund(row.original.id)}
            className="font-semibold text-accent-text hover:underline"
          >
            {row.original.refundNumber}
          </Link>
        }
        secondary={<DateTime value={row.original.createdAt} short />}
      />
    ),
    meta: { skeleton: "w-28" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge kind="refund" value={row.original.status} />
    ),
  },
  {
    id: "how",
    header: "How",
    cell: ({ row }) => (
      <TwoLine
        primary={how(row.original)}
        secondary={humanize(row.original.reason)}
      />
    ),
    meta: { from: "md", skeleton: "w-36" },
  },
  {
    id: "order",
    header: "Order",
    cell: ({ row }) => (
      <Link
        href={routes.order(row.original.orderId)}
        className="hover:underline"
      >
        {row.original.orderNumber}
      </Link>
    ),
    meta: { from: "sm", skeleton: "w-16" },
  },
  {
    id: "amount",
    header: "Amount",
    cell: ({ row }) => (
      <Money cents={row.original.amount} className="font-medium" />
    ),
    meta: { align: "right", skeleton: "w-14" },
  },
];

export function RefundsView() {
  const [state, setState, clear] = useUrlState({
    status: param.oneOf(REFUND_STATUSES),
    q: param.text(24),
    orderNumber: param.text(24),
  });
  const text = state.q || state.orderNumber;
  const number = ORDER_NUMBER.exec(text.trim());
  const understood = text.trim() === "" || number !== null;
  const query = {
    status: state.status,
    orderNumber: number ? `RF-${number[1]}` : undefined,
  };
  const refunds = useInfiniteQuery({
    queryKey: queryKeys.refunds.list(query),
    queryFn: ({ pageParam, signal }) =>
      api.refunds.list({ ...query, limit: 25, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: understood,
  });
  const rows = refunds.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(state.status || text);

  return (
    <RequirePermission permission="payments.read">
      <PageHeader
        title="Refunds"
        description="A refund is decided on its order. One through Stripe completes when Stripe confirms; one by hand waits here until you have sent the money and mark it complete."
      />
      <PageBody>
        <div className="flex flex-col gap-3">
          <FilterBar active={filtered} onClear={clear}>
            <SearchField
              label="Refunds of an order"
              placeholder="Order number, RF-1084"
              value={text}
              onChange={(q) => setState({ q, orderNumber: "" })}
            />
            <FilterSelect
              label="Status"
              value={state.status}
              options={statusOptions(REFUND_STATUS)}
              onChange={(status) => setState({ status })}
            />
          </FilterBar>
          <DataTable
            caption="Refunds, newest first"
            columns={columns}
            data={understood ? rows : []}
            getRowId={(refund) => refund.id}
            refreshing={
              refunds.isFetching && !refunds.isFetchingNextPage && Boolean(rows)
            }
            error={refunds.error}
            onRetry={() => void refunds.refetch()}
            rowHref={(refund) => routes.refund(refund.id)}
            empty={
              <EmptyState
                icon={<HandCoins />}
                title={
                  !understood
                    ? "This is not an order number"
                    : filtered
                      ? "No refund matches"
                      : "No refunds yet"
                }
              >
                {!understood
                  ? "Refunds are found by the number of their order, like RF-1084."
                  : state.status === "pending"
                    ? "No refund waits for you to send the money."
                    : filtered
                      ? "Change the filters or clear them."
                      : "A refund is decided on the payment of a paid order."}
              </EmptyState>
            }
            footer={
              <LoadMore
                shown={rows?.length ?? 0}
                noun="refund"
                hasMore={refunds.hasNextPage}
                loading={refunds.isFetchingNextPage}
                onLoadMore={() => void refunds.fetchNextPage()}
              />
            }
          />
        </div>
      </PageBody>
    </RequirePermission>
  );
}

type RefundDialog = "complete" | "cancel" | null;

export function RefundView() {
  const { id } = useParams<{ id: string }>();
  const adminName = useAdminNames();
  const [dialog, setDialog] = useState<RefundDialog>(null);
  const [paidAt, setPaidAt] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const query = useQuery({
    queryKey: queryKeys.refunds.detail(id),
    queryFn: async ({ signal }) => (await api.refunds.get(id, signal)).refund,
  });
  const meta = { invalidates: invalidation.payment, silent: true } as const;
  const complete = useMutation({
    mutationFn: (input: Parameters<typeof api.refunds.complete>[1]) =>
      api.refunds.complete(id, input),
    meta,
  });
  const cancel = useMutation({
    mutationFn: (text: string | undefined) => api.refunds.cancel(id, text),
    meta,
  });
  const sync = useMutation({
    mutationFn: () => api.refunds.sync(id),
    meta: { invalidates: invalidation.payment },
  });
  const now = useNow();
  const back = { href: routes.refunds, label: "Refunds" };
  const refund = query.data;

  if (query.isError) {
    return (
      <RequirePermission permission="payments.read">
        <PageHeader title="Refund" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            query.error,
            "REFUND_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState
              icon={<HandCoins />}
              title="This refund does not exist"
            />
          ) : (
            <Alert
              tone="danger"
              title="The refund could not be loaded"
              actions={
                <Button onClick={() => void query.refetch()}>Try again</Button>
              }
            >
              {errorMessage(query.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }
  if (!refund) {
    return (
      <RequirePermission permission="payments.read">
        <PageHeader title={<Skeleton className="h-9 w-44" />} back={back} />
        <PageBody>
          <Skeleton className="h-64 rounded-lg" />
        </PageBody>
      </RequirePermission>
    );
  }

  const can = refundActions(refund);
  const paid = paidAt === null ? null : berlinToDate(paidAt);
  const paidValid =
    paidAt === null ||
    (paid !== null && paid.getTime() <= now.getTime() + 60_000);
  const close = (open: boolean) => {
    if (!open) {
      setDialog(null);
      setPaidAt(null);
      setReference(null);
      setNote("");
    }
  };

  return (
    <RequirePermission permission="payments.read">
      <PageHeader
        back={back}
        title={refund.refundNumber}
        badges={<StatusBadge kind="refund" value={refund.status} />}
        description={
          <>
            <Money cents={refund.amount} className="font-semibold text-ink" />{" "}
            on order{" "}
            <Link
              href={routes.order(refund.orderId)}
              className="font-medium text-accent-text hover:underline"
            >
              {refund.orderNumber}
            </Link>{" "}
            · {how(refund).toLowerCase()}
          </>
        }
        actions={
          <>
            {can.cancel ? (
              <ActionButton
                permission="payments.manage"
                variant="danger-outline"
                onClick={() => setDialog("cancel")}
              >
                Withdraw
              </ActionButton>
            ) : null}
            {can.sync ? (
              <ActionButton
                permission="payments.manage"
                loading={sync.isPending}
                onClick={() =>
                  sync.mutate(undefined, {
                    onSuccess: (result) =>
                      notify.success(
                        `Stripe says: ${result.refund.stripe?.stripeStatus ?? result.refund.status}`,
                      ),
                  })
                }
              >
                Ask Stripe
              </ActionButton>
            ) : null}
            {can.complete ? (
              <ActionButton
                permission="payments.manage"
                variant="primary"
                onClick={() => setDialog("complete")}
              >
                The money is sent
              </ActionButton>
            ) : null}
          </>
        }
      />
      <PageBody>
        {refund.status === "pending" ? (
          <Alert tone="time" title="Waiting for you">
            Send {formatMoney(refund.amount)} to the customer
            {refund.manual?.reference ? ` (${refund.manual.reference})` : ""},
            then mark the refund as complete. The customer is told then.
          </Alert>
        ) : null}
        {refund.status === "processing" ? (
          <Alert tone="info" title="Stripe is working on it">
            The refund completes by itself when Stripe confirms. “Ask Stripe”
            checks now.
          </Alert>
        ) : null}
        {refund.status === "failed" ? (
          <Alert tone="danger" title="This refund failed">
            {refund.stripe?.failureReason ?? "Stripe gave no reason."} Withdraw
            it and decide a new one on the order, for example by hand.
          </Alert>
        ) : null}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Fact label="Amount">
                  <Money
                    cents={refund.amount}
                    className="font-display text-2xl leading-tight"
                  />
                </Fact>
                <Fact label="Reason">{humanize(refund.reason)}</Fact>
                <Fact label="How">{how(refund)}</Fact>
                <Fact label="Invoice">{refund.invoiceNumber ?? "—"}</Fact>
                {refund.manual ? (
                  <>
                    <Fact label="Reference">
                      {refund.manual.reference ?? "—"}
                    </Fact>
                    <Fact label="Sent">
                      <DateTime value={refund.manual.paidAt} />
                    </Fact>
                  </>
                ) : null}
                {refund.stripe ? (
                  <>
                    <Fact label="Stripe refund">
                      <span className="font-mono text-xs">
                        {refund.stripe.refundId ?? "—"}
                      </span>
                    </Fact>
                    <Fact label="Stripe status">
                      {refund.stripe.stripeStatus ?? "—"}
                    </Fact>
                  </>
                ) : null}
                <Fact label="Decided by">
                  <AdminName id={refund.createdBy} />,{" "}
                  <DateTime value={refund.createdAt} />
                </Fact>
                <Fact label="Completed">
                  <DateTime value={refund.completedAt} />
                </Fact>
                {refund.note ? (
                  <Fact label="Internal note" className="sm:col-span-2">
                    {refund.note}
                  </Fact>
                ) : null}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <Timeline
                entries={[...refund.statusHistory]
                  .reverse()
                  .map((entry, index) => ({
                    key: `${entry.at}-${index}`,
                    at: entry.at,
                    title: REFUND_STATUS[entry.to].label,
                    tone: REFUND_STATUS[entry.to].tone,
                    by:
                      entry.by === "admin"
                        ? adminName(entry.adminId)
                        : "The system",
                    note: entry.note,
                  }))}
              />
            </CardBody>
          </Card>
        </div>
      </PageBody>

      <ConfirmDialog
        open={dialog === "complete"}
        onOpenChange={close}
        title={`Is the money of ${refund.refundNumber} sent?`}
        description="The refund is marked as complete, the order carries the refunded amount, and the customer is told by email."
        facts={[
          { label: "Order", value: refund.orderNumber },
          {
            label: "Sent to the customer",
            value: formatMoney(refund.amount),
            strong: true,
          },
        ]}
        confirmLabel={`Complete the refund of ${formatMoney(refund.amount)}`}
        canConfirm={paidValid}
        onConfirm={async () => {
          await complete.mutateAsync({
            paidAt: paid ? paid.toISOString() : undefined,
            reference: reference?.trim() || undefined,
            note: note.trim() || undefined,
          });
          notify.success(`${refund.refundNumber} completed`);
        }}
      >
        <Labelled
          label="Sent at"
          optional
          hint="German time. Leave empty for now."
          error={paidValid ? null : "This time lies in the future."}
        >
          {(fieldId) => (
            <Input
              id={fieldId}
              type="datetime-local"
              value={paidAt ?? ""}
              max={toLocalInput(new Date())}
              onChange={(event) => setPaidAt(event.target.value || null)}
              className="tabular"
            />
          )}
        </Labelled>
        <Labelled
          label="Reference"
          optional
          hint="A transfer reference, for the records."
        >
          {(fieldId) => (
            <Input
              id={fieldId}
              maxLength={200}
              value={reference ?? refund.manual?.reference ?? ""}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </Labelled>
        <NoteField value={note} onChange={setNote} maxLength={1000} />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={close}
        title={`Withdraw ${refund.refundNumber}?`}
        description="The refund is withdrawn and no money is sent. The amount can be refunded again with a new decision on the order."
        tone="danger"
        facts={[
          {
            label: "Not refunded",
            value: formatMoney(refund.amount),
            strong: true,
          },
        ]}
        confirmLabel="Withdraw the refund"
        cancelLabel="Keep it"
        onConfirm={async () => {
          await cancel.mutateAsync(note.trim() || undefined);
          notify.success(`${refund.refundNumber} withdrawn`);
        }}
      >
        <NoteField value={note} onChange={setNote} maxLength={1000} />
      </ConfirmDialog>
    </RequirePermission>
  );
}
