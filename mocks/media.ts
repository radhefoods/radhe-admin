// Pictures in the mock: uploads are checked like the API checks them
// (format, size, dimensions; section 8) and kept in memory; products of the
// demo data get drawn placeholders.

import type { AdminImage } from "../src/lib/api/types/index.ts";
import type { Db } from "./db.ts";
import { fail, newId } from "./http.ts";
import { iso } from "./time.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const MIN_SIDE = 200;
const MAX_PIXELS = 40_000_000;

interface ReadImage {
  bytes: Uint8Array;
  type: string;
  width: number;
  height: number;
}

function u32be(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) |
      ((bytes[at + 1] ?? 0) << 16) |
      ((bytes[at + 2] ?? 0) << 8) |
      (bytes[at + 3] ?? 0)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.slice(at, at + length));
}

function sizeOf(
  bytes: Uint8Array,
): { type: string; width: number; height: number } | null {
  // PNG
  if (u32be(bytes, 0) === 0x89504e47) {
    return {
      type: "image/png",
      width: u32be(bytes, 16),
      height: u32be(bytes, 20),
    };
  }
  // JPEG: walk the segments to the start-of-frame marker.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] ?? 0;
      const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        return {
          type: "image/jpeg",
          height: ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0),
          width: ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0),
        };
      }
      at += 2 + length;
    }
    return null;
  }
  // WebP
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8 ") {
      return {
        type: "image/webp",
        width: (((bytes[27] ?? 0) << 8) | (bytes[26] ?? 0)) & 0x3fff,
        height: (((bytes[29] ?? 0) << 8) | (bytes[28] ?? 0)) & 0x3fff,
      };
    }
    if (chunk === "VP8L") {
      const b = [
        bytes[21] ?? 0,
        bytes[22] ?? 0,
        bytes[23] ?? 0,
        bytes[24] ?? 0,
      ];
      return {
        type: "image/webp",
        width: 1 + (((b[1]! & 0x3f) << 8) | b[0]!),
        height:
          1 + (((b[3]! & 0x0f) << 10) | (b[2]! << 2) | ((b[1]! & 0xc0) >> 6)),
      };
    }
    if (chunk === "VP8X") {
      return {
        type: "image/webp",
        width:
          1 +
          ((bytes[24] ?? 0) |
            ((bytes[25] ?? 0) << 8) |
            ((bytes[26] ?? 0) << 16)),
        height:
          1 +
          ((bytes[27] ?? 0) |
            ((bytes[28] ?? 0) << 8) |
            ((bytes[29] ?? 0) << 16)),
      };
    }
  }
  return null;
}

/** Checks one uploaded file the way the API does, with its error codes. */
export async function readImage(file: File): Promise<ReadImage> {
  if (file.size > MAX_BYTES) {
    throw fail(413, "FILE_TOO_LARGE", "The file is larger than 10 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const found = sizeOf(bytes);
  if (!found) {
    const looksLikeImage =
      /^image\//.test(file.type) ||
      /\.(gif|bmp|tiff?|svg|heic|avif)$/i.test(file.name);
    if (looksLikeImage) {
      throw fail(
        400,
        "IMAGE_FORMAT_NOT_ALLOWED",
        "Only JPEG, PNG and WebP images are accepted.",
        {
          accepted: ["jpeg", "png", "webp"],
        },
      );
    }
    throw fail(400, "IMAGE_INVALID", "The file is not an image.");
  }
  if (found.width < MIN_SIDE || found.height < MIN_SIDE) {
    throw fail(400, "IMAGE_DIMENSIONS_INVALID", "The image is too small.", {
      width: found.width,
      height: found.height,
      minimum: MIN_SIDE,
    });
  }
  if (found.width * found.height > MAX_PIXELS) {
    throw fail(
      400,
      "IMAGE_DIMENSIONS_INVALID",
      "The image has more than 40 megapixels.",
      {
        width: found.width,
        height: found.height,
        minimum: MIN_SIDE,
      },
    );
  }
  return { bytes, ...found };
}

function scaled(width: number, height: number, longest: number) {
  const factor = Math.min(1, longest / Math.max(width, height));
  return {
    width: Math.round(width * factor),
    height: Math.round(height * factor),
  };
}

/** Keeps the upload and describes it as the API describes a stored image. */
export function storeImage(db: Db, image: ReadImage, now: number): AdminImage {
  const key = newId(now);
  db.files.set(key, { bytes: image.bytes, type: image.type });
  const url = `${db.config.publicUrl}/media/upload/${key}`;
  return {
    id: newId(now),
    alt: { en: null, de: null },
    isPrimary: false,
    url,
    sizes: {
      small: { url, ...scaled(image.width, image.height, 320) },
      medium: { url, ...scaled(image.width, image.height, 800) },
      large: { url, ...scaled(image.width, image.height, 1600) },
    },
    bytes: image.bytes.byteLength,
    uploadedAt: iso(now),
  };
}

/** The files of one multipart field, or the documented errors. */
export async function uploadedFiles(
  request: Request,
  field: "file" | "files",
  maximum: number,
): Promise<File[]> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw fail(400, "IMAGE_REQUIRED", "No file was sent.");
  }
  const unexpected = [...form.keys()].filter((key) => key !== field);
  if (unexpected.length > 0) {
    throw fail(400, "BAD_REQUEST", `Unexpected field: ${unexpected[0]}`);
  }
  const files = form
    .getAll(field)
    .filter((entry): entry is File => entry instanceof File);
  if (files.length === 0)
    throw fail(400, "IMAGE_REQUIRED", "No file was sent.");
  if (files.length > maximum) {
    throw fail(400, "BAD_REQUEST", `At most ${maximum} files per request.`);
  }
  return files;
}

/** A drawn stand-in for a product photo: a soft ground and the initials. */
export function placeholderSvg(
  hue: number,
  size: number,
  label: string,
): string {
  const text = label.replace(/[<&>"]/g, "");
  // From the cleaned text: "Rice & Grains" must not put a bare "&" into the SVG.
  const initials = text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 400 400" role="img" aria-label="${text}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 62% 90%)"/><stop offset="1" stop-color="hsl(${(hue + 28) % 360} 58% 78%)"/></linearGradient></defs>
<rect width="400" height="400" fill="url(#g)"/>
<circle cx="200" cy="184" r="96" fill="hsl(${hue} 55% 97% / 0.75)"/>
<text x="200" y="212" text-anchor="middle" font-family="Georgia, serif" font-size="84" fill="hsl(${hue} 48% 28%)">${initials}</text>
<text x="200" y="336" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="hsl(${hue} 40% 30%)">${text}</text>
</svg>`;
}
