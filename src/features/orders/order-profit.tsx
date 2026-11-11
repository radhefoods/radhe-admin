"use client";

import { ChevronDown } from "lucide-react";
import { Fragment, useId, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollX } from "@/components/ui/scroll-x";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Skeleton,
} from "@/components/ui/surface";
import {
  chargedNote,
  differs,
  formatCost,
  formatExact,
  formatFine,
  formatPercent,
  packOf,
  quantityText,
} from "@/features/finance/profit-format";
import { useOrderProfit } from "@/features/finance/queries";
import { errorMessage } from "@/lib/api/error-text";
import type { FineCents, Id, OrderProfit, ProfitLine } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";
import { plural, translated } from "@/lib/format/names";

// The "Cost & profit" section of the order page (documentation, 32;
// doc/ORDER_PROFIT.md). Everything is without VAT unless a row says
// otherwise, and every figure is the API's: the panel prints them and adds
// nothing up, because adding rounded figures gives other totals.

const numberCell = "px-3 py-2.5 text-right whitespace-nowrap tabular";
const headCell = "px-3 py-2 text-right font-semibold";

/** A figure as the order ended, with the ordered one crossed out when it differs. */
function Figure({
  final,
  ordered,
  cost = false,
  className,
}: {
  final: FineCents | null;
  ordered: FineCents | null;
  /** Printed as a negative amount. */
  cost?: boolean;
  className?: string;
}) {
  const print = cost ? formatCost : formatFine;
  return (
    <>
      <span className={className}>{print(final)}</span>
      {final !== null && ordered !== null && differs(ordered, final) ? (
        <span className="block text-13 text-ink-subtle">
          <span className="sr-only">As ordered: </span>
          <s>{print(ordered)}</s>
        </span>
      ) : null}
    </>
  );
}

/** Green for a gain, red for a loss, plain for nothing. */
function gainClass(value: FineCents | null): string {
  if (value === null) return "";
  const cents = Math.round(value);
  return cents > 0 ? "text-success-fg" : cents < 0 ? "text-danger-fg" : "";
}

