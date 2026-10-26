"use client";

import { Boxes, Copy, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
  SortSelect,
  type SortOption,
} from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Thumb, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/surface";
import { ImportExportButton } from "@/features/catalogue/import-export-dialog";
import {
  WHOLESALE_PRODUCT_SORTS,
  WHOLESALE_RULES,
  type WholesaleProductSort,
  type WholesaleProductSummary,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural, translated } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes, withQuery } from "@/lib/routes";
import { PRODUCT_STATUS, statusOptions } from "@/lib/status";
import { CopyFromRetailDialog } from "./copy-from-retail";
import { PRODUCT_STATUSES } from "./product-schema";
import {
  useSetWholesaleAvailable,
  useWholesaleCategories,
  useWholesaleProducts,
} from "./queries";
import { cartonsText, overviewState } from "./rules";
import { WHOLESALE_SHEETS } from "./sheets";

const SORTS: readonly SortOption<WholesaleProductSort>[] = [
  { value: "newest", label: "Newest first" },
  { value: "updated", label: "Last changed first" },
  { value: "name", label: "Name A to Z" },
  { value: "sku", label: "Article number" },
];

function AvailableSwitch({ product }: { product: WholesaleProductSummary }) {
  const can = useCan();
  const set = useSetWholesaleAvailable();
  return (
    <Switch
      checked={product.isAvailable}
      disabled={!can("wholesale.manage")}
      aria-label={`${translated(product.name)} is available`}
      onCheckedChange={(isAvailable) =>
        set.mutate({ id: product.id, isAvailable })
      }
    />
  );
}

/** The cartons on hand over the SKUs, with a red word when one is below zero. */
function StockCell({ product }: { product: WholesaleProductSummary }) {
  const state = overviewState(product.stock);
  return (
    <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
      <span
        className={cn(
          "tabular",
          product.stock.quantity < 0 && "font-semibold text-danger-fg",
        )}
      >
        {product.stock.quantity}
      </span>
      {state ? (
        <Badge tone={state.tone} className="h-[18px] px-1.5 text-2xs">
          {state.label}
        </Badge>
      ) : null}
    </span>
  );
}

const columns: Column<WholesaleProductSummary>[] = [
  {
    id: "product",
    header: "Product",
    cell: ({ row }) => {
      const product = row.original;
      return (
        <span className="flex min-w-0 items-center gap-3">
          <Thumb src={product.image?.sizes.small.url} size={40} />
          <TwoLine
            primary={
              <Link
                href={routes.wholesaleProduct(product.id)}
                className="font-semibold text-accent-text hover:underline"
              >
                {translated(product.name)}
              </Link>
            }
            secondary={
              <span className="tabular">
                {product.brand ? <span>{product.brand} · </span> : null}
                {product.skus[0]?.sku}
              </span>
            }
          />
        </span>
      );
    },
    meta: { skeleton: "w-52", className: "max-w-80" },
  },
  {
    id: "category",
    header: "Category",
    cell: ({ row }) => (
      <span className="text-ink-muted">
        {translated(row.original.category.name)}
      </span>
    ),
    meta: { from: "lg", skeleton: "w-24" },
  },
  {
    id: "skus",
    header: "SKUs",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <span className="tabular">
            {plural(row.original.skuCount, "SKU")}
          </span>
        }
        secondary={cartonsText(row.original.skus)}
      />
    ),
    meta: { from: "md", skeleton: "w-32", className: "max-w-64" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge kind="product" value={row.original.status} />
    ),
    meta: { skeleton: "w-16" },
  },
  {
    id: "stock",
    header: "Cartons",
    cell: ({ row }) => <StockCell product={row.original} />,
    meta: { align: "right", skeleton: "w-12" },
  },
  {
    id: "available",
    header: "Available",
    cell: ({ row }) => <AvailableSwitch product={row.original} />,
    meta: { align: "center", skeleton: "w-9" },
  },
  {
    id: "updated",
    header: "Updated",
    cell: ({ row }) => (
      <DateTime
        value={row.original.updatedAt}
        short
        className="text-ink-muted"
      />
    ),
    meta: { align: "right", from: "xl", skeleton: "w-20" },
  },
];

function ProductCard({ product }: { product: WholesaleProductSummary }) {
  const state = overviewState(product.stock);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line p-3">
      <Thumb src={product.image?.sizes.small.url} size={48} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={routes.wholesaleProduct(product.id)}
          className="truncate font-semibold text-accent-text"
        >
          {translated(product.name)}
        </Link>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-13 text-ink-subtle">
          <span className="tabular">{cartonsText(product.skus)}</span>
          <StatusBadge kind="product" value={product.status} />
          <span
            className={cn(
              "tabular",
              product.stock.quantity < 0 && "text-danger-fg",
            )}
          >
            {product.stock.quantity} cartons
          </span>
          {state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
        </span>
      </div>
      <AvailableSwitch product={product} />
    </div>
  );
}

