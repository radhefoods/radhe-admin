import { describe, expect, it } from "vitest";
import { NOTIFICATION_STATUSES, NOTIFICATION_TYPES } from "@/lib/api/types";
import {
  STATUS_MEANING,
  TYPE_OPTIONS,
  canCancel,
  canRetry,
  dataRows,
  humanizeKey,
  refusalText,
  retryBlocked,
  runDidSomething,
  runResultText,
  typeLabel,
} from "./labels";

describe("the words of the log", () => {
  it("makes the API's type names readable", () => {
    expect(typeLabel("payment_failed")).toBe("Payment failed");
    expect(typeLabel("refund_completed")).toBe("Refund completed");
    expect(TYPE_OPTIONS.map((option) => option.value)).toEqual([
      ...NOTIFICATION_TYPES,
    ]);
  });

  it("explains every status", () => {
    for (const status of NOTIFICATION_STATUSES) {
      expect(STATUS_MEANING[status]).toMatch(/\.$/);
    }
  });
});

describe("what can be done with a message", () => {
  it("offers a retry for failed, skipped and cancelled messages only", () => {
    expect(NOTIFICATION_STATUSES.filter(canRetry)).toEqual([
      "failed",
      "skipped",
      "cancelled",
    ]);
  });

  it("offers the cancellation for queued messages only", () => {
    expect(NOTIFICATION_STATUSES.filter(canCancel)).toEqual(["queued"]);
  });

  it("holds a WhatsApp retry back while WhatsApp is not configured", () => {
    const whatsapp = { channel: "whatsapp", type: "order_dispatched" } as const;
    expect(retryBlocked(whatsapp, false)).toMatch(/WhatsApp is not configured/);
    expect(retryBlocked(whatsapp, true)).toBeNull();
    // Not known yet: the API decides.
    expect(retryBlocked(whatsapp, undefined)).toBeNull();
  });

  it("holds a WhatsApp retry back for a type without a template", () => {
    const message = { channel: "whatsapp", type: "order_confirmed" } as const;
    expect(retryBlocked(message, true)).toMatch(/no WhatsApp template/);
  });

  it("never holds an email back", () => {
    expect(
      retryBlocked({ channel: "email", type: "order_confirmed" }, false),
    ).toBeNull();
  });

  it("explains the API's refusal", () => {
    const email = { channel: "email", type: "order_dispatched" } as const;
    expect(refusalText("retry", email, false)).toMatch(
      /sent or queued in the meantime/,
    );
    expect(
      refusalText(
        "retry",
        { channel: "whatsapp", type: "order_dispatched" },
        false,
      ),
    ).toMatch(/WhatsApp is not configured/);
    expect(refusalText("cancel", email, true)).toMatch(/Only a queued message/);
  });
});

describe("the values a message was rendered from", () => {
  it("reads camel case and snake case as words", () => {
    expect(humanizeKey("amountDue")).toBe("Amount due");
    expect(humanizeKey("payUrl")).toBe("Pay URL");
    expect(humanizeKey("order_number")).toBe("Order number");
    expect(humanizeKey("invoiceId")).toBe("Invoice ID");
    expect(humanizeKey("deadline")).toBe("Deadline");
  });

  it("recognises amounts, moments, days and addresses", () => {
    const rows = dataRows({
      orderNumber: "RF-1084",
      amountDue: 3193,
      deadline: "2026-09-20T21:59:59.000Z",
      deliveredOn: "2026-09-18",
      payUrl: "https://radhefoods.de/pay/abc",
      itemCount: 3,
      paid: false,
      note: null,
    });
    expect(rows).toEqual([
      {
        key: "orderNumber",
        label: "Order number",
        value: { kind: "text", text: "RF-1084" },
      },
      {
        key: "amountDue",
        label: "Amount due",
        value: { kind: "money", cents: 3193 },
      },
      {
        key: "deadline",
        label: "Deadline",
        value: { kind: "moment", iso: "2026-09-20T21:59:59.000Z" },
      },
      {
        key: "deliveredOn",
        label: "Delivered on",
        value: { kind: "day", day: "2026-09-18" },
      },
      {
        key: "payUrl",
        label: "Pay URL",
        value: { kind: "link", url: "https://radhefoods.de/pay/abc" },
      },
      // A count is a number, not money.
      {
        key: "itemCount",
        label: "Item count",
        value: { kind: "text", text: "3" },
      },
      { key: "paid", label: "Paid", value: { kind: "text", text: "No" } },
      { key: "note", label: "Note", value: { kind: "empty" } },
    ]);
  });

  it("gives a translated text one row per language", () => {
    expect(
      dataRows({ message: { en: "Fresh mangoes", de: "Frische Mangos" } }),
    ).toEqual([
      {
        key: "message.en",
        label: "Message (English)",
        value: { kind: "text", text: "Fresh mangoes" },
      },
      {
        key: "message.de",
        label: "Message (German)",
        value: { kind: "text", text: "Frische Mangos" },
      },
    ]);
  });

  it("flattens nested values and lists", () => {
    expect(
      dataRows({
        address: { city: "Frankfurt", postalCode: "60311" },
        tags: ["a", "b"],
        items: [{ name: "Rice", total: 1999 }],
        empty: {},
      }),
    ).toEqual([
      {
        key: "address.city",
        label: "Address: City",
        value: { kind: "text", text: "Frankfurt" },
      },
      {
        key: "address.postalCode",
        label: "Address: Postal code",
        value: { kind: "text", text: "60311" },
      },
      { key: "tags", label: "Tags", value: { kind: "text", text: "a, b" } },
      {
        key: "items.0.name",
        label: "Items 1: Name",
        value: { kind: "text", text: "Rice" },
      },
      {
        key: "items.0.total",
        label: "Items 1: Total",
        value: { kind: "money", cents: 1999 },
      },
      { key: "empty", label: "Empty", value: { kind: "empty" } },
    ]);
  });

  it("has no rows without data", () => {
    expect(dataRows({})).toEqual([]);
    expect(dataRows(null)).toEqual([]);
    expect(dataRows(undefined)).toEqual([]);
  });
});

describe("the result of a run of the queue", () => {
  it("lists every count the API returns", () => {
    const result = { sent: 3, retried: 1, failed: 0, skipped: 0, recovered: 0 };
    expect(runResultText(result)).toBe(
      "3 sent, 1 retried, 0 failed, 0 skipped, 0 recovered",
    );
    expect(runDidSomething(result)).toBe(true);
    expect(
      runDidSomething({
        sent: 0,
        retried: 0,
        failed: 0,
        skipped: 0,
        recovered: 0,
      }),
    ).toBe(false);
  });
});
