"use client";

import { BadgePercent, Plus } from "lucide-react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
} from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { CopyButton, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import {
  DISCOUNT_RULES,
  DISCOUNT_STATES,
  type DiscountCode,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDateTime } from "@/lib/format/dates";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { DISCOUNT_STATE, statusOptions } from "@/lib/status";
import { useDiscounts, useUpdateDiscount } from "./queries";
import { DISCOUNT_TYPE_LABEL, periodText, usesText, valueText } from "./rules";

/** What the switch did, from the state the API answered. */
export function switchedText(code: DiscountCode): [string, string | undefined] {
  switch (code.state) {
    case "active":
      return [`${code.code} is switched on`, "The shop takes it now."];
    case "scheduled":
      return [
        `${code.code} is switched on`,
        `The shop takes it from ${formatDateTime(code.startsAt)}.`,
      ];
    case "expired":
      return [
        `${code.code} is switched on, but its period has ended`,
        `It ended on ${formatDateTime(code.expiresAt)}. Move the end to take it again.`,
      ];
    case "exhausted":
      return [
        `${code.code} is switched on, but it is used up`,
        "Raise the maximum uses to take it again.",
      ];
    default:
      return [`${code.code} is switched off`, "The shop does not take it."];
  }
}

function ActiveSwitch({ code }: { code: DiscountCode }) {
  const can = useCan();
  const update = useUpdateDiscount();
  return (
    <Switch
      checked={code.isActive}
      disabled={!can("discounts.manage") || update.isPending}
      aria-label={`${code.code} is switched on`}
      onCheckedChange={(isActive) =>
        update.mutate(
          { id: code.id, isActive },
          {
            onSuccess: (saved) => notify.success(...switchedText(saved)),
            onError: (error) => notify.error(error),
          },
        )
      }
    />
  );
}

function CodeText({ code }: { code: DiscountCode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Link
        href={routes.discount(code.id)}
        className="font-mono text-sm font-semibold text-accent-text hover:underline"
      >
        {code.code}
      </Link>
      <CopyButton value={code.code} label={`Copy the code ${code.code}`} />
    </span>
  );
}

const columns: Column<DiscountCode>[] = [
  {
    id: "code",
    header: "Code",
    cell: ({ row }) => (
      <TwoLine
        primary={<CodeText code={row.original} />}
        secondary={row.original.note}
      />
    ),
    meta: { skeleton: "w-36", className: "max-w-72" },
  },
  {
    id: "value",
    header: "Discount",
    cell: ({ row }) => (
      <TwoLine
        primary={<span className="tabular">{valueText(row.original)}</span>}
        secondary={DISCOUNT_TYPE_LABEL[row.original.type]}
      />
    ),
    meta: { skeleton: "w-16" },
  },
  {
    id: "state",
    header: "State",
    cell: ({ row }) => (
      <StatusBadge kind="discount" value={row.original.state} />
    ),
    meta: { skeleton: "w-16" },
  },
  {
    id: "uses",
    header: "Uses",
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular">
        {usesText(row.original)}
      </span>
    ),
    meta: { from: "md", skeleton: "w-20" },
  },
  {
    id: "period",
    header: "Period",
    cell: ({ row }) => (
      <span className="text-ink-muted">
        {periodText(row.original, formatDateTime)}
      </span>
    ),
    meta: { from: "lg", skeleton: "w-32", className: "max-w-64" },
  },
  {
    id: "once",
    header: "Once per customer",
    cell: ({ row }) =>
      row.original.oncePerCustomer ? (
        <span>Yes</span>
      ) : (
        <span className="text-ink-subtle">No</span>
      ),
    meta: { from: "xl", skeleton: "w-8" },
  },
  {
    id: "active",
    header: "On",
    cell: ({ row }) => <ActiveSwitch code={row.original} />,
    meta: { align: "center", skeleton: "w-9" },
  },
];

function DiscountCard({ code }: { code: DiscountCode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <CodeText code={code} />
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-13 text-ink-subtle">
          <span className="tabular">{valueText(code)}</span>
          <StatusBadge kind="discount" value={code.state} />
          <span className="tabular">{usesText(code)}</span>
        </span>
        <span className="truncate text-13 text-ink-subtle">
          {periodText(code, formatDateTime)}
        </span>
      </div>
      <ActiveSwitch code={code} />
    </div>
  );
}

/** Discount codes (26): a table with the API's search and state filter, by page. */
export function DiscountsView() {
  const manage = useCan()("discounts.manage");
  const [state, setState, clear] = useUrlState({
    q: param.text(100),
    status: param.oneOf(DISCOUNT_STATES),
    page: param.page(),
  });
  const discounts = useDiscounts({
    q: state.q || undefined,
    status: state.status,
    page: state.page,
    limit: DISCOUNT_RULES.pageLimit,
  });
  const filtered = Boolean(state.q || state.status);

  return (
    <RequirePermission permission="discounts.read">
      <PageHeader
        title="Discount codes"
        description="Promotional codes of the retail shop: a customer enters one on the checkout page, the order reserves a use and the payment counts it. The wholesale site is not involved."
        actions={
          manage ? (
            <Button asChild variant="primary">
              <Link href={routes.discountNew}>
                <Plus />
                New code
              </Link>
            </Button>
          ) : (
            <ActionButton
              permission="discounts.manage"
              variant="primary"
              icon={<Plus />}
            >
              New code
            </ActionButton>
          )
        }
      />
      <PageBody className="gap-3">
        <FilterBar active={filtered} onClear={clear}>
          <SearchField
            label="Search discount codes"
            placeholder="Code or note"
            value={state.q}
            onChange={(q) => setState({ q })}
          />
          <FilterSelect
            label="State"
            value={state.status}
            options={statusOptions(DISCOUNT_STATE)}
            onChange={(status) => setState({ status })}
          />
        </FilterBar>

        <DataTable
          caption="Discount codes"
          columns={columns}
          data={discounts.data?.items}
          getRowId={(code) => code.id}
          refreshing={discounts.isPlaceholderData}
          error={discounts.error}
          onRetry={() => void discounts.refetch()}
          rowHref={(code) => routes.discount(code.id)}
          card={(code) => <DiscountCard code={code} />}
          empty={
            <EmptyState
              icon={<BadgePercent />}
              title={filtered ? "No code matches" : "No discount code yet"}
              action={
                filtered ? (
                  <Button onClick={clear}>Clear the filters</Button>
                ) : manage ? (
                  <Button asChild variant="primary">
                    <Link href={routes.discountNew}>Create the first code</Link>
                  </Button>
                ) : null
              }
            >
              {filtered
                ? "Change the search or the state. The search looks at the code and the note."
                : "Customers cannot enter a code on the checkout page until one exists here."}
            </EmptyState>
          }
          footer={
            discounts.data ? (
              <Pagination
                {...discounts.data}
                noun="code"
                onPage={(page) => setState({ page })}
              />
            ) : null
          }
        />
      </PageBody>
    </RequirePermission>
  );
}
