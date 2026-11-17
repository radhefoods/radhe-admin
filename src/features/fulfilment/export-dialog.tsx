"use client";

import { Download } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { saveCsv } from "@/features/catalogue/sheets";
import { api } from "@/lib/api/client";
import { describeError } from "@/lib/api/error-text";
import { isSessionError } from "@/lib/api/errors";
import {
  FULFILMENT_DEFAULT_EXPORT_COLUMNS,
  FULFILMENT_EXPORT_COLUMNS,
  type FulfilmentExportColumn,
  type FulfilmentFilters,
  type FulfilmentSort,
  type Id,
} from "@/lib/api/types";
import { plural } from "@/lib/format/names";
import { BrandFilter } from "./brand-filter";
import {
  EXPORT_COLUMN_LABEL,
  daysOf,
  periodProblem,
  periodText,
  rowsText,
  sheetOf,
  type PeriodState,
} from "./fulfilment";
import { PeriodPicker } from "./period-picker";
import { useFulfilmentBrands, useFulfilmentReport } from "./queries";

/** What the page hands over when the dialog opens. */
export interface ExportStart {
  period: PeriodState;
  brands: readonly string[];
  q: string;
  productId: Id | undefined;
  /** The name of the product the page is filtered to, when it is known. */
  productName: string | null;
  sort: FulfilmentSort | undefined;
}

function Content({
  start,
  onClose,
}: {
  start: ExportStart;
  onClose: () => void;
}) {
  const id = useId();
  const [columns, setColumns] = useState<ReadonlySet<FulfilmentExportColumn>>(
    () => new Set(FULFILMENT_DEFAULT_EXPORT_COLUMNS),
  );
  const [brands, setBrands] = useState<string[]>([...start.brands]);
  const [period, setPeriod] = useState<PeriodState>(start.period);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [empty, setEmpty] = useState(false);

  const problem = periodProblem(period);
  const days = daysOf(period);
  // The search and the product of the page are carried over as they are.
  const carried = {
    q: start.q || undefined,
    productId: start.productId,
  };
  const filters: FulfilmentFilters = {
    ...days,
    ...carried,
    brand: brands.length > 0 ? brands : undefined,
  };
  const brandList = useFulfilmentBrands({ ...days, ...carried }, !problem);
  // One row is enough: the totals are those of every row under the filters.
  const counted = useFulfilmentReport({ ...filters, limit: 1 }, !problem);
  const rows = counted.data?.totals.packSizes;
  // The order of the file is the order of the list.
  const chosen = FULFILMENT_EXPORT_COLUMNS.filter((key) => columns.has(key));

  const tick = (key: FulfilmentExportColumn, on: boolean) => {
    const next = new Set(columns);
    if (on) next.add(key);
    else next.delete(key);
    setColumns(next);
  };

  async function run() {
    setPending(true);
    setError(null);
    setEmpty(false);
    try {
      // Every row under the filters comes from the endpoint, never from the
      // rows on the screen: the file then matches the report by construction.
      const answer = await api.fulfilment.export({
        ...filters,
        sort: start.sort,
        columns: chosen,
      });
      if (answer.rows.length === 0) {
        setEmpty(true);
        return;
      }
      const sheet = sheetOf(answer);
      saveCsv(answer.fileName, sheet.labels, sheet.rows);
      notify.success(
        "CSV exported",
        `${plural(answer.rows.length, "row")} in ${answer.fileName}.`,
      );
      onClose();
    } catch (caught) {
      if (!isSessionError(caught)) setError(caught);
    } finally {
      setPending(false);
    }
  }

  const nothing = rows === 0 || empty;
  const notes = [
    start.q ? `Search: ${start.q}` : null,
    start.productId
      ? `Product: ${start.productName ?? "the one the page is filtered to"}`
      : null,
  ].filter(Boolean);

  return (
    <>
      <DialogHeader
        title="Export CSV"
        description="One line per pack size, with the columns you tick. The file has every row under the filters, not only the page on the screen."
      />
      <DialogBody>
        <fieldset className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <legend className="text-13 font-medium text-ink">Columns</legend>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setColumns(new Set(FULFILMENT_EXPORT_COLUMNS))}
              >
                Select all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setColumns(new Set(FULFILMENT_DEFAULT_EXPORT_COLUMNS))
                }
              >
                Reset
              </Button>
            </div>
          </div>
          <ul className="glass-inset grid gap-x-4 rounded-lg px-3.5 py-2 sm:grid-cols-2">
            {FULFILMENT_EXPORT_COLUMNS.map((key) => (
              <li key={key} className="flex items-center gap-2.5 py-1.5">
                <Checkbox
                  id={`${id}-${key}`}
                  checked={columns.has(key)}
                  onCheckedChange={(checked) => tick(key, checked === true)}
                />
                <label
                  htmlFor={`${id}-${key}`}
                  className="cursor-pointer text-sm text-ink"
                >
                  {EXPORT_COLUMN_LABEL[key]}
                </label>
              </li>
            ))}
          </ul>
          {chosen.length === 0 ? (
            <p role="alert" className="text-13 text-danger-fg">
              Tick at least one column.
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <p className="text-13 font-medium text-ink">Brands</p>
          <div className="flex flex-wrap items-center gap-2.5">
            <BrandFilter
              brands={brandList.data?.items}
              selected={brands}
              onChange={setBrands}
              loading={brandList.isFetching}
            />
            <span className="text-13 text-ink-muted">
              {brands.length === 0
                ? "All brands"
                : `Only ${brands.length === 1 ? "this brand" : `these ${brands.length} brands`}`}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-13 font-medium text-ink">Dates</p>
          <PeriodPicker state={period} onChange={setPeriod} />
          <p className="text-13 text-ink-muted">
            {problem ? null : periodText(days)}
          </p>
        </div>

        {notes.length > 0 ? (
          <p className="text-13 text-ink-muted">
            Carried over from the page: {notes.join(" · ")}
          </p>
        ) : null}

        {nothing ? (
          <Alert tone="info" title="Nothing to export">
            No pack size has anything under these filters. No file is written.
          </Alert>
        ) : (
          <p
            aria-live="polite"
            className="text-sm font-medium text-ink tabular"
          >
            {problem
              ? "Correct the dates to see how many rows there are."
              : rows === undefined
                ? counted.error
                  ? "The number of rows could not be loaded."
                  : "Counting the rows…"
                : rowsText(rows)}
          </p>
        )}

        {error ? (
          <Alert tone="danger" title="The file could not be exported">
            {describeError(error).message}
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost" size="lg" disabled={pending}>
            Not now
          </Button>
        </DialogClose>
        <Button
          variant="primary"
          size="lg"
          icon={<Download />}
          loading={pending}
          disabled={chosen.length === 0 || Boolean(problem) || rows === 0}
          onClick={() => void run()}
        >
          Export CSV
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * "Export CSV": the columns, the brands and the dates of a file, preset
 * with what the page shows. The rows come from `GET …/export`, which
 * answers every row under the filters; the panel writes them down.
 */
export function ExportDialog({
  start,
  onClose,
}: {
  /** `null` closes the dialog. */
  start: ExportStart | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={start !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent size="lg">
        {start ? <Content start={start} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}
