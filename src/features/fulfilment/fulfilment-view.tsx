"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Download,
  History,
  PackageCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
  type FilterOption,
} from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import { Can, RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menu";
import { EmptyState, Skeleton } from "@/components/ui/surface";
import { FigureTile } from "@/features/analytics/kpi";
import type {
  FulfilmentAdjustment,
  FulfilmentFilters,
  FulfilmentRow,
  FulfilmentSort,
  FulfilmentSortField,
} from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { AdjustDialog, type AdjustTarget } from "./adjust-dialog";
import { BrandFilter } from "./brand-filter";
import { ExportDialog, type ExportStart } from "./export-dialog";
import {
  DEFAULT_PERIOD,
  FIGURE_LABEL,
  NEGATIVE_NET_HINT,
  PAGE_SIZE,
  PAGE_TITLE,
  PERIOD_PRESETS,
  adjustedHint,
  count,
  dayParam,
  daysOf,
  isAdjusted,
  nextSort,
  packTitle,
  parseSort,
  periodProblem,
  periodText,
  sortParam,
  takeBackOf,
  type PackSizeRef,
  type PeriodState,
} from "./fulfilment";
import { HistoryDialog } from "./history-dialog";
import { OrdersDialog } from "./orders-dialog";
import { PeriodPicker } from "./period-picker";
import { useFulfilmentBrands, useFulfilmentReport } from "./queries";

/** The header of a column the API sorts by: a click sorts, a second click turns it round. */
function SortHeader({
  field,
  sort,
  onSort,
  children,
}: {
  field: FulfilmentSortField;
  sort: FulfilmentSort | undefined;
  onSort: (sort: FulfilmentSort) => void;
  children: string;
}) {
  const now = parseSort(sort);
  const active = now.field === field;
  const Icon = !active
    ? ChevronsUpDown
    : now.direction === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(nextSort(sort, field))}
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 transition-colors hover:bg-ink/6 hover:text-ink",
        active && "text-ink",
      )}
    >
      {children}
      <Icon
        aria-hidden="true"
        className={cn("size-3.5", !active && "opacity-50")}
      />
      <span className="sr-only">
        {active
          ? `, sorted ${now.direction === "asc" ? "ascending" : "descending"}`
          : ", not sorted"}
      </span>
    </button>
  );
}

const ariaSort = (
  sort: FulfilmentSort | undefined,
  field: FulfilmentSortField,
) => {
  const now = parseSort(sort);
  if (now.field !== field) return "none" as const;
  return now.direction === "asc"
    ? ("ascending" as const)
    : ("descending" as const);
};

/** The sorts as a chip, for phones, where the table gives way to cards without headers. */
const SORT_OPTIONS: readonly FilterOption<FulfilmentSort>[] = [
  {
    value: "dispatched:desc",
    label: `Most ${FIGURE_LABEL.dispatched.toLowerCase()}`,
  },
  {
    value: "returned:desc",
    label: `Most ${FIGURE_LABEL.returned.toLowerCase()}`,
  },
  { value: "net:desc", label: `Most ${FIGURE_LABEL.net.toLowerCase()}` },
  { value: "name:asc", label: "Product, A to Z" },
  { value: "brand:asc", label: "Brand, A to Z" },
  { value: "sku:asc", label: "SKU, A to Z" },
];

function ProductCell({ row }: { row: FulfilmentRow }) {
  const german =
    row.name.de && row.name.de !== row.name.en ? row.name.de : null;
  return (
    <span className="flex min-w-0 flex-col">
      {row.inCatalogue ? (
        <Link
          href={routes.product(row.productId)}
          className="truncate font-medium text-accent-text hover:underline"
        >
          {row.name.en}
        </Link>
      ) : (
        <span className="truncate font-medium text-ink">{row.name.en}</span>
      )}
      {german ? (
        <span lang="de" className="truncate text-13 text-ink-subtle">
          {german}
        </span>
      ) : null}
      {row.inCatalogue ? null : (
        <span className="text-xs text-ink-subtle">
          no longer in the catalogue
        </span>
      )}
    </span>
  );
}

