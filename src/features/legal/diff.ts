import { diffLines, diffWordsWithSpace } from "diff";

// What changed between two versions of a text. Lines find the passages
// that differ; inside a passage that was rewritten, words show what
// exactly was taken out and put in.

export type Change = "same" | "added" | "removed";

export interface DiffPart {
  change: Change;
  text: string;
}

export interface DiffRow {
  /**
   * `same`: the passage is in both versions. `added` / `removed`: it is in
   * one of them only. `changed`: it was rewritten, and `parts` holds the
   * words of both versions in reading order.
   */
  kind: Change | "changed";
  parts: DiffPart[];
}

export interface TextDiff {
  rows: DiffRow[];
  /** Words that are new in the later version. */
  addedWords: number;
  /** Words of the earlier version that are gone. */
  removedWords: number;
  identical: boolean;
}

/**
 * Line endings and the end of the text are a matter of the editor, not of
 * the content: they never count as a change.
 */
export function normalizeText(text: string | null | undefined): string {
  const value = (text ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return value === "" ? "" : `${value}\n`;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

/** The earlier version of a row: everything except what was added. */
export function beforeParts(row: DiffRow): DiffPart[] {
  return row.parts.filter((part) => part.change !== "added");
}

/** The later version of a row: everything except what was removed. */
export function afterParts(row: DiffRow): DiffPart[] {
  return row.parts.filter((part) => part.change !== "removed");
}

export function diffTexts(
  before: string | null | undefined,
  after: string | null | undefined,
): TextDiff {
  const chunks = diffLines(normalizeText(before), normalizeText(after));
  const rows: DiffRow[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const next = chunks[index + 1];
    const rewritten =
      next && ((chunk.removed && next.added) || (chunk.added && next.removed));
    if (rewritten) {
      const [old, fresh] = chunk.removed ? [chunk, next] : [next, chunk];
      rows.push({
        kind: "changed",
        parts: diffWordsWithSpace(old.value, fresh.value).map((word) => ({
          change: word.added ? "added" : word.removed ? "removed" : "same",
          text: word.value,
        })),
      });
      index += 1;
      continue;
    }
    const change: Change = chunk.added
      ? "added"
      : chunk.removed
        ? "removed"
        : "same";
    rows.push({ kind: change, parts: [{ change, text: chunk.value }] });
  }

  let addedWords = 0;
  let removedWords = 0;
  for (const row of rows) {
    for (const part of row.parts) {
      if (part.change === "added") addedWords += countWords(part.text);
      if (part.change === "removed") removedWords += countWords(part.text);
    }
  }

  return {
    rows,
    addedWords,
    removedWords,
    identical: rows.every((row) => row.kind === "same"),
  };
}
