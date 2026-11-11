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
  EMPTY_PAGE,
  LEGAL_TYPES,
  groupByType,
  legalPageUrl,
  onlyLanguage,
  pageDefaults,
  pageSchema,
  previousVersion,
  toContent,
  toPageInput,
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
  publishedByAdmin: null,
  createdByAdmin: null,
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
    expect(groups.privacy).toHaveLength(1);
    // Every type has its group, also one nobody has written yet.
    expect(Object.keys(groups)).toEqual([...LEGAL_TYPES]);
    expect(groups.withdrawal).toEqual([]);
    expect(
      groupByType([version("imprint", 1, "published", true)]).imprint,
    ).toHaveLength(1);
  });

  it("knows which text accepted at checkout has no published version", () => {
    const terms = { type: "terms" as const, current: items[2]! };
    const privacy = { type: "privacy" as const, current: null };
    // A page that only informs is never among them, published or not.
    const imprint = { type: "imprint" as const, current: null };
    expect(
      unpublishedRequiredTypes([imprint, terms, privacy], ["terms", "privacy"]),
    ).toEqual(["privacy"]);
    expect(unpublishedRequiredTypes([], ["terms", "privacy"])).toEqual([
      "terms",
      "privacy",
    ]);
    expect(
      unpublishedRequiredTypes(
        [imprint, terms, { ...privacy, current: items[0]! }],
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
    expect(versionName({ type: "privacy", version: 2 })).toBe(
      "Privacy policy, version 2",
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

  it("knows a text that is written in one language only", () => {
    expect(onlyLanguage({ en: "Text", de: "" })).toBe("en");
    expect(onlyLanguage({ en: "  ", de: "Text" })).toBe("de");
    expect(onlyLanguage({ en: "Text", de: "Text" })).toBeNull();
    expect(onlyLanguage({})).toBeNull();
  });
});

describe("the page of a legal text", () => {
  const page = {
    slug: { en: "delivery", de: "versand" },
    defaultSlug: { en: "shipping", de: "versand" },
    seo: { title: { de: "Versand | Radhe Foods" }, description: null },
  };

  it("builds the link the way the website routes its legal pages", () => {
    expect(legalPageUrl("en", "terms")).toBe(
      "http://localhost:3001/en/legal/terms",
    );
    expect(legalPageUrl("de", "agb")).toBe(
      "http://localhost:3001/de/rechtliches/agb",
    );
  });

  it("shows an address that is the default as an empty field", () => {
    expect(pageDefaults(page)).toEqual({
      slug: { en: "delivery", de: "" },
      seoTitle: { en: "", de: "Versand | Radhe Foods" },
      seoDescription: { en: "", de: "" },
    });
  });

  it("sends everything the page keeps, and leaves out what is empty", () => {
    expect(toPageInput(pageDefaults(page))).toEqual({
      slug: { en: "delivery" },
      seo: { title: { de: "Versand | Radhe Foods" } },
    });
    expect(toPageInput(EMPTY_PAGE)).toEqual({});
    expect(
      toPageInput({
        slug: { en: " a ", de: "b" },
        seoTitle: { en: "", de: "" },
        seoDescription: { en: "How we deliver.", de: "" },
      }),
    ).toEqual({
      slug: { en: "a", de: "b" },
      seo: { description: { en: "How we deliver." } },
    });
  });

  it("takes lower-case letters, digits and single hyphens as an address", () => {
    const address = (en: string) =>
      pageSchema.safeParse({ ...EMPTY_PAGE, slug: { en, de: "" } }).success;
    expect(address("")).toBe(true);
    expect(address("refund-policy-2")).toBe(true);
    expect(address("Refund")).toBe(false);
    expect(address("refund--policy")).toBe(false);
    expect(address("-refund")).toBe(false);
    expect(address("rück")).toBe(false);
    expect(address("a".repeat(121))).toBe(false);
    expect(
      pageSchema.safeParse({
        ...EMPTY_PAGE,
        seoTitle: { en: "t".repeat(301), de: "" },
      }).success,
    ).toBe(false);
  });
});
