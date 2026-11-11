import { describe, expect, it } from "vitest";
import { followRows } from "./rows";

interface Row {
  variantId: string;
  size: string;
  price: string;
  removed?: boolean;
}

const row = (variantId: string, size: string, price: string): Row => ({
  variantId,
  size,
  price,
});
const idOf = (entry: Row) => entry.variantId;

describe("the rows of a form whose record changed underneath", () => {
  const small = row("a", "1 kg", "3.00");
  const large = row("b", "5 kg", "12.00");

  it("keeps a typed price with its pack size when a row is added before it", () => {
    // Typed for 1 kg; meanwhile another admin added 500 g, which sorts first.
    const typed = [{ ...small, price: "3.50" }, large];
    const added = row("z", "500 g", "1.80");
    expect(
      followRows({
        typed,
        previous: [small, large],
        next: [added, small, large],
        idOf,
      }),
    ).toEqual([added, { ...small, price: "3.50" }, large]);
  });

  it("gives an untouched row the record's new values", () => {
    const cheaper = { ...large, price: "11.00" };
    expect(
      followRows({
        typed: [{ ...small, price: "3.50" }, large],
        previous: [small, large],
        next: [small, cheaper],
        idOf,
      }),
    ).toEqual([{ ...small, price: "3.50" }, cheaper]);
  });

  it("keeps a row that is not saved yet, whole and at the end", () => {
    const fresh = row("", "10 kg", "22.00");
    expect(
      followRows({
        typed: [small, large, fresh],
        previous: [small, large],
        next: [small, { ...large, price: "11.00" }],
        idOf,
      }),
    ).toEqual([small, { ...large, price: "11.00" }, fresh]);
  });

  it("drops a row the record no longer has, also one that was changed here", () => {
    expect(
      followRows({
        typed: [
          { ...small, price: "3.50" },
          { ...large, removed: true },
        ],
        previous: [small, large],
        next: [large],
        idOf,
      }),
    ).toEqual([{ ...large, removed: true }]);
  });

  it("reads a row as untouched whatever the order of its keys", () => {
    const reordered: Row = { price: "3.00", size: "1 kg", variantId: "a" };
    const renamed = { ...small, size: "1000 g" };
    expect(
      followRows({
        typed: [reordered],
        previous: [small],
        next: [renamed],
        idOf,
      }),
    ).toEqual([renamed]);
  });
});
