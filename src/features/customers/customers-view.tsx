"use client";

import { Check, Users } from "lucide-react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
  SortSelect,
  type SortOption,
} from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/surface";
import { errorMessage } from "@/lib/api/error-text";
import type {
  Customer,
  CustomerSortField,
  CustomerStatus,
  SortParam,
} from "@/lib/api/types";
import { formatDate } from "@/lib/format/dates";
import { LOCALE_LABEL, personName } from "@/lib/format/names";
import { useNow } from "@/lib/hooks/use-now";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { CUSTOMER_STATUS, statusOptions } from "@/lib/status";
import { useCustomerCount, useCustomers } from "./queries";
import { SIGNUP_METHOD_LABEL } from "./schemas";

const STATUSES: readonly CustomerStatus[] = ["active", "blocked"];

/** The orders of the list the API offers (4). */
const SORTS: readonly SortOption<SortParam<CustomerSortField>>[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "email:asc", label: "Email A to Z" },
  { value: "email:desc", label: "Email Z to A" },
  { value: "status:asc", label: "By status" },
];
const SORT_VALUES = SORTS.map((option) => option.value);

/** The name when the customer gave one; the email stands in otherwise. */
function hasName(customer: Customer): boolean {
  return Boolean(customer.firstName?.trim() || customer.lastName?.trim());
}

/** A decision about ordering that applies right now, as a badge next to the status. */
export function OrderingBadge({
  customer,
  short = false,
}: {
  customer: Customer;
  /** In a list: without the day the allowance ends. */
  short?: boolean;
}) {
  const now = useNow();
  const override = customer.orderingOverride;
  if (!override) return null;
  if (override.until !== null && Date.parse(override.until) <= now.getTime())
    return null;
  if (override.mode === "blocked")
    return <Badge tone="danger">Ordering blocked</Badge>;
  return (
    <Badge tone="attention">
      {short || !override.until
        ? "Ordering allowed"
        : `May order until ${formatDate(override.until)}`}
    </Badge>
  );
}

/** An opt-in as a word with a mark: never the colour alone. */
export function OptIn({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex items-center gap-1 text-ink">
      <Check aria-hidden="true" className="size-3.5 text-success-fg" />
      Yes
    </span>
  ) : (
    <span className="text-ink-subtle">No</span>
  );
}

/** What the customer opted in to, as words: "News, WhatsApp". */
function OptIns({ customer }: { customer: Customer }) {
  const { marketingOptIn, whatsappOptIn } = customer.communication;
  const given = [
    marketingOptIn ? "News" : null,
    whatsappOptIn ? "WhatsApp" : null,
  ].filter(Boolean);
  return given.length > 0 ? (
    <span className="whitespace-nowrap">{given.join(", ")}</span>
  ) : (
    <span className="text-ink-subtle">Nothing</span>
  );
}

// From `lg` on the table is not allowed to scroll sideways (its header
// sticks to the page), so the columns shown at each width must fit it:
// language, sign-up and opt-ins share two columns and wait for `xl`.
const columns: Column<Customer>[] = [
  {
    id: "customer",
    header: "Customer",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <Link
            href={routes.customer(row.original.id)}
            className="font-semibold text-accent-text hover:underline"
          >
            {personName(row.original)}
          </Link>
        }
        secondary={hasName(row.original) ? row.original.email : "No name given"}
      />
    ),
    meta: { skeleton: "w-44", className: "max-w-56 min-[1440px]:max-w-72" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="customer" value={row.original.status} />
        <OrderingBadge customer={row.original} short />
      </span>
    ),
  },
  {
    id: "language",
    header: "Language, sign-up",
    cell: ({ row }) => (
      <TwoLine
        primary={LOCALE_LABEL[row.original.locale] ?? row.original.locale}
        secondary={
          SIGNUP_METHOD_LABEL[row.original.signupMethod] ??
          row.original.signupMethod
        }
      />
    ),
    meta: { from: "xl", skeleton: "w-16" },
  },
  {
    id: "optIns",
    header: "Opted in to",
    cell: ({ row }) => <OptIns customer={row.original} />,
    meta: { from: "xl", skeleton: "w-24" },
  },
  {
    id: "since",
    header: "Customer since",
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular">
        {formatDate(row.original.createdAt)}
      </span>
    ),
    meta: { from: "sm", skeleton: "w-20" },
  },
  {
    id: "lastLogin",
    header: "Last sign-in",
    cell: ({ row }) =>
      row.original.lastLoginAt ? (
        <DateTime value={row.original.lastLoginAt} short />
      ) : (
        <span className="text-ink-subtle">Never</span>
      ),
    meta: { from: "md", skeleton: "w-24" },
  },
];

