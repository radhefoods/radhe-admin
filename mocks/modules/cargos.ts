// Section 9: cargos, their products, bulk order actions, cargo payments.

import { z } from "zod";
import type {
  CargoStatus,
  PaymentStatus,
} from "../../src/lib/api/types/index.ts";
import type { CargoRecord, Db } from "../db.ts";
import {
  CARGO_ALLOWED,
  MOVABLE,
  activatePayment,
  cargoDetail,
  cargoView,
  companyMissing,
  customerOf,
  descendantIds,
  productSummary,
  pushHistory,
  queueMessage,
} from "../domain.ts";
import {
  boolParam,
  enumParam,
  fail,
  idParam,
  json,
  newId,
  noContent,
  page,
  validationFailed,
  zId,
  zIds,
  zNote,
  zTranslatedOptional,
} from "../http.ts";
import {
  assertCanTakeOrders,
  moveOrder,
  ordersOf,
  setDeliveryMethod,
  setOrderStatus,
} from "../order-ops.ts";
import type { Router } from "../router.ts";
import { berlinDay, iso } from "../time.ts";

const STATUSES = [
  "draft",
  "scheduled",
  "taking_orders",
  "orders_closed",
  "in_transit",
  "arrived",
  "delivering",
  "delivered",
  "cancelled",
] as const;

const zMoment = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
    "must be an ISO 8601 date-time with a time zone",
  );
const zDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a day as YYYY-MM-DD");

const cargoFields = {
  customerName: zTranslatedOptional(160).optional(),
  customerMessage: zTranslatedOptional(1000).optional(),
  internalNotes: z.string().max(5000).nullish(),
};
const createCargo = z.strictObject({
  internalName: z.string().min(1).max(120),
  orderOpenAt: zMoment,
  orderCloseAt: zMoment,
  deliveryStart: zDay,
  deliveryEnd: zDay,
  status: z.enum(["draft", "scheduled"]).optional(),
  copyProductsFrom: zId.optional(),
  ...cargoFields,
});
const updateCargo = z.strictObject({
  internalName: z.string().min(1).max(120).optional(),
  orderOpenAt: zMoment.optional(),
  orderCloseAt: zMoment.optional(),
  deliveryStart: zDay.optional(),
  deliveryEnd: zDay.optional(),
  ...cargoFields,
});
const statusBody = z.strictObject({
  status: z.enum(STATUSES),
  excludeOrderIds: zIds(1000),
  moveOrdersToCargoId: zId.nullish(),
  note: zNote(500),
});
const noteBody = z.strictObject({ note: zNote(500) });

function cargoById(db: Db, id: string): CargoRecord {
  const cargo = db.cargos.find((entry) => entry.id === id);
  if (!cargo) throw fail(404, "CARGO_NOT_FOUND", "The cargo was not found.");
  return cargo;
}

function assertDates(
  openAt: string,
  closeAt: string,
  start: string,
  end: string,
): void {
  const problems: string[] = [];
  if (Date.parse(closeAt) <= Date.parse(openAt)) {
    problems.push("The order deadline must be after the opening time.");
  }
  if (end < start)
    problems.push("The delivery window must not end before it starts.");
  if (start < berlinDay(Date.parse(closeAt))) {
    problems.push(
      "Delivery cannot start before the day of the order deadline.",
    );
  }
  if (problems.length > 0) {
    throw fail(
      400,
      "CARGO_DATES_INVALID",
      "The dates of the cargo are not valid.",
      problems,
    );
  }
}

/** Order windows of scheduled and open cargos may not overlap. */
function assertWindowFree(db: Db, cargo: CargoRecord): void {
  const open = Date.parse(cargo.orderOpenAt);
  const close = Date.parse(cargo.orderCloseAt);
  const other = db.cargos.find(
    (entry) =>
      entry.id !== cargo.id &&
      (entry.status === "scheduled" || entry.status === "taking_orders") &&
      Date.parse(entry.orderOpenAt) < close &&
      open < Date.parse(entry.orderCloseAt),
  );
  if (other) {
    throw fail(
      409,
      "CARGO_WINDOW_OVERLAP",
      "The order window overlaps with another cargo.",
      {
        cargo: other.code,
        orderOpenAt: other.orderOpenAt,
        orderCloseAt: other.orderCloseAt,
      },
    );
  }
}

