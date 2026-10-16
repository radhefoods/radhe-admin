import { describe, expect, it } from "vitest";
import {
  announcementDefaults,
  announcementSchema,
  customersReached,
  isAbsoluteUrl,
  messagesQueued,
  toAnnouncementInput,
  withoutLinkTargets,
  type AnnouncementFormValues,
} from "./schema";

const valid: AnnouncementFormValues = {
  ...announcementDefaults,
  subject: { en: "Fresh mangoes are in", de: "" },
  message: { en: "The first Alphonso mangoes arrive.", de: "" },
};

function problems(values: AnnouncementFormValues): Record<string, string> {
  const result = announcementSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

describe("the rules of an announcement", () => {
  it("accepts English alone", () => {
    expect(problems(valid)).toEqual({});
  });

  it("needs the English subject and message", () => {
    expect(
      problems({ ...valid, subject: { en: "  ", de: "Nur deutsch" } }),
    ).toEqual({
      "subject.en": "The English subject is required.",
    });
    expect(problems({ ...valid, message: { en: "", de: "" } })).toEqual({
      "message.en": "The English message is required.",
    });
  });

  it("keeps to the lengths of the API", () => {
    expect(
      problems({
        ...valid,
        subject: { en: "x".repeat(160), de: "y".repeat(160) },
      }),
    ).toEqual({});
    expect(
      problems({ ...valid, subject: { en: "x".repeat(161), de: "" } })[
        "subject.en"
      ],
    ).toBe("At most 160 characters.");
    expect(
      problems({
        ...valid,
        message: { en: "x".repeat(2000), de: "y".repeat(2000) },
      }),
    ).toEqual({});
    expect(
      problems({ ...valid, message: { en: "x", de: "y".repeat(2001) } })[
        "message.de"
      ],
    ).toBe("At most 2,000 characters.");
  });

  it("takes an absolute link of up to 500 characters, or none", () => {
    expect(
      problems({ ...valid, link: "https://radhefoods.de/products/mango" }),
    ).toEqual({});
    expect(problems({ ...valid, link: "" })).toEqual({});
    expect(problems({ ...valid, link: "radhefoods.de/products" }).link).toMatch(
      /full address/,
    );
    expect(problems({ ...valid, link: "/products/mango" }).link).toMatch(
      /full address/,
    );
    expect(
      problems({ ...valid, link: `https://radhefoods.de/${"x".repeat(500)}` })
        .link,
    ).toBe("At most 500 characters.");
    expect(isAbsoluteUrl("http://localhost:3001/x")).toBe(true);
    expect(isAbsoluteUrl("javascript:alert(1)")).toBe(false);
    expect(isAbsoluteUrl("https://")).toBe(false);
  });

  it("needs the English button label when there is a German one", () => {
    expect(
      problems({ ...valid, linkLabel: { en: "", de: "Zum Produkt" } }),
    ).toEqual({
      "linkLabel.en": "Give the English label too.",
    });
    expect(
      problems({ ...valid, linkLabel: { en: "See the product", de: "" } }),
    ).toEqual({});
  });

  it("needs at least one channel", () => {
    expect(problems({ ...valid, email: false, whatsapp: false })).toEqual({
      email: "Choose at least one channel.",
    });
    expect(problems({ ...valid, email: false, whatsapp: true })).toEqual({});
  });
});

describe("what the API gets", () => {
  it("leaves every empty optional field out", () => {
    const input = toAnnouncementInput(announcementSchema.parse(valid));
    expect(input).toEqual({
      subject: { en: "Fresh mangoes are in" },
      message: { en: "The first Alphonso mangoes arrive." },
      channels: ["email"],
    });
    // Not even as `undefined`: unknown and empty values are refused.
    expect(Object.keys(input).sort()).toEqual([
      "channels",
      "message",
      "subject",
    ]);
  });

  it("sends everything that was filled in", () => {
    const input = toAnnouncementInput(
      announcementSchema.parse({
        subject: { en: " Fresh mangoes are in ", de: "Frische Mangos sind da" },
        message: { en: "Line one\n\nLine two", de: "Zeile eins\nZeile zwei" },
        link: " https://radhefoods.de/products/alphonso-mango ",
        linkLabel: { en: "See the product", de: "Zum Produkt" },
        productId: "66f1a2b3c4d5e6f7a8b9c0d1",
        email: true,
        whatsapp: true,
      }),
    );
    expect(input).toEqual({
      subject: { en: "Fresh mangoes are in", de: "Frische Mangos sind da" },
      // Line breaks stay as they were typed.
      message: { en: "Line one\n\nLine two", de: "Zeile eins\nZeile zwei" },
      link: "https://radhefoods.de/products/alphonso-mango",
      linkLabel: { en: "See the product", de: "Zum Produkt" },
      productId: "66f1a2b3c4d5e6f7a8b9c0d1",
      channels: ["email", "whatsapp"],
    });
  });

  it("can send by WhatsApp alone", () => {
    const input = toAnnouncementInput(
      announcementSchema.parse({ ...valid, email: false, whatsapp: true }),
    );
    expect(input.channels).toEqual(["whatsapp"]);
  });
});

describe("the numbers of the preview", () => {
  it("counts customers once and messages per channel", () => {
    expect(customersReached({ email: 148, whatsapp: 23 })).toBe(148);
    expect(messagesQueued({ email: 148, whatsapp: 23 })).toBe(171);
    // WhatsApp alone.
    expect(customersReached({ email: 0, whatsapp: 23 })).toBe(23);
    expect(customersReached({ email: 0, whatsapp: 0 })).toBe(0);
  });
});

describe("the email in the preview frame", () => {
  it("takes the targets of links out and leaves the rest alone", () => {
    const html =
      '<!doctype html><p style="color:red">Hello</p><a href="https://radhefoods.de/x?a=1&amp;b=2" style="color:#fff">Visit</a> <a style="x" href=\'https://b.example\'>B</a>';
    expect(withoutLinkTargets(html)).toBe(
      '<!doctype html><p style="color:red">Hello</p><a style="color:#fff">Visit</a> <a style="x">B</a>',
    );
  });

  it("leaves a text that only mentions a link untouched", () => {
    const html = "<p>Write href=&quot;x&quot; in the text</p>";
    expect(withoutLinkTargets(html)).toBe(html);
  });
});
