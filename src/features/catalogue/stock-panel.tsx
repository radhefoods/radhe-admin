"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { LoadMore } from "@/components/data/pagination";
import { ActionButton } from "@/components/domain/permission";
import { AdminName, DateTime } from "@/components/domain/values";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/input";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { Labelled, NoteField } from "@/features/orders/order-dialogs";
import { errorMessage } from "@/lib/api/error-text";
import type {
  ProductDetail,
  ProductVariant,
  StockMovement,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { useChangeStock, useStockMovements } from "./queries";
import {
  STOCK_MODE_LABEL,
  STOCK_NOTE_MAX,
  STOCK_REASON_LABEL,
  formatDelta,
  readStockChange,
  stockState,
  type StockMode,
} from "./stock";

/**
 * One dialog, two modes (8): the counted number of a pack size after a
 * stock-take, or units that came in or went out. The numbers before and
 * after are restated before anything is sent.
 */
export function StockDialog({
  product,
  variant,
  open,
  onOpenChange,
}: {
  product: ProductDetail;
  variant: ProductVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<StockMode>("set");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const change = useChangeStock(product.id, variant.id);
  const groupId = useId();
  const reading = readStockChange({ mode, value, note }, variant.stock);
  const name = `${translated(product.name)} ${variant.packSize.label}`;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setMode("set");
          setValue("");
          setNote("");
        }
        onOpenChange(next);
      }}
      title={`Change the stock of ${name}`}
      description="The count is what the shop sells of this pack size: at 0 it is sold out, the other pack sizes stay on sale. Every change is kept in its stock history with your name."
      facts={[
        {
          label: "In stock now",
          value: plural(variant.stock.quantity, "unit"),
        },
        {
          label: "Change",
          value:
            reading.delta === null
              ? "—"
              : reading.delta === 0
                ? "Nothing"
                : `${formatDelta(reading.delta)} units`,
        },
        {
          label: "In stock afterwards",
          value: reading.after === null ? "—" : plural(reading.after, "unit"),
          strong: true,
        },
      ]}
      confirmLabel={
        reading.after === null || reading.delta === null
          ? "Save the stock"
          : reading.delta === 0
            ? "Nothing to change"
            : mode === "set"
              ? `Set the stock to ${reading.after}`
              : reading.delta > 0
                ? `Add ${reading.delta} units`
                : `Remove ${-reading.delta} units`
      }
      canConfirm={reading.body !== null && reading.delta !== 0}
      onConfirm={async () => {
        if (!reading.body) return;
        const result = await change.mutateAsync(reading.body);
        const after =
          result.product.variants.find((entry) => entry.id === variant.id)
            ?.stock.quantity ?? reading.after;
        notify.success(
          `Stock of ${variant.sku} is now ${after}`,
          result.movement
            ? `${formatDelta(result.movement.delta)} units, recorded in the history.`
            : "Nothing changed: the count was the same already.",
        );
      }}
    >
      <RadioGroup
        aria-label="How the stock changes"
        value={mode}
        onValueChange={(next) => {
          setMode(next as StockMode);
          setValue("");
        }}
        className="gap-3"
      >
        {(Object.keys(STOCK_MODE_LABEL) as StockMode[]).map((option) => (
          <div key={option} className="flex items-start gap-2.5">
            <RadioItem
              id={`${groupId}-${option}`}
              value={option}
              aria-describedby={`${groupId}-${option}-hint`}
              className="mt-0.5"
            />
            <div className="flex min-w-0 flex-col">
              <label
                htmlFor={`${groupId}-${option}`}
                className="text-sm font-medium text-ink"
              >
                {STOCK_MODE_LABEL[option].label}
              </label>
              <p
                id={`${groupId}-${option}-hint`}
                className="text-13 text-ink-muted"
              >
                {STOCK_MODE_LABEL[option].hint}
              </p>
            </div>
          </div>
        ))}
      </RadioGroup>
      <Labelled
        label={mode === "set" ? "Counted number" : "Units in or out"}
        error={value.trim() === "" ? null : reading.problem}
        hint={
          mode === "set"
            ? "0 to 1,000,000 units."
            : "A plus adds, a minus removes: 24, +24 or −4."
        }
      >
        {(id) => (
          <Input
            id={id}
            inputMode={mode === "set" ? "numeric" : "text"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={
              value.trim() !== "" && reading.problem ? true : undefined
            }
            autoComplete="off"
            className="w-36 tabular"
          />
        )}
      </Labelled>
      <NoteField
        value={note}
        onChange={setNote}
        label="Note for the history"
        maxLength={STOCK_NOTE_MAX}
      />
    </ConfirmDialog>
  );
}

function MovementRow({ movement }: { movement: StockMovement }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-ink">
          {STOCK_REASON_LABEL[movement.reason] ?? movement.reason}
          {movement.orderId && movement.orderNumber ? (
            <>
              {" "}
              <Link
                href={routes.order(movement.orderId)}
                className="font-medium text-accent-text hover:underline"
              >
                {movement.orderNumber}
              </Link>
            </>
          ) : null}
        </span>
        <span className="text-13 text-ink-subtle">
          <DateTime value={movement.createdAt} />
          {movement.adminId ? (
            <>
              {" "}
              · <AdminName id={movement.adminId} admin={movement.admin} />
            </>
          ) : null}
          {movement.note ? <> · “{movement.note}”</> : null}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end leading-tight">
        <span
          className={cn(
            "text-sm font-semibold tabular",
            movement.delta < 0 ? "text-danger-fg" : "text-success-fg",
          )}
        >
          {formatDelta(movement.delta)}
        </span>
        <span className="text-13 text-ink-subtle tabular">
          {movement.quantityAfter} after
        </span>
      </div>
    </li>
  );
}

