"use client";

import type { ReactNode } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { ActionButton } from "@/components/domain/permission";
import { Money } from "@/components/domain/values";
import {
  fieldMessage,
  FormError,
  type SubmitState,
} from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollX } from "@/components/ui/scroll-x";
import { Card, CardBody, CardHeader, FactRows } from "@/components/ui/surface";
import type { Id, QuotationDetail, QuotationItem } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatVatRate } from "@/lib/format/money";
import { plural } from "@/lib/format/names";
import {
  lineAmount,
  pricedText,
  toLinesPatch,
  type LinesValues,
} from "./rules";

export type LinesForm = UseFormReturn<LinesValues, unknown, LinesValues>;

const HEAD =
  "px-3 py-2 text-left text-xs font-semibold text-ink-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
const CELL =
  "px-3 py-2.5 align-top first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";

function Product({ item }: { item: QuotationItem }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-semibold text-ink">{item.name}</span>
      <span className="text-13 text-ink-muted">
        {item.brand ? `${item.brand} · ` : ""}
        <span className="tabular">{item.sku}</span> · {item.packSize.label}
      </span>
      <span className="text-13 text-ink-subtle">
        Carton {item.carton.label}, {item.carton.content.label}
      </span>
    </span>
  );
}

/** One editable cell: the input, its error under it. */
function Cell({
  form,
  name,
  label,
  prefix,
  className,
  invalid,
}: {
  form: LinesForm;
  name: `lines.${number}.cartons` | `lines.${number}.unitPrice`;
  label: string;
  prefix?: string;
  className?: string;
  invalid?: boolean;
}) {
  const error = fieldMessage(form, name);
  return (
    <span className="flex flex-col gap-1">
      <span className="relative">
        {prefix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
          >
            {prefix}
          </span>
        ) : null}
        <Input
          aria-label={label}
          aria-invalid={error || invalid ? true : undefined}
          inputMode="decimal"
          autoComplete="off"
          className={cn("tabular", prefix && "pl-7", className)}
          {...form.register(name)}
        />
      </span>
      {error ? (
        <span role="alert" className="text-xs text-danger-fg">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function Totals({ quotation }: { quotation: QuotationDetail }) {
  const { totals } = quotation;
  if (!totals) {
    return (
      <p className="text-13 text-ink-muted">
        {pricedText(quotation)}. The totals appear once every line has a price.
      </p>
    );
  }
  return (
    <FactRows
      className="sm:ml-auto sm:w-80"
      rows={[
        { label: "Cartons", value: totals.cartons },
        { label: "Net total (excl. VAT)", value: <Money cents={totals.net} /> },
        ...totals.vat.map((entry) => ({
          label: `VAT ${formatVatRate(entry.vatRate)}`,
          value: <Money cents={entry.vat} />,
        })),
        {
          label: "Total incl. VAT",
          value: <Money cents={totals.gross} />,
          strong: true,
        },
      ]}
    />
  );
}

/**
 * The lines of a quotation (24): the product as it was at the request,
 * the VAT rate, the cartons and the net price per carton, both editable
 * while the quotation is not closed, and the amount. "Save prices" sends
 * only the lines that changed.
 */
export function LinesCard({
  quotation,
  form,
  editable,
  unpriced,
  submit,
  saving,
  state,
}: {
  quotation: QuotationDetail;
  form: LinesForm;
  /** The admin may price, and the status allows it. */
  editable: boolean;
  /** Lines the API named as unpriced when a send was refused. */
  unpriced: ReadonlySet<Id>;
  submit: () => void;
  saving: boolean;
  state: SubmitState | null;
}) {
  const lines = useWatch({ control: form.control, name: "lines" });
  const changes = toLinesPatch({ lines }, quotation.items).length;
  const columns: { label: ReactNode; className?: string }[] = [
    { label: "Product" },
    { label: "VAT" },
    { label: "Cartons", className: "w-28" },
    { label: "Price per carton (excl. VAT)", className: "w-44" },
    { label: "Amount (excl. VAT)", className: "text-right" },
  ];

  return (
    <Card>
      <CardHeader
        title="Lines"
        description={
          editable
            ? "Prices per carton, net of VAT. Save them before the quotation is sent."
            : "Prices per carton, net of VAT."
        }
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        <ScrollX label={`Lines of ${quotation.number}`}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line bg-sunken">
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={index}
                    scope="col"
                    className={cn(HEAD, column.className)}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {quotation.items.map((item, index) => {
                const line = lines[index];
                const amount = line ? lineAmount(line) : item.lineTotal;
                const flagged = unpriced.has(item.id);
                return (
                  <tr
                    key={item.id}
                    aria-label={`${item.name} ${item.packSize.label}`}
                    className={cn(flagged && "bg-danger-bg/40")}
                  >
                    <td className={CELL}>
                      <Product item={item} />
                      {flagged ? (
                        <span className="mt-1 block text-xs font-medium text-danger-fg">
                          No price yet
                        </span>
                      ) : null}
                    </td>
                    <td className={cn(CELL, "whitespace-nowrap tabular")}>
                      {formatVatRate(item.vatRate)}
                    </td>
                    <td className={CELL}>
                      {editable ? (
                        <Cell
                          form={form}
                          name={`lines.${index}.cartons`}
                          label={`Cartons of ${item.name} ${item.packSize.label}`}
                          className="w-24"
                        />
                      ) : (
                        <span className="tabular">{item.cartons}</span>
                      )}
                    </td>
                    <td className={CELL}>
                      {editable ? (
                        <Cell
                          form={form}
                          name={`lines.${index}.unitPrice`}
                          label={`Price per carton of ${item.name} ${item.packSize.label}`}
                          prefix="€"
                          className="w-36"
                          invalid={flagged}
                        />
                      ) : (
                        <Money cents={item.unitPrice} />
                      )}
                    </td>
                    <td
                      className={cn(
                        CELL,
                        "text-right font-semibold whitespace-nowrap",
                      )}
                    >
                      <Money cents={amount} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
        <CardBody className="flex flex-col gap-4 border-t border-line">
          <Totals quotation={quotation} />
          {editable ? (
            <>
              {state ? <FormError state={state} /> : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-13 text-ink-muted" aria-live="polite">
                  {changes > 0
                    ? `${plural(changes, "line")} changed. The totals follow once the prices are saved.`
                    : "Nothing to save."}
                </p>
                <div className="flex items-center gap-2">
                  {changes > 0 ? (
                    <Button variant="ghost" onClick={() => form.reset()}>
                      Discard changes
                    </Button>
                  ) : null}
                  <ActionButton
                    type="submit"
                    permission="quotations.manage"
                    variant="primary"
                    loading={saving}
                    disabled={changes === 0}
                  >
                    Save prices
                  </ActionButton>
                </div>
              </div>
            </>
          ) : null}
        </CardBody>
      </form>
    </Card>
  );
}