function assertWindowAhead(cargo: CargoRecord, now: number): void {
  if (Date.parse(cargo.orderCloseAt) <= now) {
    throw fail(
      409,
      "CARGO_WINDOW_PASSED",
      "The order deadline of the cargo has passed.",
    );
  }
}

interface TransitionInput {
  source: "admin" | "schedule";
  adminId: string | null;
  note?: string | null;
  excludeOrderIds?: string[];
  moveOrdersToCargoId?: string | null;
}

/** One function for every change of status, by hand or by the schedule (7.2). */
export function transition(
  db: Db,
  cargo: CargoRecord,
  to: CargoStatus,
  input: TransitionInput,
  now: number,
): { changed: boolean; ordersMoved: number } {
  const from = cargo.status;
  if (from === to) return { changed: false, ordersMoved: 0 };
  if (!CARGO_ALLOWED[from].includes(to)) {
    throw fail(
      409,
      "CARGO_TRANSITION_NOT_ALLOWED",
      "This change of status is not allowed.",
      {
        from,
        to,
        allowed: CARGO_ALLOWED[from],
      },
    );
  }
  const excluded = new Set(input.excludeOrderIds ?? []);
  const actor = { adminId: input.adminId, note: input.note ?? null };
  let ordersMoved = 0;

  if (to === "scheduled") {
    assertWindowAhead(cargo, now);
    assertWindowFree(db, cargo);
  }
  if (to === "taking_orders") {
    const other = db.cargos.find(
      (entry) => entry.id !== cargo.id && entry.status === "taking_orders",
    );
    if (other) {
      throw fail(
        409,
        "CARGO_ANOTHER_TAKING_ORDERS",
        "Another cargo is taking orders.",
        {
          cargo: other.code,
          id: other.id,
        },
      );
    }
    assertWindowAhead(cargo, now);
    assertWindowFree(db, cargo);
  }
  if (to === "cancelled") {
    const active = ordersOf(db, cargo.id).filter(
      (order) => order.status !== "cancelled" && order.status !== "returned",
    );
    if (active.length > 0) {
      const onTheirWay = active.filter(
        (order) => !MOVABLE.includes(order.status),
      );
      if (onTheirWay.length > 0 || !input.moveOrdersToCargoId) {
        throw fail(
          409,
          "CARGO_HAS_ORDERS",
          onTheirWay.length > 0
            ? "Some orders are already on their way. Look at them first."
            : "The cargo has orders. Name the cargo that takes them over.",
          { orders: active.length },
        );
      }
      const target = cargoById(db, input.moveOrdersToCargoId);
      assertCanTakeOrders(target);
      for (const order of active) moveOrder(db, order, target, actor, now);
      ordersMoved = active.length;
    }
  }

  cargo.status = to;
  cargo.updatedAt = iso(now);
  if (to === "taking_orders") {
    cargo.openedAt = iso(now);
    cargo.closedAt = null;
  }
  if (to === "orders_closed" && from === "taking_orders")
    cargo.closedAt = iso(now);
  cargo.statusHistory.push({
    from,
    to,
    at: iso(now),
    source: input.source,
    by: input.adminId,
    note: input.note ?? null,
  });

  // The orders of a cargo follow it (7.4), except the ones left out.
  if (to === "delivering" || to === "delivered") {
    for (const order of ordersOf(db, cargo.id)) {
      if (excluded.has(order.id)) continue;
      if (
        to === "delivering" &&
        (order.status === "confirmed" || order.status === "preparing")
      ) {
        setOrderStatus(db, order, "dispatched", actor, now);
      }
      if (to === "delivered" && order.status === "dispatched") {
        setOrderStatus(db, order, "delivered", actor, now);
      }
    }
  }
  return { changed: true, ordersMoved };
}

