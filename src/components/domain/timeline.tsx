import type { ReactNode } from "react";
import { toneClass } from "@/components/ui/badge";
import type { IsoDateTime } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/status";
import { DateTime } from "./values";

export interface TimelineEntry {
  key: string;
  at: IsoDateTime;
  /** What happened: "Dispatched". */
  title: ReactNode;
  /** Who did it, or what caused it. */
  by?: ReactNode;
  note?: ReactNode;
  tone?: Tone;
}

/** The history of a record, newest first. */
export function Timeline({
  entries,
  className,
}: {
  entries: TimelineEntry[];
  className?: string;
}) {
  if (entries.length === 0) {
    return <p className="text-13 text-ink-muted">Nothing has happened yet.</p>;
  }
  return (
    <ol className={cn("flex flex-col", className)}>
      {entries.map((entry, index) => (
        <li key={entry.key} className="relative flex gap-3 pb-4 last:pb-0">
          {index < entries.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-4 bottom-0 left-[4.5px] w-px bg-line"
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              "relative mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-surface",
              toneClass[entry.tone ?? "neutral"].dot,
            )}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium text-ink">{entry.title}</p>
            <p className="text-13 text-ink-muted">
              <DateTime value={entry.at} />
              {entry.by ? <> · {entry.by}</> : null}
            </p>
            {entry.note ? (
              <p className="text-13 text-ink-muted">“{entry.note}”</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