/** The wholesale products (25): a table with the API's filters, search and sort, by page. */
export function ProductsView() {
  const can = useCan();
  const router = useRouter();
  const [copying, setCopying] = useState(false);
  const [state, setState, clear] = useUrlState({
    q: param.text(80),
    status: param.oneOf(PRODUCT_STATUSES),
    categoryId: param.id(),
    isAvailable: param.flag(),
    sort: param.oneOf(WHOLESALE_PRODUCT_SORTS),
    page: param.page(),
  });
  const products = useWholesaleProducts({
    q: state.q.length >= 2 ? state.q : undefined,
    status: state.status,
    categoryId: state.categoryId,
    isAvailable: state.isAvailable,
    sort: state.sort,
    page: state.page,
    limit: WHOLESALE_RULES.pageLimit,
  });
  const categories = useWholesaleCategories().data?.items;
  const filtered = Boolean(
    state.q ||
    state.status ||
    state.categoryId ||
    state.isAvailable !== undefined,
  );
  const flag = (value: boolean | undefined) =>
    value === undefined ? undefined : value ? "yes" : "no";
  const manage = can("wholesale.manage");

  return (
    <RequirePermission permission="wholesale.read">
      <PageHeader
        title="Wholesale products"
        description="What the wholesale site offers by the carton, apart from the retail catalogue. Each SKU is a pack size in its carton with its stock in cartons; prices are given per quotation."
        actions={
          <>
            <ImportExportButton type="products" catalogue={WHOLESALE_SHEETS} />
            <ActionButton
              permission="wholesale.manage"
              icon={<Copy />}
              blocked={
                can("catalog.read")
                  ? null
                  : "Needs the permission “Catalogue: read” to find the retail product."
              }
              onClick={() => setCopying(true)}
            >
              Copy from retail
            </ActionButton>
            {manage ? (
              <Button asChild variant="primary">
                <Link
                  href={withQuery(routes.wholesaleProductNew, {
                    categoryId: state.categoryId,
                  })}
                >
                  <Plus />
                  New product
                </Link>
              </Button>
            ) : (
              <ActionButton
                permission="wholesale.manage"
                variant="primary"
                icon={<Plus />}
              >
                New product
              </ActionButton>
            )}
          </>
        }
      />
      <PageBody className="gap-3">
        <FilterBar active={filtered || Boolean(state.sort)} onClear={clear}>
          <SearchField
            label="Search wholesale products"
            placeholder="Name, article number, brand"
            value={state.q}
            minLength={2}
            hint="At least two characters."
            onChange={(q) => setState({ q })}
          />
          <FilterSelect
            label="Status"
            value={state.status}
            options={statusOptions(PRODUCT_STATUS)}
            onChange={(status) => setState({ status })}
          />
          {categories ? (
            <FilterSelect
              label="Category"
              value={state.categoryId}
              options={categories.map((entry) => ({
                value: entry.id,
                label: entry.name.en,
              }))}
              onChange={(categoryId) => setState({ categoryId })}
            />
          ) : null}
          <FilterSelect
            label="Available"
            value={flag(state.isAvailable)}
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            onChange={(value) =>
              setState({
                isAvailable: value === undefined ? undefined : value === "yes",
              })
            }
          />
          <SortSelect
            value={state.sort}
            options={SORTS}
            onChange={(sort) => setState({ sort })}
          />
        </FilterBar>

        <DataTable
          caption="Wholesale products"
          columns={columns}
          data={products.data?.items}
          getRowId={(product) => product.id}
          refreshing={products.isPlaceholderData}
          error={products.error}
          onRetry={() => void products.refetch()}
          rowHref={(product) => routes.wholesaleProduct(product.id)}
          card={(product) => <ProductCard product={product} />}
          empty={
            <EmptyState
              icon={<Boxes />}
              title={
                filtered ? "No product matches" : "No wholesale product yet"
              }
              action={
                filtered ? (
                  <Button onClick={clear}>Clear the filters</Button>
                ) : manage ? (
                  <Button asChild variant="primary">
                    <Link href={routes.wholesaleProductNew}>
                      Create the first product
                    </Link>
                  </Button>
                ) : null
              }
            >
              {filtered
                ? "Change the search or the filters. The search looks at names, article numbers, brands and keywords."
                : "The wholesale site is empty until products exist here. Create one with its SKUs, copy one from the retail catalogue, or import a sheet."}
            </EmptyState>
          }
          footer={
            products.data ? (
              <Pagination
                {...products.data}
                noun="product"
                onPage={(page) => setState({ page })}
              />
            ) : null
          }
        />
      </PageBody>

      <CopyFromRetailDialog
        open={copying}
        onOpenChange={setCopying}
        onCopied={(product) => router.push(routes.wholesaleProduct(product.id))}
      />
    </RequirePermission>
  );
}
