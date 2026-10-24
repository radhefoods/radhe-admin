"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

// The charts of the panel, drawn as SVG with the theme's own tokens: the
// accent for the current period, the subtle ink for the previous one, the
// danger dot for refunds. No chart library: the panel had none, and these
// few shapes are all the dashboard needs. Every chart carries its numbers
// as a table for screen readers.

/** The colour of a series, by what it means. */
export type SeriesVariant = "primary" | "previous" | "danger" | "secondary";

const STROKE: Record<SeriesVariant, string> = {
  primary: "var(--accent)",
  previous: "var(--ink-subtle)",
  danger: "var(--danger-dot)",
  secondary: "var(--success-dot)",
};

/** The colours of the slices of a donut and the bars of a share list. */
export const CATEGORICAL = [
  "var(--accent)",
  "var(--success-dot)",
  "var(--attention-dot)",
  "var(--moving-dot)",
  "var(--planned-dot)",
  "var(--danger-dot)",
  "var(--neutral-dot)",
] as const;

export interface Series {
  key: string;
  label: string;
  values: number[];
  variant: SeriesVariant;
  /** The names of the points of this series, when they differ from the chart's (the previous period). */
  pointLabels?: string[];
}

/** The width of an element, followed as it changes; a guess before the first layout. */
function useWidth(
  fallback = 600,
): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => {
      const measured = node.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Four steps from zero to a round number above the largest value. */
function ticksFor(max: number, steps = 4): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4].map((step) => step * 0.25);
  const rough = max / steps;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const unit =
    [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= rough) ??
    10;
  const step = unit * magnitude;
  return Array.from({ length: steps + 1 }, (_, index) => index * step);
}

const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

function Tooltip({
  left,
  title,
  rows,
}: {
  left: number;
  title: string;
  rows: { label: string; value: string; colour: string }[];
}) {
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border border-line bg-surface px-2.5 py-2 text-13 shadow-pop"
      style={{
        left: `${left}%`,
        transform:
          left > 60 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
      }}
    >
      <p className="font-semibold text-ink">{title}</p>
      <dl className="mt-1 flex flex-col gap-0.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3"
          >
            <dt className="flex items-center gap-1.5 text-ink-muted">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: row.colour }}
              />
              {row.label}
            </dt>
            <dd className="font-medium text-ink tabular">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The numbers of a chart, for whoever cannot see it. */
