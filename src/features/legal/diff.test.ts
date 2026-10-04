import { describe, expect, it } from "vitest";
import type { LegalDocumentSummary } from "@/lib/api/types";
import {
  afterParts,
  beforeParts,
  countWords,
  diffTexts,
  normalizeText,
} from "./diff";
import {
  groupByType,
  previousVersion,
  toContent,
  toTitle,
  unpublishedRequiredTypes,
  versionName,
} from "./legal";

const text = (parts: { text: string }[]) =>
  parts.map((part) => part.text).join("");

describe("the diff of two versions of a text", () => {
  it("finds nothing between a text and itself", () => {
    const diff = diffTexts(
      "# Terms\n\nYou pay after delivery.\n",
      "# Terms\n\nYou pay after delivery.\n",
    );
    expect(diff.identical).toBe(true);
    expect(diff.addedWords).toBe(0);
    expect(diff.removedWords).toBe(0);
    expect(diff.rows).toEqual([
      {
        kind: "same",
        parts: [
          { change: "same", text: "# Terms\n\nYou pay after delivery.\n" },
        ],
      },
    ]);
  });

  it("ignores line endings and the end of the text", () => {
    expect(normalizeText("a\r\nb\r\n\r\n")).toBe("a\nb\n");
    expect(normalizeText("   \n")).toBe("");
    expect(normalizeText(null)).toBe("");
    expect(diffTexts("a\r\nb", "a\nb\n\n").identical).toBe(true);
  });

  it("marks the words of a passage that was rewritten", () => {
    const diff = diffTexts(
      "# Terms\n\nPayment is due by the deadline on the invoice.\n",
      "# Terms\n\nPayment is due by the deadline on the invoice, at the earliest five days after the invoice.\n",
    );
    expect(diff.identical).toBe(false);
    expect(diff.rows.map((row) => row.kind)).toEqual(["same", "changed"]);
    const changed = diff.rows[1]!;
    // Both versions can be read out of the one row.
    expect(text(beforeParts(changed))).toBe(
      "Payment is due by the deadline on the invoice.\n",
    );
    expect(text(afterParts(changed))).toBe(
      "Payment is due by the deadline on the invoice, at the earliest five days after the invoice.\n",
    );
    expect(changed.parts.some((part) => part.change === "added")).toBe(true);
    expect(
      changed.parts.filter((part) => part.change === "same").length,
    ).toBeGreaterThan(0);
    expect(diff.addedWords).toBeGreaterThan(0);
  });

  it("tells a passage that is new from one that is gone", () => {
    const added = diffTexts(
      "One.\n",
      "One.\n\n## 5. Returns\n\nWithin 14 days.\n",
    );
    expect(added.rows.map((row) => row.kind)).toEqual(["same", "added"]);
    expect(added.addedWords).toBe(6);
    expect(added.removedWords).toBe(0);

    const removed = diffTexts("One.\nTwo words.\nThree.\n", "One.\nThree.\n");
    expect(removed.rows.map((row) => row.kind)).toEqual([
      "same",
      "removed",
      "same",
    ]);
    expect(removed.removedWords).toBe(2);
    expect(text(afterParts(removed.rows[1]!))).toBe("");
    expect(text(beforeParts(removed.rows[1]!))).toBe("Two words.\n");
  });

  it("shows a language that did not exist before as all new, and one that is gone as all removed", () => {
    const fresh = diffTexts(null, "Neu.\nGanz neu.\n");
    expect(fresh.rows).toEqual([
      {
        kind: "added",
        parts: [{ change: "added", text: "Neu.\nGanz neu.\n" }],
      },
    ]);
    const gone = diffTexts("Alt.\n", "");
    expect(gone.rows.map((row) => row.kind)).toEqual(["removed"]);
    expect(diffTexts(null, undefined)).toEqual({
      rows: [],
      addedWords: 0,
      removedWords: 0,
      identical: true,
    });
  });

  it("puts the two versions back together from the rows", () => {
    const before = "# A\n\nfirst line\nsecond line\n\nlast\n";
    const after = "# A\n\nfirst line changed\n\nnew paragraph\n\nlast\n";
    const diff = diffTexts(before, after);
    expect(diff.rows.map((row) => text(beforeParts(row))).join("")).toBe(
      before,
    );
    expect(diff.rows.map((row) => text(afterParts(row))).join("")).toBe(after);
  });

  it("counts words, not spaces", () => {
    expect(countWords("  two   words \n")).toBe(2);
    expect(countWords("")).toBe(0);
  });
});

const version = (
  type: LegalDocumentSummary["type"],
  number: number,
  status: LegalDocumentSummary["status"],
  isCurrent = false,
): LegalDocumentSummary => ({
  id: `${type}-${number}`,
  type,
  version: number,
  status,
  title: { en: type },
  note: null,
  publishedAt: status === "published" ? "2026-09-01T10:00:00.000Z" : null,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  isCurrent,
});

describe("the versions of the legal texts", () => {
  const items = [
    version("terms", 1, "published"),
    version("terms", 3, "draft"),
    version("terms", 2, "published", true),
    version("privacy", 1, "draft"),
  ];

  it("groups them by type, newest first", () => {
    const groups = groupByType(items);
    expect(groups.terms.map((entry) => entry.version)).toEqual([3, 2, 1]);
    expect(groups.preorder_terms).toEqual([]);
    expect(groups.privacy).toHaveLength(1);
  });

  it("knows which required text has no published version", () => {
    expect(unpublishedRequiredTypes(items, ["terms", "privacy"])).toEqual([
      "privacy",
    ]);
    expect(unpublishedRequiredTypes([], ["terms", "privacy"])).toEqual([
      "terms",
      "privacy",
    ]);
    expect(
      unpublishedRequiredTypes(
        [...items, version("privacy", 2, "published")],
        ["terms", "privacy"],
      ),
    ).toEqual([]);
  });

  it("compares a version with the one before it, of the same type", () => {
    expect(
      previousVersion(items, { id: "terms-3", type: "terms", version: 3 })?.id,
    ).toBe("terms-2");
    expect(
      previousVersion(items, { id: "terms-1", type: "terms", version: 1 }),
    ).toBeNull();
    expect(
      previousVersion(items, { id: "privacy-1", type: "privacy", version: 1 }),
    ).toBeNull();
  });

  it("names a version", () => {
    expect(versionName({ type: "preorder_terms", version: 2 })).toBe(
      "Pre-order terms, version 2",
    );
  });

  it("leaves a language without text out of what the API gets", () => {
    expect(toTitle({ en: " Terms ", de: "" })).toEqual({ en: "Terms" });
    expect(toTitle({ en: "Terms", de: "AGB" })).toEqual({
      en: "Terms",
      de: "AGB",
    });
    expect(toTitle({ en: "Terms", de: null })).toEqual({ en: "Terms" });
    expect(toContent({ en: "# Text\n", de: "  \n" })).toEqual({
      en: "# Text\n",
    });
    expect(toContent({ en: null, de: undefined })).toEqual({});
  });
});
