"use client";

import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Package,
  Plus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
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
import { DateTime, Money, Thumb, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/surface";
import type {
  Category,
  PriceView,
  ProductSort,
  ProductSummary,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatVatRate } from "@/lib/format/money";
import { translated } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes, withQuery } from "@/lib/routes";
import { PRODUCT_STATUS, statusOptions } from "@/lib/status";
import { PRODUCT_STATUSES } from "./product-schema";
import { ImportExportButton } from "./import-export-dialog";
import { useCategories, useProducts, useSetAvailable } from "./queries";

const PAGE_SIZE = 25;

/** The sorts the API offers (documentation, 8); `newest` is its default. */
const SORTS: { value: ProductSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "updated", label: "Last changed" },
  { value: "name", label: "Name" },
  { value: "sku", label: "Article number" },
  { value: "price_asc", label: "Price, lowest first" },
  { value: "price_desc", label: "Price, highest first" },
];
const SORT_VALUES = SORTS.map((sort) => sort.value);

/** The price of a product; a sale shows the regular price struck through and the percentage. */
export function ProductPrice({
  pricing,
  className,
}: {
  pricing: PriceView;
  className?: string;
}) {
  if (!pricing.onSale)
    return <Money cents={pricing.price} className={className} />;
  return (
    <span
      className={cn("inline-flex flex-col items-end leading-tight", className)}
    >
      <span className="inline-flex items-center gap-1.5">
        {pricing.discountPercent !== null ? (
          <Badge tone="neutral" dot={false} className="h-[18px] px-1.5">
            <span className="sr-only">On sale: </span>−{pricing.discountPercent}{" "}
            %
          </Badge>
        ) : null}
        <Money cents={pricing.price} className="font-semibold" />
      </span>
      <span className="text-13 text-ink-subtle">
        <span className="sr-only">Regular price </span>
        <s>
          <Money cents={pricing.regularPrice} />
        </s>
      </span>
    </span>
  );
}