/** From the buying price of one pack to its price, step by step (Model A). */
function Calculation({ line }: { line: ProfitLine }) {
  const { unit } = line;
  const steps = unit.calculation;
  if (!steps) return null;
  const note = chargedNote(unit);
  const rows: { label: string; value: string; strong?: boolean }[] = [
    { label: "Supplier buying price", value: formatExact(steps.cost) },
    {
      label: `Fulfilment cost (${formatPercent(unit.rule?.fulfilmentPercent)})`,
      value: formatExact(steps.fulfilment),
    },
    ...(steps.extra !== 0
      ? [{ label: "Other expenses", value: formatExact(steps.extra) }]
      : []),
    {
      label: "Cost after fulfilment",
      // The one figure the API does not name: the three steps before it,
      // unrounded, as the documentation defines the row.
      value: formatExact(steps.cost + steps.fulfilment + steps.extra),
    },
    {
      label: `Markup (${formatPercent(unit.rule?.markupPercent)})`,
      value: formatExact(steps.markup),
    },
    { label: "Selling price before VAT", value: formatExact(steps.net) },
    {
      label: `VAT (${formatPercent(line.vatPercent)})`,
      value: formatExact(steps.vat),
    },
    {
      label: "Final customer selling price",
      value: formatMoney(steps.price),
      strong: true,
    },
  ];
  return (
    <div className="flex flex-col gap-2 sm:max-w-md">
      <p className="text-13 font-semibold text-ink">
        How the price of one pack comes about
      </p>
      <dl className="glass-inset divide-y divide-line overflow-hidden rounded-lg text-13">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 px-3 py-1.5"
          >
            <dt className="text-ink-muted">{row.label}</dt>
            <dd
              className={cn(
                "text-right text-ink tabular",
                row.strong && "font-semibold",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
        {note !== null ? (
          <div className="flex items-baseline justify-between gap-4 px-3 py-1.5">
            <dt className="text-ink-muted">
              Charged{note ? ` (${note})` : ""}
            </dt>
            <dd className="text-right font-semibold text-ink tabular">
              {formatMoney(unit.price)}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function LineRow({ line }: { line: ProfitLine }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const name = translated(line.name);
  const known = line.unit.cost !== null;
  const { ordered, final } = line;
  return (
    <Fragment>
      <tr className={cn("border-b border-line", open && "border-b-0")}>
        <th scope="row" className="px-4 py-2.5 text-left font-normal sm:px-5">
          <span className="flex items-start gap-1.5">
            {line.unit.calculation ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={`${open ? "Hide" : "Show"} the calculation of one pack of ${name} ${packOf(line)}`}
                onClick={() => setOpen((current) => !current)}
                className="-ml-1.5 shrink-0"
              >
                <ChevronDown
                  className={cn(
                    "transition-transform duration-150",
                    open && "rotate-180",
                  )}
                />
              </Button>
            ) : (
              <span aria-hidden="true" className="-ml-1.5 size-7 shrink-0" />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="text-ink">
                {name} <span className="text-ink-muted">{packOf(line)}</span>
              </span>
              <span className="text-13 text-ink-subtle">{line.sku}</span>
              {known ? null : (
                <span className="text-13 text-attention-fg">
                  buying price not known
                </span>
              )}
            </span>
          </span>
        </th>
        <td className={numberCell}>{quantityText(line.quantity)}</td>
        <td className={numberCell}>{formatFine(line.unit.cost)}</td>
        <td className={numberCell}>{formatMoney(line.unit.price)}</td>
        <td className={numberCell}>
          <Figure final={final.discount} ordered={ordered.discount} cost />
        </td>
        <td className={numberCell}>
          <Figure final={final.netRevenue} ordered={ordered.netRevenue} />
        </td>
        <td className={numberCell}>
          <Figure final={final.buyingCost} ordered={ordered.buyingCost} cost />
        </td>
        <td className={numberCell}>
          <Figure
            final={final.fulfilmentCost}
            ordered={ordered.fulfilmentCost}
            cost
          />
        </td>
        <td className={numberCell}>
          <Figure
            final={final.profit}
            ordered={ordered.profit}
            className={cn("font-medium", gainClass(final.profit))}
          />
        </td>
        <td className={cn(numberCell, "pr-4 sm:pr-5")}>
          {formatPercent(final.marginPercent)}
        </td>
      </tr>
      {open ? (
        <tr id={panelId} className="border-b border-line">
          <td colSpan={10} className="px-4 pt-1 pb-4 sm:px-5">
            <Calculation line={line} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function Lines({ profit }: { profit: OrderProfit }) {
  const label = `Cost and profit of the products of ${profit.orderNumber}`;
  return (
    <ScrollX label={label}>
      <table className="w-full text-sm">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-ink-muted">
            <th
              scope="col"
              className="px-4 py-2 text-left font-semibold sm:px-5"
            >
              Product
            </th>
            <th scope="col" className={headCell}>
              Quantity
            </th>
            <th scope="col" className={headCell}>
              Buying price
            </th>
            <th scope="col" className={headCell}>
              Selling price
            </th>
            <th scope="col" className={headCell}>
              Discount
            </th>
            <th scope="col" className={headCell}>
              Revenue
            </th>
            <th scope="col" className={headCell}>
              Buying cost
            </th>
            <th scope="col" className={headCell}>
              Fulfilment
            </th>
            <th scope="col" className={headCell}>
              Profit
            </th>
            <th scope="col" className={cn(headCell, "pr-4 sm:pr-5")}>
              Margin
            </th>
          </tr>
        </thead>
        <tbody className="[&>tr:last-child]:border-b-0">
          {profit.lines.map((line) => (
            <LineRow key={line.variantId} line={line} />
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}

interface Row {
  label: ReactNode;
  value: ReactNode;
  /** A result, not a part: set off from the rows before it. */
  result?: boolean;
  strong?: boolean;
  className?: string;
}

function Rows({ label, rows }: { label: string; rows: Row[] }) {
  return (
    <dl aria-label={label} className="flex flex-col text-sm">
      {rows.map((row, index) => (
        <div
          key={index}
          className={cn(
            "flex items-baseline justify-between gap-6 py-1",
            row.result && "mt-1 border-t border-line pt-2",
            row.strong && "font-semibold text-ink",
          )}
        >
          <dt className={cn(!row.strong && "text-ink-muted")}>{row.label}</dt>
          <dd
            className={cn(
              "text-right whitespace-nowrap tabular",
              !row.strong && "text-ink",
              row.className,
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const FEE_SOURCE = {
  actual: { label: "actual", tone: "success" },
  estimate: { label: "estimate", tone: "attention" },
} as const;

function Summary({ profit }: { profit: OrderProfit }) {
  const { summary, paymentFee } = profit;
  const source = paymentFee.source === "none" ? null : paymentFee.source;
  const rows: Row[] = [
    {
      label: "Total product revenue",
      value: formatFine(summary.productRevenue),
    },
    { label: "Total buying costs", value: formatCost(summary.buyingCosts) },
    {
      label: "Total fulfilment costs",
      value: formatCost(summary.fulfilmentCosts),
    },
    ...(summary.extraCosts !== 0
      ? [
          {
            label: "Other product costs",
            value: formatCost(summary.extraCosts),
          },
        ]
      : []),
    { label: "Delivery revenue", value: formatFine(summary.deliveryRevenue) },
    { label: "Delivery cost", value: formatCost(summary.deliveryCost) },
    { label: "Packaging cost", value: formatCost(summary.packagingCost) },
    {
      label: (
        <span className="flex flex-wrap items-center gap-2">
          Stripe processing fee
          {source ? (
            <Badge tone={FEE_SOURCE[source].tone}>
              {FEE_SOURCE[source].label}
            </Badge>
          ) : null}
        </span>
      ),
      value: formatCost(summary.paymentFee),
    },
    { label: "Other operational costs", value: formatCost(summary.otherCosts) },
    {
      label: "Profit as ordered",
      value: formatFine(summary.profitAsOrdered),
      result: true,
    },
    ...(summary.refundAdjustment !== 0
      ? [
          {
            label: "Refund adjustments",
            value: formatFine(summary.refundAdjustment),
          },
        ]
      : []),
    {
      label: "Final net profit",
      value: formatFine(summary.netProfit),
      result: true,
      strong: true,
      className: cn("text-base", gainClass(summary.netProfit)),
    },
    {
      label: "Actual profit margin",
      value: formatPercent(summary.marginPercent),
      strong: true,
    },
  ];
  return (
    <section aria-label="Order summary" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink-muted">Order summary</h3>
      <Rows label="Order summary" rows={rows} />
      <p className="text-13 text-ink-subtle">All amounts without VAT.</p>
    </section>
  );
}

function Refunds({ profit }: { profit: OrderProfit }) {
  const { refunds } = profit;
  if (refunds.profit === 0) return null;
  const rows: Row[] = [
    { label: "Revenue given back", value: formatFine(refunds.revenue) },
    { label: "Costs recovered", value: formatFine(refunds.costsRecovered) },
    ...(refunds.goodwill !== 0
      ? [{ label: "Goodwill", value: formatCost(refunds.goodwill) }]
      : []),
  ];
  return (
    <section aria-label="Refunds" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink-muted">Refunds</h3>
      <Rows label="Refunds" rows={rows} />
      <p className="text-13 text-ink-subtle">
        What corrections, returns and a cancellation changed. Without VAT.
      </p>
    </section>
  );
}

function CustomerPaid({ profit }: { profit: OrderProfit }) {
  const { customer } = profit;
  const rows: Row[] = [
    { label: "Agreed", value: formatMoney(customer.agreed) },
    { label: "Paid", value: formatMoney(customer.paid) },
    { label: "Refunded", value: formatMoney(customer.refunded) },
    { label: "Kept", value: formatMoney(customer.kept), strong: true },
    { label: "of which VAT", value: formatMoney(customer.vat) },
    ...(customer.pendingRefund > 0
      ? [
          {
            label: "Still to refund",
            value: formatMoney(customer.pendingRefund),
            className: "text-attention-fg",
          },
        ]
      : []),
  ];
  return (
    <section
      aria-label="What the customer paid"
      className="flex flex-col gap-2"
    >
      <h3 className="text-xs font-semibold text-ink-muted">
        What the customer paid
      </h3>
      <Rows label="What the customer paid" rows={rows} />
      <p className="text-13 text-ink-subtle">VAT included.</p>
    </section>
  );
}

/** What the reader has to know before the figures. */
function Notes({ profit }: { profit: OrderProfit }) {
  const notes = [
    ...(profit.state === "not_paid"
      ? ["Not paid yet: these figures are what is expected."]
      : []),
    ...(profit.state === "cancelled"
      ? ["Cancelled: only what the order still cost is shown."]
      : []),
    ...(profit.costs === null
      ? ["Placed before order costs were recorded."]
      : []),
    ...(profit.paymentFee.source === "estimate"
      ? ["The payment fee is an estimate until Stripe reports it."]
      : []),
  ];
  if (profit.complete && notes.length === 0) return null;
  return (
    <CardBody className="flex flex-col gap-3 border-b border-line">
      {profit.complete ? null : (
        <Alert tone="warning">
          The buying price of {plural(profit.linesWithoutCost, "product")} is
          not known: the profit shown is too high.
        </Alert>
      )}
      {notes.length > 0 ? (
        <ul
          aria-label="Notes on the figures"
          className="flex list-disc flex-col gap-1 pl-4 text-13 text-ink-muted"
        >
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </CardBody>
  );
}

function Breakdown({ orderId }: { orderId: Id }) {
  const profit = useOrderProfit(orderId);
  const data = profit.data;
  return (
    <Card aria-label="Cost & profit" id="cost-and-profit">
      <CardHeader
        title="Cost & profit"
        description="What this order cost and what it earned, worked out from the buying prices and the order costs as they were when it was placed. Internal: no customer sees this."
      />
      {data ? (
        <>
          <Notes profit={data} />
          <Lines profit={data} />
          <CardBody className="grid gap-x-10 gap-y-6 border-t border-line md:grid-cols-2">
            <Summary profit={data} />
            <div className="flex flex-col gap-6">
              <Refunds profit={data} />
              <CustomerPaid profit={data} />
            </div>
          </CardBody>
        </>
      ) : profit.isError ? (
        <CardBody>
          <Alert
            tone="danger"
            title="Cost and profit could not be loaded"
            actions={
              <Button onClick={() => void profit.refetch()}>Try again</Button>
            }
          >
            {errorMessage(profit.error)}
          </Alert>
        </CardBody>
      ) : (
        <CardBody aria-busy="true">
          <span className="sr-only" role="status">
            Loading cost and profit
          </span>
          <Skeleton className="h-40 rounded-lg" />
        </CardBody>
      )}
    </Card>
  );
}

/**
 * "Cost & profit" of an order: the products with what each cost and
 * earned, the summary of the order, what refunds changed and what the
 * customer paid. Buying prices and profit are not for everyone who works
 * on orders: without `finance.read` there is no section, and the API is
 * not asked. The breakdown is loaded again with the order, after anything
 * that changes it.
 */
export function OrderProfitCard({ orderId }: { orderId: Id }) {
  const can = useCan();
  if (!can("finance.read")) return null;
  return <Breakdown orderId={orderId} />;
}