/** Net sold as it is, also below zero, and the mark of a row that was adjusted by hand. */
function NetCell({ row }: { row: FulfilmentRow }) {
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {row.net < 0 ? (
        <Tooltip content={NEGATIVE_NET_HINT}>
          <span
            tabIndex={0}
            className="rounded-sm font-semibold text-gold underline decoration-dotted underline-offset-4"
          >
            {count(row.net)}
            <span className="sr-only">. {NEGATIVE_NET_HINT}</span>
          </span>
        </Tooltip>
      ) : (
        <span className="font-semibold text-ink">{count(row.net)}</span>
      )}
      {isAdjusted(row.adjusted) ? (
        <Tooltip content={adjustedHint(row.adjusted)}>
          <Badge tone="planned" dot={false} tabIndex={0}>
            adjusted
            <span className="sr-only">: {adjustedHint(row.adjusted)}</span>
          </Badge>
        </Tooltip>
      ) : null}
    </span>
  );
}

function RowActions({
  row,
  onView,
  onAdjust,
}: {
  row: FulfilmentRow;
  onView: (row: FulfilmentRow) => void;
  onAdjust: (row: FulfilmentRow) => void;
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <Button
        size="sm"
        onClick={() => onView(row)}
        aria-label={`View orders: ${packTitle(row)}`}
      >
        View orders
      </Button>
      <Can permission="orders.manage">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAdjust(row)}
          aria-label={`Adjust: ${packTitle(row)}`}
        >
          Adjust
        </Button>
      </Can>
    </span>
  );
}

