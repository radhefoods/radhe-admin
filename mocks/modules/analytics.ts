// Section 21: analytics, the second tab of the start page. Every figure is
// computed from the records when asked, over calendar days in Germany, as
// doc/ANALYTICS.md defines them.

import type {
  AnalyticsCustomers,
  AnalyticsGranularity,
  AnalyticsInventory,
  AnalyticsPayments,
  AnalyticsPreset,
  AnalyticsProductRef,
  AnalyticsProducts,
  AnalyticsRange,
  AnalyticsSummary,
  Kpi,
  SalesPoint,
  StockLine,
} from "../../src/lib/api/types/index.ts";
import type { Db, OrderRecord, ProductRecord } from "../db.ts";
import { enumParam, fail, intParam, json } from "../http.ts";
import type { Router } from "../router.ts";
import { addDays, berlinDay } from "../time.ts";

const PRESETS: readonly AnalyticsPreset[] = [
  "today",
  "yesterday",
  "last_7_days",
  "this_month",
  "last_month",
  "custom",
];
const GRANULARITIES: readonly AnalyticsGranularity[] = ["day", "week", "month"];
const MAX_DAYS = 731;
const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// --- Days -------------------------------------------------------------------

function isDay(day: string): boolean {
  if (!DAY_SHAPE.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const check = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return check.getUTCMonth() === (m ?? 1) - 1 && check.getUTCDate() === d;
}

function daysBetween(from: string, to: string): number {
  const at = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((at(to) - at(from)) / 86_400_000) + 1;
}

const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
const lastOfMonth = (day: string) =>
  addDays(firstOfMonth(addDays(`${day.slice(0, 7)}-28`, 4)), -1);

/** The German day of a moment, or `null`. */
function dayOf(at: string | null | undefined): string | null {
  return at ? berlinDay(Date.parse(at)) : null;
}

/** The first day of the bucket a day falls in. */
function bucketOf(day: string, granularity: AnalyticsGranularity): string {
  if (granularity === "day") return day;
  if (granularity === "month") return firstOfMonth(day);
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** Every bucket of a range, zero-filled; the first may begin before the range. */
function bucketsOf(
  from: string,
  to: string,
  granularity: AnalyticsGranularity,
): string[] {
  const buckets: string[] = [];
  let at = bucketOf(from, granularity);
  while (at <= to) {
    buckets.push(at);
    at =
      granularity === "day"
        ? addDays(at, 1)
        : granularity === "week"
          ? addDays(at, 7)
          : firstOfMonth(addDays(at, 32));
  }
  return buckets;
}

// --- The range --------------------------------------------------------------

interface Period {
  from: string;
  to: string;
}

function invalid(message: string): never {
  throw fail(400, "ANALYTICS_RANGE_INVALID", message);
}

export function resolveRange(
  query: URLSearchParams,
  now: number,
): AnalyticsRange {
  const preset = enumParam(query, "range", PRESETS) ?? "this_month";
  const granularityWanted = enumParam(query, "granularity", GRANULARITIES);
  const today = berlinDay(now);
  let from: string;
  let to: string;
  switch (preset) {
    case "today":
      from = to = today;
      break;
    case "yesterday":
      from = to = addDays(today, -1);
      break;
    case "last_7_days":
      from = addDays(today, -6);
      to = today;
      break;
    case "this_month":
      from = firstOfMonth(today);
      to = today;
      break;
    case "last_month": {
      const last = addDays(firstOfMonth(today), -1);
      from = firstOfMonth(last);
      to = last;
      break;
    }
    default: {
      const rawFrom = query.get("from") ?? "";
      const rawTo = query.get("to") ?? "";
      if (!rawFrom || !rawTo) invalid("A custom range needs from and to.");
      for (const [name, raw] of [
        ["from", rawFrom],
        ["to", rawTo],
      ] as const) {
        if (!DAY_SHAPE.test(raw)) {
          throw fail(
            400,
            "VALIDATION_FAILED",
            "The request contains invalid data.",
            [{ field: name, problems: [`${name} must be a date YYYY-MM-DD`] }],
          );
        }
        if (!isDay(raw)) invalid(`${name} is not a day that exists.`);
      }
      if (rawFrom > rawTo) invalid("from must not come after to.");
      if (daysBetween(rawFrom, rawTo) > MAX_DAYS) {
        invalid(`At most ${MAX_DAYS} days.`);
      }
      from = rawFrom;
      to = rawTo;
    }
  }
  const days = daysBetween(from, to);
  const granularity =
    granularityWanted ?? (days <= 31 ? "day" : days <= 182 ? "week" : "month");

  let previous: Period;
  if (preset === "this_month") {
    const prevFirst = firstOfMonth(addDays(from, -1));
    const sameDay = addDays(prevFirst, days - 1);
    const prevLast = lastOfMonth(prevFirst);
    previous = { from: prevFirst, to: sameDay < prevLast ? sameDay : prevLast };
  } else if (preset === "last_month") {
    const prevFirst = firstOfMonth(addDays(from, -1));
    previous = { from: prevFirst, to: lastOfMonth(prevFirst) };
  } else {
    previous = { from: addDays(from, -days), to: addDays(from, -1) };
  }
  return {
    preset,
    from,
    to,
    days,
    timeZone: "Europe/Berlin",
    granularity,
    previous,
  };
}

// --- Figures ----------------------------------------------------------------

function kpi(value: number, previous: number): Kpi {
  return {
    value,
    previous,
    change:
      previous === 0
        ? null
        : Math.round(((value - previous) / previous) * 1000) / 10,
  };
}

const within = (day: string | null, period: Period): boolean =>
  day !== null && day >= period.from && day <= period.to;

const round1 = (value: number) => Math.round(value * 10) / 10;
const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : round1((part / whole) * 100);

function paidOrders(db: Db, period: Period): OrderRecord[] {
  return db.orders.filter((order) =>
    within(dayOf(order.payment.paidAt), period),
  );
}

const unitsOf = (order: OrderRecord) =>
  order.items.reduce((sum, item) => sum + item.quantity, 0);

/** The customers whose first paid order ever falls in the period. */
function firstTimeBuyers(db: Db, period: Period): Set<string> {
  const first = new Map<string, string>();
  for (const order of db.orders) {
    const day = dayOf(order.payment.paidAt);
    if (!day) continue;
    const known = first.get(order.customer.id);
    if (!known || day < known) first.set(order.customer.id, day);
  }
  const result = new Set<string>();
  for (const [customerId, day] of first) {
    if (within(day, period)) result.add(customerId);
  }
  return result;
}

interface PeriodFigures {
  gross: number;
  goods: number;
  deliveryFees: number;
  vat: number;
  netOfVat: number;
  refunded: number;
  refundsCompleted: number;
  credits: number;
  paid: number;
  units: number;
  cancelled: number;
  abandoned: number;
  dispatched: number;
  delivered: number;
  buyers: number;
  firstTime: number;
  newCustomers: number;
  returnsRequested: number;
  returnsCompleted: number;
  credited: number;
}

function figuresOf(db: Db, period: Period): PeriodFigures {
  const orders = paidOrders(db, period);
  const refunds = db.refunds.filter((refund) =>
    within(dayOf(refund.completedAt), period),
  );
  const returnsCompleted = db.returns.filter((entry) =>
    within(dayOf(entry.completedAt), period),
  );
  const buyers = new Set(orders.map((order) => order.customer.id));
  const firstTime = firstTimeBuyers(db, period);
  const sum = <T>(rows: T[], of: (row: T) => number) =>
    rows.reduce((total, row) => total + of(row), 0);
  return {
    gross: sum(orders, (order) => order.totals.total),
    goods: sum(orders, (order) => order.totals.subtotal),
    deliveryFees: sum(orders, (order) => order.totals.deliveryFee),
    vat: sum(orders, (order) => order.totals.vatTotal),
    netOfVat: sum(orders, (order) => order.totals.netTotal),
    refunded: sum(refunds, (refund) => refund.amount),
    refundsCompleted: refunds.length,
    credits: sum(
      db.invoices.filter(
        (invoice) =>
          invoice.type === "credit_note" &&
          within(dayOf(invoice.issuedAt), period),
      ),
      (invoice) => invoice.total,
    ),
    paid: orders.length,
    units: sum(orders, unitsOf),
    cancelled: db.orders.filter(
      (order) =>
        order.payment.paidAt !== null &&
        within(dayOf(order.cancellation?.at), period),
    ).length,
    abandoned: db.orders.filter(
      (order) =>
        order.payment.paidAt === null &&
        within(dayOf(order.cancellation?.at), period),
    ).length,
    dispatched: db.orders.filter((order) =>
      within(dayOf(order.delivery.dispatchedAt), period),
    ).length,
    delivered: db.orders.filter((order) =>
      within(dayOf(order.delivery.deliveredAt), period),
    ).length,
    buyers: buyers.size,
    firstTime: [...buyers].filter((id) => firstTime.has(id)).length,
    newCustomers: db.customers.filter((customer) =>
      within(dayOf(customer.createdAt), period),
    ).length,
    returnsRequested: db.returns.filter((entry) =>
      within(dayOf(entry.requestedAt), period),
    ).length,
    returnsCompleted: returnsCompleted.length,
    credited: sum(returnsCompleted, (entry) => entry.creditAmount ?? 0),
  };
}

function summaryOf(db: Db, range: AnalyticsRange): AnalyticsSummary {
  const now = figuresOf(db, range);
  const before = figuresOf(db, range.previous);
  const compare = (key: keyof PeriodFigures) => kpi(now[key], before[key]);
  const aov = (figures: PeriodFigures) =>
    figures.paid === 0 ? 0 : Math.round(figures.gross / figures.paid);
  return {
    range,
    revenue: {
      gross: compare("gross"),
      net: kpi(now.gross - now.refunded, before.gross - before.refunded),
      goods: compare("goods"),
      deliveryFees: compare("deliveryFees"),
      vat: compare("vat"),
      netOfVat: compare("netOfVat"),
      credits: compare("credits"),
      refunded: compare("refunded"),
    },
    orders: {
      paid: compare("paid"),
      averageOrderValue: kpi(aov(now), aov(before)),
      units: compare("units"),
      cancelled: compare("cancelled"),
      abandoned: compare("abandoned"),
      dispatched: compare("dispatched"),
      delivered: compare("delivered"),
    },
    customers: {
      buyers: compare("buyers"),
      firstTime: compare("firstTime"),
      returning: kpi(
        now.buyers - now.firstTime,
        before.buyers - before.firstTime,
      ),
      new: compare("newCustomers"),
    },
    returns: {
      requested: compare("returnsRequested"),
      completed: compare("returnsCompleted"),
      credited: compare("credited"),
    },
    refunds: {
      completed: compare("refundsCompleted"),
      amount: compare("refunded"),
    },
  };
}

function salesOf(
  db: Db,
  period: Period,
  granularity: AnalyticsGranularity,
): SalesPoint[] {
  const points = new Map<string, SalesPoint>(
    bucketsOf(period.from, period.to, granularity).map((bucket) => [
      bucket,
      {
        period: bucket,
        revenue: 0,
        orders: 0,
        units: 0,
        averageOrderValue: 0,
        refunded: 0,
      },
    ]),
  );
  for (const order of paidOrders(db, period)) {
    const point = points.get(
      bucketOf(dayOf(order.payment.paidAt) as string, granularity),
    );
    if (!point) continue;
    point.revenue += order.totals.total;
    point.orders += 1;
    point.units += unitsOf(order);
  }
  for (const refund of db.refunds) {
    const day = dayOf(refund.completedAt);
    if (!within(day, period)) continue;
    const point = points.get(bucketOf(day as string, granularity));
    if (point) point.refunded += refund.amount;
  }
  for (const point of points.values()) {
    point.averageOrderValue =
      point.orders === 0 ? 0 : Math.round(point.revenue / point.orders);
  }
  return [...points.values()];
}

function productRef(
  db: Db,
  productId: string,
  fallbackName: { en: string; de?: string | null },
): AnalyticsProductRef {
  const product = db.products.find((entry) => entry.id === productId);
  if (!product) {
    return {
      id: productId,
      name: fallbackName,
      slug: null,
      status: null,
      image: null,
    };
  }
  const primary =
    product.images.find((image) => image.isPrimary) ?? product.images[0];
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    status: product.status,
    image: primary
      ? { url: primary.url, sizes: { small: { url: primary.sizes.small.url } } }
      : null,
  };
}

interface ProductTally {
  units: number;
  revenue: number;
  orders: Set<string>;
  name: { en: string; de?: string | null };
  variants: Map<
    string,
    {
      sku: string;
      packSize: { value: number; unit: string };
      units: number;
      revenue: number;
    }
  >;
}

function tallyProducts(db: Db, period: Period): Map<string, ProductTally> {
  const tally = new Map<string, ProductTally>();
  for (const order of paidOrders(db, period)) {
    for (const item of order.items) {
      const entry = tally.get(item.productId) ?? {
        units: 0,
        revenue: 0,
        orders: new Set<string>(),
        name: item.name,
        variants: new Map(),
      };
      entry.units += item.quantity;
      entry.revenue += item.lineTotal;
      entry.orders.add(order.id);
      const variant = entry.variants.get(item.variantId) ?? {
        sku: item.sku,
        packSize: { value: item.packSize.value, unit: item.packSize.unit },
        units: 0,
        revenue: 0,
      };
      variant.units += item.quantity;
      variant.revenue += item.lineTotal;
      entry.variants.set(item.variantId, variant);
      tally.set(item.productId, entry);
    }
  }
  return tally;
}

function productsOf(
  db: Db,
  range: AnalyticsRange,
  limit: number,
  sortBy: "units" | "revenue",
): AnalyticsProducts {
  const now = tallyProducts(db, range);
  const before = tallyProducts(db, range.previous);
  const goods = [...now.values()].reduce(
    (sum, entry) => sum + entry.revenue,
    0,
  );
  const bestSellers = [...now.entries()]
    .sort((a, b) => b[1][sortBy] - a[1][sortBy] || b[1].units - a[1].units)
    .slice(0, limit)
    .map(([productId, entry]) => ({
      product: productRef(db, productId, entry.name),
      units: kpi(entry.units, before.get(productId)?.units ?? 0),
      revenue: kpi(entry.revenue, before.get(productId)?.revenue ?? 0),
      orders: entry.orders.size,
      variants: [...entry.variants.entries()]
        .sort((a, b) => b[1].units - a[1].units)
        .map(([variantId, variant]) => ({
          variantId,
          ...variant,
          packSize: variant.packSize as {
            value: number;
            unit: "g" | "kg" | "ml" | "l" | "pcs";
          },
        })),
    }));

  const byCategory = (tally: Map<string, ProductTally>) => {
    const groups = new Map<
      string | null,
      { units: number; revenue: number; products: Set<string> }
    >();
    for (const [productId, entry] of tally) {
      const product = db.products.find(
        (candidate) => candidate.id === productId,
      );
      const key = product?.categoryId ?? null;
      const group = groups.get(key) ?? {
        units: 0,
        revenue: 0,
        products: new Set(),
      };
      group.units += entry.units;
      group.revenue += entry.revenue;
      group.products.add(productId);
      groups.set(key, group);
    }
    return groups;
  };
  const groupsNow = byCategory(now);
  const groupsBefore = byCategory(before);
  const categories = [...groupsNow.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([categoryId, group]) => {
      const category = categoryId
        ? db.categories.find((entry) => entry.id === categoryId)
        : undefined;
      return {
        category: category
          ? { id: category.id, name: category.name, slug: category.slug }
          : null,
        units: group.units,
        revenue: kpi(group.revenue, groupsBefore.get(categoryId)?.revenue ?? 0),
        share: percent(group.revenue, goods),
        products: group.products.size,
      };
    });

  return {
    range,
    sortBy,
    totals: {
      units: [...now.values()].reduce((sum, entry) => sum + entry.units, 0),
      revenue: goods,
      products: now.size,
    },
    bestSellers,
    categories,
  };
}

function customersOf(
  db: Db,
  range: AnalyticsRange,
  limit: number,
): AnalyticsCustomers {
  const now = figuresOf(db, range);
  const before = figuresOf(db, range.previous);
  const rate = (figures: PeriodFigures) =>
    percent(figures.buyers - figures.firstTime, figures.buyers);
  const newByBucket = new Map(
    bucketsOf(range.from, range.to, range.granularity).map((bucket) => [
      bucket,
      0,
    ]),
  );
  for (const customer of db.customers) {
    const day = dayOf(customer.createdAt);
    if (!within(day, range)) continue;
    const bucket = bucketOf(day as string, range.granularity);
    newByBucket.set(bucket, (newByBucket.get(bucket) ?? 0) + 1);
  }
  const top = new Map<
    string,
    {
      name: string | null;
      email: string;
      orders: number;
      revenue: number;
      last: string;
    }
  >();
  const byLanguage = new Map<
    "en" | "de",
    { orders: number; revenue: number }
  >();
  for (const order of paidOrders(db, range)) {
    const name =
      [order.customer.firstName, order.customer.lastName]
        .filter((part) => part && part.trim() !== "")
        .join(" ") || null;
    const entry = top.get(order.customer.id) ?? {
      name,
      email: order.customer.email,
      orders: 0,
      revenue: 0,
      last: order.payment.paidAt as string,
    };
    entry.orders += 1;
    entry.revenue += order.totals.total;
    if ((order.payment.paidAt as string) > entry.last) {
      entry.last = order.payment.paidAt as string;
    }
    top.set(order.customer.id, entry);
    const language = byLanguage.get(order.language) ?? {
      orders: 0,
      revenue: 0,
    };
    language.orders += 1;
    language.revenue += order.totals.total;
    byLanguage.set(order.language, language);
  }
  return {
    range,
    new: kpi(now.newCustomers, before.newCustomers),
    buyers: kpi(now.buyers, before.buyers),
    firstTime: kpi(now.firstTime, before.firstTime),
    returning: kpi(
      now.buyers - now.firstTime,
      before.buyers - before.firstTime,
    ),
    repeatRate: kpi(rate(now), rate(before)),
    newCustomers: [...newByBucket.entries()].map(([period, count]) => ({
      period,
      count,
    })),
    topCustomers: [...top.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, limit)
      .map(([id, entry]) => ({
        customer: { id, name: entry.name, email: entry.email },
        orders: entry.orders,
        revenue: entry.revenue,
        averageOrderValue: Math.round(entry.revenue / entry.orders),
        lastOrderAt: entry.last,
      })),
    byLanguage: [...byLanguage.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([language, entry]) => ({ language, ...entry })),
  };
}

function paymentsOf(db: Db, range: AnalyticsRange): AnalyticsPayments {
  const paid = paidOrders(db, range);
  const total = paid.reduce((sum, order) => sum + order.totals.total, 0);
  const types = new Map<
    "card" | "paypal" | "unknown",
    { orders: number; amount: number }
  >();
  for (const order of paid) {
    const type = order.payment.paymentType ?? "unknown";
    const entry = types.get(type) ?? { orders: 0, amount: 0 };
    entry.orders += 1;
    entry.amount += order.totals.total;
    types.set(type, entry);
  }
  const started = db.orders.filter((order) =>
    within(dayOf(order.placedAt), range),
  );
  const checkouts = {
    started: started.length,
    paid: started.filter((order) => order.payment.paidAt !== null).length,
    pending: started.filter(
      (order) =>
        order.status === "pending_payment" && order.paymentStatus !== "failed",
    ).length,
    failed: started.filter(
      (order) =>
        order.status === "pending_payment" && order.paymentStatus === "failed",
    ).length,
    abandoned: started.filter(
      (order) => order.status === "cancelled" && order.payment.paidAt === null,
    ).length,
    conversion: 0,
  };
  checkouts.conversion = percent(checkouts.paid, checkouts.started);

  const created = db.refunds.filter((refund) =>
    within(dayOf(refund.createdAt), range),
  );
  const completed = db.refunds.filter((refund) =>
    within(dayOf(refund.completedAt), range),
  );
  const group = <K extends string>(
    key: (refund: (typeof created)[number]) => K,
  ) => {
    const groups = new Map<K, { count: number; amount: number }>();
    for (const refund of created) {
      const entry = groups.get(key(refund)) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += refund.amount;
      groups.set(key(refund), entry);
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([k, entry]) => ({ key: k, ...entry }));
  };

  const requested = db.returns.filter((entry) =>
    within(dayOf(entry.requestedAt), range),
  );
  const returnsCompleted = db.returns.filter((entry) =>
    within(dayOf(entry.completedAt), range),
  );
  const byStatus = new Map<string, number>();
  const byReason = new Map<string, { items: number; units: number }>();
  for (const entry of requested) {
    byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1);
    for (const item of entry.items) {
      const reason = byReason.get(item.reason) ?? { items: 0, units: 0 };
      reason.items += 1;
      reason.units += item.quantity;
      byReason.set(item.reason, reason);
    }
  }

  return {
    range,
    byType: [...types.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([type, entry]) => ({
        type,
        ...entry,
        share: percent(entry.amount, total),
      })),
    checkouts,
    refunds: {
      created: {
        count: created.length,
        amount: created.reduce((sum, refund) => sum + refund.amount, 0),
      },
      completed: {
        count: completed.length,
        amount: completed.reduce((sum, refund) => sum + refund.amount, 0),
      },
      byStatus: group((refund) => refund.status),
      byReason: group((refund) => refund.reason),
      byMethod: group((refund) => refund.method),
    },
    returns: {
      requested: requested.length,
      completed: {
        count: returnsCompleted.length,
        credited: returnsCompleted.reduce(
          (sum, entry) => sum + (entry.creditAmount ?? 0),
          0,
        ),
      },
      byStatus: [...byStatus.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => ({
          status:
            status as AnalyticsPayments["returns"]["byStatus"][number]["status"],
          count,
        })),
      byReason: [...byReason.entries()]
        .sort((a, b) => b[1].units - a[1].units)
        .map(([reason, entry]) => ({
          reason:
            reason as AnalyticsPayments["returns"]["byReason"][number]["reason"],
          ...entry,
        })),
    },
  };
}

