import type {
  Cents,
  CompanyMissingField,
  Id,
  OrderStatus,
  QuotationStatus,
  Refundable,
  RefundMethod,
  RefundStatus,
} from "./types";

/**
 * Every error code the admin API documents (section 17.3, without the codes
 * only the shop can receive). The API's `message` is English and written
 * for developers; the panel maps the `code` to its own sentence
 * (`error-text.ts`) and shows the `message` with the request id only for
 * errors nobody expected.
 */
export const API_ERROR_CODES = [
  // generic (0.3)
  "VALIDATION_FAILED",
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "FORBIDDEN",
  "ORIGIN_NOT_ALLOWED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
  // session (0.3, 1)
  "AUTH_TOKEN_INVALID",
  "AUTH_REFRESH_INVALID",
  "AUTH_SESSION_REVOKED",
  "ADMIN_CREDENTIALS_INVALID",
  "ADMIN_ACCOUNT_LOCKED",
  "ADMIN_ACCOUNT_DISABLED",
  "ADMIN_MFA_TOKEN_INVALID",
  "ADMIN_MFA_CODE_INVALID",
  "ADMIN_MFA_SETUP_REQUIRED",
  "ADMIN_PASSWORD_CHANGE_REQUIRED",
  "ADMIN_PERMISSION_DENIED",
  // admin users and roles (2, 3)
  "ADMIN_NOT_FOUND",
  "ADMIN_EMAIL_TAKEN",
  "ADMIN_SELF_MODIFICATION",
  "ROLE_NOT_FOUND",
  "ROLE_KEY_TAKEN",
  "ROLE_IN_USE",
  "ROLE_IS_SYSTEM",
  "ROLE_PERMISSION_UNKNOWN",
  // customers (4)
  "CUSTOMER_NOT_FOUND",
  // legal (6)
  "LEGAL_DOCUMENT_NOT_FOUND",
  "LEGAL_DOCUMENT_PUBLISHED",
  // categories (7)
  "CATEGORY_NOT_FOUND",
  "CATEGORY_PARENT_INVALID",
  "CATEGORY_TOO_DEEP",
  "CATEGORY_SLUG_TAKEN",
  "CATEGORY_ORDER_INVALID",
  "CATEGORY_PRODUCT_ORDER_INVALID",
  "CATEGORY_HAS_CHILDREN",
  "CATEGORY_HAS_PRODUCTS",
  // products, stock and images (8)
  "PRODUCT_NOT_FOUND",
  "PRODUCT_PRICE_INVALID",
  "PRODUCT_QUANTITY_INVALID",
  "PRODUCT_VARIANT_INVALID",
  "PRODUCT_VARIANT_NOT_FOUND",
  "PRODUCT_VARIANT_LAST",
  "PRODUCT_VARIANT_IN_USE",
  "PRODUCT_SKU_TAKEN",
  "PRODUCT_SLUG_TAKEN",
  "PRODUCT_IS_ACTIVE",
  "PRODUCT_IN_USE",
  "STOCK_CHANGE_INVALID",
  "STOCK_INSUFFICIENT",
  "IMAGE_REQUIRED",
  "IMAGE_INVALID",
  "IMAGE_FORMAT_NOT_ALLOWED",
  "IMAGE_DIMENSIONS_INVALID",
  "IMAGE_LIMIT_REACHED",
  "IMAGE_ORDER_INVALID",
  "IMAGE_NOT_FOUND",
  "FILE_TOO_LARGE",
  "STORAGE_UNAVAILABLE",
  // orders (9)
  "ORDER_NOT_FOUND",
  "ORDER_ITEM_NOT_FOUND",
  "ORDER_QUANTITY_INVALID",
  "ORDER_TRANSITION_NOT_ALLOWED",
  "ORDER_CANNOT_BE_CANCELLED",
  "ORDER_CANNOT_BE_CHANGED",
  "ORDER_CHANGED_MEANWHILE",
  // returns (10)
  "RETURN_NOT_FOUND",
  "RETURN_QUANTITY_INVALID",
  "RETURN_TRANSITION_NOT_ALLOWED",
  // payments, refunds, invoices (11, 12)
  "COMPANY_DETAILS_MISSING",
  "PAYMENTS_NOT_CONFIGURED",
  "PAYMENT_PROVIDER_ERROR",
  "REFUND_NOT_FOUND",
  "REFUND_AMOUNT_INVALID",
  "REFUND_METHOD_INVALID",
  "REFUND_TRANSITION_NOT_ALLOWED",
  "INVOICE_NOT_FOUND",
  // notifications and announcements (13, 14)
  "NOTIFICATION_NOT_FOUND",
  "NOTIFICATION_TRANSITION_NOT_ALLOWED",
  "ANNOUNCEMENT_NOT_FOUND",
  "ANNOUNCEMENT_NO_RECIPIENTS",
  "MAIL_DELIVERY_FAILED",
  // banners (20)
  "BANNER_NOT_FOUND",
  "BANNER_LIMIT_REACHED",
  "BANNER_SCHEDULE_INVALID",
  "BANNER_ORDER_INVALID",
  // analytics (21)
  "ANALYTICS_RANGE_INVALID",
  // FAQ (22)
  "FAQ_NOT_FOUND",
  "FAQ_GROUP_NOT_FOUND",
  "FAQ_ORDER_INVALID",
  "FAQ_GROUP_ORDER_INVALID",
  "FAQ_GROUP_HAS_FAQS",
  // blog (23)
  "BLOG_POST_NOT_FOUND",
  "BLOG_CATEGORY_NOT_FOUND",
  "BLOG_POST_SLUG_TAKEN",
  "BLOG_CATEGORY_SLUG_TAKEN",
  "BLOG_CATEGORY_HAS_POSTS",
  "BLOG_CATEGORY_ORDER_INVALID",
  "BLOG_POST_INCOMPLETE",
  // wholesale quotations (24)
  "QUOTATION_NOT_FOUND",
  "QUOTATION_ITEM_NOT_FOUND",
  "QUOTATION_NOT_PRICED",
  "QUOTATION_STATUS_INVALID",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * Codes the panel itself raises: the API could not be reached, it answered
 * with something that is not its error format, or the upload was stopped.
 */
export type ClientErrorCode =
  "NETWORK_ERROR" | "UNEXPECTED_RESPONSE" | "UPLOAD_ABORTED";

export type ErrorCode = ApiErrorCode | ClientErrorCode;

const KNOWN_CODES: ReadonlySet<string> = new Set<string>([
  ...API_ERROR_CODES,
  "NETWORK_ERROR",
  "UNEXPECTED_RESPONSE",
  "UPLOAD_ABORTED",
]);

/** One entry of `details` for `VALIDATION_FAILED` (0.3). */
export interface FieldProblem {
  field: string;
  problems: string[];
}

/** `details` per code, as documented with each endpoint. */
export interface ErrorDetails {
  VALIDATION_FAILED: FieldProblem[];
  ADMIN_PERMISSION_DENIED: { required: string[] };
  ADMIN_ACCOUNT_LOCKED: { retryAfterSeconds: number };
  ROLE_PERMISSION_UNKNOWN: { unknown: string[] };
  CATEGORY_ORDER_INVALID: { expected: Id[] };
  CATEGORY_PRODUCT_ORDER_INVALID: { unknown: Id[]; expected: Id[] };
  PRODUCT_PRICE_INVALID: { regularPrice?: Cents; salePrice?: Cents | null };
  PRODUCT_VARIANT_INVALID:
    { families?: string[]; baseQuantity?: number; sku?: string } | undefined;
  STOCK_INSUFFICIENT: {
    productId: Id;
    variantId: Id;
    sku: string;
    available: number;
    wanted: number;
  };
  IMAGE_FORMAT_NOT_ALLOWED: { accepted: string[] };
  /**
   * Products and categories name `minimum` (one side); a banner names
   * `minimumHeight` with it, or `landscape: true` when the picture is not
   * wider than tall (20).
   */
  IMAGE_DIMENSIONS_INVALID: {
    width: number;
    height: number;
    minimum?: number;
    minimumHeight?: number;
    landscape?: true;
  };
  IMAGE_LIMIT_REACHED: { maximum: number; remaining: number };
  IMAGE_ORDER_INVALID: { expected: Id[] } | undefined;
  BANNER_LIMIT_REACHED: { maximum: number };
  BANNER_ORDER_INVALID: { expected: Id[] } | undefined;
  FAQ_ORDER_INVALID: { unknown: Id[]; expected: Id[] } | undefined;
  FAQ_GROUP_ORDER_INVALID: { expected: Id[] } | undefined;
  FAQ_GROUP_HAS_FAQS: { faqs: number } | undefined;
  BLOG_CATEGORY_HAS_POSTS: { posts: number } | undefined;
  BLOG_CATEGORY_ORDER_INVALID: { expected: Id[] } | undefined;
  /** `missing` names the fields a post needs before it is published: `content.en`. */
  BLOG_POST_INCOMPLETE: { missing: string[] } | undefined;
  QUOTATION_ITEM_NOT_FOUND: { id: Id } | undefined;
  /** The lines without a price. */
  QUOTATION_NOT_PRICED: { unpriced: Id[] } | undefined;
  QUOTATION_STATUS_INVALID:
    { status: QuotationStatus; allowed: QuotationStatus[] } | undefined;
  ORDER_TRANSITION_NOT_ALLOWED: {
    from: OrderStatus;
    to: OrderStatus;
    allowed: OrderStatus[];
  };
  ORDER_CANNOT_BE_CHANGED: { status: OrderStatus; allowedIn: OrderStatus[] };
  ORDER_CANNOT_BE_CANCELLED: { status: OrderStatus };
  ORDER_QUANTITY_INVALID: { min: number; max: number };
  ORDER_ITEM_NOT_FOUND: { variantIds?: Id[] } | undefined;
  RETURN_TRANSITION_NOT_ALLOWED: { from: string; to: string };
  RETURN_QUANTITY_INVALID:
    { productId?: Id; variantId?: Id; sku?: string; max?: number } | undefined;
  COMPANY_DETAILS_MISSING: { missing: CompanyMissingField[] };
  REFUND_AMOUNT_INVALID: Refundable | undefined;
  REFUND_TRANSITION_NOT_ALLOWED: {
    status: RefundStatus;
    method: RefundMethod;
  };
}

export class ApiError extends Error {
  /** HTTP status; 0 when the API was not reached. */
  readonly status: number;
  /**
   * A documented code, or a client code. A code the panel does not know
   * (a newer API) is kept in `rawCode` and reported as `INTERNAL_ERROR`,
   * so that the interface always has a sentence for it.
   */
  readonly code: ErrorCode;
  readonly rawCode: string;
  readonly details: unknown;
  /** Shown on unexpected errors, for finding the request in the API's log. */
  readonly requestId: string | null;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.rawCode = input.code;
    this.code = KNOWN_CODES.has(input.code)
      ? (input.code as ErrorCode)
      : "INTERNAL_ERROR";
    this.details = input.details;
    this.requestId = input.requestId ?? null;
  }
}