/** The automatic check: closes what is past its deadline, opens what is due. */
export function runCargoCheck(
  db: Db,
  now: number,
): { closed: string[]; opened: string[] } {
  const closed: string[] = [];
  const opened: string[] = [];
  for (const cargo of db.cargos) {
    if (
      cargo.status === "taking_orders" &&
      Date.parse(cargo.orderCloseAt) <= now
    ) {
      transition(
        db,
        cargo,
        "orders_closed",
        { source: "schedule", adminId: null },
        now,
      );
      closed.push(cargo.code);
    }
  }
  const due = db.cargos
    .filter(
      (cargo) =>
        cargo.status === "scheduled" &&
        Date.parse(cargo.orderOpenAt) <= now &&
        Date.parse(cargo.orderCloseAt) > now,
    )
    .sort((a, b) => Date.parse(a.orderOpenAt) - Date.parse(b.orderOpenAt))[0];
  if (due && !db.cargos.some((cargo) => cargo.status === "taking_orders")) {
    transition(
      db,
      due,
      "taking_orders",
      { source: "schedule", adminId: null },
      now,
    );
    opened.push(due.code);
  }
  return { closed, opened };
}

function assertProductsEditable(cargo: CargoRecord): void {
  if (!["draft", "scheduled", "taking_orders"].includes(cargo.status)) {
    throw fail(
      409,
      "CARGO_NOT_EDITABLE",
      "The products of a cargo can be changed until ordering has ended.",
      {
        status: cargo.status,
      },
    );
  }
}

function assertProducts(db: Db, productIds: string[]): void {
  const missing = productIds.filter(
    (id) => !db.products.some((product) => product.id === id),
  );
  const archived = productIds.filter(
    (id) =>
      db.products.find((product) => product.id === id)?.status === "archived",
  );
  if (missing.length > 0 || archived.length > 0) {
    throw fail(
      400,
      "CARGO_PRODUCT_INVALID",
      "Some products are missing or archived.",
      {
        missing,
        archived,
      },
    );
  }
}

function settingOf(db: Db, cargoId: string, productId: string) {
  const entry = db.cargoProducts.find(
    (setting) => setting.cargoId === cargoId && setting.productId === productId,
  );
  if (!entry) {
    return {
      isEnabled: false,
      maxQuantity: null,
      orderedQuantity: 0,
      remaining: null,
    };
  }
  return {
    isEnabled: entry.isEnabled,
    maxQuantity: entry.maxQuantity,
    orderedQuantity: entry.orderedQuantity,
    remaining:
      entry.maxQuantity === null
        ? null
        : Math.max(0, entry.maxQuantity - entry.orderedQuantity),
  };
}

function productCounts(db: Db, cargoId: string) {
  const settings = db.cargoProducts.filter(
    (entry) => entry.cargoId === cargoId,
  );
  return {
    total: settings.length,
    enabled: settings.filter((entry) => entry.isEnabled).length,
  };
}

function upsertSetting(
  db: Db,
  cargoId: string,
  productId: string,
  input: { isEnabled?: boolean; maxQuantity?: number | null },
): void {
  let entry = db.cargoProducts.find(
    (setting) => setting.cargoId === cargoId && setting.productId === productId,
  );
  if (!entry) {
    entry = {
      cargoId,
      productId,
      isEnabled: true,
      maxQuantity: null,
      orderedQuantity: 0,
    };
    db.cargoProducts.push(entry);
  }
  if (input.isEnabled !== undefined) entry.isEnabled = input.isEnabled;
  if (input.maxQuantity !== undefined) entry.maxQuantity = input.maxQuantity;
}

function copyProducts(db: Db, from: CargoRecord, to: CargoRecord): number {
  let added = 0;
  for (const source of db.cargoProducts.filter(
    (entry) => entry.cargoId === from.id,
  )) {
    const product = db.products.find((entry) => entry.id === source.productId);
    if (!product || product.status === "archived") continue;
    const exists = db.cargoProducts.some(
      (entry) =>
        entry.cargoId === to.id && entry.productId === source.productId,
    );
    if (exists) continue;
    db.cargoProducts.push({
      cargoId: to.id,
      productId: source.productId,
      isEnabled: source.isEnabled,
      maxQuantity: source.maxQuantity,
      orderedQuantity: 0,
    });
    added += 1;
  }
  return added;
}