function CustomerCard({ customer }: { customer: Customer }) {
  return (
    <Link
      href={routes.customer(customer.id)}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 active:bg-sunken"
    >
      <span className="flex flex-col">
        <span className="truncate text-base font-semibold text-ink">
          {personName(customer)}
        </span>
        {hasName(customer) ? (
          <span className="truncate text-sm text-ink-muted">
            {customer.email}
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="customer" value={customer.status} />
        <OrderingBadge customer={customer} short />
        <span className="ml-auto text-13 text-ink-subtle">
          Since {formatDate(customer.createdAt)}
        </span>
      </span>
    </Link>
  );
}

export function CustomersView() {
  const [state, setState, clear] = useUrlState({
    status: param.oneOf(STATUSES),
    q: param.text(100),
    sort: param.oneOf(SORT_VALUES),
    // Links from elsewhere may still name the beginning of an email.
    email: param.text(254),
  });
  const q = state.q.trim() || undefined;
  const email = q || state.email.length < 2 ? undefined : state.email;
  const filters = { status: state.status, q, email };
  const customers = useCustomers({ ...filters, sort: state.sort });
  const count = useCustomerCount(filters);
  const rows = customers.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(state.status || q || email);
  const sortLabel =
    SORTS.find((option) => option.value === state.sort)?.label ??
    "newest first";

  return (
    <RequirePermission permission="customers.read">
      <PageHeader
        title="Customers"
        description="Everyone with an account in the shop, newest first. Customers keep their own details; here you look them up, block an account, and decide who may order."
      />
      <PageBody className="gap-3">
        <FilterBar active={filtered || Boolean(state.sort)} onClear={clear}>
          <SearchField
            value={state.q || state.email}
            onChange={(value) => setState({ q: value, email: "" })}
            label="Search customers"
            placeholder="Name, email or phone"
          />
          <FilterSelect
            label="Status"
            value={state.status}
            options={statusOptions(CUSTOMER_STATUS)}
            onChange={(status) => setState({ status })}
          />
          <SortSelect
            value={state.sort}
            options={SORTS}
            onChange={(sort) => setState({ sort })}
          />
        </FilterBar>

        <DataTable
          caption={`Customers, ${sortLabel.toLowerCase()}`}
          columns={columns}
          data={rows}
          getRowId={(customer) => customer.id}
          refreshing={customers.isPlaceholderData}
          error={customers.error}
          onRetry={() => void customers.refetch()}
          rowHref={(customer) => routes.customer(customer.id)}
          card={(customer) => <CustomerCard customer={customer} />}
          empty={
            <EmptyState
              icon={<Users />}
              title={
                q
                  ? `No customer matches "${q}"`
                  : email
                    ? `No customer's email begins with "${email}"`
                    : state.status
                      ? `No customer is ${CUSTOMER_STATUS[state.status].label.toLowerCase()}`
                      : "No customer yet"
              }
              action={
                filtered ? (
                  <Button onClick={clear}>Clear the filters</Button>
                ) : null
              }
            >
              {q || email
                ? "The search looks at the name, the email and the phone; every word must begin one of them."
                : state.status
                  ? "Choose another status or clear the filter."
                  : "Customers appear here as soon as they create an account in the shop."}
            </EmptyState>
          }
          footer={
            <>
              {customers.isFetchNextPageError ? (
                <Alert
                  tone="danger"
                  title="More customers could not be loaded"
                  actions={
                    <Button onClick={() => void customers.fetchNextPage()}>
                      Try again
                    </Button>
                  }
                >
                  {errorMessage(customers.error)}
                </Alert>
              ) : null}
              <LoadMore
                shown={rows?.length ?? 0}
                total={count.data?.total}
                noun="customer"
                hasMore={customers.hasNextPage}
                loading={customers.isFetchingNextPage}
                onLoadMore={() => void customers.fetchNextPage()}
              />
            </>
          }
        />
      </PageBody>
    </RequirePermission>
  );
}
