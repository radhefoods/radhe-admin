"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { Pagination } from "@/components/data/pagination";
import { AdminName, DateTime } from "@/components/domain/values";
import { Select } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { formatDelta } from "@/features/catalogue/stock";
import type {
  WholesaleProductDetail,
  WholesaleStockMovement,
} from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { useWholesaleStockMovements } from "./queries";
import { STOCK_REASON_LABEL } from "./rules";

const PAGE_SIZE = 25;

function Reason({ movement }: { movement: WholesaleStockMovement }) {
  if (movement.reason === "quotation_accepted" && movement.quotationId) {
    return (
      <span>
        Quotation{" "}
        <Link
          href={routes.quotation(movement.quotationId)}
          className="font-medium text-accent-text hover:underline"
        >
          {movement.quotationNumber ?? "opened"}
        </Link>{" "}
        accepted
      </span>
    );
  }
  return <span>{STOCK_REASON_LABEL[movement.reason] ?? movement.reason}</span>;
}

const columns: Column<WholesaleStockMovement>[] = [
  {
    id: "date",
    header: "When",
    cell: ({ row }) => (
      <DateTime
        value={row.original.createdAt}
        short
        className="text-ink-muted"
      />
    ),
    meta: { skeleton: "w-20" },
  },
  {
    id: "sku",
    header: "SKU",
    cell: ({ row }) => <span className="tabular">{row.original.sku}</span>,
    meta: { skeleton: "w-20" },
  },
  {
    id: "reason",
    header: "Reason",
    cell: ({ row }) => <Reason movement={row.original} />,
    meta: { skeleton: "w-28" },
  },
  {
    id: "delta",
    header: "Cartons",
    cell: ({ row }) => (
      <span
        className={cn(
          "font-semibold tabular",
          row.original.delta < 0 ? "text-danger-fg" : "text-success-fg",
        )}
      >
        {formatDelta(row.original.delta)}
      </span>
    ),
    meta: { align: "right", skeleton: "w-8" },
  },
  {
    id: "count",
    header: "Before → after",
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular">
        {row.original.quantityBefore} →{" "}
        <span
          className={cn(
            "font-semibold",
            row.original.quantityAfter < 0 && "text-danger-fg",
          )}
        >
          {row.original.quantityAfter}
        </span>
      </span>
    ),
    meta: { align: "right", skeleton: "w-16" },
  },
  {
    id: "admin",
    header: "By",
    cell: ({ row }) =>
      row.original.adminId ? (
        <AdminName id={row.original.adminId} admin={row.original.admin} />
      ) : (
        <span className="text-ink-subtle">—</span>
      ),
    meta: { from: "md", skeleton: "w-20" },
  },
  {
    id: "note",
    header: "Note",
    cell: ({ row }) =>
      row.original.note ? (
        <span className="text-ink-muted">“{row.original.note}”</span>
      ) : (
        <span className="text-ink-subtle">—</span>
      ),
    meta: { from: "lg", className: "max-w-56 truncate", skeleton: "w-28" },
  },
];

/**
 * The stock ledger of a product (25, section 8): every change of every
 * SKU, newest first, by page, with a filter by SKU. An entry of an accepted
 * quotation links to it.
 */
export function StockHistoryCard({
  product,
  paused = false,
}: {
  product: WholesaleProductDetail;
  /** The product is being deleted: the ledger is not asked for again. */
  paused?: boolean;
}) {
  const [skuId, setSkuId] = useState<string>("");
  const [page, setPage] = useState(1);
  const selectId = useId();
  const movements = useWholesaleStockMovements(
    product.id,
    { skuId: skuId || undefined, page, limit: PAGE_SIZE },
    !paused,
  );
  const data = movements.data;

  return (
    <Card
      id="stock-history"
      aria-label="Stock history"
      className="scroll-mt-20"
    >
      <CardHeader
        title="Stock history"
        description="Every change of the cartons on hand: your counts, CSV imports and accepted quotations."
        actions={
          product.skus.length > 1 ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor={selectId}
                className="text-13 font-medium text-ink"
              >
                SKU
              </label>
              <Select
                id={selectId}
                value={skuId}
                onChange={(event) => {
                  setSkuId(event.target.value);
                  setPage(1);
                }}
                className="w-auto min-w-40"
              >
                <option value="">All SKUs</option>
                {product.skus.map((sku) => (
                  <option key={sku.id} value={sku.id}>
                    {sku.carton.label} · {sku.sku}
                  </option>
                ))}
              </Select>
            </div>
          ) : null
        }
      />
      <CardBody>
        <DataTable
          caption={`Stock history of ${product.name.en}`}
          columns={columns}
          data={data?.items}
          getRowId={(movement) => movement.id}
          refreshing={movements.isPlaceholderData}
          error={movements.error}
          onRetry={() => void movements.refetch()}
          empty={
            <p className="p-4 text-13 text-ink-muted">
              No change is recorded yet. Every count, import and accepted
              quotation adds a line.
            </p>
          }
          footer={
            data ? (
              <Pagination {...data} noun="change" onPage={setPage} />
            ) : null
          }
        />
      </CardBody>
    </Card>
  );
}
