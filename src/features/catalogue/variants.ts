import type { PackUnit } from "@/lib/api/types";

// The rules of the pack sizes of a product (documentation, 8), checked in
// the form before the API refuses: one unit family, no pack twice, no
// article number twice, 1 to 20 of them.

export const VARIANTS_MAX = 20;

export type UnitFamily = "weight" | "volume" | "pieces";

export const UNIT_FAMILY: Record<PackUnit, UnitFamily> = {
  g: "weight",
  kg: "weight",
  ml: "volume",
  l: "volume",
  pcs: "pieces",
};

export const FAMILY_LABEL: Record<UnitFamily, string> = {
  weight: "weight (g, kg)",
  volume: "volume (ml, l)",
  pieces: "pieces",
};

/** The pack in its base unit (g, ml or pieces): two packs are the same when this is. */
export function baseQuantity(value: number, unit: PackUnit): number {
  const factor = unit === "kg" || unit === "l" ? 1000 : 1;
  return Math.round(value * factor * 1000) / 1000;
}

/** The label a pack gets as typed: "5 kg", "0.5 l"; empty while nothing is typed. */
export function packLabelOf(value: string, unit: PackUnit): string {
  const text = value.trim().replace(",", ".");
  return text === "" ? "" : `${text} ${unit}`;
}

/** What the checks need of a row of the pack-size table. */
export interface RowShape {
  packSize: { value: string; unit: PackUnit };
  sku: string;
  /** Marked for removal when the product is saved: it does not count. */
  removed: boolean;
}

export interface RowProblem {
  /** The row, or `-1` for the table as a whole. */
  index: number;
  field: "packSize.value" | "packSize.unit" | "sku" | "root";
  message: string;
}

function parsed(value: string): number | null {
  const match = /^(\d{1,7})(?:[.,](\d{1,3}))?$/.exec(value.trim());
  return match ? Number(`${match[1]}.${match[2] ?? "0"}`) : null;
}

/**
 * The problems the API would refuse the rows for. Rows marked for removal
 * are left out: they are gone once the product is saved.
 */
export function rowProblems(rows: readonly RowShape[]): RowProblem[] {
  const problems: RowProblem[] = [];
  const live = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.removed);
  if (live.length === 0) {
    problems.push({
      index: -1,
      field: "root",
      message: "A product needs at least one pack size.",
    });
    return problems;
  }
  if (live.length > VARIANTS_MAX) {
    problems.push({
      index: -1,
      field: "root",
      message: `A product has at most ${VARIANTS_MAX} pack sizes.`,
    });
  }
  const family = UNIT_FAMILY[live[0]!.row.packSize.unit];
  const seenPacks = new Map<number, number>();
  const seenSkus = new Map<string, number>();
  for (const { row, index } of live) {
    if (UNIT_FAMILY[row.packSize.unit] !== family) {
      problems.push({
        index,
        field: "packSize.unit",
        message: `All pack sizes of a product are of one unit family. The first one is ${FAMILY_LABEL[family]}.`,
      });
    }
    const value = parsed(row.packSize.value);
    if (value !== null && UNIT_FAMILY[row.packSize.unit] === family) {
      const base = baseQuantity(value, row.packSize.unit);
      const earlier = seenPacks.get(base);
      if (earlier !== undefined) {
        problems.push({
          index,
          field: "packSize.value",
          message: `The same pack as row ${earlier + 1}. Each pack only once.`,
        });
      } else seenPacks.set(base, index);
    }
    const sku = row.sku.trim().toUpperCase();
    if (sku !== "") {
      const earlier = seenSkus.get(sku);
      if (earlier !== undefined) {
        problems.push({
          index,
          field: "sku",
          message: `The same article number as row ${earlier + 1}.`,
        });
      } else seenSkus.set(sku, index);
    }
  }
  return problems;
}
