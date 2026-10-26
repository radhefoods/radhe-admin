"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
  SortSelect,
  type SortOption,
} from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Money, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/surface";
import {
  QUOTATION_RULES,
  QUOTATION_SORTS,
  QUOTATION_STATUSES,
  type QuotationQuery,
  type QuotationSort,
  type QuotationSummary,
} from "@/lib/api/types";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { QUOTATION_STATUS, statusOptions } from "@/lib/status";
import { useQuotations } from "./queries";
import { linesText, pricedText, revisionText } from "./rules";

/** The orders of the list the API offers (24). */
const SORTS: readonly SortOption<QuotationSort>[] = [
  { value: "newest", label: "Newest first" },
  { value: "updated", label: "Last changed first" },
  { value: "company", label: "Company A to Z" },
];

function Totals({ quotation }: { quotation: QuotationSummary }) {
  if (quotation.totals) {
    return (
      <span className="flex flex-col items-end">
        <Money cents={quotation.totals.gross} className="font-semibold" />
        <span className="text-13 text-ink-subtle">incl. VAT</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      <span className="text-ink-subtle">Not priced</span>
      <span className="text-13 text-ink-subtle tabular">
        {pricedText(quotation)}
      </span>
    </span>
  );
}

// From `lg` on the table is not allowed to scroll sideways (its header
// sticks to the page), so the columns shown at each width must fit it.
const columns: Column<QuotationSummary>[] = [
  {
    id: "number",
    header: "Quotation",
    cell: ({ row }) => {
      const revision = revisionText(row.original);
      return (
        <TwoLine
          primary={
            <Link
              href={routes.quotation(row.original.id)}
              className="font-semibold text-accent-text tabular hover:underline"
            >
              {row.original.number}
            </Link>
          }
          secondary={revision ?? undefined}
        />
      );
    },
  },
  {
    id: "company",
    header: "Company",
    cell: ({ row }) => (
      <TwoLine
        primary={row.original.contact.company}
        secondary={row.original.contact.name}
      />
    ),
  },
  {
    id: "submitted",
    header: "Submitted",
    meta: { from: "md" },
    cell: ({ row }) => (
      <DateTime
        value={row.original.createdAt}
        short
        className="text-ink-muted"
      />
    ),
  },
  {
    id: "lines",
    header: "Lines",
    meta: { from: "xl" },
    cell: ({ row }) => (
      <span className="text-ink-muted tabular">{linesText(row.original)}</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="inline-flex flex-wrap items-center gap-1">
        <StatusBadge kind="quotation" value={row.original.status} />
        {row.original.stock?.short ? (
          // Accepting took a SKU below zero (25): the shortage is the admin's to resolve.
          <Badge tone="danger">Stock short</Badge>
        ) : null}
      </span>
    ),
  },
  {
    id: "total",
    header: "Total",
    meta: { align: "right" },
    cell: ({ row }) => <Totals quotation={row.original} />,
  },
  {
    id: "sent",
    header: "Sent",
    meta: { from: "lg" },
    cell: ({ row }) =>
      row.original.sentAt ? (
        <DateTime
          value={row.original.sentAt}
          short
          className="text-ink-muted"
        />
      ) : (
        <span className="text-ink-subtle">—</span>
      ),
  },
];

function QuotationCard({ quotation }: { quotation: QuotationSummary }) {
  return (
    <Link
      href={routes.quotation(quotation.id)}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 active:bg-sunken"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-base font-semibold text-ink tabular">
          {quotation.number}
        </span>
        {quotation.totals ? (
          <Money cents={quotation.totals.gross} className="font-semibold" />
        ) : (
          <span className="text-13 text-ink-subtle">
            {pricedText(quotation)}
          </span>
        )}
      </span>
      <span className="text-sm text-ink-muted">
        {quotation.contact.company} · {quotation.contact.name}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="quotation" value={quotation.status} />
        {quotation.stock?.short ? (
          <Badge tone="danger">Stock short</Badge>
        ) : null}
        <span className="ml-auto text-13 text-ink-subtle">
          {linesText(quotation)} ·{" "}
          <DateTime value={quotation.createdAt} short />
        </span>
      </span>
    </Link>
  );
}

/** The wholesale quotations (24): a table with the API's filters, search and sort, by page. */
export function QuotationsView() {
  const [state, setState, clear] = useUrlState({
    q: param.text(100),
    status: param.oneOf(QUOTATION_STATUSES),
    sort: param.oneOf(QUOTATION_SORTS),
    page: param.page(),
  });
  const q = state.q.trim() || undefined;
  const query: QuotationQuery = {
    status: state.status,
    q,
    sort: state.sort,
    page: state.page,
    limit: QUOTATION_RULES.pageLimit,
  };
  const quotations = useQuotations(query);
  const data = quotations.data;
  const filtered = Boolean(q || state.status);

  return (
    <RequirePermission permission="quotations.read">
      <PageHeader
        title="Quotations"
        description="Requests from the wholesale site, priced per carton and net of VAT. A new request waits for its prices; a sent quotation waits for the customer's answer."
      />
      <PageBody className="gap-3">
        <FilterBar active={filtered || Boolean(state.sort)} onClear={clear}>
          <SearchField
            label="Find quotations"
            placeholder="Number, company, contact or email"
            value={state.q}
            onChange={(value) => setState({ q: value })}
            className="w-full sm:w-72"
          />
          <FilterSelect
            label="Status"
            value={state.status}
            options={statusOptions(QUOTATION_STATUS)}
            onChange={(status) => setState({ status })}
          />
          <SortSelect
            value={state.sort}
            options={SORTS}
            onChange={(sort) => setState({ sort })}
          />
        </FilterBar>
        <DataTable
          caption="Wholesale quotations"
          columns={columns}
          data={data?.items}
          getRowId={(row) => row.id}
          refreshing={quotations.isPlaceholderData}
          error={quotations.error}
          onRetry={() => void quotations.refetch()}
          rowHref={(row) => routes.quotation(row.id)}
          card={(quotation) => <QuotationCard quotation={quotation} />}
          empty={
            <EmptyState
              icon={<FileText />}
              title={
                filtered ? "No quotation matches" : "No quotation request yet"
              }
            >
              {filtered
                ? "Change or clear the filters."
                : "Requests arrive from the wholesale site. They show up here the moment a business customer sends one."}
            </EmptyState>
          }
          footer={
            data ? (
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                totalPages={data.totalPages}
                onPage={(page) => setState({ page })}
                noun="quotation"
              />
            ) : null
          }
        />
      </PageBody>
    </RequirePermission>
  );
}
