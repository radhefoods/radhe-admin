"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Tags } from "lucide-react";
import { useId, useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
} from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import { ActionButton } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Money, Thumb, TwoLine } from "@/components/domain/values";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/input";
import { Alert, EmptyState } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  CargoDetail,
  CargoProductRow,
  Id,
  PageResult,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { plural, translated } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { useCurrentCargo } from "./cargo-frame";
import { useCargoChoices, useCargoProducts } from "./queries";

/** Products can be set until ordering has ended (documentation, 9.3). */
const EDITABLE_IN = ["draft", "scheduled", "taking_orders"];
const SHOW = ["all", "enabled", "not_enabled"] as const;

type Setting = { isEnabled?: boolean; maxQuantity?: number | null };

/** One setting of one product. The switch answers at once and steps back if the API refuses. */
function useSetProduct(cargoId: Id) {
  const client = useQueryClient();
  const key = queryKeys.cargos.productsOf(cargoId);
  return useMutation({
    mutationFn: ({ productId, ...input }: Setting & { productId: Id }) =>
      api.cargos.patchProduct(cargoId, productId, input),
    onMutate: async ({ productId, ...input }) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueriesData<PageResult<CargoProductRow>>({
        queryKey: key,
      });
      client.setQueriesData<PageResult<CargoProductRow>>(
        { queryKey: key },
        (page) =>
          page
            ? {
                ...page,
                items: page.items.map((row) =>
                  row.product.id === productId
                    ? { ...row, cargo: { ...row.cargo, ...input } }
                    : row,
                ),
              }
            : page,
      );
      return { before };
    },
    onError: (_error, _input, context) => {
      for (const [queryKey, data] of context?.before ?? []) {
        client.setQueryData(queryKey, data);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.cargos.all });
    },
  });
}

/** The limit of a product: empty means "no limit". Saved when the field is left. */
function LimitInput({
  row,
  disabled,
  onSave,
}: {
  row: CargoProductRow;
  disabled: boolean;
  onSave: (maxQuantity: number | null) => void;
}) {
  const current =
    row.cargo.maxQuantity === null ? "" : String(row.cargo.maxQuantity);
  const [text, setText] = useState(current);
  const [shown, setShown] = useState(current);
  // The row was loaded again: what the API says wins.
  if (current !== shown) {
    setShown(current);
    setText(current);
  }
  const valid = text.trim() === "" || /^\d{1,7}$/.test(text.trim());

  function save() {
    if (!valid) {
      setText(current);
      return;
    }
    const next = text.trim() === "" ? null : Number(text);
    if (next !== row.cargo.maxQuantity) onSave(next);
  }

  return (
    <Input
      inputMode="numeric"
      value={text}
      disabled={disabled}
      placeholder="No limit"
      aria-label={`Limit for ${translated(row.product.name)} ${row.product.packSize.label}`}
      aria-invalid={valid ? undefined : true}
      onChange={(event) => setText(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setText(current);
      }}
      className="ml-auto h-8 w-24 text-right text-13 tabular"
    />
  );
}

function CopyDialog({
  cargo,
  open,
  onOpenChange,
}: {
  cargo: CargoDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const [from, setFrom] = useState("");
  const choices = useCargoChoices(open).data;
  const sources = (choices?.items ?? []).filter(
    (entry) => entry.id !== cargo.id && entry.products.total > 0,
  );
  const copy = useMutation({
    mutationFn: () => api.cargos.copyProducts(cargo.id, from),
    meta: { invalidates: [queryKeys.cargos.all], silent: true },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setFrom("");
        onOpenChange(value);
      }}
      title="Take the products of another cargo"
      description={`Products and limits of the cargo you choose are added to ${cargo.code}. Settings ${cargo.code} already has stay as they are; archived products are skipped.`}
      confirmLabel="Add the products"
      canConfirm={from !== ""}
      onConfirm={async () => {
        const result = await copy.mutateAsync();
        notify.success(
          result.added > 0
            ? `${plural(result.added, "product")} added`
            : "Nothing to add",
          `${result.products.enabled} of ${result.products.total} products can be ordered in ${cargo.code}.`,
        );
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-13 font-medium text-ink">
          Cargo
        </label>
        <Select
          id={id}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        >
          <option value="">Choose a cargo</option>
          {sources.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.code} · {entry.internalName} · {entry.products.enabled}{" "}
              products
            </option>
          ))}
        </Select>
      </div>
    </ConfirmDialog>
  );
}

