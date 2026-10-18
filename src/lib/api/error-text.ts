import { formatMoney } from "@/lib/format/money";
import { humanize } from "@/lib/status";
import {
  hasErrorCode,
  isApiError,
  isUnexpectedError,
  type ErrorCode,
} from "./errors";

/**
 * What the panel says for each error code. The API's own `message` is
 * English for developers and is shown, with the request id, only for errors
 * nobody expected.
 */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  // the panel's own
  NETWORK_ERROR:
    "The API could not be reached. Check the connection and try again.",
  UNEXPECTED_RESPONSE: "The API gave an answer the panel does not understand.",
  UPLOAD_ABORTED: "The upload was stopped.",
  // generic
  VALIDATION_FAILED: "Some values are not valid. Check the marked fields.",
  BAD_REQUEST: "The request was not accepted.",
  NOT_FOUND: "This does not exist (any more).",
  CONFLICT: "This collides with the current state. Reload and try again.",
  FORBIDDEN: "This is not allowed.",
  ORIGIN_NOT_ALLOWED:
    "The API does not accept changes from this address. The panel's address must be listed in the API's CORS_ORIGINS.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  INTERNAL_ERROR: "Something went wrong on the server.",
  SERVICE_UNAVAILABLE: "The API is not available at the moment.",
  // session
  AUTH_TOKEN_INVALID: "You are signed out. Sign in again.",
  AUTH_REFRESH_INVALID: "Your session has ended. Sign in again.",
  AUTH_SESSION_REVOKED:
    "Your session was ended: signed out elsewhere, or your account changed. Sign in again.",
  ADMIN_CREDENTIALS_INVALID: "Email or password is not correct.",
  ADMIN_ACCOUNT_LOCKED:
    "Too many wrong attempts. The account is locked for a while.",
  ADMIN_ACCOUNT_DISABLED: "This account is disabled.",
  ADMIN_MFA_TOKEN_INVALID:
    "The sign-in took too long. Start again with email and password.",
  ADMIN_MFA_CODE_INVALID:
    "The code is not correct, or was used already. Wait for the next code.",
  ADMIN_MFA_SETUP_REQUIRED: "The authenticator has to be set up first.",
  ADMIN_PASSWORD_CHANGE_REQUIRED: "Set your own password before anything else.",
  ADMIN_PERMISSION_DENIED: "Your role does not allow this.",
  // admin users and roles
  ADMIN_NOT_FOUND: "This admin does not exist (any more).",
  ADMIN_EMAIL_TAKEN: "An admin with this email exists already.",
  ADMIN_SELF_MODIFICATION:
    "You cannot change your own role or status, and one active super admin must remain.",
  ROLE_NOT_FOUND: "This role does not exist (any more).",
  ROLE_KEY_TAKEN: "A role with this key exists already.",
  ROLE_IN_USE:
    "The role is still assigned to an admin. Give them another role first.",
  ROLE_IS_SYSTEM: "The super admin role cannot be changed or deleted.",
  ROLE_PERMISSION_UNKNOWN:
    "The role contains a permission the API does not know.",
  // customers
  CUSTOMER_NOT_FOUND: "This customer does not exist (any more).",
  // legal
  LEGAL_DOCUMENT_NOT_FOUND: "This legal text does not exist (any more).",
  LEGAL_DOCUMENT_PUBLISHED:
    "A published version can never change. Create a new version instead.",
  // categories
  CATEGORY_NOT_FOUND: "This category does not exist (any more).",
  CATEGORY_PARENT_INVALID:
    "This parent is not possible: it is missing, or it is the category itself or one below it.",
  CATEGORY_TOO_DEEP: "Categories go three levels deep at most.",
  CATEGORY_SLUG_TAKEN: "Another category already uses this address (slug).",
  CATEGORY_ORDER_INVALID:
    "The categories changed in the meantime. The list was loaded again.",
  CATEGORY_HAS_CHILDREN:
    "The category still has sub-categories. Move or delete them first.",
  CATEGORY_HAS_PRODUCTS:
    "The category still has products. Move them first, or hide the category instead.",
  // products, stock and images
  PRODUCT_NOT_FOUND: "This product does not exist (any more).",
  PRODUCT_PRICE_INVALID:
    "The sale price must be below the regular price, and a sale is given either as a price or as a percentage.",
  PRODUCT_QUANTITY_INVALID:
    "The largest order quantity must not be below the smallest.",
  PRODUCT_VARIANT_INVALID:
    "The pack sizes of a product are all of one unit family (weight, volume or pieces), no pack appears twice, and there are 20 at most.",
  PRODUCT_VARIANT_NOT_FOUND: "This pack size does not exist (any more).",
  PRODUCT_VARIANT_LAST:
    "A product needs at least one pack size. Disable it, or delete the product.",
  PRODUCT_VARIANT_IN_USE:
    "The pack size is part of an order and cannot be removed. Disable it instead.",
  PRODUCT_SKU_TAKEN: "Another product already has this article number (SKU).",
  PRODUCT_SLUG_TAKEN:
    "Another product already uses this address (slug), or the address of one of the pack sizes.",
  PRODUCT_IS_ACTIVE: "Archive the product before deleting it.",
  PRODUCT_IN_USE:
    "The product is part of an order and cannot be deleted. Archive it instead.",
  STOCK_CHANGE_INVALID:
    "Give either the counted number or the units to add or remove, not both.",
  STOCK_INSUFFICIENT: "More units would be removed than are in stock.",
  IMAGE_REQUIRED: "Choose a picture first.",
  IMAGE_INVALID: "The file is not a picture the API can read.",
  IMAGE_FORMAT_NOT_ALLOWED: "Only JPEG, PNG and WebP pictures are accepted.",
  IMAGE_DIMENSIONS_INVALID:
    "The picture is too small. Each side needs at least 200 pixels.",
  IMAGE_LIMIT_REACHED: "A product holds 12 pictures at most.",
  IMAGE_ORDER_INVALID:
    "The pictures changed in the meantime. The product was loaded again.",
  IMAGE_NOT_FOUND: "This picture does not exist (any more).",
  FILE_TOO_LARGE: "The file is too large. A picture may have 10 MB at most.",
  STORAGE_UNAVAILABLE:
    "The picture storage is not available at the moment. Try again shortly.",
  // orders
  ORDER_NOT_FOUND: "This order does not exist.",
  ORDER_ITEM_NOT_FOUND: "The order has no such pack size.",
  ORDER_QUANTITY_INVALID: "The quantity is outside of what is possible.",
  ORDER_TRANSITION_NOT_ALLOWED:
    "The order cannot take this step from where it is now.",
  ORDER_CANNOT_BE_CANCELLED:
    "The order can no longer be cancelled. After delivery, the way back is a return.",
  ORDER_CANNOT_BE_CHANGED: "The order can no longer be changed in its status.",
  ORDER_CHANGED_MEANWHILE:
    "The order changed in the meantime. It was loaded again: check and repeat.",
  // returns
  RETURN_NOT_FOUND: "This return does not exist.",
  RETURN_QUANTITY_INVALID: "The return quantities are not possible.",
  RETURN_TRANSITION_NOT_ALLOWED:
    "The return cannot take this step from where it is now.",
  // payments
  COMPANY_DETAILS_MISSING:
    "Invoices cannot be issued yet: the company details are incomplete.",
  PAYMENTS_NOT_CONFIGURED:
    "Online payment is not set up yet (Stripe is not connected). The shop cannot sell, and a refund through Stripe is not possible; refunds by hand work.",
  PAYMENT_PROVIDER_ERROR: "Stripe refused or failed. Try again shortly.",
  REFUND_NOT_FOUND: "This refund does not exist.",
  REFUND_AMOUNT_INVALID: "The amount is more than can be refunded.",
  REFUND_METHOD_INVALID: "This way of refunding is not possible for the order.",
  REFUND_TRANSITION_NOT_ALLOWED:
    "The refund cannot take this step. Stripe refunds complete through Stripe.",
  INVOICE_NOT_FOUND: "This document does not exist.",
  // notifications and announcements
  NOTIFICATION_NOT_FOUND: "This message does not exist.",
  NOTIFICATION_TRANSITION_NOT_ALLOWED:
    "This is not possible for the message in its status.",
  ANNOUNCEMENT_NOT_FOUND: "This announcement does not exist.",
  ANNOUNCEMENT_NO_RECIPIENTS: "No customer has asked for news yet.",
  MAIL_DELIVERY_FAILED: "The email could not be sent.",
  // banners
  BANNER_NOT_FOUND: "This banner does not exist (any more).",
  BANNER_LIMIT_REACHED: "The shop holds 20 banners at most. Delete one first.",
  BANNER_SCHEDULE_INVALID: "The end must come after the start.",
  BANNER_ORDER_INVALID:
    "The banners changed in the meantime. The list was loaded again.",
};