/** The category filter: the tree, indented; the chip shows the plain name. */
function CategoryFilter({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const current = categories.find((category) => category.id === value);
  return (
    <div
      className={cn(
        "flex h-8 items-center rounded-md border text-13 font-medium",
        current
          ? "border-transparent bg-accent-soft text-accent-text"
          : "border-line bg-surface text-ink-muted hover:border-line-strong",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex h-full items-center gap-1.5 rounded-md pl-2.5",
            current ? "pr-1.5" : "pr-2",
          )}
        >
          <span>Category</span>
          {current ? (
            <span className="max-w-48 truncate font-semibold">
              {current.name.en}
            </span>
          ) : (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto"
        >
          {categories.map((category) => (
            <DropdownMenuItem
              key={category.id}
              onSelect={() => onChange(category.id)}
              style={{ paddingLeft: 10 + (category.level - 1) * 16 }}
              className={cn(category.level === 1 && "font-medium")}
            >
              {category.name.en}
              {category.isVisible ? null : (
                <span className="text-xs text-ink-subtle">hidden</span>
              )}
              {category.id === value ? (
                <Check className="ml-auto text-accent-text" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {current ? (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          aria-label="Remove the filter Category"
          className="mr-1 flex size-5 items-center justify-center rounded-sm hover:bg-planned-bg"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function SortMenu({
  value,
  onChange,
}: {
  value: ProductSort;
  onChange: (value: ProductSort) => void;
}) {
  const current = SORTS.find((sort) => sort.value === value) ?? SORTS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8">
          <ArrowUpDown />
          <span className="sr-only">Sorted by: </span>
          {current?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SORTS.map((sort) => (
          <DropdownMenuItem
            key={sort.value}
            onSelect={() => onChange(sort.value)}
          >
            {sort.label}
            {sort.value === value ? (
              <Check className="ml-auto text-accent-text" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AvailableSwitch({ product }: { product: ProductSummary }) {
  const can = useCan();
  const set = useSetAvailable();
  return (
    <Switch
      checked={product.isAvailable}
      disabled={!can("catalog.manage")}
      aria-label={`${translated(product.name)} ${product.packSize.label} is available`}
      onCheckedChange={(isAvailable) =>
        set.mutate({ id: product.id, isAvailable })
      }
    />
  );
}

const columns: Column<ProductSummary>[] = [
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
              <>
                <Link
                  href={routes.product(product.id)}
                  className="font-semibold text-accent-text hover:underline"
                >
                  {translated(product.name)}
                </Link>{" "}
                <span className="text-ink-muted">{product.packSize.label}</span>
              </>
            }
            secondary={
              <span className="tabular">
                {product.sku}
                {product.brand ? <span> · {product.brand}</span> : null}
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
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge kind="product" value={row.original.status} />
    ),
    meta: { skeleton: "w-16" },
  },
  {
    id: "available",
    header: "Available",
    cell: ({ row }) => <AvailableSwitch product={row.original} />,
    meta: { align: "center", skeleton: "w-9" },
  },
  {
    id: "price",
    header: "Price",
    cell: ({ row }) => <ProductPrice pricing={row.original.pricing} />,
    meta: { align: "right", skeleton: "w-16" },
  },
  {
    id: "vat",
    header: "VAT",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-ink-muted">
        {formatVatRate(row.original.pricing.vatRate)}
      </span>
    ),
    meta: { align: "right", from: "md", skeleton: "w-8" },
  },
  {
    id: "packs",
    header: "Pack sizes",
    cell: ({ row }) => {
      const { packSizeCount, isDefaultVariant } = row.original;
      if (packSizeCount <= 1) return <span className="text-ink-subtle">1</span>;
      return (
        <span className="inline-flex flex-col items-end leading-tight">
          {packSizeCount}
          {isDefaultVariant ? (
            <span className="text-xs text-ink-subtle">default</span>
          ) : null}
        </span>
      );
    },
    meta: { align: "right", from: "xl", skeleton: "w-6" },
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

function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line p-3">
      <Thumb src={product.image?.sizes.small.url} size={48} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={routes.product(product.id)}
          className="truncate font-semibold text-accent-text"
        >
          {translated(product.name)}{" "}
          <span className="font-normal text-ink-muted">
            {product.packSize.label}
          </span>
        </Link>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-13 text-ink-subtle">
          <span className="tabular">{product.sku}</span>
          <StatusBadge kind="product" value={product.status} />
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <ProductPrice pricing={product.pricing} />
        <AvailableSwitch product={product} />
      </div>
    </div>
  );
}

export function ProductsView() {
  const can = useCan();
  const [state, setState, clear] = useUrlState({
    q: param.text(80),
    status: param.oneOf(PRODUCT_STATUSES),
    categoryId: param.id(),
    isAvailable: param.flag(),
    onSale: param.flag(),
    sort: param.oneOfOr(SORT_VALUES, "newest"),
    page: param.page(),
  });
  const products = useProducts({
    // The API takes a search of 2 to 80 characters.
    q: state.q.length >= 2 ? state.q : undefined,
    status: state.status,
    categoryId: state.categoryId,
    isAvailable: state.isAvailable,
    onSale: state.onSale,
    sort: state.sort === "newest" ? undefined : state.sort,
    page: state.page,
    limit: PAGE_SIZE,
  });
  const categories = useCategories().data?.items;
  const filtered = Boolean(
    state.q ||
    state.status ||
    state.categoryId ||
    state.isAvailable !== undefined ||
    state.onSale !== undefined,
  );
  const flag = (value: boolean | undefined) =>
    value === undefined ? undefined : value ? "yes" : "no";
  const category = useMemo(
    () => categories?.find((entry) => entry.id === state.categoryId),
    [categories, state.categoryId],
  );

  const newProduct = can("catalog.manage") ? (
    <Button asChild variant="primary">
      {/* A list filtered by a category starts the new product in it. */}
      <Link
        href={withQuery(routes.productNew, { categoryId: state.categoryId })}
      >
        <Plus />
        New product
      </Link>
    </Button>
  ) : (
    <ActionButton permission="catalog.manage" variant="primary" icon={<Plus />}>
      New product
    </ActionButton>
  );

  return (
    <RequirePermission permission="catalog.read">
      <PageHeader
        title="Products"
        description="Every pack size is a product of its own, with its article number, price and pictures. The pack sizes of one article are linked, and one of them is shown in the shop's listings."
        actions={
          <>
            <ImportExportButton type="products" />
            {newProduct}
          </>
        }
      />
      <PageBody className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <FilterBar active={filtered} onClear={clear}>
            <SearchField
              label="Search products"
              placeholder="Name, article number, brand, tag"
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
              <CategoryFilter
                categories={categories}
                value={state.categoryId}
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
                  isAvailable:
                    value === undefined ? undefined : value === "yes",
                })
              }
            />
            <FilterSelect
              label="On sale"
              value={flag(state.onSale)}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              onChange={(value) =>
                setState({
                  onSale: value === undefined ? undefined : value === "yes",
                })
              }
            />
          </FilterBar>
          <SortMenu
            value={state.sort}
            onChange={(sort) => setState({ sort })}
          />
        </div>

        {category &&
        categories?.some((entry) => entry.parentId === category.id) ? (
          <p className="text-13 text-ink-subtle">
            Products of “{category.name.en}” and of the categories below it.
          </p>
        ) : null}

        <DataTable
          caption="Products"
          columns={columns}
          data={products.data?.items}
          getRowId={(product) => product.id}
          refreshing={products.isPlaceholderData}
          error={products.error}
          onRetry={() => void products.refetch()}
          rowHref={(product) => routes.product(product.id)}
          card={(product) => <ProductCard product={product} />}
          empty={
            <EmptyState
              icon={<Package />}
              title={filtered ? "No product matches" : "No product yet"}
              action={
                filtered ? (
                  <Button onClick={clear}>Clear the filters</Button>
                ) : can("catalog.manage") ? (
                  <Button asChild variant="primary">
                    <Link href={routes.productNew}>
                      Create the first product
                    </Link>
                  </Button>
                ) : null
              }
            >
              {filtered
                ? "Change the search or the filters. The search looks at names, article numbers, brands, keywords and tags."
                : "Products are what customers buy in the shop. Create one with its pack size, price and opening stock; pictures are added once it exists."}
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
    </RequirePermission>
  );
}