/**
 * The pack size a panel of the aside shows: a select when the product has
 * several, pre-set to the one that stands for the product.
 */
export function usePackSizeChoice(product: ProductDetail): {
  variant: ProductVariant;
  chooser: React.ReactNode;
} {
  const [variantId, setVariantId] = useState(product.defaultVariant.id);
  const id = useId();
  // A pack size that was removed meanwhile falls back to the default one.
  const variant =
    product.variants.find((entry) => entry.id === variantId) ??
    product.defaultVariant;
  const chooser =
    product.variants.length > 1 ? (
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-13 font-medium text-ink">
          Pack size
        </label>
        <Select
          id={id}
          value={variant.id}
          onChange={(event) => setVariantId(event.target.value)}
          className="w-auto min-w-36"
        >
          {product.variants.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.packSize.label} · {entry.sku}
            </option>
          ))}
        </Select>
      </div>
    ) : null;
  return { variant, chooser };
}

/**
 * The stock of a product (8): one pack size at a time, with its count, its
 * threshold, its state, one dialog to change the count, and the ledger of
 * every change, newest first. The count itself never changes through the
 * form; the threshold does.
 */
export function StockPanel({
  product,
  paused = false,
}: {
  product: ProductDetail;
  /** The product is being deleted: its history is not asked for again. */
  paused?: boolean;
}) {
  const can = useCan();
  const [changing, setChanging] = useState(false);
  const { variant, chooser } = usePackSizeChoice(product);
  const movements = useStockMovements(product.id, variant.id, !paused);
  const rows = movements.data?.pages.flatMap((page) => page.items);
  const state = stockState(variant.stock);
  const { stock } = variant;
  const several = product.variants.length > 1;

  return (
    <Card id="stock" aria-label="Stock" className="scroll-mt-20">
      <CardHeader
        title="Stock"
        description={
          several
            ? `What is on the shelf of each pack size is what the shop sells of it. ${product.stock.quantity} units over ${product.variants.length} pack sizes; nothing is reserved before a payment.`
            : "What is on the shelf is what the shop sells. Nothing is reserved before a payment."
        }
        actions={
          <ActionButton
            permission="catalog.manage"
            size="sm"
            variant={stock.quantity === 0 ? "primary" : "secondary"}
            onClick={() => setChanging(true)}
          >
            Change the stock
          </ActionButton>
        }
      />
      <CardBody className="flex flex-col gap-4">
        {chooser}
        <dl className="grid grid-cols-2 gap-4">
          <Fact
            label={several ? `In stock, ${variant.packSize.label}` : "In stock"}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "font-display text-2xl leading-tight tabular",
                  stock.quantity === 0 ? "text-danger-fg" : "text-ink",
                )}
              >
                {stock.quantity}
              </span>
              {state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
            </span>
          </Fact>
          <Fact label="Low-stock threshold">
            {stock.lowStockThreshold === null ? (
              <span className="text-ink-subtle">None: never warned</span>
            ) : (
              <>
                <span className="tabular">{stock.lowStockThreshold}</span>
                <span className="block text-13 text-ink-subtle">
                  Warned at or below it. Set in the pack-size table.
                </span>
              </>
            )}
          </Fact>
        </dl>
        {stock.quantity === 0 ? (
          <Alert tone="info" title="Sold out in the shop">
            {several
              ? "Customers cannot order this pack size until units are added. The other pack sizes stay on sale."
              : "Customers see the product but cannot order it until units are added."}
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <h3 className="text-xs font-semibold text-ink-muted">
            Stock history{several ? ` of ${variant.packSize.label}` : ""}
          </h3>
          {movements.isPending ? (
            <div
              className="flex flex-col gap-3"
              role="status"
              aria-label="Loading the stock history"
            >
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : movements.isError ? (
            <Alert
              tone="danger"
              title="The stock history could not be loaded"
              actions={
                <Button size="sm" onClick={() => void movements.refetch()}>
                  Try again
                </Button>
              }
            >
              {errorMessage(movements.error)}
            </Alert>
          ) : !rows || rows.length === 0 ? (
            <p className="text-13 text-ink-muted">
              No change is recorded yet. Every count, delivery, order,
              cancellation, return and import adds a line.
            </p>
          ) : (
            <>
              <ol
                aria-label="Stock history"
                className="flex flex-col divide-y divide-line"
              >
                {rows.map((movement) => (
                  <MovementRow key={movement.id} movement={movement} />
                ))}
              </ol>
              <LoadMore
                shown={rows.length}
                noun="change"
                hasMore={movements.hasNextPage}
                loading={movements.isFetchingNextPage}
                onLoadMore={() => void movements.fetchNextPage()}
              />
            </>
          )}
        </div>
      </CardBody>
      {can("catalog.manage") ? (
        <StockDialog
          product={product}
          variant={variant}
          open={changing}
          onOpenChange={setChanging}
        />
      ) : null}
    </Card>
  );
}
