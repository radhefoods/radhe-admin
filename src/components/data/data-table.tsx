"use client";

import {
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
  type Updater,
} from "@tanstack/react-table";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Alert, Skeleton } from "@/components/ui/surface";
import { describeError } from "@/lib/api/error-text";
import { isSessionError } from "@/lib/api/errors";
import { cn } from "@/lib/cn";

export interface ColumnMeta {
  /** Numbers and money sit right, so their digits line up. */
  align?: "left" | "right" | "center";
  /** The column appears from this width on. */
  from?: "sm" | "md" | "lg" | "xl";
  /** Classes for the cells of the column. */
  className?: string;
  /** What the skeleton of a loading cell is wide. */
  skeleton?: string;
}

/** One set of features for every table of the panel. */
export const features = tableFeatures({
  rowSelectionFeature,
  columnMeta: {} as ColumnMeta,
});

// Cell values are of many types: the value type of a column is open.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Column<T extends RowData> = ColumnDef<typeof features, T, any>;

const FROM: Record<NonNullable<ColumnMeta["from"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

const ALIGN: Record<NonNullable<ColumnMeta["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export interface TableSelection<T extends RowData> {
  /** The ids of the selected rows. */
  selected: ReadonlySet<string>;
  onChange: (selected: Set<string>) => void;
  /** Rows that cannot be selected (their status does not allow the action). */
  canSelect?: (row: T) => boolean;
  /** What the checkbox of a row is called: "Include RF-1084". */
  label: (row: T) => string;
  /**
   * Every row is ticked to begin with and unticking leaves one out: then a
   * ticked row looks normal and an unticked one steps back.
   */
  inverse?: boolean;
}

export interface DataTableProps<T extends RowData> {
  /** What the table lists, for screen readers. */
  caption: string;
  columns: Column<T>[];
  /** `undefined` while the first page loads. */
  data: T[] | undefined;
  getRowId: (row: T) => string;
  /** A request for other rows is on its way: the rows shown are dimmed. */
  refreshing?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown instead of the table when there are no rows. */
  empty: ReactNode;
  /** Makes a row lead to its record. The first link in the row stays the real link. */
  rowHref?: (row: T) => Route;
  selection?: TableSelection<T>;
  /** On phones, a card per row instead of the table. */
  card?: (row: T) => ReactNode;
  /** Under the table: pagination or "load more". */
  footer?: ReactNode;
  className?: string;
}

function isInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "a, button, input, select, textarea, label, [role='checkbox'], [role='menuitem']",
    ) !== null
  );
}

/**
 * The table of every list: sticky header, numbers right, skeleton while
 * loading, an explanation when empty, the API's error when it failed.
 *
 * It shows the rows it is given and nothing else: paging, sorting and
 * filtering are the API's, wired by the list around it.
 */
