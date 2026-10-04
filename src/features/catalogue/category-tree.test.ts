import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Category } from "@/lib/api/types";
import {
  categoryDefaults,
  categoryErrorField,
  categorySchema,
  toCategoryInput,
  toCategoryPatch,
} from "./category-schema";
import {
  buildTree,
  categoryPath,
  depthBelow,
  descendantIds,
  flattenTree,
  indentedName,
  moveItem,
  parentChoices,
  reorderSiblings,
  siblingsOf,
} from "./category-tree";

const id = (n: number) => n.toString(16).padStart(24, "0");

function category(
  n: number,
  name: string,
  parent: number | null,
  level: 1 | 2 | 3,
  overrides: Partial<Category> = {},
): Category {
  return {
    id: id(n),
    name: { en: name, de: null },
    slug: { en: name.toLowerCase().replace(/\s+/g, "-") },
    tagline: null,
    description: null,
    parentId: parent === null ? null : id(parent),
    ancestorIds: [],
    level,
    sortOrder: 0,
    isVisible: true,
    image: null,
    productCount: 0,
    seo: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

// The flat list as the API returns it: each parent followed by its children.
const flat: Category[] = [
  category(1, "Rice", null, 1),
  category(2, "Basmati", 1, 2),
  category(3, "Aged Basmati", 2, 3),
  category(4, "Everyday Rice", 1, 2),
  category(5, "Flour", null, 1),
  category(6, "Atta", 5, 2),
  category(7, "Pulses", null, 1, { isVisible: false }),
];
const names = (list: Category[]) => list.map((entry) => entry.name.en);

describe("the tree of the flat list", () => {
  it("puts every category under its parent and keeps the order", () => {
    const tree = buildTree(flat);
    expect(tree.map((node) => node.category.name.en)).toEqual([
      "Rice",
      "Flour",
      "Pulses",
    ]);
    expect(tree[0]?.children.map((node) => node.category.name.en)).toEqual([
      "Basmati",
      "Everyday Rice",
    ]);
    expect(tree[0]?.children[0]?.children[0]?.category.name.en).toBe(
      "Aged Basmati",
    );
    expect(flattenTree(tree)).toEqual(flat);
  });

  it("shows a category whose parent is missing at the top instead of losing it", () => {
    const orphan = category(9, "Orphan", 99, 2);
    expect(buildTree([...flat, orphan]).at(-1)?.category.name.en).toBe(
      "Orphan",
    );
  });

  it("knows the children, everything below, and how deep it goes", () => {
    expect(names(siblingsOf(flat, null))).toEqual(["Rice", "Flour", "Pulses"]);
    expect(names(siblingsOf(flat, id(1)))).toEqual([
      "Basmati",
      "Everyday Rice",
    ]);
    expect([...descendantIds(flat, id(1))]).toEqual([
      id(1),
      id(2),
      id(3),
      id(4),
    ]);
    expect([...descendantIds(flat, id(7))]).toEqual([id(7)]);
    expect(depthBelow(flat, id(1))).toBe(2);
    expect(depthBelow(flat, id(5))).toBe(1);
    expect(depthBelow(flat, id(7))).toBe(0);
  });

  it("names a category with its way down the tree", () => {
    expect(categoryPath(flat, id(3))).toBe("Rice › Basmati › Aged Basmati");
    expect(categoryPath(flat, id(5))).toBe("Flour");
    expect(categoryPath(flat, id(99))).toBe("");
    expect(indentedName(flat[0] as Category)).toBe("Rice");
    expect(indentedName(flat[2] as Category).trim()).toBe("Aged Basmati");
    expect(indentedName(flat[2] as Category).startsWith(" ")).toBe(true);
    expect(indentedName(flat[6] as Category)).toBe("Pulses (hidden)");
  });
});

describe("the parents a category can have (three levels at most)", () => {
  it("offers every category of the first two levels to a new one", () => {
    expect(names(parentChoices(flat))).toEqual([
      "Rice",
      "Basmati",
      "Everyday Rice",
      "Flour",
      "Atta",
      "Pulses",
    ]);
  });

  it("never offers the category itself or anything below it", () => {
    const choices = names(parentChoices(flat, flat[1]));
    expect(choices).not.toContain("Basmati");
    expect(choices).not.toContain("Aged Basmati");
  });

  it("offers only parents that keep its sub-categories within the third level", () => {
    // Basmati has one level below it: it fits under a main category only.
    expect(names(parentChoices(flat, flat[1]))).toEqual([
      "Rice",
      "Flour",
      "Pulses",
    ]);
    // Rice has two levels below it: it can only be a main category.
    expect(parentChoices(flat, flat[0])).toEqual([]);
    // A leaf fits under every category of the first two levels but itself.
    expect(names(parentChoices(flat, flat[5]))).toEqual([
      "Rice",
      "Basmati",
      "Everyday Rice",
      "Flour",
      "Pulses",
    ]);
  });
});

describe("a new order for the categories of one parent", () => {
  it("moves a main category with everything below it", () => {
    const next = reorderSiblings(flat, null, [id(5), id(7), id(1)]);
    expect(names(next)).toEqual([
      "Flour",
      "Atta",
      "Pulses",
      "Rice",
      "Basmati",
      "Aged Basmati",
      "Everyday Rice",
    ]);
    expect(next.find((entry) => entry.id === id(1))?.sortOrder).toBe(2);
    expect(next.find((entry) => entry.id === id(5))?.sortOrder).toBe(0);
  });

  it("reorders sub-categories without touching the rest", () => {
    const next = reorderSiblings(flat, id(1), [id(4), id(2)]);
    expect(names(next)).toEqual([
      "Rice",
      "Everyday Rice",
      "Basmati",
      "Aged Basmati",
      "Flour",
      "Atta",
      "Pulses",
    ]);
  });

  it("leaves the list alone when the ids are not exactly the children of the parent", () => {
    expect(reorderSiblings(flat, null, [id(5), id(1)])).toEqual(flat);
    expect(reorderSiblings(flat, null, [id(5), id(1), id(2)])).toEqual(flat);
    expect(reorderSiblings(flat, null, [id(5), id(5), id(1)])).toEqual(flat);
  });

  it("moves one entry of a list", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 3)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], -1, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("the form of a category (documentation, 7)", () => {
  const rice = category(1, "Rice", null, 1, {
    name: { en: "Rice", de: "Reis" },
    slug: { en: "rice", de: "reis" },
    tagline: { en: "Long grain and more" },
    seo: { title: { en: "Rice online" }, description: null },
  });

  it("requires the English name and keeps the address to the slug pattern", () => {
    const empty = categorySchema.safeParse(categoryDefaults());
    expect(empty.success).toBe(false);
    const ok = { ...categoryDefaults(), name: { en: "Snacks", de: "" } };
    expect(categorySchema.safeParse(ok).success).toBe(true);
    expect(
      categorySchema.safeParse({
        ...ok,
        slug: { en: "Snacks & Sweets", de: "" },
      }).success,
    ).toBe(false);
    expect(
      categorySchema.safeParse({
        ...ok,
        tagline: { en: "x".repeat(301), de: "" },
      }).success,
    ).toBe(false);
  });

  it("starts a sub-category under its parent", () => {
    expect(categoryDefaults(undefined, id(1)).parentId).toBe(id(1));
    expect(categoryDefaults().parentId).toBe("");
    expect(categoryDefaults(flat[1]).parentId).toBe(id(1));
  });

  it("sends a new category without what is empty", () => {
    expect(
      toCategoryInput({
        ...categoryDefaults(),
        name: { en: " Snacks ", de: "" },
      }),
    ).toEqual({ name: { en: "Snacks", de: null }, isVisible: true });
    expect(
      toCategoryInput({
        ...categoryDefaults(undefined, id(5)),
        name: { en: "Besan", de: "Kichererbsenmehl" },
        slug: { en: "besan", de: "" },
        tagline: { en: "Gram flour", de: "" },
        isVisible: false,
        seo: {
          title: { en: "", de: "" },
          description: { en: "Buy besan", de: "" },
        },
      }),
    ).toEqual({
      name: { en: "Besan", de: "Kichererbsenmehl" },
      slug: { en: "besan" },
      tagline: { en: "Gram flour", de: null },
      parentId: id(5),
      isVisible: false,
      seo: { description: { en: "Buy besan", de: null } },
    });
  });

  it("sends only what changed, with translated objects whole", () => {
    const form = categoryDefaults(rice);
    expect(toCategoryPatch(form, rice)).toEqual({});
    expect(toCategoryPatch({ ...form, isVisible: false }, rice)).toEqual({
      isVisible: false,
    });
    expect(
      toCategoryPatch({ ...form, name: { en: "Rice", de: "" } }, rice),
    ).toEqual({
      name: { en: "Rice", de: null },
    });
    expect(
      toCategoryPatch({ ...form, tagline: { en: "", de: "" } }, rice),
    ).toEqual({
      tagline: { en: null, de: null },
    });
    expect(
      toCategoryPatch(
        {
          ...form,
          seo: { ...form.seo, description: { en: "All rice", de: "" } },
        },
        rice,
      ),
    ).toEqual({
      seo: {
        title: { en: "Rice online", de: null },
        description: { en: "All rice", de: null },
      },
    });
  });

  it("moves a category by sending its new parent, or null for the top", () => {
    const basmati = flat[1] as Category;
    const form = categoryDefaults(basmati);
    expect(toCategoryPatch({ ...form, parentId: id(5) }, basmati)).toEqual({
      parentId: id(5),
    });
    expect(toCategoryPatch({ ...form, parentId: "" }, basmati)).toEqual({
      parentId: null,
    });
  });

  it("puts the API's refusals at the field they belong to", () => {
    const error = (code: string, status = 400) =>
      new ApiError({ status, code, message: "refused" });
    expect(categoryErrorField(error("CATEGORY_PARENT_INVALID"))).toBe(
      "parentId",
    );
    expect(categoryErrorField(error("CATEGORY_TOO_DEEP"))).toBe("parentId");
    expect(categoryErrorField(error("CATEGORY_SLUG_TAKEN", 409))).toBe(
      "slug.en",
    );
    expect(categoryErrorField(error("CATEGORY_NOT_FOUND", 404))).toBeNull();
  });
});