function RowCard({
  row,
  onView,
  onAdjust,
}: {
  row: FulfilmentRow;
  onView: (row: FulfilmentRow) => void;
  onAdjust: (row: FulfilmentRow) => void;
}) {
  return (
    <div className="glass-inset flex flex-col gap-2.5 rounded-lg p-3">
      <div className="flex flex-col gap-0.5">
        <ProductCell row={row} />
        <span className="text-13 text-ink-subtle tabular">
          {[row.brand, row.sku, row.packSize.label].filter(Boolean).join(" · ")}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div className="flex flex-col">
          <dt className="text-xs text-ink-subtle">{FIGURE_LABEL.dispatched}</dt>
          <dd className="text-ink tabular">{count(row.dispatched)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-ink-subtle">{FIGURE_LABEL.returned}</dt>
          <dd className="text-ink tabular">{count(row.returned)}</dd>
        </div>
        <div className="flex flex-col items-start">
          <dt className="text-xs text-ink-subtle">{FIGURE_LABEL.net}</dt>
          <dd className="tabular">
            <NetCell row={row} />
          </dd>
        </div>
      </dl>
      <RowActions row={row} onView={onView} onAdjust={onAdjust} />
    </div>
  );
}

/**
 * Fulfilment & Returns (33): per pack size, the units that were
 * dispatched, that were returned, and that stay sold. The table, the four
 * figures above it and the export are all the API's answer to the same
 * filters; the panel adds nothing up.
 */
export function FulfilmentView() {
  // The report is asked for only by an admin who may read it.
  return (
    <RequirePermission permission="orders.read">
      <Report />
    </RequirePermission>
  );
}

function Report() {
  const [state, setState, clear] = useUrlState({
    range: param.oneOfOr(PERIOD_PRESETS, DEFAULT_PERIOD),
    from: dayParam,
    to: dayParam,
    q: param.text(80),
    brand: param.list(),
    productId: param.id(),
    sort: sortParam,
    page: param.page(),
  });
  const [viewing, setViewing] = useState<PackSizeRef | null>(null);
  const [adjusting, setAdjusting] = useState<AdjustTarget | null>(null);
  const [exporting, setExporting] = useState<ExportStart | null>(null);
  const [history, setHistory] = useState(false);

  const period: PeriodState = {
    range: state.range,
    from: state.from,
    to: state.to,
  };
  const problem = periodProblem(period);
  const days = daysOf(period);
  // A search is sent from two characters on, as the API asks.
  const q = state.q.length >= 2 ? state.q : undefined;
  const filters: FulfilmentFilters = {
    ...days,
    q,
    brand: state.brand.length > 0 ? state.brand : undefined,
    productId: state.productId,
    sort: state.sort,
  };
  const report = useFulfilmentReport(
    { ...filters, page: state.page, limit: PAGE_SIZE },
    !problem,
  );
  // The brands under the same dates and search; the brand filter itself is not sent.
  const brands = useFulfilmentBrands(
    { ...days, q, productId: state.productId },
    !problem,
  );

  const filtered =
    state.range !== DEFAULT_PERIOD ||
    state.q !== "" ||
    state.brand.length > 0 ||
    Boolean(state.productId);
  const totals = report.data?.totals;
  const sort = state.sort;
  const productName =
    report.data?.items.find((row) => row.productId === state.productId)?.name
      .en ?? null;

  const takeBack = (adjustment: FulfilmentAdjustment) => {
    setHistory(false);
    setAdjusting({ pack: adjustment, preset: takeBackOf(adjustment) });
  };

  const columns = useMemo<Column<FulfilmentRow>[]>(() => {
    const onSort = (next: FulfilmentSort) => setState({ sort: next });
    const header = (field: FulfilmentSortField, label: string) =>
      function Header() {
        return (
          <SortHeader field={field} sort={sort} onSort={onSort}>
            {label}
          </SortHeader>
        );
      };
    return [
      {
        id: "product",
        header: header("name", "Product"),
        cell: ({ row }) => <ProductCell row={row.original} />,
        meta: {
          className: "max-w-72",
          skeleton: "w-44",
          sort: ariaSort(sort, "name"),
        },
      },
      {
        id: "brand",
        header: header("brand", "Brand"),
        cell: ({ row }) =>
          row.original.brand ?? <span className="text-ink-subtle">—</span>,
        meta: {
          className: "max-w-40 truncate",
          sort: ariaSort(sort, "brand"),
        },
      },
      {
        id: "sku",
        header: header("sku", "SKU"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular">{row.original.sku}</span>
        ),
        meta: { skeleton: "w-20", sort: ariaSort(sort, "sku") },
      },
      {
        id: "pack",
        header: "Pack size",
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.packSize.label}
          </span>
        ),
        meta: { skeleton: "w-12" },
      },
      {
        id: "dispatched",
        header: header("dispatched", FIGURE_LABEL.dispatched),
        cell: ({ row }) => count(row.original.dispatched),
        meta: {
          align: "right",
          skeleton: "w-10",
          sort: ariaSort(sort, "dispatched"),
        },
      },
      {
        id: "returned",
        header: header("returned", FIGURE_LABEL.returned),
        cell: ({ row }) => count(row.original.returned),
        meta: {
          align: "right",
          skeleton: "w-10",
          sort: ariaSort(sort, "returned"),
        },
      },
      {
        id: "net",
        header: header("net", FIGURE_LABEL.net),
        cell: ({ row }) => <NetCell row={row.original} />,
        meta: { align: "right", skeleton: "w-10", sort: ariaSort(sort, "net") },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <RowActions
            row={row.original}
            onView={setViewing}
            onAdjust={(pack) => setAdjusting({ pack })}
          />
        ),
        meta: { align: "right", skeleton: "w-28" },
      },
    ];
  }, [sort, setState]);

  return (
    <>
      <PageHeader
        title={PAGE_TITLE}
        description={
          <>
            <span className="font-medium text-ink">
              {problem ? "Choose the dates" : periodText(days)}
            </span>
            {" · "}Per pack size: the units that left for customers, the units
            that came back, and what stays sold.
          </>
        }
        actions={
          <>
            <Button icon={<History />} onClick={() => setHistory(true)}>
              Adjustment history
            </Button>
            <Button
              icon={<Download />}
              onClick={() =>
                setExporting({
                  period,
                  brands: state.brand,
                  q: q ?? "",
                  productId: state.productId,
                  productName,
                  sort,
                })
              }
            >
              Export CSV
            </Button>
          </>
        }
      />
      <PageBody>
        <div
          aria-label="Totals of the period"
          role="group"
          aria-busy={!totals && !report.error}
          className={cn(
            "grid gap-3 sm:grid-cols-2 xl:grid-cols-4",
            report.isPlaceholderData && "opacity-60 transition-opacity",
          )}
        >
          {totals && !problem ? (
            <>
              <FigureTile
                label={FIGURE_LABEL.dispatched}
                value={count(totals.dispatched)}
              />
              <FigureTile
                label={FIGURE_LABEL.returned}
                value={count(totals.returned)}
              />
              <FigureTile
                label={FIGURE_LABEL.net}
                value={count(totals.net)}
                detail={totals.net < 0 ? NEGATIVE_NET_HINT : undefined}
                tone={totals.net < 0 ? "attention" : undefined}
              />
              <FigureTile
                label="Pack sizes"
                value={count(totals.packSizes)}
                detail={`in ${plural(totals.products, "product")}`}
              />
            </>
          ) : report.error || problem ? null : (
            Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-[68px] rounded-xl" />
            ))
          )}
        </div>

        <div className="flex flex-col gap-3">
          <FilterBar
            active={filtered || Boolean(sort)}
            onClear={clear}
            clearLabel="Clear filters"
          >
            <SearchField
              label="Search by product name or SKU"
              placeholder="Product name or SKU"
              value={state.q}
              minLength={2}
              hint="At least two characters."
              onChange={(next) => setState({ q: next })}
            />
            <PeriodPicker state={period} onChange={(next) => setState(next)} />
            <BrandFilter
              brands={brands.data?.items}
              selected={state.brand}
              loading={brands.isFetching}
              onChange={(brand) => setState({ brand })}
            />
            {state.productId ? (
              <div className="flex h-8 items-center rounded-md border border-accent/25 bg-accent-soft text-13 font-medium text-accent-text shadow-glow-sm">
                <span className="flex items-center gap-1.5 pr-1.5 pl-2.5">
                  <span>Product</span>
                  <span className="max-w-48 truncate font-semibold">
                    {productName ?? "one product"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setState({ productId: undefined })}
                  aria-label="Remove the filter Product"
                  className="mr-1 flex size-5 items-center justify-center rounded-sm hover:bg-planned-bg"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            ) : null}
            <FilterSelect
              label="Sort"
              value={sort}
              options={SORT_OPTIONS}
              onChange={(next) => setState({ sort: next })}
              className="sm:hidden"
            />
          </FilterBar>
          <DataTable
            caption={`${PAGE_TITLE} per pack size, ${periodText(days)}`}
            columns={columns}
            data={problem ? [] : report.data?.items}
            getRowId={(row) => row.variantId}
            refreshing={report.isPlaceholderData}
            error={report.error}
            onRetry={() => void report.refetch()}
            card={(row) => (
              <RowCard
                row={row}
                onView={setViewing}
                onAdjust={(pack) => setAdjusting({ pack })}
              />
            )}
            empty={
              <EmptyState
                icon={<PackageCheck />}
                title={
                  problem
                    ? "These dates cannot be shown"
                    : "Nothing was dispatched or returned in this period."
                }
                action={
                  filtered ? (
                    <Button onClick={clear}>Clear filters</Button>
                  ) : undefined
                }
              >
                {problem
                  ? problem
                  : filtered
                    ? "Change the filters or clear them."
                    : "A pack size appears here once an order with it is dispatched."}
              </EmptyState>
            }
            footer={
              report.data && !problem ? (
                <Pagination
                  {...report.data}
                  noun="pack size"
                  onPage={(page) => setState({ page })}
                />
              ) : null
            }
          />
        </div>
      </PageBody>

      <OrdersDialog
        pack={viewing}
        days={days}
        onClose={() => setViewing(null)}
      />
      <AdjustDialog
        target={adjusting}
        onClose={() => setAdjusting(null)}
        onTakeBack={takeBack}
      />
      <ExportDialog start={exporting} onClose={() => setExporting(null)} />
      <HistoryDialog
        open={history}
        onOpenChange={setHistory}
        onTakeBack={takeBack}
      />
    </>
  );
}
