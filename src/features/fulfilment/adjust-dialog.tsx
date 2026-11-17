"use client";

import { Minus, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Pagination } from "@/components/data/pagination";
import { ActionButton } from "@/components/domain/permission";
import { Field } from "@/components/form/form";
import { ReasonField } from "@/components/form/reason-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, FactRows, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { isCalendarDay } from "@/features/analytics/range";
import { describeError } from "@/lib/api/error-text";
import { isSessionError } from "@/lib/api/errors";
import {
  FULFILMENT_ADJUSTMENT_RULES,
  type FulfilmentAdjustment,
} from "@/lib/api/types";
import { berlinDay } from "@/lib/format/dates";
import { AdjustmentList } from "./adjustment-list";
import {
  FIGURE_LABEL,
  adjustmentProblem,
  changeText,
  count,
  figuresText,
  liveLine,
  packTitle,
  parseUnits,
  type AdjustmentPreset,
  type PackSizeRef,
} from "./fulfilment";
import {
  useAdjustFulfilment,
  useFulfilmentAdjustments,
  useFulfilmentFigures,
} from "./queries";

const RULES = FULFILMENT_ADJUSTMENT_RULES;

/** What the dialog is opened for: a pack size, and maybe numbers to start with ("Take back"). */
export interface AdjustTarget {
  pack: PackSizeRef;
  preset?: AdjustmentPreset;
}

/** A whole number that may be negative, with a button to each side. */
function UnitsField({
  label,
  noun,
  value,
  onChange,
}: {
  label: string;
  /** "dispatched" or "returned", for the names of the two buttons. */
  noun: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const parsed = parseUnits(value);
  const invalid = parsed === null;
  const step = (by: number) => onChange(String((parsed ?? 0) + by));
  return (
    <Field
      label={label}
      htmlFor={id}
      error={invalid ? "A whole number, such as 2 or -1." : null}
    >
      <div className="flex items-center gap-1.5">
        <Button
          size="icon"
          aria-label={`Remove one ${noun} unit`}
          onClick={() => step(-1)}
        >
          <Minus />
        </Button>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          placeholder="0"
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid ? true : undefined}
          className="w-full min-w-0 text-center tabular"
        />
        <Button
          size="icon"
          aria-label={`Add one ${noun} unit`}
          onClick={() => step(1)}
        >
          <Plus />
        </Button>
      </div>
    </Field>
  );
}

