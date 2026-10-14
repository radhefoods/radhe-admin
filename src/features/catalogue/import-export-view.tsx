"use client";

import { useMutation } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { invalidation } from "@/lib/api/query-keys";
import {
  IMPORT_MAX_ROWS,
  type ImportAction,
  type ImportBody,
  type ImportExisting,
  type ImportResult,
  type ImportRowResult,
  type ImportSheetResult,
  type ImportSheetType,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import type { Tone } from "@/lib/status";
import { readSheetFile, saveCsv, saveXlsx, type Sheet } from "./sheets";

const SHEETS: { type: ImportSheetType; label: string; what: string }[] = [
  {
    type: "categories",
    label: "Categories",
    what: "The tree, each row with its parent's slug.",
  },
  {
    type: "products",
    label: "Products",
    what: "Every pack size as a row, with price, VAT, texts and food information.",
  },
];

const ACTION: Record<ImportAction, { label: string; tone: Tone }> = {
  create: { label: "Create", tone: "success" },
  update: { label: "Update", tone: "planned" },
  skip: { label: "Skip", tone: "neutral" },
  unchanged: { label: "Unchanged", tone: "neutral" },
  error: { label: "Problem", tone: "danger" },
};

const TEMPLATES: Record<ImportSheetType, string> = {
  categories: "/templates/categories-example.csv",
  products: "/templates/products-example.csv",
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

// --- Export ----------------------------------------------------------------------

function ExportCard() {
  const save = useMutation({
    mutationFn: async ({
      type,
      format,
    }: {
      type: ImportSheetType;
      format: "xlsx" | "csv";
    }) => {
      const sheet = await api.catalogSheets.export(type);
      const day = new Date().toISOString().slice(0, 10);
      const name = `radhe-${type}-${day}.${format}`;
      if (format === "csv") saveCsv(name, sheet.columns, sheet.rows);
      else await saveXlsx(name, sheet.columns, sheet.rows);
      return { name, rows: sheet.rows.length };
    },
    onSuccess: ({ name, rows }) =>
      notify.success(`${name} saved`, `${plural(rows, "row")}.`),
    onError: (error) => notify.error(error, "The export could not be made"),
  });
  const busy = (type: ImportSheetType, format: "xlsx" | "csv") =>
    save.isPending &&
    save.variables?.type === type &&
    save.variables.format === format;

  return (
    <Card>
      <CardHeader
        title="Export"
        description="Every record as flat rows in the columns of the import. An exported file, edited, imports again: what did not change is left as it is."
      />
      <CardBody className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y divide-line">
          {SHEETS.map((sheet) => (
            <li
              key={sheet.type}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{sheet.label}</p>
                <p className="text-13 text-ink-muted">{sheet.what}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  icon={<Download />}
                  loading={busy(sheet.type, "xlsx")}
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({ type: sheet.type, format: "xlsx" })
                  }
                >
                  Excel (.xlsx)
                </Button>
                <Button
                  size="sm"
                  loading={busy(sheet.type, "csv")}
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({ type: sheet.type, format: "csv" })
                  }
                >
                  CSV
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-13 text-ink-muted">
          Templates with every column and sample rows:{" "}
          <a
            href={TEMPLATES.categories}
            download
            className="font-medium text-accent-text underline underline-offset-2"
          >
            categories-example.csv
          </a>{" "}
          and{" "}
          <a
            href={TEMPLATES.products}
            download
            className="font-medium text-accent-text underline underline-offset-2"
          >
            products-example.csv
          </a>
          . Pictures are not part of a sheet: they are uploaded on the product
          or the category.
        </p>
      </CardBody>
    </Card>
  );
}

// --- Import ----------------------------------------------------------------------

interface Chosen {
  file: File;
  sheet: Sheet;
}

function FileField({
  type,
  label,
  chosen,
  problem,
  disabled,
  onChoose,
  onRemove,
}: {
  type: ImportSheetType;
  label: string;
  chosen: Chosen | undefined;
  problem: string | null;
  disabled: boolean;
  onChoose: (file: File) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const tooMany = chosen && chosen.sheet.rows.length > IMPORT_MAX_ROWS;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-13 font-medium text-ink">
        {label} sheet
        <span className="ml-1.5 font-normal text-ink-subtle">
          .csv or .xlsx, optional
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="file"
          accept=".csv,.xlsx,text/csv"
          disabled={disabled}
          aria-describedby={`${id}-state`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onChoose(file);
          }}
          className="h-9 max-w-full rounded-md border border-line bg-surface text-13 text-ink file:mr-3 file:h-full file:border-0 file:border-r file:border-line file:bg-sunken file:px-3 file:text-13 file:font-medium file:text-ink hover:border-line-strong disabled:opacity-60"
        />
        {chosen ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<X />}
            disabled={disabled}
            onClick={onRemove}
          >
            Remove
          </Button>
        ) : null}
      </div>
      <p
        id={`${id}-state`}
        className={cn(
          "text-13",
          problem || tooMany ? "text-danger-fg" : "text-ink-muted",
        )}
      >
        {problem
          ? problem
          : chosen
            ? tooMany
              ? `${chosen.file.name}: ${chosen.sheet.rows.length.toLocaleString("en")} rows, more than the ${IMPORT_MAX_ROWS.toLocaleString("en")} one import takes. Split the file.`
              : `${chosen.file.name}: ${plural(chosen.sheet.rows.length, "row")}, ${plural(chosen.sheet.columns.length, "column")}.`
            : type === "categories"
              ? "Matched by slug_en. Parents may be rows of the same file."
              : "Matched by sku. category_slug may name a row of the categories sheet."}
      </p>
    </div>
  );
}