function DataTable({
  caption,
  labels,
  series,
  format,
}: {
  caption: string;
  labels: string[];
  series: Series[];
  format: (value: number) => string;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          {series.map((entry) => (
            <th key={entry.key} scope="col">
              {entry.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((label, index) => (
          <tr key={`${label}-${index}`}>
            <th scope="row">{label}</th>
            {series.map((entry) => (
              <td key={entry.key}>{format(entry.values[index] ?? 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface PlotProps {
  /** What the chart shows, for screen readers: "Revenue per day". */
  caption: string;
  /** The name of every point: the day, the week, the month. */
  labels: string[];
  series: Series[];
  /** How a value is printed in the tooltip and the table. */
  format: (value: number) => string;
  /** How a value is printed on the axis; `format` when absent. */
  formatTick?: (value: number) => string;
  height?: number;
  className?: string;
}

function usePlot(labels: string[], series: Series[], height: number) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const count = Math.max(labels.length, 1);
  const max = Math.max(0, ...series.flatMap((entry) => entry.values));
  const ticks = ticksFor(max);
  const top = ticks[ticks.length - 1] ?? 1;
  const innerWidth = Math.max(1, width - PAD.left - PAD.right);
  const innerHeight = Math.max(1, height - PAD.top - PAD.bottom);
  const x = (index: number) =>
    PAD.left +
    (count === 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth);
  const y = (value: number) =>
    PAD.top + innerHeight - (value / top) * innerHeight;

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left - PAD.left;
    const index = Math.round((px / innerWidth) * (count - 1));
    setHover(Math.min(count - 1, Math.max(0, index)));
  }

  return {
    ref,
    width,
    hover,
    setHover,
    onPointerMove,
    count,
    ticks,
    top,
    innerWidth,
    innerHeight,
    x,
    y,
  };
}

/** Which labels fit along the axis: every n-th one. */
function axisLabels(labels: string[], width: number): number[] {
  const room = Math.max(1, Math.floor(width / 72));
  const every = Math.max(1, Math.ceil(labels.length / room));
  return labels.map((_, index) => index).filter((index) => index % every === 0);
}

function Axes({
  ticks,
  labels,
  x,
  y,
  width,
  innerWidth,
  formatTick,
}: {
  ticks: number[];
  labels: string[];
  x: (index: number) => number;
  y: (value: number) => number;
  width: number;
  innerWidth: number;
  formatTick: (value: number) => string;
}) {
  return (
    <>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--line)"
            strokeDasharray={tick === 0 ? undefined : "2 4"}
          />
          <text
            x={PAD.left - 8}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-ink-subtle text-[11px] tabular"
          >
            {formatTick(tick)}
          </text>
        </g>
      ))}
      {axisLabels(labels, innerWidth).map((index) => (
        <text
          key={index}
          x={x(index)}
          y={PAD.top + (y(0) - PAD.top) + 18}
          textAnchor={
            labels.length === 1
              ? "middle"
              : index === 0
                ? "start"
                : index === labels.length - 1
                  ? "end"
                  : "middle"
          }
          className="fill-ink-subtle text-[11px]"
        >
          {labels[index]}
        </text>
      ))}
    </>
  );
}

function tooltipRows(
  series: Series[],
  index: number,
  format: (value: number) => string,
) {
  return series.map((entry) => ({
    label: entry.pointLabels?.[index]
      ? `${entry.label} (${entry.pointLabels[index]})`
      : entry.label,
    value: format(entry.values[index] ?? 0),
    colour: STROKE[entry.variant],
  }));
}

/**
 * Lines over time: the current period as a line with a soft area under it,
 * the previous period as a dashed line, a second figure as another line.
 */
export function LineChart({
  caption,
  labels,
  series,
  format,
  formatTick = format,
  height = 240,
  className,
}: PlotProps) {
  const id = useId();
  const plot = usePlot(labels, series, height);
  const { ref, width, hover, setHover, count, x, y } = plot;

  const path = (values: number[]) =>
    values
      .slice(0, count)
      .map(
        (value, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(value)}`,
      )
      .join(" ");
  const area = (values: number[]) =>
    `${path(values)} L${x(Math.min(values.length, count) - 1)},${y(0)} L${x(0)},${y(0)} Z`;

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <svg
        role="img"
        aria-label={caption}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={plot.onPointerMove}
        onPointerLeave={() => setHover(null)}
        className="block touch-none select-none"
      >
        <Axes
          ticks={plot.ticks}
          labels={labels}
          x={x}
          y={y}
          width={width}
          innerWidth={plot.innerWidth}
          formatTick={formatTick}
        />
        {series.map((entry) =>
          entry.variant === "primary" ? (
            <path
              key={`${entry.key}-area`}
              d={area(entry.values)}
              fill={`url(#${id}-fill)`}
            />
          ) : null,
        )}
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {series.map((entry) => (
          <path
            key={entry.key}
            d={path(entry.values)}
            fill="none"
            stroke={STROKE[entry.variant]}
            strokeWidth={entry.variant === "primary" ? 2 : 1.5}
            strokeDasharray={entry.variant === "previous" ? "4 4" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hover !== null ? (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={y(0)}
              stroke="var(--line-strong)"
            />
            {series.map((entry) =>
              entry.values[hover] === undefined ? null : (
                <circle
                  key={entry.key}
                  cx={x(hover)}
                  cy={y(entry.values[hover] ?? 0)}
                  r={3.5}
                  fill="var(--surface)"
                  stroke={STROKE[entry.variant]}
                  strokeWidth={2}
                />
              ),
            )}
          </g>
        ) : null}
      </svg>
      {hover !== null && labels[hover] !== undefined ? (
        <Tooltip
          left={(x(hover) / width) * 100}
          title={labels[hover]}
          rows={tooltipRows(series, hover, format)}
        />
      ) : null}
      <DataTable
        caption={caption}
        labels={labels}
        series={series}
        format={format}
      />
    </div>
  );
}

/** Bars over time, one series. */
export function BarChart({
  caption,
  labels,
  series,
  format,
  formatTick = format,
  height = 160,
  className,
}: PlotProps) {
  const plot = usePlot(labels, series, height);
  const { ref, width, hover, setHover, count, x, y } = plot;
  const slot = plot.innerWidth / count;
  const bar = Math.max(2, Math.min(28, slot * 0.6));
  const first = series[0];

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <svg
        role="img"
        aria-label={caption}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={plot.onPointerMove}
        onPointerLeave={() => setHover(null)}
        className="block touch-none select-none"
      >
        <Axes
          ticks={plot.ticks}
          labels={labels}
          x={x}
          y={y}
          width={width}
          innerWidth={plot.innerWidth}
          formatTick={formatTick}
        />
        {first
          ? first.values
              .slice(0, count)
              .map((value, index) => (
                <rect
                  key={index}
                  x={x(index) - bar / 2}
                  y={y(value)}
                  width={bar}
                  height={Math.max(0, y(0) - y(value))}
                  rx={2}
                  fill={STROKE[first.variant]}
                  opacity={hover === null || hover === index ? 1 : 0.55}
                />
              ))
          : null}
      </svg>
      {hover !== null && labels[hover] !== undefined ? (
        <Tooltip
          left={(x(hover) / width) * 100}
          title={labels[hover]}
          rows={tooltipRows(series, hover, format)}
        />
      ) : null}
      <DataTable
        caption={caption}
        labels={labels}
        series={series}
        format={format}
      />
    </div>
  );
}

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** What stands next to the label: the share, the amount. */
  detail?: string;
}

/** A ring with a legend: shares of one whole. */
export function Donut({
  caption,
  slices,
  format,
  centre,
  className,
}: {
  caption: string;
  slices: Slice[];
  format: (value: number) => string;
  /** The words in the middle: the total. */
  centre?: { value: string; label: string };
  className?: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-6 gap-y-3", className)}
    >
      <svg
        role="img"
        aria-label={caption}
        viewBox="0 0 120 120"
        className="size-36 shrink-0 -rotate-90"
      >
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--sunken)"
          strokeWidth="14"
        />
        {total > 0
          ? slices.map((slice, index) => {
              const length = (slice.value / total) * circumference;
              const element = (
                <circle
                  key={slice.key}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke={CATEGORICAL[index % CATEGORICAL.length]}
                  strokeWidth="14"
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += length;
              return element;
            })
          : null}
        {centre ? (
          <g transform="rotate(90 60 60)">
            <text
              x="60"
              y="57"
              textAnchor="middle"
              className="fill-ink text-[15px] font-semibold tabular"
            >
              {centre.value}
            </text>
            <text
              x="60"
              y="72"
              textAnchor="middle"
              className="fill-ink-subtle text-[9px]"
            >
              {centre.label}
            </text>
          </g>
        ) : null}
      </svg>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-13">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: CATEGORICAL[index % CATEGORICAL.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-ink">
              {slice.label}
            </span>
            <span className="text-ink-muted tabular">
              {slice.detail ?? format(slice.value)}
            </span>
          </li>
        ))}
        {slices.length === 0 ? (
          <li className="text-ink-subtle">Nothing in this period.</li>
        ) : null}
      </ul>
    </div>
  );
}

/** Horizontal bars by share, the largest first, with a value next to each. */
export function ShareBars({
  caption,
  rows,
  className,
}: {
  caption: string;
  rows: { key: string; label: ReactNode; share: number; value: string }[];
  className?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.share));
  return (
    <ul aria-label={caption} className={cn("flex flex-col gap-2.5", className)}>
      {rows.map((row, index) => (
        <li key={row.key} className="flex flex-col gap-1 text-13">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ink">{row.label}</span>
            <span className="shrink-0 text-ink-muted tabular">
              {row.value} · {row.share.toLocaleString("en")} %
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(row.share / max) * 100}%`,
                background: CATEGORICAL[index % CATEGORICAL.length],
              }}
            />
          </div>
        </li>
      ))}
      {rows.length === 0 ? (
        <li className="text-13 text-ink-subtle">Nothing in this period.</li>
      ) : null}
    </ul>
  );
}

/** A funnel of counts: each step as a bar against the first. */
export function Funnel({
  caption,
  steps,
  className,
}: {
  caption: string;
  steps: { key: string; label: string; value: number; tone?: SeriesVariant }[];
  className?: string;
}) {
  const first = steps[0]?.value ?? 0;
  return (
    <ol aria-label={caption} className={cn("flex flex-col gap-2", className)}>
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-3 text-13">
          <span className="w-24 shrink-0 text-ink-muted">{step.label}</span>
          <span className="h-5 min-w-0 flex-1 overflow-hidden rounded-sm bg-sunken">
            <span
              className="block h-full rounded-sm"
              style={{
                width: `${first === 0 ? 0 : Math.max(step.value > 0 ? 1 : 0, (step.value / first) * 100)}%`,
                background: STROKE[step.tone ?? "primary"],
              }}
            />
          </span>
          <span className="w-10 shrink-0 text-right font-medium text-ink tabular">
            {step.value.toLocaleString("en")}
          </span>
        </li>
      ))}
    </ol>
  );
}
