import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { IMAGE_RULES } from "@/lib/api/types";
import { plural } from "@/lib/format/names";

// What the API accepts as a picture (documentation, 7 and 8): JPEG, PNG or
// WebP, at most 10 MB, at least 200 px on each side, at most 40 megapixels;
// at most 10 files per request and 12 pictures per product. The panel
// checks the same rules before it sends anything, so that the admin learns
// about every unusable file at once and not one refusal at a time.

/** Above this the API refuses a picture (documentation, 8: upload). */
export const MAX_PIXELS = 40_000_000;

export const IMAGE_ACCEPT = IMAGE_RULES.acceptedTypes.join(",");

/** The rules in one line, for the upload area. */
export const IMAGE_RULES_TEXT = `JPEG, PNG or WebP, up to ${
  IMAGE_RULES.maxBytes / (1024 * 1024)
} MB, at least ${IMAGE_RULES.minSidePx} px on each side.`;

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * Reads the size of a picture. `null`: the file is not a picture that can
 * be read. `"unknown"`: this environment cannot look inside a file; the API
 * checks it.
 */
export type SizeReader = (file: File) => Promise<PixelSize | null | "unknown">;

export const readImageSize: SizeReader = async (file) => {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return null;
    }
  }
  if (
    typeof Image === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return "unknown";
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<PixelSize | null>((resolve) => {
      const image = new Image();
      image.onload = () =>
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** `184 KB`, `2.4 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
}

const EXTENSION = /\.(jpe?g|png|webp)$/i;

function hasAcceptedFormat(file: File): boolean {
  if ((IMAGE_RULES.acceptedTypes as readonly string[]).includes(file.type)) {
    return true;
  }
  // Some systems hand over a file without a type: the name decides then,
  // and the API has the last word.
  return file.type === "" && EXTENSION.test(file.name);
}

/** Why one file cannot be uploaded, or `null` when the API will take it. */
export async function imageProblem(
  file: File,
  readSize: SizeReader = readImageSize,
): Promise<string | null> {
  if (!hasAcceptedFormat(file)) {
    return "Not a JPEG, PNG or WebP picture.";
  }
  if (file.size > IMAGE_RULES.maxBytes) {
    return `${formatBytes(file.size)}: larger than ${formatBytes(IMAGE_RULES.maxBytes)}.`;
  }
  const size = await readSize(file);
  if (size === "unknown") return null;
  if (size === null) return "The file cannot be read as a picture.";
  const { width, height } = size;
  if (width < IMAGE_RULES.minSidePx || height < IMAGE_RULES.minSidePx) {
    return `${width} × ${height} px: each side needs at least ${IMAGE_RULES.minSidePx} px.`;
  }
  if (width * height > MAX_PIXELS) {
    return `${width} × ${height} px: more than 40 megapixels.`;
  }
  return null;
}

export interface FileCheck {
  /** The files the API will take. */
  accepted: File[];
  /** One entry per file that breaks a rule. */
  refused: { name: string; problem: string }[];
  /**
   * The selection as a whole cannot be sent (nothing chosen, too many for
   * one request, more than the product has room for).
   */
  blocked: string | null;
}

/**
 * Checks a selection of files against the rules of the API before the
 * upload. `existing` is how many pictures the product has already.
 */
export async function checkImageFiles(
  files: readonly File[],
  options: { existing: number; readSize?: SizeReader },
): Promise<FileCheck> {
  const { existing, readSize = readImageSize } = options;
  const refused: FileCheck["refused"] = [];
  const accepted: File[] = [];
  for (const file of files) {
    const problem = await imageProblem(file, readSize);
    if (problem) refused.push({ name: file.name, problem });
    else accepted.push(file);
  }

  const remaining = Math.max(0, IMAGE_RULES.maxImagesPerProduct - existing);
  let blocked: string | null = null;
  if (files.length === 0) {
    blocked = "Choose a picture first.";
  } else if (remaining === 0) {
    blocked = `The product has ${IMAGE_RULES.maxImagesPerProduct} pictures already, which is the most it can hold. Delete one first.`;
  } else if (accepted.length > remaining) {
    blocked = `There is room for ${plural(remaining, "more picture")}, and you chose ${accepted.length}. A product holds ${IMAGE_RULES.maxImagesPerProduct} at most.`;
  } else if (accepted.length > IMAGE_RULES.maxFilesPerRequest) {
    blocked = `At most ${IMAGE_RULES.maxFilesPerRequest} pictures can be uploaded at once, and you chose ${accepted.length}. Add the rest in a second step.`;
  }
  return { accepted, refused, blocked };
}

/** How many more pictures a product can take. */
export function remainingImages(existing: number): number {
  return Math.max(0, IMAGE_RULES.maxImagesPerProduct - existing);
}

export interface UploadFailure {
  title: string;
  /** What to do about it, or what the API said in numbers. */
  detail: string | null;
  /** Every file the API refused, each with its reason (`details.files`). */
  refused?: { name: string; problem: string }[];
}

interface RefusedFile {
  name: string;
  code: string;
  bytes?: number;
  width?: number;
  height?: number;
}

/** The reason of one refused file, from its code and numbers. */
function refusedProblem(file: RefusedFile): string {
  switch (file.code) {
    case "IMAGE_FORMAT_NOT_ALLOWED":
      return "Not a JPEG, PNG or WebP picture.";
    case "IMAGE_DIMENSIONS_INVALID":
      return typeof file.width === "number" && typeof file.height === "number"
        ? `${file.width} × ${file.height} px: each side needs at least ${IMAGE_RULES.minSidePx} px, and at most 40 megapixels.`
        : `Each side needs at least ${IMAGE_RULES.minSidePx} px, and at most 40 megapixels.`;
    case "IMAGE_INVALID":
      return "The file cannot be read as a picture.";
    case "FILE_TOO_LARGE":
      return `${typeof file.bytes === "number" ? `${formatBytes(file.bytes)}: ` : ""}larger than ${formatBytes(IMAGE_RULES.maxBytes)}.`;
    default:
      return humanizeCode(file.code);
  }
}

const humanizeCode = (code: string) =>
  code
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

/** The refused files the API names (`details.files`, 8), when it does. */
function refusedFiles(error: unknown): UploadFailure["refused"] {
  const details = (error as { details?: { files?: unknown } } | null)?.details;
  const files = details?.files;
  if (!Array.isArray(files)) return undefined;
  const refused = files
    .filter(
      (file): file is RefusedFile =>
        typeof file === "object" &&
        file !== null &&
        typeof (file as RefusedFile).name === "string" &&
        typeof (file as RefusedFile).code === "string",
    )
    .map((file) => ({ name: file.name, problem: refusedProblem(file) }));
  return refused.length > 0 ? refused : undefined;
}

/**
 * What to say when the API refuses an upload. Every documented code of the
 * image endpoints has its sentence; the numbers of `details` are named.
 * `count` is the number of files that were sent: with more than one, the
 * admin is told that none of them was stored.
 */
export function uploadFailure(error: unknown, count: number): UploadFailure {
  const nothingStored =
    count > 1
      ? "None of the pictures was stored: an upload is all or nothing."
      : null;
  const refused = refusedFiles(error);
  if (refused && refused.length > 1) {
    return {
      title: `${refused.length} files cannot be uploaded`,
      detail: nothingStored ?? "Nothing was stored.",
      refused,
    };
  }

  if (hasErrorCode(error, "UPLOAD_ABORTED")) {
    return { title: "The upload was stopped", detail: "Nothing was stored." };
  }
  if (hasErrorCode(error, "IMAGE_REQUIRED")) {
    return {
      title: "No picture arrived at the API",
      detail: "Choose the files again.",
    };
  }
  if (hasErrorCode(error, "IMAGE_LIMIT_REACHED")) {
    const details = error.details as
      { maximum?: number; remaining?: number } | undefined;
    const remaining = details?.remaining;
    return {
      title: `A product holds ${details?.maximum ?? IMAGE_RULES.maxImagesPerProduct} pictures at most`,
      detail:
        typeof remaining === "number"
          ? remaining > 0
            ? `There is room for ${plural(remaining, "more picture")}. Nothing was stored: choose fewer files.`
            : "There is no room left. Delete a picture first."
          : nothingStored,
    };
  }
  if (hasErrorCode(error, "IMAGE_FORMAT_NOT_ALLOWED")) {
    const accepted = (error.details as { accepted?: string[] } | undefined)
      ?.accepted;
    const formats =
      Array.isArray(accepted) && accepted.length > 0
        ? accepted.map((format) => format.toUpperCase()).join(", ")
        : "JPEG, PNG, WEBP";
    return {
      title: "One file has a format the API does not accept",
      detail: [`Accepted: ${formats}.`, nothingStored]
        .filter(Boolean)
        .join(" "),
    };
  }
  if (hasErrorCode(error, "IMAGE_DIMENSIONS_INVALID")) {
    const details = error.details as
      { width?: number; height?: number; minimum?: number } | undefined;
    const minimum = details?.minimum ?? IMAGE_RULES.minSidePx;
    const measured =
      typeof details?.width === "number" && typeof details.height === "number"
        ? `It has ${details.width} × ${details.height} px. `
        : "";
    return {
      title: "One picture has a size the API does not accept",
      detail: [
        `${measured}Each side needs at least ${minimum} px, and a picture may have 40 megapixels at most.`,
        nothingStored,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  if (hasErrorCode(error, "IMAGE_INVALID")) {
    return {
      title: "One file is not a picture the API can read",
      detail:
        nothingStored ??
        "Save it again as JPEG, PNG or WebP and try once more.",
    };
  }
  if (hasErrorCode(error, "FILE_TOO_LARGE")) {
    return {
      title: `One file is larger than ${formatBytes(IMAGE_RULES.maxBytes)}`,
      detail: nothingStored ?? "Make it smaller and try again.",
    };
  }
  if (hasErrorCode(error, "STORAGE_UNAVAILABLE")) {
    return {
      title: "The picture storage is not available at the moment",
      detail: "Nothing was stored. Try again shortly.",
    };
  }
  if (hasErrorCode(error, "BAD_REQUEST")) {
    return {
      title: "The API did not accept the upload",
      detail: `At most ${IMAGE_RULES.maxFilesPerRequest} pictures can be sent at once. Nothing was stored.`,
    };
  }
  return { title: errorMessage(error), detail: nothingStored };
}