const resultColumns: Column<ImportRowResult>[] = [
  {
    id: "row",
    header: "Row",
    cell: ({ row }) => <span className="tabular">{row.original.row}</span>,
    meta: { align: "right", className: "w-14", skeleton: "w-6" },
  },
  {
    id: "key",
    header: "Key",
    cell: ({ row }) => (
      <span className="font-mono text-13">{row.original.key || "—"}</span>
    ),
    meta: { className: "max-w-48 truncate", skeleton: "w-24" },
  },
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => row.original.name || "—",
    meta: { className: "max-w-56 truncate", skeleton: "w-32" },
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
    id: "changes",
    header: "Changes",
    cell: ({ row }) =>
      row.original.changes.length > 0 ? (
        <span className="text-13">{row.original.changes.join(", ")}</span>
      ) : (
        <span className="text-ink-subtle">—</span>
      ),
    meta: { from: "md", className: "max-w-64", skeleton: "w-24" },
  },
  {
    id: "problems",
    header: "Problems",
    cell: ({ row }) =>
      row.original.problems.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-13 text-danger-fg">
          {row.original.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : (
        <span className="text-ink-subtle">—</span>
      ),
    meta: { className: "max-w-md", skeleton: "w-32" },
  },
];

function SheetOutcome({
  label,
  sheet,
  applied,
}: {
  label: string;
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
      aria-label={`${label}: ${applied ? "result" : "preview"}`}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold tracking-[-0.01em] text-ink">
          {label}
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
        caption={`${label}, row by row`}
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

function ImportCard() {
  const [chosen, setChosen] = useState<
    Partial<Record<ImportSheetType, Chosen>>
  >({});
  const [problems, setProblems] = useState<
    Record<ImportSheetType, string | null>
  >({
    categories: null,
    products: null,
  });
  const [mode, setMode] = useState<ImportExisting>("skip");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  const body = (existing: ImportExisting): ImportBody => ({
    ...(chosen.categories ? { categories: chosen.categories.sheet.rows } : {}),
    ...(chosen.products ? { products: chosen.products.sheet.rows } : {}),
    existing,
  });
  const previewing = useMutation({
    mutationFn: (existing: ImportExisting) =>
      api.catalogSheets.preview(body(existing)),
    onSuccess: (outcome, existing) => {
      setMode(existing);
      setPreview(outcome);
      setResult(null);
    },
    onError: (error) => notify.error(error, "The preview could not be made"),
  });
  const importing = useMutation({
    mutationFn: (existing: ImportExisting) =>
      api.catalogSheets.run(body(existing)),
    onSuccess: (outcome) => {
      setResult(outcome);
      setPreview(null);
      const created =
        (outcome.categories?.summary.create ?? 0) +
        (outcome.products?.summary.create ?? 0);
      const updated =
        (outcome.categories?.summary.update ?? 0) +
        (outcome.products?.summary.update ?? 0);
      if (outcome.stoppedAt) {
        notify.info(
          "The import stopped",
          `Row ${outcome.stoppedAt.row} of the ${outcome.stoppedAt.type} sheet failed. ${plural(created, "record")} created and ${updated} updated before it.`,
        );
      } else {
        notify.success(
          "Imported",
          `${plural(created, "record")} created, ${updated} updated.`,
        );
      }
    },
    meta: { invalidates: invalidation.catalog, silent: true },
  });

  const files = Object.values(chosen).filter(Boolean);
  const tooMany = files.some(
    (entry) => entry.sheet.rows.length > IMPORT_MAX_ROWS,
  );
  const busy = previewing.isPending || importing.isPending;
  const shown = result ?? preview;
  const writes =
    (preview?.categories?.summary.create ?? 0) +
    (preview?.categories?.summary.update ?? 0) +
    (preview?.products?.summary.create ?? 0) +
    (preview?.products?.summary.update ?? 0);
  const matching =
    (preview?.categories?.summary.skip ?? 0) +
    (preview?.products?.summary.skip ?? 0);

  async function choose(type: ImportSheetType, file: File) {
    setPreview(null);
    setResult(null);
    try {
      const sheet = await readSheetFile(file);
      setChosen((current) => ({ ...current, [type]: { file, sheet } }));
      setProblems((current) => ({ ...current, [type]: null }));
    } catch (error) {
      setChosen((current) => ({ ...current, [type]: undefined }));
      setProblems((current) => ({
        ...current,
        [type]: `${file.name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  }

  function remove(type: ImportSheetType) {
    setChosen((current) => ({ ...current, [type]: undefined }));
    setProblems((current) => ({ ...current, [type]: null }));
    setPreview(null);
    setResult(null);
  }

  function reset() {
    setChosen({});
    setProblems({ categories: null, products: null });
    setMode("skip");
    setPreview(null);
    setResult(null);
  }

  const facts: { label: string; value: ReactNode }[] = [];
  for (const sheet of SHEETS) {
    const summary = preview?.[sheet.type]?.summary;
    if (summary) facts.push({ label: sheet.label, value: countsText(summary) });
  }

  return (
    <Card>
      <CardHeader
        title="Import"
        description="Choose one or both sheets. The API checks every row and says what would happen; nothing is written until you confirm. A row with a problem is never written, the others are."
      />
      <CardBody className="flex flex-col gap-5">
        <div className="grid gap-4 md:grid-cols-2">
          {SHEETS.map((sheet) => (
            <FileField
              key={sheet.type}
              type={sheet.type}
              label={sheet.label}
              chosen={chosen[sheet.type]}
              problem={problems[sheet.type]}
              disabled={busy}
              onChoose={(file) => void choose(sheet.type, file)}
              onRemove={() => remove(sheet.type)}
            />
          ))}
        </div>

        {result === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={preview ? "secondary" : "primary"}
              icon={<FileSpreadsheet />}
              loading={previewing.isPending && previewing.variables === "skip"}
              disabled={files.length === 0 || tooMany || busy}
              onClick={() => previewing.mutate("skip")}
            >
              {preview ? "Preview again" : "Preview"}
            </Button>
            {preview && matching > 0 && mode === "skip" ? (
              <Button
                loading={
                  previewing.isPending && previewing.variables === "update"
                }
                disabled={busy}
                onClick={() => previewing.mutate("update")}
              >
                Preview with updates: change the{" "}
                {plural(matching, "existing record")}
              </Button>
            ) : null}
            {preview && mode === "update" ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => previewing.mutate("skip")}
              >
                Leave existing records as they are
              </Button>
            ) : null}
            {preview ? (
              <Button
                variant="primary"
                icon={<Upload />}
                disabled={busy || writes === 0}
                onClick={() => setConfirming(true)}
                className="ml-auto"
              >
                Import
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={reset}>
              Import another file
            </Button>
          </div>
        )}

        {preview && mode === "update" ? (
          <Alert
            tone="info"
            title="Existing records get the fields of the file"
          >
            Each row names the fields that change. An empty cell leaves the
            field as it is; to remove a value, write what the column says (for
            example <code className="font-mono text-xs">0</code> for{" "}
            <code className="font-mono text-xs">sale_price</code>).
          </Alert>
        ) : null}
        {preview && mode === "skip" && matching > 0 ? (
          <Alert
            tone="info"
            title={`${plural(matching, "row")} match records that exist`}
          >
            They are left as they are. “Preview with updates” shows what the
            file would change on them.
          </Alert>
        ) : null}
        {preview && writes === 0 && !tooMany ? (
          <Alert tone="info" title="Nothing to write">
            {matching > 0
              ? "Every row matches a record that exists. Preview with updates to change them, or there is nothing to do."
              : "No row would be created or updated. Fix the problems in the file and choose it again."}
          </Alert>
        ) : null}

        {result?.stoppedAt ? (
          <Alert
            tone="danger"
            title={`The import stopped at row ${result.stoppedAt.row} of the ${result.stoppedAt.type} sheet`}
          >
            The rows written before it are kept; that row and the ones after it
            are not written. Its problem is in the table. Fix the file and
            import it again: what exists by now is matched and skipped or
            updated, nothing is created twice.
          </Alert>
        ) : result ? (
          <Alert tone="success" title="Imported">
            {SHEETS.map((sheet) => {
              const summary = result[sheet.type]?.summary;
              return summary
                ? `${sheet.label}: ${countsText(summary).toLowerCase()}. `
                : "";
            })}
          </Alert>
        ) : null}

        {shown
          ? SHEETS.map((sheet) => {
              const outcome = shown[sheet.type];
              return outcome ? (
                <SheetOutcome
                  key={sheet.type}
                  label={sheet.label}
                  sheet={outcome}
                  applied={shown.applied}
                />
              ) : null;
            })
          : null}
      </CardBody>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Import ${plural(writes, "row")}?`}
        description={
          mode === "update"
            ? "Records that match a row get the fields of the file. Rows with a problem are left out."
            : "Records that match a row are left as they are. Rows with a problem are left out."
        }
        facts={facts}
        confirmLabel="Import"
        onConfirm={async () => {
          await importing.mutateAsync(mode);
        }}
        errorHelp={(error) => errorMessage(error)}
      />
    </Card>
  );
}

export function ImportExportView() {
  const manage = useCan()("catalog.manage");
  return (
    <RequirePermission permission="catalog.read">
      <PageHeader
        title="Import and export"
        back={{ href: routes.products, label: "Products" }}
        description="Categories and products come in from a spreadsheet and go out as one. The API checks every row and says what would happen before anything is written. Pictures are never part of a sheet."
      />
      <PageBody className="max-w-5xl">
        <ExportCard />
        {manage ? (
          <ImportCard />
        ) : (
          <Alert
            tone="info"
            title="Importing needs the permission to manage the catalogue"
          >
            Your role reads the catalogue; exporting works, importing is for an
            admin who may change categories and products.
          </Alert>
        )}
      </PageBody>
    </RequirePermission>
  );
}
