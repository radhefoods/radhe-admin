import type { Category, Id } from "@/lib/api/types";

// The API returns the categories as a flat list in display order: each
// parent is followed by its children, `level` and `parentId` give the tree
// (documentation, 7). Everything here is derived from that list.

/** Categories go three levels deep at most (`CATEGORY_TOO_DEEP`). */
export const MAX_CATEGORY_LEVEL = 3;

export interface CategoryNode {
  category: Category;
  children: CategoryNode[];
}

/** The tree of a flat list. Siblings keep the order they have in the list. */
export function buildTree(flat: readonly Category[]): CategoryNode[] {
  const nodes = new Map<Id, CategoryNode>();
  for (const category of flat)
    nodes.set(category.id, { category, children: [] });
  const roots: CategoryNode[] = [];
  for (const category of flat) {
    const node = nodes.get(category.id) as CategoryNode;
    const parent = category.parentId ? nodes.get(category.parentId) : undefined;
    // A category whose parent is missing from the list is shown at the top
    // rather than lost.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** The display order of a tree: each parent followed by its children. */
export function flattenTree(nodes: readonly CategoryNode[]): Category[] {
  return nodes.flatMap((node) => [
    node.category,
    ...flattenTree(node.children),
  ]);
}

/** The categories of one parent (`null`: the main categories), in order. */
export function siblingsOf(
  flat: readonly Category[],
  parentId: Id | null,
): Category[] {
  return flat.filter((category) => category.parentId === parentId);
}

/** A category and everything below it. */
export function descendantIds(flat: readonly Category[], id: Id): Set<Id> {
  const inside = new Set<Id>([id]);
  // The list is in display order, so a child always comes after its parent.
  for (const category of flat) {
    if (category.parentId && inside.has(category.parentId))
      inside.add(category.id);
  }
  return inside;
}

/** How many levels lie below a category: 0 when it has no sub-categories. */
export function depthBelow(flat: readonly Category[], id: Id): number {
  const children = siblingsOf(flat, id);
  if (children.length === 0) return 0;
  return 1 + Math.max(...children.map((child) => depthBelow(flat, child.id)));
}

/**
 * The parents a category can have: not itself, nothing below it, and no
 * parent that would push it or its sub-categories past the third level.
 * For a new category `moving` is left out.
 */
export function parentChoices(
  flat: readonly Category[],
  moving?: Category,
): Category[] {
  const below = moving ? depthBelow(flat, moving.id) : 0;
  const own = moving ? descendantIds(flat, moving.id) : new Set<Id>();
  return flat.filter(
    (category) =>
      !own.has(category.id) && category.level + 1 + below <= MAX_CATEGORY_LEVEL,
  );
}

const INDENT = "    ";

/** `Rice`, `    Basmati Rice`: the name, indented by its level, for a select. */
export function indentedName(category: Category): string {
  const hidden = category.isVisible ? "" : " (hidden)";
  return `${INDENT.repeat(category.level - 1)}${category.name.en}${hidden}`;
}

/** `Rice & Grains › Basmati Rice`. */
export function categoryPath(flat: readonly Category[], id: Id): string {
  const byId = new Map(flat.map((category) => [category.id, category]));
  const names: string[] = [];
  let current = byId.get(id);
  while (current && names.length < MAX_CATEGORY_LEVEL) {
    names.unshift(current.name.en);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(" › ");
}

/**
 * The flat list after the categories of one parent were put in a new order.
 * Returns the list unchanged when `orderedIds` is not exactly the children
 * of that parent (the API would answer `CATEGORY_ORDER_INVALID`).
 */
export function reorderSiblings(
  flat: readonly Category[],
  parentId: Id | null,
  orderedIds: readonly Id[],
): Category[] {
  const siblings = siblingsOf(flat, parentId);
  const known = new Set(siblings.map((category) => category.id));
  const exact =
    orderedIds.length === siblings.length &&
    new Set(orderedIds).size === orderedIds.length &&
    orderedIds.every((id) => known.has(id));
  if (!exact) return [...flat];

  const position = new Map(orderedIds.map((id, index) => [id, index]));
  const moved = flat.map((category) =>
    category.parentId === parentId
      ? {
          ...category,
          sortOrder: position.get(category.id) ?? category.sortOrder,
        }
      : category,
  );
  const tree = buildTree(moved);
  const reorder = (
    nodes: CategoryNode[],
    parent: Id | null,
  ): CategoryNode[] => {
    const ordered =
      parent === parentId
        ? [...nodes].sort(
            (a, b) =>
              (position.get(a.category.id) ?? 0) -
              (position.get(b.category.id) ?? 0),
          )
        : nodes;
    return ordered.map((node) => ({
      ...node,
      children: reorder(node.children, node.category.id),
    }));
  };
  return flattenTree(reorder(tree, null));
}

/** A list with one entry moved from one place to another. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length)
    return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
