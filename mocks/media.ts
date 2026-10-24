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

/** What a picture must measure: a side for products and categories (8), … */
export interface ImageRules {
  minSide?: number;
  /** … or a width and a height, for a banner (20) or the featured picture of a post (23). */
  minWidth?: number;
  minHeight?: number;
  /** The picture must be wider than tall (banners). */
  landscape?: boolean;
}

const PRODUCT_IMAGE: ImageRules = { minSide: MIN_SIDE };
export const BANNER_IMAGE: ImageRules = {
  minWidth: 1200,
  minHeight: 300,
  landscape: true,
};
/** The featured picture of a blog post (23): at least 800 × 400 px. */
export const BLOG_FEATURED_IMAGE: ImageRules = {
  minWidth: 800,
  minHeight: 400,
};
/** The widths a featured picture is stored in (23), never enlarged. */
export const BLOG_FEATURED_WIDTHS = {
  small: 480,
  medium: 1024,
  large: 1920,
} as const;

/** The widths a banner is stored in (20), never enlarged. */
export const BANNER_WIDTHS = {
  small: 768,
  medium: 1536,
  large: 2560,
} as const;

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
export async function readImage(
  file: File,
  rules: ImageRules = PRODUCT_IMAGE,
): Promise<ReadImage> {
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
  if (rules.minWidth !== undefined && rules.minHeight !== undefined) {
    if (rules.landscape && found.width <= found.height) {
      throw fail(
        400,
        "IMAGE_DIMENSIONS_INVALID",
        "The image must be wider than tall.",
        { width: found.width, height: found.height, landscape: true },
      );
    }
    if (found.width < rules.minWidth || found.height < rules.minHeight) {
      throw fail(400, "IMAGE_DIMENSIONS_INVALID", "The image is too small.", {
        width: found.width,
        height: found.height,
        minimum: rules.minWidth,
        minimumHeight: rules.minHeight,
      });
    }
  } else if (
    found.width < (rules.minSide ?? MIN_SIDE) ||
    found.height < (rules.minSide ?? MIN_SIDE)
  ) {
    throw fail(400, "IMAGE_DIMENSIONS_INVALID", "The image is too small.", {
      width: found.width,
      height: found.height,
      minimum: rules.minSide ?? MIN_SIDE,
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

function toWidth(width: number, height: number, wanted: number) {
  const factor = Math.min(1, wanted / width);
  return {
    width: Math.round(width * factor),
    height: Math.round(height * factor),
  };
}

/**
 * Keeps the upload and describes it as the API describes a stored image:
 * by the longest side for products and categories, by width for a banner.
 */
export function storeImage(
  db: Db,
  image: ReadImage,
  now: number,
  widths?: { small: number; medium: number; large: number },
): AdminImage {
  const key = newId(now);
  db.files.set(key, { bytes: image.bytes, type: image.type });
  const url = `${db.config.publicUrl}/media/upload/${key}`;
  const size = (longest: number, width: number) =>
    widths
      ? toWidth(image.width, image.height, width)
      : scaled(image.width, image.height, longest);
  return {
    id: newId(now),
    alt: { en: null, de: null },
    isPrimary: false,
    url,
    sizes: {
      small: { url, ...size(320, widths?.small ?? 0) },
      medium: { url, ...size(800, widths?.medium ?? 0) },
      large: { url, ...size(1600, widths?.large ?? 0) },
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

/** A drawn stand-in for a banner: a wide ground with the offer's words. */
export function bannerSvg(
  hue: number,
  width: number,
  height: number,
  label: string,
): string {
  const text = label.replace(/[<&>"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 500" role="img" aria-label="${text}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="hsl(${hue} 60% 30%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 65% 45%)"/></linearGradient></defs>
<rect width="1200" height="500" fill="url(#g)"/>
<circle cx="980" cy="250" r="170" fill="hsl(${hue} 70% 92% / 0.25)"/>
<text x="110" y="270" font-family="Georgia, serif" font-size="72" fill="hsl(${hue} 50% 97%)">${text}</text>
<text x="112" y="330" font-family="Segoe UI, Arial, sans-serif" font-size="28" fill="hsl(${hue} 50% 92%)">Radhe Foods · radhefoods.de</text>
</svg>`;
}
