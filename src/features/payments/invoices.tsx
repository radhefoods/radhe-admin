"use client";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, ReceiptText, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
} from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Money, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { ScrollX } from "@/components/ui/scroll-x";
import {
  Alert,
  Card,
  CardBody,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  Id,
  InvoiceDetail,
  InvoiceSummary,
  InvoiceType,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDate, formatDay, formatDeadline } from "@/lib/format/dates";
import { formatVatRate } from "@/lib/format/money";
import { LOCALE_LABEL } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { humanize } from "@/lib/status";

const TYPES = [
  "invoice",
  "credit_note",
] as const satisfies readonly InvoiceType[];
const ORDER_NUMBER = /^(?:rf[\s-]?|#)?(\d{3,9})$/i;

/** A credit note lowers what is owed: its amount is shown with a minus. */
const signed = (document: Pick<InvoiceSummary, "type" | "total">) =>
  document.type === "credit_note" ? -document.total : document.total;

/**
 * The PDF of a document. It is fetched with the session (a plain link
 * would not refresh it) and handed to the browser as a local file.
 */
export function useInvoicePdf(
  document: { id: Id; number: string } | undefined,
) {
  const [url, setUrl] = useState<string | null>(null);
  const load = useMutation({
    mutationFn: async () => {
      if (!document) throw new Error("No document");
      return URL.createObjectURL(await api.invoices.pdf(document.id));
    },
    onSuccess: (created) => setUrl(created),
  });
  // The local file is given back when the viewer closes or the page is left.
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return {
    url,
    open: () => load.mutate(),
    close: () => setUrl(null),
    loading: load.isPending,
    download: () => {
      if (!url || !document) return;
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${document.number}.pdf`;
      anchor.click();
    },
  };
}

const columns: Column<InvoiceSummary>[] = [
  {
    id: "number",
    header: "Document",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <Link
            href={routes.invoice(row.original.id)}
            className="font-semibold text-accent-text hover:underline"
          >
            {row.original.number}
          </Link>
        }
        secondary={formatDate(row.original.issuedAt)}
      />
    ),
    meta: { skeleton: "w-32" },
  },
  {
    id: "type",
    header: "Type",
    cell: ({ row }) =>
      row.original.type === "invoice" ? (
        <StatusBadge kind="invoiceType" value="invoice" />
      ) : (
        <TwoLine
          primary={<StatusBadge kind="invoiceType" value="credit_note" />}
          secondary={`${humanize(row.original.creditReason ?? "adjustment")} of ${row.original.invoiceNumber ?? "an invoice"}`}
        />
      ),
  },
  {
    id: "order",
    header: "Order",
    cell: ({ row }) => row.original.orderNumber,
    meta: { from: "sm", skeleton: "w-16" },
  },
  {
    id: "due",
    header: "Due",
    cell: ({ row }) =>
      row.original.type === "credit_note" ? (
        <span className="text-ink-subtle">—</span>
      ) : row.original.paidAt ? (
        <Badge tone="success">Paid {formatDate(row.original.paidAt)}</Badge>
      ) : (
        <span className="tabular">{formatDeadline(row.original.dueAt)}</span>
      ),
    meta: { from: "md", skeleton: "w-28" },
  },
  {
    id: "total",
    header: "Amount",
    cell: ({ row }) => (
      <Money cents={signed(row.original)} className="font-medium" />
    ),
    meta: { align: "right", skeleton: "w-14" },
  },
];

export function InvoicesView() {
  const [state, setState, clear] = useUrlState({
    type: param.oneOf(TYPES),
    q: param.text(20),
    orderNumber: param.text(20),
    customerId: param.id(),
  });
  const text = state.q || state.orderNumber;
  const number = ORDER_NUMBER.exec(text.trim());
  const understood = text.trim() === "" || number !== null;
  const query = {
    type: state.type,
    orderNumber: number ? `RF-${number[1]}` : undefined,
    customerId: state.customerId,
  };
  const invoices = useInfiniteQuery({
    queryKey: queryKeys.invoices.list(query),
    queryFn: ({ pageParam, signal }) =>
      api.invoices.list({ ...query, limit: 25, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: understood,
  });
  const rows = invoices.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(state.type || text || state.customerId);

  return (
    <RequirePermission permission="payments.read">
      <PageHeader
        title="Invoices"
        description="An invoice is issued when payment is activated; a credit note when the bill goes down afterwards. Both are numbered without gaps and never change."
      />
      <PageBody>
        <div className="flex flex-col gap-3">
          <FilterBar active={filtered} onClear={clear}>
            <SearchField
              label="Documents of an order"
              placeholder="Order number, RF-1084"
              value={text}
              onChange={(q) => setState({ q, orderNumber: "" })}
            />
            <FilterSelect
              label="Type"
              value={state.type}
              options={[
                { value: "invoice", label: "Invoices" },
                { value: "credit_note", label: "Credit notes" },
              ]}
              onChange={(type) => setState({ type })}
            />
            {state.customerId ? (
              <span className="flex h-8 items-center gap-1 rounded-md bg-accent-soft pr-1 pl-2.5 text-13 font-semibold text-accent-text">
                One customer
                <button
                  type="button"
                  onClick={() => setState({ customerId: undefined })}
                  aria-label="Remove the filter: one customer"
                  className="flex size-5 items-center justify-center rounded-sm hover:bg-planned-bg"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            ) : null}
          </FilterBar>
          <DataTable
            caption="Invoices and credit notes, newest first"
            columns={columns}
            data={understood ? rows : []}
            getRowId={(invoice) => invoice.id}
            refreshing={
              invoices.isFetching &&
              !invoices.isFetchingNextPage &&
              Boolean(rows)
            }
            error={invoices.error}
            onRetry={() => void invoices.refetch()}
            rowHref={(invoice) => routes.invoice(invoice.id)}
            empty={
              <EmptyState
                icon={<ReceiptText />}
                title={
                  !understood
                    ? "This is not an order number"
                    : filtered
                      ? "No document matches"
                      : "No invoices yet"
                }
              >
                {!understood
                  ? "The API finds documents by the number of their order, like RF-1084, not by the invoice number."
                  : filtered
                    ? "Change the filters or clear them."
                    : "The first invoice is issued when payment is activated for a delivered order."}
              </EmptyState>
            }
            footer={
              <LoadMore
                shown={rows?.length ?? 0}
                noun="document"
                hasMore={invoices.hasNextPage}
                loading={invoices.isFetchingNextPage}
                onLoadMore={() => void invoices.fetchNextPage()}
              />
            }
          />
        </div>
      </PageBody>
    </RequirePermission>
  );
}

function Party({
  title,
  lines,
}: {
  title: string;
  lines: (string | null | undefined)[];
}) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <h3 className="mb-1 text-xs font-semibold text-ink-muted">{title}</h3>
      {lines
        .filter((line): line is string => Boolean(line))
        .map((line, index) => (
          <span
            key={`${line}-${index}`}
            className={
              index === 0 ? "font-semibold text-ink" : "text-ink-muted"
            }
          >
            {line}
          </span>
        ))}
    </div>
  );
}

function Paper({ invoice }: { invoice: InvoiceDetail }) {
  const credit = invoice.type === "credit_note";
  return (
    <Card className="overflow-hidden">
      <CardBody className="flex flex-col gap-7 sm:p-8">
        <div className="grid gap-6 sm:grid-cols-2">
          <Party
            title="Seller"
            lines={[
              invoice.seller.name,
              ...invoice.seller.addressLines,
              invoice.seller.email,
              invoice.seller.phone,
              invoice.seller.vatId ? `VAT id ${invoice.seller.vatId}` : null,
              invoice.seller.taxNumber
                ? `Tax number ${invoice.seller.taxNumber}`
                : null,
              invoice.seller.registration,
            ]}
          />
          <Party
            title="Customer"
            lines={[
              invoice.customer.name,
              invoice.customer.company,
              ...invoice.customer.addressLines,
              invoice.customer.email,
            ]}
          />
        </div>
        <ScrollX label={`Lines of ${invoice.number}`}>
          <table className="w-full text-sm">
            <caption className="sr-only">Lines of {invoice.number}</caption>
            <thead>
              <tr className="border-b border-line-strong text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 text-left font-semibold">
                  Description
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Quantity
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Unit price
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  VAT
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, index) => (
                <tr key={index} className="border-b border-line">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                    {line.description}
                    {line.sku ? (
                      <span className="block text-13 text-ink-subtle">
                        {line.sku}
                      </span>
                    ) : null}
                  </th>
                  <td className="px-3 py-2.5 text-right tabular">
                    {line.quantity}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Money cents={line.unitPrice} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {formatVatRate(line.vatRate)}
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    <Money cents={line.lineTotal} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
        <dl className="flex flex-col gap-1 self-end text-sm sm:w-72">
          <div className="flex justify-between gap-6 text-ink-muted">
            <dt>Net</dt>
            <dd>
              <Money cents={invoice.totals.netTotal} />
            </dd>
          </div>
          {invoice.totals.vat.map((entry) => (
            <div
              key={entry.vatRate}
              className="flex justify-between gap-6 text-ink-muted"
            >
              <dt>VAT {formatVatRate(entry.vatRate)}</dt>
              <dd>
                <Money cents={entry.vat} />
              </dd>
            </div>
          ))}
          <div className="flex justify-between gap-6 border-t border-line-strong pt-2 text-base font-semibold text-ink">
            <dt>{credit ? "Credited" : "Total"}</dt>
            <dd>
              <Money cents={invoice.totals.total} />
            </dd>
          </div>
        </dl>
        {invoice.footer ? (
          <p className="text-13 text-ink-muted">{invoice.footer}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function InvoiceView() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const query = useQuery({
    queryKey: queryKeys.invoices.detail(id),
    queryFn: async ({ signal }) => (await api.invoices.get(id, signal)).invoice,
  });
  const invoice = query.data;
  const pdf = useInvoicePdf(invoice);
  const back = { href: routes.invoices, label: "Invoices" };

  if (query.isError) {
    return (
      <RequirePermission permission="payments.read">
        <PageHeader title="Document" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            query.error,
            "INVOICE_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState
              icon={<ReceiptText />}
              title="This document does not exist"
            />
          ) : (
            <Alert
              tone="danger"
              title="The document could not be loaded"
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
  if (!invoice) {
    return (
      <RequirePermission permission="payments.read">
        <PageHeader title={<Skeleton className="h-9 w-52" />} back={back} />
        <PageBody>
          <Skeleton className="h-96 rounded-lg" />
        </PageBody>
      </RequirePermission>
    );
  }
  const credit = invoice.type === "credit_note";

  return (
    <RequirePermission permission="payments.read">
      <PageHeader
        back={back}
        title={invoice.number}
        badges={
          <>
            <StatusBadge kind="invoiceType" value={invoice.type} />
            {invoice.paidAt ? <Badge tone="success">Paid</Badge> : null}
          </>
        }
        description={
          <>
            {credit ? "Credit note" : "Invoice"} for order{" "}
            {can("orders.read") ? (
              <Link
                href={routes.order(invoice.orderId)}
                className="font-medium text-accent-text hover:underline"
              >
                {invoice.orderNumber}
              </Link>
            ) : (
              invoice.orderNumber
            )}
            . A document never changes; a correction is a credit note.
          </>
        }
        actions={
          <Button
            variant="primary"
            icon={<FileText />}
            loading={pdf.loading}
            onClick={pdf.open}
          >
            Open the PDF
          </Button>
        }
      />
      <PageBody>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Paper invoice={invoice} />
          <Card>
            <CardBody>
              <dl className="grid gap-4">
                <Fact label="Issued">
                  <DateTime value={invoice.issuedAt} />
                </Fact>
                {credit ? (
                  <>
                    <Fact label="Corrects">{invoice.invoiceNumber ?? "—"}</Fact>
                    <Fact label="Reason">
                      {humanize(invoice.creditReason ?? "adjustment")}
                      {invoice.creditReference
                        ? ` (${invoice.creditReference})`
                        : ""}
                    </Fact>
                  </>
                ) : (
                  <>
                    <Fact label="Due">
                      <span
                        className={
                          invoice.paidAt ? "" : "font-medium text-gold"
                        }
                      >
                        {formatDeadline(invoice.dueAt)}
                      </span>
                    </Fact>
                    <Fact label="Paid">
                      <DateTime value={invoice.paidAt} />
                    </Fact>
                    <Fact label="Delivered on">
                      {formatDay(invoice.deliveredOn)}
                    </Fact>
                  </>
                )}
                <Fact label="Language of the document">
                  {LOCALE_LABEL[invoice.language]}
                </Fact>
                {can("customers.read") ? (
                  <Fact label="Customer">
                    <Link
                      href={routes.customer(invoice.customerId)}
                      className="font-medium text-accent-text hover:underline"
                    >
                      {invoice.customer.name}
                    </Link>
                  </Fact>
                ) : null}
              </dl>
            </CardBody>
          </Card>
        </div>
      </PageBody>

      <Dialog
        open={pdf.url !== null}
        onOpenChange={(open) => !open && pdf.close()}
      >
        <DialogContent
          size="xl"
          className="h-[calc(100dvh-2rem)] sm:h-[calc(100dvh-4rem)]"
        >
          <DialogHeader
            title={invoice.number}
            description="The PDF as the customer received it."
          />
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-3 pb-5 sm:px-6">
            {pdf.url ? (
              <iframe
                title={`PDF of ${invoice.number}`}
                src={pdf.url}
                className="min-h-0 flex-1 rounded-md border border-line bg-sunken"
              />
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {/* Phones and some browsers show no PDF inside a page. */}
              {pdf.url ? (
                <Button asChild variant="ghost">
                  <a href={pdf.url} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    Open in a new tab
                  </a>
                </Button>
              ) : null}
              <Button icon={<Download />} onClick={pdf.download}>
                Download
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </RequirePermission>
  );
}
