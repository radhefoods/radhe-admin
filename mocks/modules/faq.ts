// Section 22: the FAQ, groups and questions. doc/FAQ.md.

import { z } from "zod";
import type { Faq, FaqGroup } from "../../src/lib/api/types/index.ts";
import type { Db } from "../db.ts";
import {
  boolParam,
  fail,
  idParam,
  json,
  newId,
  noContent,
  zId,
  zTranslated,
} from "../http.ts";
import type { Router } from "../router.ts";
import { DAY, HOUR, iso } from "../time.ts";

/** A group as stored: the counts are worked out on reading. */
export type FaqGroupRecord = Omit<FaqGroup, "faqCount" | "publishedCount">;
/** A question as stored: its group is looked up on reading. */
export type FaqRecord = Omit<Faq, "group">;

const QUESTION_MAX = 300;
const ANSWER_MAX = 20_000;
const MAX_ORDER_IDS = 500;

export function orderedGroups(db: Db): FaqGroupRecord[] {
  return [...db.faqGroups].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The questions of one group (`null`: without a group), by position. */
export function faqsOf(db: Db, groupId: string | null): FaqRecord[] {
  return db.faqs
    .filter((faq) => faq.groupId === groupId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function groupView(
  db: Db,
  group: FaqGroupRecord,
  withCounts: boolean,
): FaqGroup {
  if (!withCounts) return group;
  const faqs = faqsOf(db, group.id);
  return {
    ...group,
    faqCount: faqs.length,
    publishedCount: faqs.filter((faq) => faq.isPublished).length,
  };
}

function faqView(db: Db, faq: FaqRecord): Faq {
  const group = faq.groupId
    ? db.faqGroups.find((entry) => entry.id === faq.groupId)
    : undefined;
  return {
    ...faq,
    group: group ? { id: group.id, name: group.name } : null,
  };
}

function groupById(db: Db, id: string): FaqGroupRecord {
  const found = db.faqGroups.find((entry) => entry.id === id);
  if (!found) throw fail(404, "FAQ_GROUP_NOT_FOUND", "FAQ group not found.");
  return found;
}

function faqById(db: Db, id: string): FaqRecord {
  const found = db.faqs.find((entry) => entry.id === id);
  if (!found) throw fail(404, "FAQ_NOT_FOUND", "FAQ not found.");
  return found;
}

function renumber(db: Db, groupId: string | null): void {
  faqsOf(db, groupId).forEach((faq, index) => {
    faq.sortOrder = index;
  });
}

/** Grouped questions first, groups in display order, then the ones without a group. */
function allFaqsInOrder(db: Db): FaqRecord[] {
  return [
    ...orderedGroups(db).flatMap((group) => faqsOf(db, group.id)),
    ...faqsOf(db, null),
  ];
}

const zGroupInput = z.strictObject({
  name: zTranslated(120),
  isVisible: z.boolean().optional(),
});
const zGroupPatch = z.strictObject({
  name: zTranslated(120).optional(),
  isVisible: z.boolean().optional(),
});
const zFaqInput = z.strictObject({
  question: zTranslated(QUESTION_MAX),
  answer: zTranslated(ANSWER_MAX),
  groupId: zId.nullable().optional(),
  isPublished: z.boolean().optional(),
});
const zFaqPatch = z.strictObject({
  question: zTranslated(QUESTION_MAX).optional(),
  answer: zTranslated(ANSWER_MAX).optional(),
  groupId: zId.nullable().optional(),
  isPublished: z.boolean().optional(),
});

export function registerFaq(router: Router): void {
  const groups = "/v1/admin/faq-groups";
  const faqs = "/v1/admin/faqs";
  const read = { permission: "content.read" };
  const manage = { permission: "content.manage" };

  // --- Groups ---------------------------------------------------------------

  router.get(groups, read, (ctx) => {
    const ungrouped = faqsOf(ctx.db, null);
    return json({
      items: orderedGroups(ctx.db).map((group) =>
        groupView(ctx.db, group, true),
      ),
      ungrouped: {
        total: ungrouped.length,
        published: ungrouped.filter((faq) => faq.isPublished).length,
      },
    });
  });

  router.post(groups, manage, async (ctx) => {
    const input = await ctx.body(zGroupInput);
    const record: FaqGroupRecord = {
      id: newId(ctx.now),
      name: { en: input.name.en, de: input.name.de ?? null },
      isVisible: input.isVisible ?? true,
      sortOrder: ctx.db.faqGroups.length,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.faqGroups.push(record);
    return json({ group: groupView(ctx.db, record, false) }, 201);
  });

  // Before `:id`: "order" is not an id.
  router.put(`${groups}/order`, manage, async (ctx) => {
    const input = await ctx.body(
      z.strictObject({ orderedIds: z.array(zId).min(1).max(MAX_ORDER_IDS) }),
    );
    const expected = orderedGroups(ctx.db).map((group) => group.id);
    const same =
      expected.length === input.orderedIds.length &&
      new Set(input.orderedIds).size === input.orderedIds.length &&
      input.orderedIds.every((id) => expected.includes(id));
    if (!same) {
      throw fail(
        400,
        "FAQ_GROUP_ORDER_INVALID",
        "orderedIds must name every group exactly once.",
        { expected },
      );
    }
    input.orderedIds.forEach((id, index) => {
      groupById(ctx.db, id).sortOrder = index;
    });
    return json({
      items: orderedGroups(ctx.db).map((group) =>
        groupView(ctx.db, group, true),
      ),
    });
  });

  router.get(`${groups}/:id`, read, (ctx) =>
    json({
      group: groupView(ctx.db, groupById(ctx.db, ctx.params.id ?? ""), false),
    }),
  );

  router.patch(`${groups}/:id`, manage, async (ctx) => {
    const input = await ctx.body(zGroupPatch);
    const record = groupById(ctx.db, ctx.params.id ?? "");
    if (input.name)
      record.name = { en: input.name.en, de: input.name.de ?? null };
    if (input.isVisible !== undefined) record.isVisible = input.isVisible;
    record.updatedAt = iso(ctx.now);
    return json({ group: groupView(ctx.db, record, false) });
  });

  router.delete(`${groups}/:id`, manage, (ctx) => {
    const record = groupById(ctx.db, ctx.params.id ?? "");
    const inGroup = faqsOf(ctx.db, record.id).length;
    if (inGroup > 0) {
      throw fail(
        409,
        "FAQ_GROUP_HAS_FAQS",
        "The group still has questions. Move or delete them first.",
        { faqs: inGroup },
      );
    }
    ctx.db.faqGroups = ctx.db.faqGroups.filter((entry) => entry !== record);
    orderedGroups(ctx.db).forEach((group, index) => {
      group.sortOrder = index;
    });
    return noContent();
  });

  // --- Questions --------------------------------------------------------------

  router.get(faqs, read, (ctx) => {
    const groupId = idParam(ctx.query, "groupId");
    const ungrouped = boolParam(ctx.query, "ungrouped");
    const isPublished = boolParam(ctx.query, "isPublished");
    let rows = allFaqsInOrder(ctx.db);
    if (groupId) rows = rows.filter((faq) => faq.groupId === groupId);
    if (ungrouped) rows = rows.filter((faq) => faq.groupId === null);
    if (isPublished !== undefined) {
      rows = rows.filter((faq) => faq.isPublished === isPublished);
    }
    return json({ items: rows.map((faq) => faqView(ctx.db, faq)) });
  });

  router.post(faqs, manage, async (ctx) => {
    const input = await ctx.body(zFaqInput);
    const groupId = input.groupId ?? null;
    if (groupId) groupById(ctx.db, groupId);
    const published = input.isPublished ?? false;
    const record: FaqRecord = {
      id: newId(ctx.now),
      question: { en: input.question.en, de: input.question.de ?? null },
      answer: { en: input.answer.en, de: input.answer.de ?? null },
      groupId,
      sortOrder: faqsOf(ctx.db, groupId).length,
      isPublished: published,
      publishedAt: published ? iso(ctx.now) : null,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.faqs.push(record);
    return json({ faq: faqView(ctx.db, record) }, 201);
  });

  router.put(`${faqs}/order`, manage, async (ctx) => {
    const input = await ctx.body(
      z.strictObject({
        groupId: zId.nullable().optional(),
        orderedIds: z.array(zId).min(1).max(MAX_ORDER_IDS),
      }),
    );
    const groupId = input.groupId ?? null;
    if (groupId) groupById(ctx.db, groupId);
    const current = faqsOf(ctx.db, groupId);
    const expected = current.map((faq) => faq.id);
    const unknown = input.orderedIds.filter((id) => !expected.includes(id));
    if (
      unknown.length > 0 ||
      new Set(input.orderedIds).size !== input.orderedIds.length
    ) {
      throw fail(
        400,
        "FAQ_ORDER_INVALID",
        "orderedIds must name questions of this group, each once.",
        { unknown, expected },
      );
    }
    // The named ones first, in this order; the rest keeps its order.
    const next = [
      ...input.orderedIds.map((id) => faqById(ctx.db, id)),
      ...current.filter((faq) => !input.orderedIds.includes(faq.id)),
    ];
    next.forEach((faq, index) => {
      faq.sortOrder = index;
    });
    return json({
      items: faqsOf(ctx.db, groupId).map((faq) => faqView(ctx.db, faq)),
    });
  });

  router.get(`${faqs}/:id`, read, (ctx) =>
    json({ faq: faqView(ctx.db, faqById(ctx.db, ctx.params.id ?? "")) }),
  );

  router.patch(`${faqs}/:id`, manage, async (ctx) => {
    const input = await ctx.body(zFaqPatch);
    const record = faqById(ctx.db, ctx.params.id ?? "");
    if (input.question) {
      record.question = {
        en: input.question.en,
        de: input.question.de ?? null,
      };
    }
    if (input.answer) {
      record.answer = { en: input.answer.en, de: input.answer.de ?? null };
    }
    if (input.groupId !== undefined && input.groupId !== record.groupId) {
      if (input.groupId) groupById(ctx.db, input.groupId);
      const from = record.groupId;
      record.groupId = input.groupId;
      // A moved question goes last in its new group.
      record.sortOrder = faqsOf(ctx.db, input.groupId).length - 1;
      renumber(ctx.db, from);
      renumber(ctx.db, input.groupId);
    }
    if (input.isPublished !== undefined) {
      record.isPublished = input.isPublished;
      if (input.isPublished && !record.publishedAt)
        record.publishedAt = iso(ctx.now);
    }
    record.updatedAt = iso(ctx.now);
    return json({ faq: faqView(ctx.db, record) });
  });

  router.delete(`${faqs}/:id`, manage, (ctx) => {
    const record = faqById(ctx.db, ctx.params.id ?? "");
    ctx.db.faqs = ctx.db.faqs.filter((entry) => entry !== record);
    renumber(ctx.db, record.groupId);
    return noContent();
  });
}

// --- Demo data ----------------------------------------------------------------

/** Three groups with their questions, one hidden group, one question without a group. */
export function seedFaq(db: Db, now: number): void {
  const at = now - 12 * DAY;
  const group = (name: [string, string], isVisible = true): FaqGroupRecord => {
    const record: FaqGroupRecord = {
      id: newId(at + db.faqGroups.length * HOUR),
      name: { en: name[0], de: name[1] },
      isVisible,
      sortOrder: db.faqGroups.length,
      createdAt: iso(at),
      updatedAt: iso(at),
    };
    db.faqGroups.push(record);
    return record;
  };
  const question = (
    groupId: string | null,
    q: [string, string | null],
    a: [string, string | null],
    isPublished = true,
  ): void => {
    const created = at + db.faqs.length * HOUR + 5 * 60_000;
    db.faqs.push({
      id: newId(created),
      question: { en: q[0], de: q[1] },
      answer: { en: a[0], de: a[1] },
      groupId,
      sortOrder: faqsOf(db, groupId).length,
      isPublished,
      publishedAt: isPublished ? iso(created + 10 * 60_000) : null,
      createdAt: iso(created),
      updatedAt: iso(created + 10 * 60_000),
    });
  };

  const orders = group(["Orders", "Bestellungen"]);
  const delivery = group(["Delivery", "Lieferung"]);
  const returns = group(["Returns", "Rücksendungen"]);
  const payment = group(["Payment", "Bezahlung"], false);

  question(
    orders.id,
    ["Can I cancel my order?", "Kann ich meine Bestellung stornieren?"],
    [
      "Yes, until we start preparing it. Open the order in your account and choose *Cancel order*. The money goes back the way it came.",
      "Ja, bis wir mit der Vorbereitung beginnen. Öffnen Sie die Bestellung in Ihrem Konto und wählen Sie *Bestellung stornieren*.",
    ],
  );
  question(
    orders.id,
    ["Can I track my order?", "Kann ich meine Bestellung verfolgen?"],
    [
      "Yes: once the parcel is on its way you get an email with the tracking link, and the order in your account shows it too.",
      "Ja: Sobald das Paket unterwegs ist, erhalten Sie eine E-Mail mit dem Sendungslink; die Bestellung in Ihrem Konto zeigt ihn ebenfalls.",
    ],
  );
  question(
    orders.id,
    ["Is there a minimum order value?", null],
    ["No. Orders below 50 euros pay the delivery fee shown at checkout.", null],
    false,
  );
  question(
    delivery.id,
    ["How long does delivery take?", "Wie lange dauert die Lieferung?"],
    [
      "2 to 4 working days within Germany.",
      "2 bis 4 Werktage innerhalb Deutschlands.",
    ],
  );
  question(
    delivery.id,
    ["Do you deliver chilled products?", "Liefert ihr gekühlte Produkte?"],
    [
      "Chilled products travel in insulated boxes with cooling packs and are only dispatched Monday to Wednesday.",
      "Gekühlte Produkte reisen in Isolierboxen mit Kühlakkus und werden nur montags bis mittwochs verschickt.",
    ],
  );
  question(
    returns.id,
    ["Can I return food?", "Kann ich Lebensmittel zurückgeben?"],
    [
      "Sealed, non-perishable products can be returned within 14 days. Open the order and choose *Return items*; we confirm the return and tell you how to send it back.\n\nChilled and fresh products cannot be returned for hygiene reasons.",
      "Versiegelte, nicht verderbliche Produkte können innerhalb von 14 Tagen zurückgegeben werden. Öffnen Sie die Bestellung und wählen Sie *Artikel zurücksenden*.\n\nGekühlte und frische Produkte sind aus Hygienegründen von der Rückgabe ausgeschlossen.",
    ],
  );
  question(
    payment.id,
    [
      "Which payment methods do you accept?",
      "Welche Zahlungsarten akzeptiert ihr?",
    ],
    [
      "Card and PayPal, through our payment page.",
      "Karte und PayPal über unsere Bezahlseite.",
    ],
  );
  question(
    null,
    ["Do you have a shop in Frankfurt?", "Habt ihr ein Geschäft in Frankfurt?"],
    [
      "Not yet. We deliver all over Germany.",
      "Noch nicht. Wir liefern deutschlandweit.",
    ],
  );
}
