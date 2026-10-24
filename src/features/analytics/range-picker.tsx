"use client";

import { useId } from "react";
import { Input, Select } from "@/components/ui/input";
import {
  ANALYTICS_GRANULARITIES,
  ANALYTICS_PRESETS,
  type AnalyticsGranularity,
  type AnalyticsPreset,
} from "@/lib/api/types";
import { Segmented } from "@/features/legal/segmented";
import { GRANULARITY_LABEL, PRESET_LABEL, type RangeState } from "./range";

/**
 * The period of the figures: a preset, or two calendar days; the buckets
 * of the charts for ranges longer than a month. Lives in the page header.
 */
export function RangePicker({
  state,
  onChange,
  /** The length of the resolved range, when known: the granularity toggle appears above a month. */
  days,
}: {
  state: RangeState;
  onChange: (changes: Partial<RangeState>) => void;
  days: number | null;
}) {
  const id = useId();
  const custom = state.range === "custom";
  const long = (days ?? 0) > 31;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${id}-range`} className="sr-only">
        Period
      </label>
      <Select
        id={`${id}-range`}
        value={state.range}
        onChange={(event) =>
          onChange({ range: event.target.value as AnalyticsPreset })
        }
        className="h-8 w-40 text-13"
      >
        {ANALYTICS_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {PRESET_LABEL[preset]}
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
            onChange={(event) => onChange({ from: event.target.value })}
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
            onChange={(event) => onChange({ to: event.target.value })}
            className="h-8 w-38 text-13 tabular"
          />
        </>
      ) : null}
      {long ? (
        <Segmented<AnalyticsGranularity | "auto">
          label="Buckets of the charts"
          value={state.granularity ?? "auto"}
          options={[
            { value: "auto", label: "Auto" },
            ...ANALYTICS_GRANULARITIES.map((granularity) => ({
              value: granularity,
              label: GRANULARITY_LABEL[granularity],
            })),
          ]}
          onChange={(value) =>
            onChange({ granularity: value === "auto" ? undefined : value })
          }
        />
      ) : null}
    </div>
  );
}