export function DataTable<T extends RowData>({
  caption,
  columns,
  data,
  getRowId,
  refreshing = false,
  error,
  onRetry,
  empty,
  rowHref,
  selection,
  card,
  footer,
  className,
}: DataTableProps<T>) {
  const router = useRouter();
  const rows: T[] = data ?? (EMPTY as T[]);

  const rowSelection: RowSelectionState = {};
  if (selection) for (const id of selection.selected) rowSelection[id] = true;

  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId,
    state: { rowSelection },
    enableRowSelection: selection
      ? (row) => selection.canSelect?.(row.original) ?? true
      : false,
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      if (!selection) return;
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater;
      selection.onChange(new Set(Object.keys(next)));
    },
  });

  if (error && !isSessionError(error) && data === undefined) {
    const notice = describeError(error);
    return (
      <Alert
        tone="danger"
        title="This list could not be loaded"
        actions={onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
      >
        {notice.message}
        {notice.requestId ? (
          <span className="mt-1 block font-mono text-2xs">
            {notice.technical} · Request {notice.requestId}
          </span>
        ) : null}
      </Alert>
    );
  }

  const loading = data === undefined;
  const headerGroups = table.getHeaderGroups();
  const tableRows = table.getRowModel().rows;
  const selectable = tableRows.filter((row) => row.getCanSelect());
  const allSelected =
    selectable.length > 0 && selectable.every((row) => row.getIsSelected());
  const someSelected = selectable.some((row) => row.getIsSelected());

  if (!loading && rows.length === 0) {
    return (
      <div className={cn("rounded-lg border border-line", className)}>
        {empty}
      </div>
    );
  }

  function open(event: MouseEvent, row: T) {
    if (!rowHref || isInteractive(event.target)) return;
    // Text that was just selected is not a click on the row.
    if (window.getSelection()?.toString()) return;
    const href = rowHref(row);
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {card ? (
        <ul
          aria-label={caption}
          aria-busy={loading || refreshing}
          className={cn(
            "flex flex-col gap-2 sm:hidden",
            refreshing && "opacity-60 transition-opacity",
          )}
        >
          {loading
            ? Array.from({ length: 5 }, (_, index) => (
                <li key={index} className="rounded-lg border border-line p-3.5">
                  <Skeleton className="mb-2 w-24" />
                  <Skeleton className="w-40" />
                </li>
              ))
            : rows.map((row) => <li key={getRowId(row)}>{card(row)}</li>)}
        </ul>
      ) : null}

      <div
        className={cn(
          "relative overflow-x-auto rounded-lg border border-line lg:overflow-visible",
          card && "hidden sm:block",
        )}
      >
        <table
          aria-busy={loading || refreshing}
          className="w-full border-separate border-spacing-0 text-sm"
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            {headerGroups.map((group) => (
              <tr key={group.id}>
                {selection ? (
                  <th
                    scope="col"
                    className="z-10 w-10 border-b border-line bg-sunken py-2 pr-1 pl-3.5 first:rounded-tl-lg lg:sticky lg:top-14"
                  >
                    <Checkbox
                      aria-label="Select all rows"
                      checked={
                        allSelected
                          ? true
                          : someSelected
                            ? "indeterminate"
                            : false
                      }
                      disabled={selectable.length === 0}
                      onCheckedChange={(checked) =>
                        table.toggleAllRowsSelected(checked === true)
                      }
                    />
                  </th>
                ) : null}
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={cn(
                        // Below `lg` the frame scrolls sideways and would be what
                        // the header sticks to, 3.5rem down over the first row.
                        "z-10 border-b border-line bg-sunken px-3.5 py-2 text-xs font-semibold whitespace-nowrap text-ink-muted first:rounded-tl-lg last:rounded-tr-lg lg:sticky lg:top-14",
                        ALIGN[meta?.align ?? "left"],
                        meta?.from && FROM[meta.from],
                      )}
                    >
                      {header.isPlaceholder ? null : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className={cn(refreshing && "opacity-60 transition-opacity")}>
            {loading
              ? Array.from({ length: 8 }, (_, index) => (
                  <tr key={index}>
                    {selection ? (
                      <td className="border-b border-line py-3 pr-1 pl-3.5">
                        <Skeleton className="size-4" />
                      </td>
                    ) : null}
                    {columns.map((column, cell) => (
                      <td
                        key={cell}
                        className={cn(
                          "border-b border-line px-3.5 py-3",
                          column.meta?.from && FROM[column.meta.from],
                        )}
                      >
                        <Skeleton
                          className={cn(
                            column.meta?.skeleton ?? "w-24",
                            column.meta?.align === "right" && "ml-auto",
                          )}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : tableRows.map((row) => {
                  const selected = row.getIsSelected();
                  return (
                    <tr
                      key={row.id}
                      onClick={(event) => open(event, row.original)}
                      data-selected={selected || undefined}
                      className={cn(
                        "group/row transition-colors [&:last-child>td]:border-b-0",
                        rowHref && "cursor-pointer hover:bg-sunken/70",
                        selected &&
                          !selection?.inverse &&
                          "bg-accent-soft/60 hover:bg-accent-soft",
                        selection?.inverse &&
                          !selected &&
                          row.getCanSelect() &&
                          "text-ink-subtle [&_td:first-child>*]:opacity-100 [&_td>*]:opacity-55",
                      )}
                    >
                      {selection ? (
                        <td className="border-b border-line py-2.5 pr-1 pl-3.5 align-middle">
                          <Checkbox
                            aria-label={selection.label(row.original)}
                            checked={selected}
                            disabled={!row.getCanSelect()}
                            onCheckedChange={(checked) =>
                              row.toggleSelected(checked === true)
                            }
                          />
                        </td>
                      ) : null}
                      {row.getAllCells().map((cell) => {
                        const meta = cell.column.columnDef.meta;
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "border-b border-line px-3.5 py-2.5 align-middle",
                              ALIGN[meta?.align ?? "left"],
                              meta?.align === "right" && "tabular",
                              meta?.from && FROM[meta.from],
                              meta?.className,
                            )}
                          >
                            <table.FlexRender cell={cell} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}

const EMPTY: never[] = [];