type WithCode<C extends ErrorCode> = ApiError & {
  code: C;
  details: C extends keyof ErrorDetails ? ErrorDetails[C] : unknown;
};

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Narrowing check with typed `details`. */
export function hasErrorCode<C extends ErrorCode>(
  error: unknown,
  ...codes: C[]
): error is WithCode<C> {
  return isApiError(error) && (codes as ErrorCode[]).includes(error.code);
}

/**
 * The problems of a `VALIDATION_FAILED` answer by field path
 * (`tiers.0.fee`, `name.en`), for showing them next to the field.
 */
export function fieldProblems(error: unknown): Record<string, string[]> {
  if (!hasErrorCode(error, "VALIDATION_FAILED")) return {};
  const details: unknown = error.details;
  if (!Array.isArray(details)) return {};
  const byField: Record<string, string[]> = {};
  for (const entry of details as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { field, problems } = entry as Partial<FieldProblem>;
    if (typeof field !== "string" || !Array.isArray(problems)) continue;
    byField[field] = [
      ...(byField[field] ?? []),
      ...problems.filter((problem) => typeof problem === "string"),
    ];
  }
  return byField;
}

/** The session is over, or was never there: nothing to report as an error. */
export function isSessionError(error: unknown): boolean {
  return hasErrorCode(
    error,
    "AUTH_TOKEN_INVALID",
    "AUTH_REFRESH_INVALID",
    "AUTH_SESSION_REVOKED",
    "ADMIN_ACCOUNT_DISABLED",
    "ADMIN_PASSWORD_CHANGE_REQUIRED",
  );
}

/** Errors worth showing the request id for: nothing the admin did wrong. */
export function isUnexpectedError(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return (
    error.status >= 500 ||
    error.code === "INTERNAL_ERROR" ||
    error.code === "UNEXPECTED_RESPONSE" ||
    error.code === "BAD_REQUEST"
  );
}

/**
 * Whether asking again can help, and is safe. Used for reads only: the
 * network failed, the API was busy (429) or briefly unavailable.
 */
export function isRetryable(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.code === "NETWORK_ERROR" || error.code === "RATE_LIMITED") {
    return true;
  }
  return error.status === 502 || error.status === 503 || error.status === 504;
}
