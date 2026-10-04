import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { IMAGE_RULES } from "@/lib/api/types";
import {
  MAX_PIXELS,
  checkImageFiles,
  formatBytes,
  imageProblem,
  remainingImages,
  uploadFailure,
  type SizeReader,
} from "./image-rules";

/** A file of a given size without holding its bytes. */
function file(name: string, type: string, bytes = 1000): File {
  const made = new File(["x"], name, { type });
  Object.defineProperty(made, "size", { value: bytes });
  return made;
}

const sized =
  (width: number, height: number): SizeReader =>
  async () => ({ width, height });
const fine = sized(1200, 900);

describe("one file against the rules of the API", () => {
  it("takes JPEG, PNG and WebP", async () => {
    for (const [name, type] of [
      ["a.jpg", "image/jpeg"],
      ["a.png", "image/png"],
      ["a.webp", "image/webp"],
    ] as const) {
      expect(await imageProblem(file(name, type), fine)).toBeNull();
    }
  });

  it("refuses other formats before anything is read", async () => {
    let read = false;
    const reader: SizeReader = async () => {
      read = true;
      return { width: 800, height: 800 };
    };
    expect(await imageProblem(file("a.gif", "image/gif"), reader)).toBe(
      "Not a JPEG, PNG or WebP picture.",
    );
    expect(
      await imageProblem(file("notes.pdf", "application/pdf"), reader),
    ).toBeDefined();
    expect(
      await imageProblem(file("a.svg", "image/svg+xml"), reader),
    ).not.toBeNull();
    expect(read).toBe(false);
  });

  it("goes by the name when the system gives no type", async () => {
    expect(await imageProblem(file("photo.JPEG", ""), fine)).toBeNull();
    expect(await imageProblem(file("photo.heic", ""), fine)).not.toBeNull();
  });

  it("refuses more than 10 MB", async () => {
    expect(
      await imageProblem(
        file("a.jpg", "image/jpeg", IMAGE_RULES.maxBytes),
        fine,
      ),
    ).toBeNull();
    expect(
      await imageProblem(
        file("a.jpg", "image/jpeg", IMAGE_RULES.maxBytes + 1),
        fine,
      ),
    ).toMatch(/larger than 10 MB/);
  });

  it("wants 200 px on each side and 40 megapixels at most", async () => {
    const jpeg = file("a.jpg", "image/jpeg");
    expect(await imageProblem(jpeg, sized(200, 200))).toBeNull();
    expect(await imageProblem(jpeg, sized(199, 800))).toBe(
      "199 × 800 px: each side needs at least 200 px.",
    );
    expect(await imageProblem(jpeg, sized(800, 150))).toMatch(/800 × 150 px/);
    expect(await imageProblem(jpeg, sized(8000, 5000))).toBeNull();
    expect(8000 * 5001).toBeGreaterThan(MAX_PIXELS);
    expect(await imageProblem(jpeg, sized(8000, 5001))).toMatch(
      /40 megapixels/,
    );
  });

  it("refuses a file that is no picture, and lets the API decide where it cannot look", async () => {
    const jpeg = file("a.jpg", "image/jpeg");
    expect(await imageProblem(jpeg, async () => null)).toBe(
      "The file cannot be read as a picture.",
    );
    expect(await imageProblem(jpeg, async () => "unknown")).toBeNull();
  });
});

describe("a selection of files", () => {
  const jpegs = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      file(`p${index}.jpg`, "image/jpeg"),
    );

  it("passes files that are fine", async () => {
    const check = await checkImageFiles(jpegs(3), {
      existing: 2,
      readSize: fine,
    });
    expect(check.accepted).toHaveLength(3);
    expect(check.refused).toEqual([]);
    expect(check.blocked).toBeNull();
  });

  it("names every file that breaks a rule, not only the first", async () => {
    const files = [
      file("ok.jpg", "image/jpeg"),
      file("anim.gif", "image/gif"),
      file("huge.png", "image/png", 11 * 1024 * 1024),
    ];
    const check = await checkImageFiles(files, { existing: 0, readSize: fine });
    expect(check.accepted.map((entry) => entry.name)).toEqual(["ok.jpg"]);
    expect(check.refused).toEqual([
      { name: "anim.gif", problem: "Not a JPEG, PNG or WebP picture." },
      { name: "huge.png", problem: "11 MB: larger than 10 MB." },
    ]);
    expect(check.blocked).toBeNull();
  });

  it("stops at 12 pictures per product and says how many still fit", async () => {
    expect(remainingImages(9)).toBe(3);
    expect(remainingImages(12)).toBe(0);
    expect(remainingImages(14)).toBe(0);
    const tooMany = await checkImageFiles(jpegs(4), {
      existing: 9,
      readSize: fine,
    });
    expect(tooMany.blocked).toBe(
      "There is room for 3 more pictures, and you chose 4. A product holds 12 at most.",
    );
    const full = await checkImageFiles(jpegs(1), {
      existing: 12,
      readSize: fine,
    });
    expect(full.blocked).toMatch(/has 12 pictures already/);
    const exact = await checkImageFiles(jpegs(3), {
      existing: 9,
      readSize: fine,
    });
    expect(exact.blocked).toBeNull();
  });

  it("stops at 10 files per request", async () => {
    const eleven = await checkImageFiles(jpegs(11), {
      existing: 0,
      readSize: fine,
    });
    expect(eleven.blocked).toMatch(
      /At most 10 pictures can be uploaded at once, and you chose 11/,
    );
    const ten = await checkImageFiles(jpegs(10), {
      existing: 0,
      readSize: fine,
    });
    expect(ten.blocked).toBeNull();
  });

  it("counts only the usable files against the limits", async () => {
    const files = [...jpegs(3), file("anim.gif", "image/gif")];
    const check = await checkImageFiles(files, { existing: 9, readSize: fine });
    expect(check.blocked).toBeNull();
    expect(check.accepted).toHaveLength(3);
    expect(check.refused).toHaveLength(1);
  });

  it("asks for a file when none was chosen", async () => {
    const none = await checkImageFiles([], { existing: 0, readSize: fine });
    expect(none.blocked).toBe("Choose a picture first.");
  });
});

