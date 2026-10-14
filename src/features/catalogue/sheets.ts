import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import writeXlsxFile, { type SheetData } from "write-excel-file/browser";
import type { ImportRow } from "@/lib/api/types";

// Spreadsheets in the browser (documentation, 8.2): a CSV or Excel file is
// read into rows keyed by its header, and rows of the API are written back
// as .xlsx or .csv. The API never sees a file.

export interface Sheet {
  /** The headers, as they are in the file. */
  columns: string[];
  rows: ImportRow[];
}

/** What a parser gives for one cell. */
type Cell = unknown;

function cellValue(cell: Cell): string | number | boolean {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number" || typeof cell === "boolean") return cell;
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

/**
 * Rows keyed by the header row. Headers are trimmed but otherwise kept as
 * they are (the API names unknown ones); columns without a header and rows
 * without a cell are left out.
 */
export function sheetFromMatrix(matrix: readonly (readonly Cell[])[]): Sheet {
  const [header = [], ...body] = matrix;
  const columns = header.map((cell) => String(cell ?? "").trim());
  const rows: ImportRow[] = [];
  for (const line of body) {
    const row: ImportRow = {};
    let filled = false;
    columns.forEach((column, index) => {
      if (column === "") return;
      const value = cellValue(line[index]);
      row[column] = value;
      if (value !== "") filled = true;
    });
    if (filled) rows.push(row);
  }
  return { columns: columns.filter((column) => column !== ""), rows };
}

function parseCsv(file: File): Promise<Sheet> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (result) => {
        const fatal = result.errors.find((error) => error.type !== "Quotes");
        if (fatal && result.data.length === 0) {
          reject(new Error(fatal.message));
          return;
        }
        resolve(sheetFromMatrix(result.data));
      },
      error: (error) => reject(error),
    });
  });
}

async function parseXlsx(file: File): Promise<Sheet> {
  // The first sheet of the workbook.
  const matrix = await readSheet(file);
  return sheetFromMatrix(matrix);
}

/** Reads a `.csv` or `.xlsx` file; anything else is refused by name. */
export async function readSheetFile(file: File): Promise<Sheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return parseXlsx(file);
  if (
    name.endsWith(".csv") ||
    name.endsWith(".txt") ||
    file.type === "text/csv"
  )
    return parseCsv(file);
  throw new Error("Choose a .csv or .xlsx file.");
}

/** The rows as CSV text, in the writing of the import (UTF-8, comma, header). */
export function csvOf(
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  return Papa.unparse({
    fields: [...columns],
    data: rows.map((row) => columns.map((column) => row[column] ?? "")),
  });
}

/** Hands a file to the browser's download. */
export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveCsv(
  name: string,
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): void {
  // The byte order mark makes Excel read the file as UTF-8.
  download(
    name,
    new Blob(["﻿", csvOf(columns, rows)], {
      type: "text/csv;charset=utf-8",
    }),
  );
}

export async function saveXlsx(
  name: string,
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): Promise<void> {
  const data: SheetData = [
    columns.map((column) => ({ value: column, fontWeight: "bold" as const })),
    ...rows.map((row) => columns.map((column) => row[column] ?? "")),
  ];
  await writeXlsxFile(data, {
    columns: columns.map(() => ({ width: 18 })),
  }).toFile(name);
}
