import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { BANNER_RULES, IMAGE_RULES } from "@/lib/api/types";
import {
  formatBytes,
  hasAcceptedFormat,
  readImageSize,
  type SizeReader,
} from "@/features/catalogue/image-rules";

// What the API accepts as a banner picture (doc/BANNERS.md, 2): JPEG, PNG
// or WebP, at most 10 MB, wider than tall, at least 1200 × 300 px. The panel
// checks the same rules before it sends anything.

const { minWidthPx, minHeightPx, recommended } = BANNER_RULES;

/** The rules in one line, for the upload area. */
export const BANNER_RULES_TEXT = `${recommended.width} × ${recommended.height} px recommended; wider than tall and at least ${minWidthPx} × ${minHeightPx} px. JPEG, PNG or WebP, up to ${IMAGE_RULES.maxBytes / (1024 * 1024)} MB.`;

/** Why one file cannot be a banner, or `null` when the API will take it. */
export async function bannerProblem(
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
  if (width <= height) {
    return `${width} × ${height} px: a banner must be wider than tall.`;
  }
  if (width < minWidthPx || height < minHeightPx) {
    return `${width} × ${height} px: a banner needs at least ${minWidthPx} × ${minHeightPx} px.`;
  }
  return null;
}

export interface BannerUploadFailure {
  title: string;
  detail: string | null;
}

/**
 * What to say when the API refuses the picture of a banner. Every
 * documented code of the banner endpoints has its sentence; the numbers of
 * `details` are named.
 */
export function bannerUploadFailure(error: unknown): BannerUploadFailure {
  if (hasErrorCode(error, "UPLOAD_ABORTED")) {
    return { title: "The upload was stopped", detail: "Nothing was stored." };
  }
  if (hasErrorCode(error, "IMAGE_REQUIRED")) {
    return {
      title: "No picture arrived at the API",
      detail: "Choose the file again.",
    };
  }
  if (hasErrorCode(error, "BANNER_LIMIT_REACHED")) {
    const maximum = error.details?.maximum ?? BANNER_RULES.maxBanners;
    return {
      title: `The shop holds ${maximum} banners at most`,
      detail: "Delete a banner first. Nothing was stored.",
    };
  }
  if (hasErrorCode(error, "IMAGE_FORMAT_NOT_ALLOWED")) {
    return {
      title: "The file has a format the API does not accept",
      detail: "Accepted: JPEG, PNG, WEBP. Nothing was stored.",
    };
  }
  if (hasErrorCode(error, "IMAGE_DIMENSIONS_INVALID")) {
    const d = error.details;
    const measured =
      d && typeof d.width === "number"
        ? `It has ${d.width} × ${d.height} px. `
        : "";
    if (d?.landscape) {
      return {
        title: "The picture is not wider than tall",
        detail: `${measured}A banner is a wide picture: ${recommended.width} × ${recommended.height} px is recommended. Nothing was stored.`,
      };
    }
    return {
      title: "The picture is too small for a banner",
      detail: `${measured}It needs at least ${d?.minimum ?? minWidthPx} × ${d?.minimumHeight ?? minHeightPx} px; ${recommended.width} × ${recommended.height} px is recommended. Nothing was stored.`,
    };
  }
  if (hasErrorCode(error, "IMAGE_INVALID")) {
    return {
      title: "The file is not a picture the API can read",
      detail: "Save it again as JPEG, PNG or WebP and try once more.",
    };
  }
  if (hasErrorCode(error, "FILE_TOO_LARGE")) {
    return {
      title: `The file is larger than ${formatBytes(IMAGE_RULES.maxBytes)}`,
      detail: "Make it smaller and try again.",
    };
  }
  if (hasErrorCode(error, "STORAGE_UNAVAILABLE")) {
    return {
      title: "The picture storage is not available at the moment",
      detail: "Nothing was stored. Try again shortly.",
    };
  }
  if (hasErrorCode(error, "BANNER_NOT_FOUND")) {
    return {
      title: "This banner does not exist any more",
      detail: "Someone deleted it in the meantime. The list was loaded again.",
    };
  }
  return { title: errorMessage(error), detail: null };
}