function list(values: readonly string[]): string {
  return values.map((value) => humanize(value).toLowerCase()).join(", ");
}

/** The sentence for an error, with the numbers of its `details` where they help. */
export function errorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return "Something went wrong in the panel. Reload the page and try again.";
  }

  if (hasErrorCode(error, "ADMIN_ACCOUNT_LOCKED")) {
    const seconds = error.details?.retryAfterSeconds;
    if (typeof seconds === "number" && seconds > 0) {
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      return `Too many wrong attempts. The account is locked for about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
  }
  if (hasErrorCode(error, "ADMIN_PERMISSION_DENIED")) {
    const required = error.details?.required;
    if (Array.isArray(required) && required.length > 0) {
      return `Your role does not allow this. It needs: ${required.join(", ")}.`;
    }
  }
  if (hasErrorCode(error, "ROLE_PERMISSION_UNKNOWN")) {
    const unknown = error.details?.unknown;
    if (Array.isArray(unknown) && unknown.length > 0) {
      return `The API does not know these permissions: ${unknown.join(", ")}.`;
    }
  }
  if (hasErrorCode(error, "IMAGE_DIMENSIONS_INVALID")) {
    const d = error.details;
    if (d && typeof d.width === "number") {
      if (d.landscape) {
        return `The picture must be wider than tall; it has ${d.width} × ${d.height} px.`;
      }
      if (typeof d.minimumHeight === "number") {
        return `The picture is too small (${d.width} × ${d.height} px). It needs at least ${d.minimum} × ${d.minimumHeight} px.`;
      }
      return `The picture is too small (${d.width} × ${d.height} px). Each side needs at least ${d.minimum} px.`;
    }
  }
  if (hasErrorCode(error, "BANNER_LIMIT_REACHED")) {
    const d = error.details;
    if (d && typeof d.maximum === "number") {
      return `The shop holds ${d.maximum} banners at most. Delete one first.`;
    }
  }
  if (hasErrorCode(error, "IMAGE_LIMIT_REACHED")) {
    const d = error.details;
    if (d && typeof d.remaining === "number") {
      return `A product holds ${d.maximum} pictures at most. There is room for ${d.remaining} more.`;
    }
  }
  if (hasErrorCode(error, "STOCK_INSUFFICIENT")) {
    const d = error.details;
    if (d && typeof d.available === "number") {
      return `Only ${d.available} unit${d.available === 1 ? " is" : "s are"} in stock; ${d.wanted} cannot be removed.`;
    }
  }
  if (hasErrorCode(error, "ORDER_TRANSITION_NOT_ALLOWED")) {
    const d = error.details;
    if (d && Array.isArray(d.allowed)) {
      if (d.from === "pending_payment") {
        return "The order waits for its payment. The payment confirms it; nothing can be set by hand.";
      }
      const possible =
        d.allowed.length > 0 ? list(d.allowed) : "nothing further";
      return `From "${humanize(String(d.from)).toLowerCase()}" this step is not possible. Possible: ${possible}.`;
    }
  }
  if (hasErrorCode(error, "ORDER_CANNOT_BE_CHANGED")) {
    const d = error.details;
    if (d && Array.isArray(d.allowedIn)) {
      return `Not possible while the order is "${humanize(String(d.status)).toLowerCase()}". Possible in: ${list(d.allowedIn)}.`;
    }
  }
  if (hasErrorCode(error, "ORDER_QUANTITY_INVALID")) {
    const d = error.details;
    if (d && typeof d.max === "number") {
      return `The delivered quantity must be between ${d.min} and ${d.max}.`;
    }
  }
  if (hasErrorCode(error, "COMPANY_DETAILS_MISSING")) {
    const missing = error.details?.missing;
    if (Array.isArray(missing) && missing.length > 0) {
      return `Invoices cannot be issued yet. Missing in the company settings: ${missing.join(", ")}.`;
    }
  }
  if (hasErrorCode(error, "REFUND_AMOUNT_INVALID")) {
    const d = error.details;
    if (d && typeof d.maximum === "number") {
      return `At most ${formatMoney(d.maximum)} can be refunded.`;
    }
  }

  return ERROR_TEXT[error.code];
}

export interface ErrorNotice {
  /** The sentence for the admin. */
  message: string;
  /** For unexpected errors: what the API said, for whoever looks into it. */
  technical: string | null;
  requestId: string | null;
}

/** Everything a toast or an alert needs to show an error (prompt, section 3). */
export function describeError(error: unknown): ErrorNotice {
  const message = errorMessage(error);
  if (!isApiError(error)) {
    return {
      message,
      technical: error instanceof Error ? error.message : null,
      requestId: null,
    };
  }
  const unexpected = isUnexpectedError(error);
  return {
    message,
    technical: unexpected ? `${error.rawCode}: ${error.message}` : null,
    requestId: unexpected ? error.requestId : null,
  };
}
