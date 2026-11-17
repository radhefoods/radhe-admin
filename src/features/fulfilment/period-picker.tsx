"use client";

import { useId } from "react";
import { Input, Select } from "@/components/ui/input";
import {
  PERIOD_LABEL,
  PERIOD_PRESETS,
  customFrom,
  periodProblem,
  type PeriodPreset,
  type PeriodState,
} from "./fulfilment";

/**
 * The period of the report: a preset, all dates, or two calendar days of
 * German time, either of which may stay empty (an open side). The same
 * controls as the period of the analytics tab; the days are worked out
 * here, because the tracker takes two days and nothing else.
 */
export function PeriodPicker({
  state,
  onChange,
}: {
  state: PeriodState;
  onChange: (next: PeriodState) => void;
}) {
  const id = useId();
  const custom = state.range === "custom";
  const problem = periodProblem(state);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${id}-range`} className="sr-only">
        Period
      </label>
      <Select
        id={`${id}-range`}
        value={state.range}
        onChange={(event) => {
          const range = event.target.value as PeriodPreset;
          onChange(
            range === "custom"
              ? customFrom(state)
              : { range, from: "", to: "" },
          );
        }}
        className="h-8 w-36 text-13"
      >
        {PERIOD_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {PERIOD_LABEL[preset]}
          </option>
        ))}
      </Select>
      {custom ? (
        <>
          <label htmlFor={`${id}-from`} className="sr-only">
            First day
          </label>
          <Input
            id={`${id}-from`}
            type="date"
            value={state.from}
            max={state.to || undefined}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            onChange={(event) =>
              onChange({ ...state, from: event.target.value })
            }
            className="h-8 w-38 text-13 tabular"
          />
          <span aria-hidden="true" className="text-13 text-ink-subtle">
            to
          </span>
          <label htmlFor={`${id}-to`} className="sr-only">
            Last day
          </label>
          <Input
            id={`${id}-to`}
            type="date"
            value={state.to}
            min={state.from || undefined}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            onChange={(event) => onChange({ ...state, to: event.target.value })}
            className="h-8 w-38 text-13 tabular"
          />
        </>
      ) : null}
      {problem ? (
        <p id={`${id}-problem`} role="alert" className="text-13 text-danger-fg">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