describe("what the API refuses, in the panel's words", () => {
  const error = (code: string, status: number, details?: unknown) =>
    new ApiError({ status, code, message: "refused", details });

  it("says that nothing was stored when one of several files is refused", () => {
    const several = uploadFailure(
      error("IMAGE_FORMAT_NOT_ALLOWED", 400, {
        accepted: ["jpeg", "png", "webp"],
      }),
      3,
    );
    expect(several.title).toBe("One file has a format the API does not accept");
    expect(several.detail).toBe(
      "Accepted: JPEG, PNG, WEBP. None of the pictures was stored: an upload is all or nothing.",
    );
    const single = uploadFailure(
      error("IMAGE_FORMAT_NOT_ALLOWED", 400, {
        accepted: ["jpeg", "png", "webp"],
      }),
      1,
    );
    expect(single.detail).toBe("Accepted: JPEG, PNG, WEBP.");
  });

  it("names the measured size of a picture that is too small", () => {
    const notice = uploadFailure(
      error("IMAGE_DIMENSIONS_INVALID", 400, {
        width: 150,
        height: 600,
        minimum: 200,
      }),
      2,
    );
    expect(notice.detail).toContain("It has 150 × 600 px.");
    expect(notice.detail).toContain("at least 200 px");
    expect(notice.detail).toContain("None of the pictures was stored");
  });

  it("says how much room is left when the product is full", () => {
    expect(
      uploadFailure(
        error("IMAGE_LIMIT_REACHED", 400, { maximum: 12, remaining: 2 }),
        4,
      ),
    ).toEqual({
      title: "A product holds 12 pictures at most",
      detail:
        "There is room for 2 more pictures. Nothing was stored: choose fewer files.",
    });
    expect(
      uploadFailure(
        error("IMAGE_LIMIT_REACHED", 400, { maximum: 12, remaining: 0 }),
        1,
      ).detail,
    ).toBe("There is no room left. Delete a picture first.");
  });

  it("has a sentence for every documented code of the image endpoints", () => {
    const codes: [string, number][] = [
      ["IMAGE_REQUIRED", 400],
      ["IMAGE_LIMIT_REACHED", 400],
      ["IMAGE_FORMAT_NOT_ALLOWED", 400],
      ["IMAGE_DIMENSIONS_INVALID", 400],
      ["IMAGE_INVALID", 400],
      ["FILE_TOO_LARGE", 413],
      ["STORAGE_UNAVAILABLE", 503],
      ["BAD_REQUEST", 400],
    ];
    const titles = codes.map(
      ([code, status]) => uploadFailure(error(code, status), 2).title,
    );
    expect(new Set(titles).size).toBe(codes.length);
    for (const title of titles) expect(title.length).toBeGreaterThan(10);
    expect(uploadFailure(error("FILE_TOO_LARGE", 413), 1).title).toBe(
      "One file is larger than 10 MB",
    );
    expect(uploadFailure(error("BAD_REQUEST", 400), 11).detail).toMatch(
      /At most 10 pictures can be sent at once/,
    );
    expect(uploadFailure(error("STORAGE_UNAVAILABLE", 503), 1).detail).toMatch(
      /Nothing was stored/,
    );
  });

  it("tells a stopped upload from a failed one, and falls back to the general sentence", () => {
    expect(uploadFailure(error("UPLOAD_ABORTED", 0), 2)).toEqual({
      title: "The upload was stopped",
      detail: "Nothing was stored.",
    });
    expect(uploadFailure(error("PRODUCT_NOT_FOUND", 404), 1).title).toBe(
      "This product does not exist (any more).",
    );
    expect(uploadFailure(error("NETWORK_ERROR", 0), 2).detail).toMatch(
      /all or nothing/,
    );
  });
});

describe("file sizes in words", () => {
  it("prints bytes, kilobytes and megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(184320)).toBe("180 KB");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatBytes(-1)).toBe("—");
  });
});
