"use client";

import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  Upload,
  X,
} from "lucide-react";
import { Tabs } from "radix-ui";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { invalidation } from "@/lib/api/query-keys";
import {
  IMPORT_MAX_ROWS,
  type ImportAction,
  type ImportExisting,
  type ImportResult,
  type ImportRowResult,
  type ImportSheetResult,
  type ImportSheetType,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";
import type { Tone } from "@/lib/status";
import { readSheetFile, saveCsv, saveXlsx, type Sheet } from "./sheets";

// Import and export of one kind of record (documentation, 8.2), in a
// dialog opened where the records are listed. The panel reads the file and
// writes the export; the API checks the rows, previews, and writes.

interface SheetKind {
  label: string;
  one: string;
  template: string;
  key: string;
  included: string;
  rules: string[];
}

const KINDS: Record<ImportSheetType, SheetKind> = {
  products: {
    label: "Products",
    one: "product",
    template: "/templates/products-example.csv",
    key: "the SKU (sku); without one, the slug (slug_en); without that, the slug the name and pack size would get",
    included:
      "Every product, each pack size as a row, by SKU: texts in both languages, category, pack size, prices and VAT, status, stock count and low-stock threshold, food information, tags and SEO.",
    rules: [
      "A new product needs name_en, category_slug, pack_value, pack_unit, regular_price and vat_rate; everything else has a default.",
      "category_slug is the slug_en of an existing category. variant_of_sku joins a pack size to its main product; none separates it.",
      "Prices are euros with VAT, 4.99 or 4,99; vat_rate is the percent, 7 or 19. Lists use | between entries.",
      "An empty cell leaves a field as it is. To remove a value, write what the column says: sale_price 0 ends a sale, max_order_quantity 0 removes the limit, low_stock_threshold 0 removes the threshold.",
      "stock_quantity is the exact count: the opening stock of a new product, the new count of an existing one (recorded in its stock history as an import).",
      "The SKU of an existing product, its pictures, its orders and its price history are never changed by an import.",
    ],
  },
  categories: {
    label: "Categories",
    one: "category",
    template: "/templates/categories-example.csv",
    key: "the slug (slug_en); without one, the slug the name would get",
    included:
      "Every category in display order: names in both languages, parent, tagline, description, position, visibility and SEO.",
    rules: [
      "A new category needs name_en; everything else has a default.",
      "parent_slug is the slug_en of the parent, an existing category or another row of the file; none makes a main category. Three levels at most.",
      "sort_order is the position among the siblings; is_visible takes yes or no.",
      "An empty cell leaves a field as it is. The picture of a category is never part of a sheet.",
    ],
  },
};

const ACTION: Record<ImportAction, { label: string; tone: Tone }> = {
  create: { label: "Create", tone: "success" },
  update: { label: "Update", tone: "planned" },
  skip: { label: "Skip", tone: "neutral" },
  unchanged: { label: "Unchanged", tone: "neutral" },
  error: { label: "Problem", tone: "danger" },
};

/** "Create 12, update 3, skip 40, 1 problem". */
export function countsText(summary: ImportSheetResult["summary"]): string {
  const parts = [
    `create ${summary.create}`,
    `update ${summary.update}`,
    `skip ${summary.skip}`,
  ];
  if (summary.unchanged > 0) parts.push(`unchanged ${summary.unchanged}`);
  if (summary.error > 0) parts.push(plural(summary.error, "problem"));
  const text = parts.join(", ");
  return text[0]!.toUpperCase() + text.slice(1);
}

// --- The file ----------------------------------------------------------------

interface Chosen {
  file: File;
  sheet: Sheet;
}

/** Where the sheet is handed over: dropped, or chosen with the file dialog. */
function SheetDrop({
  chosen,
  problem,
  disabled,
  onFile,
  onRemove,
}: {
  chosen: Chosen | null;
  problem: string | null;
  disabled: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const id = useId();
  const tooMany = chosen !== null && chosen.sheet.rows.length > IMPORT_MAX_ROWS;

  function take(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  }

  if (chosen) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-3",
          tooMany || problem
            ? "border-danger-dot/40 bg-danger-bg/40"
            : "border-line bg-sunken/60",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-accent-text shadow-card"
        >
          <FileSpreadsheet className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {chosen.file.name}
          </p>
          <p
            className={cn(
              "text-13",
              tooMany ? "text-danger-fg" : "text-ink-muted",
            )}
          >
            {tooMany
              ? `${chosen.sheet.rows.length.toLocaleString("en")} rows: more than the ${IMPORT_MAX_ROWS.toLocaleString("en")} one import takes. Split the file.`
              : `${plural(chosen.sheet.rows.length, "row")}, ${plural(chosen.sheet.columns.length, "column")}`}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<X />}
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => setOver(false)}
      onDrop={take}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
        over ? "border-accent bg-accent-soft" : "border-line-strong",
        disabled && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-text"
      >
        <FileUp className="size-5" />
      </span>
      <p className="text-sm text-ink">
        Drop the file here, or{" "}
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="rounded-xs font-semibold text-accent-text underline-offset-2 hover:underline"
        >
          choose a file
        </button>
      </p>
      <p className="text-13 text-ink-muted">
        .csv or .xlsx with a header row, at most{" "}
        {IMPORT_MAX_ROWS.toLocaleString("en")} rows.
      </p>
      {problem ? (
        <p role="alert" className="text-13 text-danger-fg">
          {problem}
        </p>
      ) : null}
      <input
        ref={input}
        id={id}
        type="file"
        accept=".csv,.xlsx,text/csv"
        disabled={disabled}
        aria-label="Choose a .csv or .xlsx file"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

// --- The rows -----------------------------------------------------------------

const resultColumns: Column<ImportRowResult>[] = [
  {
    id: "row",
    header: "Row",
    cell: ({ row }) => <span className="tabular">{row.original.row}</span>,
    meta: { align: "right", className: "w-12", skeleton: "w-6" },
  },
  {
    id: "key",
    header: "Key",
    cell: ({ row }) => (
      <span className="font-mono text-13">{row.original.key || "—"}</span>
    ),
    meta: { className: "max-w-44 truncate", skeleton: "w-24" },
  },
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => row.original.name || "—",
    meta: { className: "max-w-48 truncate", skeleton: "w-32" },
  },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => (
      <Badge tone={ACTION[row.original.action].tone}>
        {ACTION[row.original.action].label}
      </Badge>
    ),
  },
  {
    id: "details",
    header: "Changes and problems",
    cell: ({ row }) =>
      row.original.problems.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-13 text-danger-fg">
          {row.original.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : row.original.changes.length > 0 ? (
        <span className="text-13 text-ink-muted">
          {row.original.changes.join(", ")}
        </span>
      ) : (
        <span className="text-ink-subtle">—</span>
      ),
    meta: { className: "max-w-md", skeleton: "w-40" },
  },
];