export function CargoProductsTab() {
  const cargo = useCurrentCargo();
  const can = useCan();
  const [state, setState, clear] = useUrlState({
    q: param.text(80),
    show: param.oneOfOr(SHOW, "all"),
    categoryId: param.id(),
    page: param.page(),
  });
  const [copying, setCopying] = useState(false);
  const cargoId = cargo?.id ?? "";
  const products = useCargoProducts(cargoId, {
    q: state.q || undefined,
    show: state.show,
    categoryId: state.categoryId,
    page: state.page,
    limit: 50,
  });
  const categories = useQuery({
    queryKey: queryKeys.categories.list(),
    queryFn: ({ signal }) => api.categories.list(signal),
    enabled: can("catalog.read"),
    staleTime: 5 * 60_000,
  }).data;
  const set = useSetProduct(cargoId);
  const enableAll = useMutation({
    mutationFn: (rows: CargoProductRow[]) =>
      api.cargos.putProducts(
        cargoId,
        rows.map((row) => ({
          productId: row.product.id,
          isEnabled: true,
          // The limit a product has is sent along: leaving it out would remove it.
          maxQuantity: row.cargo.maxQuantity,
        })),
      ),
    meta: { invalidates: [queryKeys.cargos.all] },
  });

  if (!cargo) return null;
  const editable = EDITABLE_IN.includes(cargo.status);
  const locked = !editable || !can("cargos.manage");
  const rows = products.data?.items;
  const off = (rows ?? []).filter(
    (row) => !row.cargo.isEnabled && row.product.status !== "archived",
  );
  const filtered = Boolean(state.q || state.categoryId || state.show !== "all");

  const columns: Column<CargoProductRow>[] = [
    {
      id: "product",
      header: "Product",
      cell: ({ row }) => {
        const { product } = row.original;
        return (
          <span className="flex items-center gap-3">
            <Thumb src={product.image?.sizes.small.url} size={36} />
            <TwoLine
              primary={
                <>
                  {translated(product.name)}{" "}
                  <span className="text-ink-muted">
                    {product.packSize.label}
                  </span>
                </>
              }
              secondary={
                <span className="flex items-center gap-2">
                  {product.sku}
                  {product.status !== "active" ? (
                    <StatusBadge kind="product" value={product.status} />
                  ) : !product.isAvailable ? (
                    <Badge tone="neutral">Unavailable</Badge>
                  ) : null}
                </span>
              }
            />
          </span>
        );
      },
      meta: { skeleton: "w-48" },
    },
    {
      id: "price",
      header: "Price",
      cell: ({ row }) => <Money cents={row.original.product.pricing.price} />,
      meta: { align: "right", from: "md", skeleton: "w-14" },
    },
    {
      id: "enabled",
      header: "Can be ordered",
      cell: ({ row }) => (
        <Switch
          checked={row.original.cargo.isEnabled}
          disabled={locked}
          aria-label={`${translated(row.original.product.name)} ${row.original.product.packSize.label} can be ordered in ${cargo.code}`}
          onCheckedChange={(isEnabled) =>
            set.mutate({ productId: row.original.product.id, isEnabled })
          }
        />
      ),
      meta: { align: "center", skeleton: "w-9" },
    },
    {
      id: "limit",
      header: "Limit",
      cell: ({ row }) => (
        <LimitInput
          row={row.original}
          disabled={locked}
          onSave={(maxQuantity) =>
            set.mutate({ productId: row.original.product.id, maxQuantity })
          }
        />
      ),
      meta: { align: "right", skeleton: "w-20" },
    },
    {
      id: "ordered",
      header: "Ordered",
      cell: ({ row }) =>
        row.original.cargo.orderedQuantity > 0 ? (
          row.original.cargo.orderedQuantity
        ) : (
          <span className="text-ink-subtle">0</span>
        ),
      meta: { align: "right", from: "sm", skeleton: "w-8" },
    },
    {
      id: "remaining",
      header: "Left",
      cell: ({ row }) => {
        const { remaining } = row.original.cargo;
        if (remaining === null)
          return <span className="text-ink-subtle">No limit</span>;
        return remaining === 0 ? (
          <Badge tone="danger">Sold out</Badge>
        ) : (
          remaining
        );
      },
      meta: { align: "right", from: "sm", skeleton: "w-12" },
    },
  ];

  return (
    <>
      {!editable ? (
        <Alert tone="info" title="Ordering has ended for this cargo">
          Its products and limits can no longer be changed. The list shows what
          was orderable and how much was ordered.
        </Alert>
      ) : cargo.products.enabled === 0 ? (
        <Alert
          tone="warning"
          title="No product can be ordered in this cargo yet"
        >
          A product without a setting cannot be ordered. Enable products below,
          or take the products of another cargo.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar active={filtered} onClear={clear}>
          <SearchField
            label="Search products"
            placeholder="Name or article number"
            value={state.q}
            minLength={2}
            hint="At least two characters."
            onChange={(q) => setState({ q })}
          />
          <FilterSelect
            label="Show"
            value={state.show === "all" ? undefined : state.show}
            options={[
              { value: "enabled", label: "Can be ordered" },
              { value: "not_enabled", label: "Cannot be ordered" },
            ]}
            onChange={(show) => setState({ show: show ?? "all" })}
          />
          {categories ? (
            <FilterSelect
              label="Category"
              value={state.categoryId}
              options={categories.items.map((category) => ({
                value: category.id,
                label: `${"– ".repeat(category.level - 1)}${category.name.en}`,
              }))}
              onChange={(categoryId) => setState({ categoryId })}
            />
          ) : null}
        </FilterBar>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            permission="cargos.manage"
            blocked={editable ? null : "Ordering has ended for this cargo."}
            icon={<Copy />}
            onClick={() => setCopying(true)}
          >
            From another cargo
          </ActionButton>
          <ActionButton
            permission="cargos.manage"
            blocked={
              !editable
                ? "Ordering has ended for this cargo."
                : off.length === 0
                  ? "Every product shown can be ordered already."
                  : null
            }
            loading={enableAll.isPending}
            onClick={() =>
              enableAll.mutate(off, {
                onSuccess: () =>
                  notify.success(
                    `${plural(off.length, "product")} can now be ordered`,
                  ),
              })
            }
          >
            Enable the {off.length > 0 ? off.length : ""} shown
          </ActionButton>
        </div>
      </div>

      <DataTable
        caption={`Products of ${cargo.code}`}
        columns={columns}
        data={rows}
        getRowId={(row) => row.product.id}
        refreshing={products.isPlaceholderData}
        error={products.error}
        onRetry={() => void products.refetch()}
        empty={
          <EmptyState
            icon={<Tags />}
            title={filtered ? "No product matches" : "The catalogue is empty"}
          >
            {filtered
              ? "Change the search or clear the filters."
              : "Create products in the catalogue first; then they can be enabled here."}
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

      <CopyDialog cargo={cargo} open={copying} onOpenChange={setCopying} />
    </>
  );
}