export function registerCargos(router: Router): void {
  const base = "/v1/admin/cargos";

  router.get(base, { permission: "cargos.read" }, (ctx) => {
    const status = enumParam(ctx.query, "status", STATUSES);
    const rows = ctx.db.cargos
      .filter((cargo) => !status || cargo.status === status)
      .sort((a, b) => b.number - a.number);
    const result = page(rows, ctx.query);
    return json({
      ...result,
      items: result.items.map((cargo) => cargoView(ctx.db, cargo, ctx.now)),
    });
  });

  router.get(`${base}/overview`, { permission: "cargos.read" }, (ctx) => {
    const view = (cargo: CargoRecord | undefined) =>
      cargo ? cargoView(ctx.db, cargo, ctx.now) : null;
    const current = ctx.db.cargos.find(
      (cargo) => cargo.status === "taking_orders",
    );
    const next = ctx.db.cargos
      .filter((cargo) => cargo.status === "scheduled")
      .sort((a, b) => Date.parse(a.orderOpenAt) - Date.parse(b.orderOpenAt))[0];
    const inProgress = ctx.db.cargos
      .filter((cargo) =>
        ["orders_closed", "in_transit", "arrived", "delivering"].includes(
          cargo.status,
        ),
      )
      .sort((a, b) => a.number - b.number)
      .slice(0, 20);
    return json({
      acceptingOrders: Boolean(current && view(current)?.isAcceptingOrders),
      current: view(current),
      next: view(next),
      inProgress: inProgress.map((cargo) => cargoView(ctx.db, cargo, ctx.now)),
      serverTime: iso(ctx.now),
    });
  });

  router.post(base, { permission: "cargos.manage" }, async (ctx) => {
    const input = await ctx.body(createCargo);
    assertDates(
      input.orderOpenAt,
      input.orderCloseAt,
      input.deliveryStart,
      input.deliveryEnd,
    );
    const source = input.copyProductsFrom
      ? cargoById(ctx.db, input.copyProductsFrom)
      : null;
    const number =
      Math.max(0, ...ctx.db.cargos.map((cargo) => cargo.number)) + 1;
    const cargo: CargoRecord = {
      id: newId(ctx.now),
      number,
      code: `RF-C${String(number).padStart(3, "0")}`,
      internalName: input.internalName,
      customerName: input.customerName ?? null,
      customerMessage: input.customerMessage ?? null,
      internalNotes: input.internalNotes ?? null,
      status: "draft",
      orderOpenAt: iso(Date.parse(input.orderOpenAt)),
      orderCloseAt: iso(Date.parse(input.orderCloseAt)),
      delivery: { start: input.deliveryStart, end: input.deliveryEnd },
      timezone: "Europe/Berlin",
      openedAt: null,
      closedAt: null,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
      statusHistory: [
        {
          from: null,
          to: "draft",
          at: iso(ctx.now),
          source: "admin",
          by: ctx.admin.id,
          note: null,
        },
      ],
    };
    if (input.status === "scheduled") {
      assertWindowAhead(cargo, ctx.now);
      assertWindowFree(ctx.db, cargo);
    }
    ctx.db.cargos.push(cargo);
    if (source) copyProducts(ctx.db, source, cargo);
    if (input.status === "scheduled") {
      transition(
        ctx.db,
        cargo,
        "scheduled",
        { source: "admin", adminId: ctx.admin.id },
        ctx.now,
      );
    }
    return json({ cargo: cargoDetail(ctx.db, cargo, ctx.now) }, 201);
  });

  router.post(
    `${base}/rollover`,
    { permission: "cargos.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({ nextCargoId: zId, note: zNote(500) }),
      );
      const next = cargoById(ctx.db, input.nextCargoId);
      const current = ctx.db.cargos.find(
        (cargo) => cargo.status === "taking_orders" && cargo.id !== next.id,
      );
      const actor = {
        source: "admin" as const,
        adminId: ctx.admin.id,
        note: input.note,
      };
      // Both steps or none: what would refuse the opening is checked first.
      if (next.status !== "taking_orders") {
        if (!CARGO_ALLOWED[next.status].includes("taking_orders")) {
          throw fail(
            409,
            "CARGO_TRANSITION_NOT_ALLOWED",
            "This change of status is not allowed.",
            {
              from: next.status,
              to: "taking_orders",
              allowed: CARGO_ALLOWED[next.status],
            },
          );
        }
        assertWindowAhead(next, ctx.now);
      }
      const closed = current
        ? {
            ...transition(ctx.db, current, "orders_closed", actor, ctx.now),
            cargo: cargoDetail(ctx.db, current, ctx.now),
          }
        : null;
      const opened = transition(ctx.db, next, "taking_orders", actor, ctx.now);
      return json({
        closed: closed
          ? { changed: closed.changed, cargo: closed.cargo }
          : null,
        opened: {
          changed: opened.changed,
          cargo: cargoDetail(ctx.db, next, ctx.now),
        },
      });
    },
  );

  router.post(`${base}/check`, { permission: "cargos.manage" }, (ctx) =>
    json(runCargoCheck(ctx.db, ctx.now)),
  );

  router.get(`${base}/:id`, { permission: "cargos.read" }, (ctx) =>
    json({
      cargo: cargoDetail(
        ctx.db,
        cargoById(ctx.db, ctx.params.id ?? ""),
        ctx.now,
      ),
    }),
  );

  router.patch(`${base}/:id`, { permission: "cargos.manage" }, async (ctx) => {
    const input = await ctx.body(updateCargo);
    const cargo = cargoById(ctx.db, ctx.params.id ?? "");
    const refuse = () =>
      fail(409, "CARGO_NOT_EDITABLE", "This can no longer be changed.", {
        status: cargo.status,
      });
    if (cargo.status === "cancelled") throw refuse();
    if (
      input.orderOpenAt !== undefined &&
      !["draft", "scheduled"].includes(cargo.status)
    ) {
      throw refuse();
    }
    if (
      input.orderCloseAt !== undefined &&
      !["draft", "scheduled", "taking_orders"].includes(cargo.status)
    ) {
      throw refuse();
    }
    const daysChange =
      input.deliveryStart !== undefined || input.deliveryEnd !== undefined;
    if (daysChange && cargo.status === "delivered") throw refuse();

    const next = {
      ...cargo,
      orderOpenAt: input.orderOpenAt
        ? iso(Date.parse(input.orderOpenAt))
        : cargo.orderOpenAt,
      orderCloseAt: input.orderCloseAt
        ? iso(Date.parse(input.orderCloseAt))
        : cargo.orderCloseAt,
      delivery: {
        start: input.deliveryStart ?? cargo.delivery.start,
        end: input.deliveryEnd ?? cargo.delivery.end,
      },
    };
    const timesChange =
      input.orderOpenAt !== undefined || input.orderCloseAt !== undefined;
    if (timesChange || daysChange) {
      assertDates(
        next.orderOpenAt,
        next.orderCloseAt,
        next.delivery.start,
        next.delivery.end,
      );
    }
    if (
      timesChange &&
      (cargo.status === "scheduled" || cargo.status === "taking_orders")
    ) {
      assertWindowAhead(next, ctx.now);
      assertWindowFree(ctx.db, next);
    }
    const before = { ...cargo.delivery };
    cargo.orderOpenAt = next.orderOpenAt;
    cargo.orderCloseAt = next.orderCloseAt;
    cargo.delivery = next.delivery;
    if (
      daysChange &&
      (next.delivery.start !== before.start || next.delivery.end !== before.end)
    ) {
      // New delivery days reach the orders that have not left yet (9).
      for (const order of ctx.db.orders) {
        if (order.cargo.id !== cargo.id) continue;
        if (
          !["confirmed", "preparing", "delivery_failed"].includes(order.status)
        )
          continue;
        const from = `${order.delivery.promisedStart}/${order.delivery.promisedEnd}`;
        order.delivery.promisedStart = next.delivery.start;
        order.delivery.promisedEnd = next.delivery.end;
        pushHistory(
          order,
          {
            field: "delivery_window",
            from,
            to: `${next.delivery.start}/${next.delivery.end}`,
            adminId: ctx.admin.id,
          },
          ctx.now,
        );
        const customer = customerOf(ctx.db, order);
        if (customer) {
          queueMessage(
            ctx.db,
            { type: "delivery_rescheduled", customer, order },
            ctx.now,
          );
        }
      }
    }
    if (input.internalName !== undefined)
      cargo.internalName = input.internalName;
    if (input.customerName !== undefined)
      cargo.customerName = input.customerName;
    if (input.customerMessage !== undefined)
      cargo.customerMessage = input.customerMessage;
    if (input.internalNotes !== undefined)
      cargo.internalNotes = input.internalNotes;
    cargo.updatedAt = iso(ctx.now);
    // Orders show the delivery days of the cargo they are in.
    if (daysChange) {
      for (const order of ordersOf(ctx.db, cargo.id)) {
        order.delivery.promisedStart = cargo.delivery.start;
        order.delivery.promisedEnd = cargo.delivery.end;
      }
    }
    return json({ cargo: cargoDetail(ctx.db, cargo, ctx.now) });
  });

  router.delete(`${base}/:id`, { permission: "cargos.manage" }, (ctx) => {
    const cargo = cargoById(ctx.db, ctx.params.id ?? "");
    if (cargo.status !== "draft") {
      throw fail(409, "CARGO_NOT_DELETABLE", "Only a draft can be deleted.");
    }
    ctx.db.cargos = ctx.db.cargos.filter((entry) => entry.id !== cargo.id);
    ctx.db.cargoProducts = ctx.db.cargoProducts.filter(
      (entry) => entry.cargoId !== cargo.id,
    );
    return noContent();
  });

  for (const [action, to] of [
    ["open", "taking_orders"],
    ["close", "orders_closed"],
  ] as const) {
    router.post(
      `${base}/:id/${action}`,
      { permission: "cargos.manage" },
      async (ctx) => {
        const input = await ctx.body(noteBody);
        const cargo = cargoById(ctx.db, ctx.params.id ?? "");
        const result = transition(
          ctx.db,
          cargo,
          to,
          { source: "admin", adminId: ctx.admin.id, note: input.note },
          ctx.now,
        );
        return json({
          changed: result.changed,
          cargo: cargoDetail(ctx.db, cargo, ctx.now),
        });
      },
    );
  }

  router.put(
    `${base}/:id/status`,
    { permission: "cargos.manage" },
    async (ctx) => {
      const input = await ctx.body(statusBody);
      const cargo = cargoById(ctx.db, ctx.params.id ?? "");
      const result = transition(
        ctx.db,
        cargo,
        input.status,
        {
          source: "admin",
          adminId: ctx.admin.id,
          note: input.note,
          excludeOrderIds: input.excludeOrderIds,
          moveOrdersToCargoId: input.moveOrdersToCargoId,
        },
        ctx.now,
      );
      return json({
        changed: result.changed,
        cargo: cargoDetail(ctx.db, cargo, ctx.now),
        ordersMoved: result.ordersMoved,
      });
    },
  );

  // --- 9.3 Products of a cargo ----------------------------------------------

  router.get(
    `${base}/:cargoId/products`,
    { permission: "cargos.read" },
    (ctx) => {
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      const show =
        enumParam(ctx.query, "show", [
          "all",
          "enabled",
          "not_enabled",
        ] as const) ?? "all";
      const categoryId = idParam(ctx.query, "categoryId");
      const includeArchived = boolParam(ctx.query, "includeArchived") ?? false;
      const q = ctx.query.get("q")?.trim().toLowerCase();
      if (q !== undefined && q !== "" && (q.length < 2 || q.length > 80)) {
        throw validationFailed([
          { field: "q", problems: ["q must be 2 to 80 characters long"] },
        ]);
      }
      const inside = categoryId
        ? new Set(descendantIds(ctx.db, categoryId))
        : null;
      const rows = ctx.db.products
        .filter((product) => includeArchived || product.status !== "archived")
        .filter((product) => !inside || inside.has(product.categoryId))
        .filter(
          (product) =>
            !q ||
            product.sku.toLowerCase().startsWith(q) ||
            `${product.name.en} ${product.name.de ?? ""} ${product.brand ?? ""}`
              .toLowerCase()
              .split(/\s+/)
              .some((word) => word.startsWith(q)),
        )
        .map((product) => ({
          product,
          cargo: settingOf(ctx.db, cargo.id, product.id),
        }))
        .filter(
          (row) =>
            show === "all" ||
            (show === "enabled" ? row.cargo.isEnabled : !row.cargo.isEnabled),
        )
        .sort(
          (a, b) =>
            a.product.name.en.localeCompare(b.product.name.en) ||
            a.product.packSize.value - b.product.packSize.value,
        );
      const result = page(rows, ctx.query);
      return json({
        ...result,
        items: result.items.map((row) => ({
          product: productSummary(ctx.db, row.product),
          cargo: row.cargo,
        })),
      });
    },
  );

  router.put(
    `${base}/:cargoId/products`,
    { permission: "cargos.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          items: z
            .array(
              z.strictObject({
                productId: zId,
                isEnabled: z.boolean().optional(),
                maxQuantity: z.number().int().min(0).max(1_000_000).nullish(),
              }),
            )
            .min(1)
            .max(500),
        }),
      );
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      assertProductsEditable(cargo);
      assertProducts(
        ctx.db,
        input.items.map((item) => item.productId),
      );
      for (const item of input.items) {
        upsertSetting(ctx.db, cargo.id, item.productId, {
          isEnabled: item.isEnabled ?? true,
          maxQuantity: item.maxQuantity ?? null,
        });
      }
      return json({ products: productCounts(ctx.db, cargo.id) });
    },
  );

  router.post(
    `${base}/:cargoId/products/copy`,
    { permission: "cargos.manage" },
    async (ctx) => {
      const input = await ctx.body(z.strictObject({ fromCargoId: zId }));
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      const from = cargoById(ctx.db, input.fromCargoId);
      assertProductsEditable(cargo);
      const added = copyProducts(ctx.db, from, cargo);
      return json({ added, products: productCounts(ctx.db, cargo.id) });
    },
  );

  router.patch(
    `${base}/:cargoId/products/:productId`,
    { permission: "cargos.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          isEnabled: z.boolean().optional(),
          maxQuantity: z.number().int().min(0).max(1_000_000).nullish(),
        }),
      );
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      const productId = ctx.params.productId ?? "";
      assertProductsEditable(cargo);
      assertProducts(ctx.db, [productId]);
      upsertSetting(ctx.db, cargo.id, productId, input);
      return json({ productId, cargo: settingOf(ctx.db, cargo.id, productId) });
    },
  );

  router.delete(
    `${base}/:cargoId/products/:productId`,
    { permission: "cargos.manage" },
    (ctx) => {
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      const entry = ctx.db.cargoProducts.find(
        (setting) =>
          setting.cargoId === cargo.id &&
          setting.productId === ctx.params.productId,
      );
      if (!entry) {
        throw fail(
          404,
          "CARGO_PRODUCT_NOT_FOUND",
          "The product has no setting in this cargo.",
        );
      }
      assertProductsEditable(cargo);
      if (entry.orderedQuantity > 0) {
        throw fail(
          409,
          "CARGO_PRODUCT_HAS_ORDERS",
          "The product was ordered in this cargo. Disable it instead.",
        );
      }
      ctx.db.cargoProducts = ctx.db.cargoProducts.filter(
        (setting) => setting !== entry,
      );
      return noContent();
    },
  );

  // --- 9.4 All orders of a cargo at once ------------------------------------

  router.post(
    `${base}/:cargoId/orders/status`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          status: z.enum(["preparing", "dispatched", "delivered"]),
          excludeOrderIds: zIds(1000),
          note: zNote(500),
        }),
      );
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      const excluded = new Set(input.excludeOrderIds ?? []);
      const from: Record<typeof input.status, string[]> = {
        preparing: ["confirmed"],
        dispatched: ["confirmed", "preparing"],
        delivered: ["dispatched"],
      };
      let changed = 0;
      for (const order of ordersOf(ctx.db, cargo.id)) {
        if (
          excluded.has(order.id) ||
          !from[input.status].includes(order.status)
        )
          continue;
        setOrderStatus(
          ctx.db,
          order,
          input.status,
          { adminId: ctx.admin.id, note: input.note },
          ctx.now,
        );
        changed += 1;
      }
      return json({ cargo: cargo.code, status: input.status, changed });
    },
  );

  router.post(
    `${base}/:cargoId/orders/delivery-method`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          method: z.enum(["radhe_delivery", "dhl", "hermes"]),
          excludeOrderIds: zIds(1000),
          note: zNote(500),
        }),
      );
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      const excluded = new Set(input.excludeOrderIds ?? []);
      let changed = 0;
      for (const order of ordersOf(ctx.db, cargo.id)) {
        if (excluded.has(order.id)) continue;
        if (["delivered", "cancelled", "returned"].includes(order.status))
          continue;
        if (
          setDeliveryMethod(
            order,
            input.method,
            { adminId: ctx.admin.id, note: input.note },
            ctx.now,
          )
        ) {
          changed += 1;
        }
      }
      return json({ cargo: cargo.code, method: input.method, changed });
    },
  );

  router.post(
    `${base}/:cargoId/orders/move`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({ toCargoId: zId, note: zNote(500) }),
      );
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      const target = cargoById(ctx.db, input.toCargoId);
      assertCanTakeOrders(target);
      let moved = 0;
      for (const order of ordersOf(ctx.db, cargo.id)) {
        if (!MOVABLE.includes(order.status)) continue;
        moveOrder(
          ctx.db,
          order,
          target,
          { adminId: ctx.admin.id, note: input.note },
          ctx.now,
        );
        moved += 1;
      }
      return json({ from: cargo.code, to: target.code, moved });
    },
  );

  // --- 9.5 Payments of a cargo ----------------------------------------------

  const toActivate = (db: Db, cargoId: string) =>
    ordersOf(db, cargoId).filter(
      (order) =>
        order.status === "delivered" &&
        !order.payment &&
        order.finalTotals.total > 0,
    );

  router.post(
    `${base}/:cargoId/payments/activate`,
    { permission: "payments.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          deadlineDays: z.number().int().min(1).max(60),
          note: zNote(500),
          excludeOrderIds: zIds(1000),
        }),
      );
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      const missing = companyMissing(ctx.db);
      if (missing.length > 0) {
        throw fail(
          409,
          "COMPANY_DETAILS_MISSING",
          "Complete the company settings first.",
          { missing },
        );
      }
      const excluded = new Set(input.excludeOrderIds ?? []);
      const eligible = toActivate(ctx.db, cargo.id)
        .filter((order) => !excluded.has(order.id))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      // A batch per request: the panel asks again while orders remain.
      const batch = eligible.slice(0, 100);
      const activated: string[] = [];
      for (const order of batch) {
        const invoice = activatePayment(
          ctx.db,
          order,
          input.deadlineDays,
          ctx.admin.id,
          ctx.now,
        );
        const customer = customerOf(ctx.db, order);
        if (customer) {
          queueMessage(
            ctx.db,
            {
              type: "payment_request",
              customer,
              order,
              attachInvoiceId: invoice.id,
              data: {
                amountDue: invoice.total,
                deadline: order.payment?.deadline,
              },
            },
            ctx.now,
          );
        }
        activated.push(order.orderNumber);
      }
      return json({
        cargo: cargo.code,
        activated,
        failed: [],
        remaining: eligible.length - batch.length,
      });
    },
  );

  router.get(
    `${base}/:cargoId/payments/summary`,
    { permission: "payments.read" },
    (ctx) => {
      const cargo = cargoById(ctx.db, ctx.params.cargoId ?? "");
      const orders = ordersOf(ctx.db, cargo.id).filter(
        (order) => order.status !== "cancelled",
      );
      const byStatus = new Map<
        PaymentStatus,
        { orders: number; amountDue: number; paid: number; refunded: number }
      >();
      for (const order of orders) {
        const entry = byStatus.get(order.paymentStatus) ?? {
          orders: 0,
          amountDue: 0,
          paid: 0,
          refunded: 0,
        };
        entry.orders += 1;
        entry.amountDue += order.payment?.amountDue ?? 0;
        entry.paid += order.payment?.paidAmount ?? 0;
        entry.refunded += order.payment?.refundedAmount ?? 0;
        byStatus.set(order.paymentStatus, entry);
      }
      const sum = (status: PaymentStatus[]) =>
        orders
          .filter((order) => status.includes(order.paymentStatus))
          .reduce(
            (total, order) => ({
              orders: total.orders + 1,
              amount: total.amount + (order.payment?.amountDue ?? 0),
            }),
            { orders: 0, amount: 0 },
          );
      const pending = toActivate(ctx.db, cargo.id);
      return json({
        cargo: cargo.code,
        summary: {
          byStatus: [...byStatus].map(([status, entry]) => ({
            status,
            ...entry,
          })),
          toActivate: {
            orders: pending.length,
            amount: pending.reduce(
              (total, order) => total + order.finalTotals.total,
              0,
            ),
          },
          open: sum(["due", "overdue"]),
          overdue: sum(["overdue"]),
          collected: orders.reduce(
            (total, order) => total + (order.payment?.paidAmount ?? 0),
            0,
          ),
          refunded: orders.reduce(
            (total, order) => total + (order.payment?.refundedAmount ?? 0),
            0,
          ),
          waived: {
            orders: orders.filter((order) => order.paymentStatus === "waived")
              .length,
          },
        },
      });
    },
  );
}