function Outcome({
  kind,
  sheet,
  applied,
}: {
  kind: SheetKind;
  sheet: ImportSheetResult;
  applied: boolean;
}) {
  const { summary } = sheet;
  const chips: { label: string; count: number; tone: Tone }[] = [
    {
      label: applied ? "Created" : "Create",
      count: summary.create,
      tone: "success",
    },
    {
      label: applied ? "Updated" : "Update",
      count: summary.update,
      tone: "planned",
    },
    {
      label: applied ? "Skipped" : "Skip",
      count: summary.skip,
      tone: "neutral",
    },
    { label: "Unchanged", count: summary.unchanged, tone: "neutral" },
    { label: "Problems", count: summary.error, tone: "danger" },
  ];
  return (
    <section
      aria-label={`${kind.label}: ${applied ? "result" : "preview"}`}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {applied ? "What was written" : "What would happen"}
        </h3>
        <span className="text-13 text-ink-muted tabular">
          {plural(summary.total, "row")}
        </span>
        {chips
          .filter((chip) => chip.count > 0)
          .map((chip) => (
            <Badge key={chip.label} tone={chip.tone}>
              {chip.label} {chip.count.toLocaleString("en")}
            </Badge>
          ))}
      </div>
      {sheet.unknownColumns.length > 0 ? (
        <Alert
          tone="warning"
          title={`${plural(sheet.unknownColumns.length, "column")} the import does not know`}
        >
          Ignored: {sheet.unknownColumns.join(", ")}. A typo in a header looks
          like this; the template has the exact names.
        </Alert>
      ) : null}
      <DataTable
        caption={`${kind.label}, row by row`}
        columns={resultColumns}
        data={sheet.rows}
        getRowId={(entry) => String(entry.row)}
        empty={
          <p className="p-4 text-13 text-ink-muted">The sheet has no rows.</p>
        }
      />
    </section>
  );
}