function movementsOf(db: Db, period: Period) {
  const sums = { sold: 0, restocked: 0, returned: 0, released: 0, adjusted: 0 };
  for (const movement of db.stockMovements) {
    if (!within(dayOf(movement.createdAt), period)) continue;
    switch (movement.reason) {
      case "order":
        sums.sold += -movement.delta;
        break;
      case "restock":
        sums.restocked += movement.delta;
        break;
      case "return":
        sums.returned += movement.delta;
        break;
      case "cancel":
      case "release":
        sums.released += movement.delta;
        break;
      default:
        sums.adjusted += movement.delta;
    }
  }
  return sums;
}

function stockLine(
  product: ProductRecord,
  variant: ProductRecord["variants"][number],
): StockLine {
  return {
    productId: product.id,
    name: product.name,
    variantId: variant.id,
    sku: variant.sku,
    packSize: { value: variant.packSize.value, unit: variant.packSize.unit },
    quantity: variant.stock.quantity,
    threshold: variant.stock.lowStockThreshold,
  };
}

function inventoryOf(
  db: Db,
  range: AnalyticsRange,
  limit: number,
): AnalyticsInventory {
  const active = db.products.filter((product) => product.status === "active");
  const sizes = active.flatMap((product) =>
    product.variants
      .filter((variant) => variant.isEnabled)
      .map((variant) => ({ product, variant })),
  );
  const price = (variant: ProductRecord["variants"][number]) =>
    variant.salePrice ?? variant.regularPrice;
  const low = sizes.filter(
    ({ variant }) =>
      variant.stock.lowStockThreshold !== null &&
      variant.stock.quantity > 0 &&
      variant.stock.quantity <= variant.stock.lowStockThreshold,
  );
  const out = sizes.filter(({ variant }) => variant.stock.quantity === 0);
  const now = movementsOf(db, range);
  const before = movementsOf(db, range.previous);
  const sold = tallyProducts(db, range);
  const slow = active.filter((product) => !sold.has(product.id));
  const onHand = (product: ProductRecord) =>
    product.variants
      .filter((variant) => variant.isEnabled)
      .reduce((sum, variant) => sum + variant.stock.quantity, 0);
  const valueOf = (product: ProductRecord) =>
    product.variants
      .filter((variant) => variant.isEnabled)
      .reduce(
        (sum, variant) => sum + variant.stock.quantity * price(variant),
        0,
      );
  return {
    range,
    stock: {
      variants: sizes.length,
      unitsOnHand: sizes.reduce(
        (sum, { variant }) => sum + variant.stock.quantity,
        0,
      ),
      stockValue: sizes.reduce(
        (sum, { variant }) => sum + variant.stock.quantity * price(variant),
        0,
      ),
      variantsOutOfStock: out.length,
      variantsLow: low.length,
      productsOutOfStock: active.filter((product) => onHand(product) === 0)
        .length,
    },
    movements: {
      sold: kpi(now.sold, before.sold),
      restocked: kpi(now.restocked, before.restocked),
      returned: kpi(now.returned, before.returned),
      released: kpi(now.released, before.released),
      adjusted: kpi(now.adjusted, before.adjusted),
    },
    lowStock: low
      .sort((a, b) => a.variant.stock.quantity - b.variant.stock.quantity)
      .slice(0, limit)
      .map(({ product, variant }) => stockLine(product, variant)),
    outOfStock: out
      .slice(0, limit)
      .map(({ product, variant }) => stockLine(product, variant)),
    slowMovers: {
      count: slow.length,
      items: slow
        .sort((a, b) => valueOf(b) - valueOf(a))
        .slice(0, limit)
        .map((product) => ({
          product: productRef(db, product.id, product.name),
          unitsOnHand: onHand(product),
          stockValue: valueOf(product),
        })),
    },
  };
}