function Content({
  target,
  onClose,
  onTakeBack,
}: {
  target: AdjustTarget;
  onClose: () => void;
  onTakeBack: (adjustment: FulfilmentAdjustment) => void;
}) {
  const { pack, preset } = target;
  const today = berlinDay();
  const dateId = useId();
  const lineId = useId();
  const [dispatched, setDispatched] = useState(
    preset && preset.dispatched !== 0 ? String(preset.dispatched) : "",
  );
  const [returned, setReturned] = useState(
    preset && preset.returned !== 0 ? String(preset.returned) : "",
  );
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState(preset?.reason ?? "");
  const [error, setError] = useState<unknown>(null);
  const [page, setPage] = useState(1);

  const figures = useFulfilmentFigures(pack.variantId);
  const history = useFulfilmentAdjustments({ variantId: pack.variantId, page });
  const adjust = useAdjustFulfilment();

  const change = {
    dispatched: parseUnits(dispatched),
    returned: parseUnits(returned),
  };
  const whole = change.dispatched !== null && change.returned !== null;
  const units = {
    dispatched: change.dispatched ?? 0,
    returned: change.returned ?? 0,
  };
  const touched = units.dispatched !== 0 || units.returned !== 0;
  const problem =
    figures.data && whole ? adjustmentProblem(figures.data, units) : null;
  const dateProblem = !isCalendarDay(date)
    ? "Choose the day the adjustment counts for."
    : date > today
      ? "Not in the future: today or an earlier day."
      : null;
  const text = reason.trim();
  const reasonProblem =
    text !== "" && text.length < RULES.reasonMin
      ? `At least ${RULES.reasonMin} characters.`
      : null;
  const ready =
    Boolean(figures.data) &&
    whole &&
    problem === null &&
    dateProblem === null &&
    text.length >= RULES.reasonMin;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || adjust.isPending) return;
    setError(null);
    try {
      const result = await adjust.mutateAsync({
        variantId: pack.variantId,
        ...(units.dispatched !== 0 ? { dispatched: units.dispatched } : {}),
        ...(units.returned !== 0 ? { returned: units.returned } : {}),
        reason: text,
        date,
      });
      notify.success(
        "Adjustment saved",
        `${packTitle(pack)}: ${changeText(result.adjustment)}. ${figuresText(result.totals)}.`,
      );
      onClose();
    } catch (caught) {
      if (isSessionError(caught)) return;
      setError(caught);
      // The figures may have moved since the dialog opened: read them again.
      void figures.refetch();
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <DialogHeader
        title={`Adjust ${packTitle(pack)}`}
        description={
          <>
            SKU {pack.sku}
            {pack.brand ? ` · ${pack.brand}` : ""}. For what the orders cannot
            know: units handed over outside the shop, or a count that was wrong.
          </>
        }
      />
      <DialogBody>
        {figures.data ? (
          <FactRows
            rows={[
              {
                label: `${FIGURE_LABEL.dispatched}, all dates`,
                value: count(figures.data.dispatched),
              },
              {
                label: `${FIGURE_LABEL.returned}, all dates`,
                value: count(figures.data.returned),
              },
              {
                label: `${FIGURE_LABEL.net}, all dates`,
                value: count(figures.data.net),
                strong: true,
              },
            ]}
          />
        ) : figures.error && !isSessionError(figures.error) ? (
          <Alert
            tone="danger"
            title="The figures could not be loaded"
            actions={
              <Button onClick={() => void figures.refetch()}>Try again</Button>
            }
          >
            {describeError(figures.error).message}
          </Alert>
        ) : (
          <Skeleton className="h-28 rounded-lg" />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <UnitsField
            label={`${FIGURE_LABEL.dispatched}: add or remove units`}
            noun="dispatched"
            value={dispatched}
            onChange={setDispatched}
          />
          <UnitsField
            label={`${FIGURE_LABEL.returned}: add or remove units`}
            noun="returned"
            value={returned}
            onChange={setReturned}
          />
        </div>

        <div className="flex flex-col gap-1" id={lineId}>
          {figures.data && whole ? (
            <p
              aria-live="polite"
              className="text-sm font-medium text-ink tabular"
            >
              {liveLine(figures.data, units)}
            </p>
          ) : null}
          {problem && touched ? (
            <p role="alert" className="text-13 text-danger-fg">
              {problem}
            </p>
          ) : null}
          <p className="text-13 text-ink-muted">
            {FIGURE_LABEL.net} is always {FIGURE_LABEL.dispatched} minus{" "}
            {FIGURE_LABEL.returned}. To lower it without changing{" "}
            {FIGURE_LABEL.dispatched}, add returned units.
          </p>
          <p className="text-13 text-ink-muted">
            This changes the report only. Orders, returns and stock stay as they
            are.
          </p>
        </div>

        <Field
          label="Counts for"
          htmlFor={dateId}
          required
          error={dateProblem}
          hint="The day the units count for in the report: today or earlier."
          className="sm:max-w-56"
        >
          <Input
            id={dateId}
            type="date"
            value={date}
            max={today}
            required
            onChange={(event) => setDate(event.target.value)}
            aria-invalid={dateProblem ? true : undefined}
            className="tabular"
          />
        </Field>

        <ReasonField
          label="Reason"
          value={reason}
          onChange={setReason}
          maxLength={RULES.reasonMax}
          required
          error={reasonProblem}
          hint="Kept with the adjustment for good, with your name."
          placeholder="Two bags sold at the market stall, one came back"
        />

        {/* Once the figures are read again, the line above says the same. */}
        {error && !problem ? (
          <Alert tone="danger" title={describeError(error).message} />
        ) : null}

        <section
          aria-label="Adjustments of this pack size"
          className="flex flex-col gap-2"
        >
          <h3 className="text-sm font-semibold text-ink">
            Adjustments of this pack size
          </h3>
          {history.data ? (
            history.data.total === 0 ? (
              <p className="text-13 text-ink-muted">
                Nothing was adjusted by hand yet.
              </p>
            ) : (
              <>
                <AdjustmentList
                  items={history.data.items}
                  label={`Adjustments of ${packTitle(pack)}`}
                  onTakeBack={onTakeBack}
                />
                <Pagination
                  {...history.data}
                  noun="adjustment"
                  onPage={setPage}
                />
              </>
            )
          ) : history.error && !isSessionError(history.error) ? (
            <Alert
              tone="danger"
              title="The history could not be loaded"
              actions={
                <Button onClick={() => void history.refetch()}>
                  Try again
                </Button>
              }
            >
              {describeError(history.error).message}
            </Alert>
          ) : (
            <Skeleton className="h-16 rounded-lg" />
          )}
        </section>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost" size="lg" disabled={adjust.isPending}>
            Not now
          </Button>
        </DialogClose>
        <ActionButton
          permission="orders.manage"
          type="submit"
          variant="primary"
          size="lg"
          loading={adjust.isPending}
          disabled={!ready}
          aria-describedby={lineId}
        >
          Save the adjustment
        </ActionButton>
      </DialogFooter>
    </form>
  );
}

/**
 * "Adjust": units added to, or taken from, the dispatched or the returned
 * figure of one pack size, with a date and a reason
 * (`POST …/adjustments`). The figures over all dates are shown and checked
 * against, because that is what the API refuses by. Below the form: the
 * history of the pack size.
 */
export function AdjustDialog({
  target,
  onClose,
  onTakeBack,
}: {
  /** `null` closes the dialog. */
  target: AdjustTarget | null;
  onClose: () => void;
  /** "Take back" on an entry of the history: the form again, with the opposite numbers. */
  onTakeBack: (adjustment: FulfilmentAdjustment) => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent size="lg">
        {target ? (
          <Content
            key={`${target.pack.variantId}:${target.preset?.reason ?? ""}`}
            target={target}
            onClose={onClose}
            onTakeBack={onTakeBack}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