// --- Import ---------------------------------------------------------------------

function ImportPanel({
  type,
  onDone,
}: {
  type: ImportSheetType;
  /** Something was written: the lists behind the dialog are stale. */
  onDone: () => void;
}) {
  const kind = KINDS[type];
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [existing, setExisting] = useState<ImportExisting>("skip");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const modeId = useId();

  const previewing = useMutation({
    mutationFn: ({ sheet, mode }: { sheet: Sheet; mode: ImportExisting }) =>
      api.catalogSheets.preview({ [type]: sheet.rows, existing: mode }),
    onSuccess: (outcome) => setPreview(outcome),
    onError: (error) => notify.error(error, "The rows could not be checked"),
  });
  const importing = useMutation({
    mutationFn: ({ sheet, mode }: { sheet: Sheet; mode: ImportExisting }) =>
      api.catalogSheets.run({ [type]: sheet.rows, existing: mode }),
    onSuccess: (outcome) => {
      setResult(outcome);
      setPreview(null);
      onDone();
      const summary = outcome[type]?.summary;
      if (outcome.stoppedAt) {
        notify.info(
          `The import stopped at row ${outcome.stoppedAt.row}`,
          `${plural(summary?.create ?? 0, kind.one)} created and ${summary?.update ?? 0} updated before it.`,
        );
      } else {
        notify.success(
          `${kind.label} imported`,
          `${plural(summary?.create ?? 0, kind.one)} created, ${summary?.update ?? 0} updated.`,
        );
      }
    },
    meta: { invalidates: invalidation.catalog, silent: true },
  });

  const tooMany = chosen !== null && chosen.sheet.rows.length > IMPORT_MAX_ROWS;
  const busy = previewing.isPending || importing.isPending;

  // The file is checked as soon as it is read, and again when the choice
  // about existing records changes: nothing is written by that.
  const run = previewing.mutate;
  useEffect(() => {
    if (!chosen || tooMany || result) return;
    run({ sheet: chosen.sheet, mode: existing });
  }, [chosen, existing, tooMany, result, run]);

  async function take(file: File) {
    setPreview(null);
    setResult(null);
    setReadProblem(null);
    try {
      setChosen({ file, sheet: await readSheetFile(file) });
    } catch (error) {
      setChosen(null);
      setReadProblem(
        `${file.name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function reset() {
    setChosen(null);
    setReadProblem(null);
    setExisting("skip");
    setPreview(null);
    setResult(null);
  }

  const summary = preview?.[type]?.summary;
  const writes = (summary?.create ?? 0) + (summary?.update ?? 0);
  const matching = summary?.skip ?? 0;
  const shown = result ?? preview;

  return (
    <>
      <DialogBody className="gap-5">
        {!result ? (
          <>
            <ol className="grid gap-2 text-13 text-ink-muted sm:grid-cols-3">
              {[
                [
                  "Choose a file",
                  `The template has every column. Rows are matched by ${kind.key}.`,
                ],
                [
                  "Check the preview",
                  "Every row is checked by the API and says what would happen. Nothing is written yet.",
                ],
                [
                  "Import",
                  "Rows with a problem are left out; the others are written in the right order.",
                ],
              ].map(([title, text], index) => (
                <li
                  key={title}
                  className="flex gap-2.5 rounded-lg border border-line px-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-text tabular"
                  >
                    {index + 1}
                  </span>
                  <span>
                    <span className="block font-semibold text-ink">
                      {title}
                    </span>
                    {text}
                  </span>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-13">
              <a
                href={kind.template}
                download
                className="inline-flex items-center gap-1.5 font-medium text-accent-text underline-offset-2 hover:underline"
              >
                <Download aria-hidden="true" className="size-3.5" />
                Download the template ({kind.label.toLowerCase()}-example.csv)
              </a>
              <details className="group min-w-0 flex-1 basis-full text-ink-muted">
                <summary className="cursor-pointer font-medium text-ink select-none">
                  Columns and rules
                </summary>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                  {kind.rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                  <li>
                    Pictures are never part of a sheet; they are uploaded on the
                    record.
                  </li>
                </ul>
              </details>
            </div>

            <SheetDrop
              chosen={chosen}
              problem={readProblem}
              disabled={busy}
              onFile={(file) => void take(file)}
              onRemove={reset}
            />

            {chosen && !tooMany ? (
              <fieldset className="flex flex-col gap-2">
                <legend id={modeId} className="text-13 font-medium text-ink">
                  Rows that match an existing {kind.one}
                </legend>
                <RadioGroup
                  aria-labelledby={modeId}
                  value={existing}
                  disabled={busy}
                  onValueChange={(value) =>
                    setExisting(value as ImportExisting)
                  }
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {(
                    [
                      [
                        "skip",
                        "Leave them as they are",
                        "Only new rows are written. Nothing that exists changes.",
                      ],
                      [
                        "update",
                        "Update them with the file",
                        "The fields the file provides replace what is stored; empty cells change nothing. The preview names each change.",
                      ],
                    ] as const
                  ).map(([value, title, text]) => (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5",
                        existing === value
                          ? "border-accent bg-accent-soft/60"
                          : "border-line hover:border-line-strong",
                      )}
                    >
                      <RadioItem value={value} className="mt-0.5" />
                      <span className="text-sm text-ink">
                        {title}
                        <span className="block text-13 text-ink-muted">
                          {text}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
            ) : null}

            {previewing.isPending ? (
              <p
                className="flex items-center gap-2 text-13 text-ink-muted"
                role="status"
              >
                <Spinner /> Checking the rows…
              </p>
            ) : null}
          </>
        ) : null}

        {result?.stoppedAt ? (
          <Alert
            tone="danger"
            title={`The import stopped at row ${result.stoppedAt.row}`}
          >
            The rows written before it are kept; that row and the ones after it
            are not. Its problem is in the table. Fix the file and import it
            again: what exists by now is matched and skipped or updated, nothing
            is created twice.
          </Alert>
        ) : result ? (
          <Alert tone="success" title={`${kind.label} imported`}>
            {result[type] ? countsText(result[type].summary) : ""}. The list
            behind this dialog is up to date.
          </Alert>
        ) : null}

        {preview && !previewing.isPending && writes === 0 && summary ? (
          <Alert tone="info" title="Nothing to write">
            {matching > 0 && existing === "skip"
              ? `${plural(matching, "row")} match ${matching === 1 ? "a record that exists" : "records that exist"} and would be left alone. Choose “Update them with the file” to change them.`
              : summary.error > 0
                ? "Every row has a problem. Fix the file and choose it again."
                : "Every row is unchanged: the file says what is stored already."}
          </Alert>
        ) : null}

        {shown?.[type] ? (
          <Outcome kind={kind} sheet={shown[type]} applied={shown.applied} />
        ) : null}
      </DialogBody>

      <DialogFooter>
        {result ? (
          <Button
            variant="primary"
            size="lg"
            onClick={reset}
            icon={<CheckCircle2 />}
          >
            Import another file
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            icon={<Upload />}
            disabled={!preview || busy || writes === 0}
            onClick={() => setConfirming(true)}
          >
            {summary && writes > 0
              ? `Import: ${countsText(summary).toLowerCase()}`
              : "Import"}
          </Button>
        )}
      </DialogFooter>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Import ${plural(writes, "row")}?`}
        description={
          existing === "update"
            ? `${kind.label} that match a row get the fields of the file. Rows with a problem are left out.`
            : `${kind.label} that match a row are left as they are. Rows with a problem are left out.`
        }
        facts={
          summary ? [{ label: kind.label, value: countsText(summary) }] : []
        }
        confirmLabel="Import"
        onConfirm={async () => {
          if (!chosen) return;
          await importing.mutateAsync({ sheet: chosen.sheet, mode: existing });
        }}
        errorHelp={(error) => errorMessage(error)}
      />
    </>
  );
}

// --- Export ---------------------------------------------------------------------

function ExportPanel({ type }: { type: ImportSheetType }) {
  const kind = KINDS[type];
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const formatId = useId();
  const save = useMutation({
    mutationFn: async (chosen: "xlsx" | "csv") => {
      const sheet = await api.catalogSheets.export(type);
      const day = new Date().toISOString().slice(0, 10);
      const name = `radhe-${type}-${day}.${chosen}`;
      if (chosen === "csv") saveCsv(name, sheet.columns, sheet.rows);
      else await saveXlsx(name, sheet.columns, sheet.rows);
      return { name, rows: sheet.rows.length };
    },
    onSuccess: ({ name, rows }) =>
      notify.success(`${name} saved`, `${plural(rows, kind.one)}.`),
    onError: (error) => notify.error(error, "The export could not be made"),
  });

  return (
    <>
      <DialogBody className="gap-5">
        <div className="rounded-lg border border-line bg-sunken/60 px-3.5 py-3 text-13 text-ink-muted">
          <p className="font-semibold text-ink">What the file holds</p>
          <p>{kind.included}</p>
          <p className="mt-1">
            The columns are those of the import: edit the file and import it
            again, and only what changed is written. Pictures are not part of
            it.
          </p>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend id={formatId} className="text-13 font-medium text-ink">
            Format
          </legend>
          <RadioGroup
            aria-labelledby={formatId}
            value={format}
            disabled={save.isPending}
            onValueChange={(value) => setFormat(value as "xlsx" | "csv")}
            className="grid gap-2 sm:grid-cols-2"
          >
            {(
              [
                [
                  "xlsx",
                  "Excel (.xlsx)",
                  "Opens in Excel, Numbers and Google Sheets with the columns as they are. The usual choice.",
                ],
                [
                  "csv",
                  "CSV (.csv)",
                  "Plain text, UTF-8 with a header row. For other tools and scripts.",
                ],
              ] as const
            ).map(([value, title, text]) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5",
                  format === value
                    ? "border-accent bg-accent-soft/60"
                    : "border-line hover:border-line-strong",
                )}
              >
                <RadioItem value={value} className="mt-0.5" />
                <span className="text-sm text-ink">
                  {title}
                  <span className="block text-13 text-ink-muted">{text}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="primary"
          size="lg"
          icon={<Download />}
          loading={save.isPending}
          onClick={() => save.mutate(format)}
        >
          Download {kind.label.toLowerCase()} as{" "}
          {format === "xlsx" ? "Excel" : "CSV"}
        </Button>
      </DialogFooter>
    </>
  );
}

// --- The dialog and its button --------------------------------------------------

const tabClass =
  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-ink-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-accent data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-card";

export function ImportExportDialog({
  type,
  open,
  onOpenChange,
  initialTab = "import",
}: {
  type: ImportSheetType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "import" | "export";
}) {
  const kind = KINDS[type];
  const manage = useCan()("catalog.manage");
  const [tab, setTab] = useState<"import" | "export">(
    manage ? initialTab : "export",
  );
  const [imported, setImported] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && imported) setImported(false);
        onOpenChange(next);
      }}
    >
      <DialogContent size="xl">
        <DialogHeader
          title={`Import and export ${kind.label.toLowerCase()}`}
          description="Spreadsheets in and out. The API checks every row and says what would happen before anything is written."
        />
        <Tabs.Root
          value={tab}
          onValueChange={(value) => setTab(value as "import" | "export")}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Tabs.List
            aria-label="Import or export"
            className="mx-4 flex gap-1 rounded-lg bg-sunken p-1 sm:mx-5"
          >
            <Tabs.Trigger
              value="import"
              className={tabClass}
              disabled={!manage}
            >
              <Upload aria-hidden="true" className="size-4" />
              Import
            </Tabs.Trigger>
            <Tabs.Trigger value="export" className={tabClass}>
              <Download aria-hidden="true" className="size-4" />
              Export
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content
            value="import"
            className="flex min-h-0 flex-1 flex-col outline-none"
          >
            {manage ? (
              <ImportPanel type={type} onDone={() => setImported(true)} />
            ) : null}
          </Tabs.Content>
          <Tabs.Content
            value="export"
            className="flex min-h-0 flex-1 flex-col outline-none"
          >
            <ExportPanel type={type} />
          </Tabs.Content>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  );
}

/** The button next to "New …" on a list page; it owns the dialog. */
export function ImportExportButton({ type }: { type: ImportSheetType }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<FileSpreadsheet />} onClick={() => setOpen(true)}>
        Import & export
      </Button>
      {open ? (
        <ImportExportDialog type={type} open onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