// --- Routes -----------------------------------------------------------------

export function registerAnalytics(router: Router): void {
  const base = "/v1/admin/analytics";
  const permission = "analytics.read";
  const limitOf = (query: URLSearchParams) =>
    intParam(query, "limit", 10, 1, 50);

  router.get(`${base}/summary`, { permission }, (ctx) =>
    json(summaryOf(ctx.db, resolveRange(ctx.query, ctx.now))),
  );
  router.get(`${base}/sales`, { permission }, (ctx) => {
    const range = resolveRange(ctx.query, ctx.now);
    return json({
      range,
      current: salesOf(ctx.db, range, range.granularity),
      previous: salesOf(ctx.db, range.previous, range.granularity),
    });
  });
  router.get(`${base}/products`, { permission }, (ctx) =>
    json(
      productsOf(
        ctx.db,
        resolveRange(ctx.query, ctx.now),
        limitOf(ctx.query),
        enumParam(ctx.query, "sortBy", ["units", "revenue"] as const) ??
          "units",
      ),
    ),
  );
  router.get(`${base}/customers`, { permission }, (ctx) =>
    json(
      customersOf(ctx.db, resolveRange(ctx.query, ctx.now), limitOf(ctx.query)),
    ),
  );
  router.get(`${base}/payments`, { permission }, (ctx) =>
    json(paymentsOf(ctx.db, resolveRange(ctx.query, ctx.now))),
  );
  router.get(`${base}/inventory`, { permission }, (ctx) =>
    json(
      inventoryOf(ctx.db, resolveRange(ctx.query, ctx.now), limitOf(ctx.query)),
    ),
  );
}
