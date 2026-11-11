import { describe, expect, it } from "vitest";
import type { AdminImage } from "@/lib/api/types";
import { copySteps } from "./copy-pictures";

function image(id: string, file: string): AdminImage {
  const url = `https://cdn.example/${file}/large.webp`;
  const size = { url, width: 800, height: 600 };
  return {
    id,
    alt: { en: null, de: null },
    isPrimary: false,
    url,
    sizes: { small: size, medium: size, large: size },
    bytes: 1000,
    uploadedAt: "2026-11-11T09:00:00.000Z",
  };
}

describe("the requests of a copy from other pack sizes", () => {
  const small = {
    id: "v-1kg",
    images: [image("a1", "front"), image("a2", "back")],
  };
  const large = {
    id: "v-10kg",
    images: [image("c1", "front"), image("c2", "side")],
  };

  it("sends one request per pack size, with the ticked pictures in their order", () => {
    expect(
      copySteps([small, large], new Set(), new Set(["a2", "a1", "c2"])),
    ).toEqual([
      { fromVariantId: "v-1kg", imageIds: ["a1", "a2"] },
      { fromVariantId: "v-10kg", imageIds: ["c2"] },
    ]);
  });

  it("leaves out a picture the pack size shows already", () => {
    const shown = new Set([small.images[0]!.url]);
    expect(
      copySteps([small, large], shown, new Set(["a1", "a2", "c1"])),
    ).toEqual([{ fromVariantId: "v-1kg", imageIds: ["a2"] }]);
  });

  it("copies a file ticked under two pack sizes once", () => {
    expect(copySteps([small, large], new Set(), new Set(["a1", "c1"]))).toEqual(
      [{ fromVariantId: "v-1kg", imageIds: ["a1"] }],
    );
  });

  it("sends nothing while nothing is ticked", () => {
    expect(copySteps([small, large], new Set(), new Set())).toEqual([]);
  });
});
